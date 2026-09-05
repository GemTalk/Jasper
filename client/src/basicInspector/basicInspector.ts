/**
 * The basic tabbed Inspector — a webview panel that presents an object as tabs,
 * in the Enhanced Inspector's idiom, but built entirely on GCI primitives and
 * kernel sends so it needs **no server-side support installed**.
 *
 * This is what a session gets when the Enhanced Inspector is out of reach: its
 * payload isn't installed, or the stone is below the payload's 3.7.5 floor. Both
 * inspectors are editor-tab webviews driving the same miller-column strip
 * (`webview/millerColumns.js`), so which one a session routes to
 * (see `inspectRouter.ts`) is not something a user has to think about.
 *
 * Every query is in `queries/basicInspectorQueries.ts`, which documents the
 * no-server-support constraints the doits are written under. Writes and
 * evaluation go through the kernel sends in `debugQueries.ts`.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ActiveSession } from '../sessionManager';
import * as debug from '../debugQueries';
import { executeFetchString } from '../browserQueries';
import { logError } from '../gciLog';
import { QueryExecutor } from '../queries/types';
import { readWebviewScript } from '../webviewAssets';
import { SystemBrowser } from '../systemBrowser';
import {
  PAGE_SIZE,
  ObjectHeader,
  InspectorRow,
  fetchObjectHeader,
  fetchSlots,
  fetchItems,
  fetchEntries,
  fetchBytes,
  fetchObjectMeta,
  fetchMethodSource,
  fetchBrowseLocation,
} from './queries/basicInspectorQueries';

// Both webview scripts are read at runtime and injected as <script> tags — they
// are NOT compiled into the bundle (see webviewAssets.ts, and the `!` lines in
// .vscodeignore that keep them in the package).
const millerColumnsJs = readWebviewScript('millerColumns.js', 'webview');
const basicInspectorViewJs = readWebviewScript('basicInspectorView.js', 'basicInspector');

/** Preferred starting width of a column; it grows to fill spare space. */
const DEFAULT_COLUMN_WIDTH = 340;
/** Below this a column stops shrinking and the strip scrolls instead. */
const MIN_COLUMN_WIDTH = 280;

/**
 * How many pages one "Load all" click will read before stopping and leaving the
 * rest for the next click. See {@link BasicInspector.readPages}.
 */
const LOAD_ALL_MAX_PAGES = 50;

/** Which tab's data is being asked for. */
type TabName = 'slots' | 'items' | 'entries' | 'bytes' | 'meta' | 'print';

/** How a row's value is written back. Entries are keyed; the rest are indexed. */
type SlotKind = 'instvar' | 'indexed' | 'entry';

type BasicInspectorMessage =
  | { command: 'ready' }
  | {
      command: 'fetchTab';
      columnId: number;
      oop: string;
      tab: TabName;
      from: number;
      /** Keep reading pages to the end of the tab, rather than taking just one. */
      all?: boolean;
    }
  | { command: 'inspectRow'; sourceColumnId: number; oop: string; label: string }
  | {
      command: 'diveHere';
      columnId: number;
      oop: string;
      label: string;
      /**
       * Whether this dive should be recorded in the column's history. False for
       * a Back/Forward step, which is walking that history already. The host
       * doesn't interpret it — it echoes it back so the webview, which owns the
       * history, can tell the two apart.
       */
      remember: boolean;
    }
  | {
      command: 'evaluate';
      columnId: number;
      oop: string;
      expression: string;
      mode: 'display' | 'execute' | 'inspect';
    }
  | {
      command: 'setSlot';
      columnId: number;
      oop: string;
      kind: SlotKind;
      index: number;
      keyOop?: string;
      expression: string;
    }
  | {
      command: 'revertSlot';
      columnId: number;
      oop: string;
      kind: SlotKind;
      index: number;
      keyOop?: string;
    }
  | {
      command: 'fetchMethodSource';
      columnId: number;
      oop: string;
      selector: string;
      isClassSide: boolean;
    }
  | { command: 'browseClass'; oop: string }
  | { command: 'copyText'; text: string; what: string }
  | { command: 'setTitle'; title: string }
  | { command: 'closePanel' };

export class BasicInspector {
  private static panels = new Map<number, Set<BasicInspector>>();
  private readonly panel: vscode.WebviewPanel;
  private readonly sessionId: number;
  private disposables: vscode.Disposable[] = [];
  /** Monotonic id handed to each miller column; the root column is 0. */
  private nextColumnId = 1;

  /**
   * Slots the user has edited, keyed by {@link slotKey}: the OOP the slot held
   * before its FIRST edit, so revert always restores the original rather than
   * the previous edit. Mirrors the debugger's variable-revert bookkeeping.
   */
  private undoOriginals = new Map<string, bigint>();
  /** Slots still holding an edited value — drives the revert affordance. */
  private undoDirty = new Set<string>();
  /**
   * Non-immediate originals pinned into the session's export set so they can't
   * be scavenged (and their OOP numbers reused for something else) while we hold
   * them for a revert. Released en masse on dispose — the export set isn't
   * ref-counted, and a targeted release is all we may do since a session can
   * host more than one panel.
   */
  private undoPinned: bigint[] = [];

  static create(session: ActiveSession, oop: bigint, label: string): BasicInspector {
    const panel = vscode.window.createWebviewPanel(
      'gemstoneBasicInspector',
      'Inspector',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    const inspector = new BasicInspector(panel, session, oop, label);
    if (!BasicInspector.panels.has(session.id)) {
      BasicInspector.panels.set(session.id, new Set());
    }
    BasicInspector.panels.get(session.id)!.add(inspector);
    return inspector;
  }

  /**
   * Close this inspector's panel. Used by an owner (e.g. the debugger that
   * opened it) to tear it down; disposing the panel fires onDidDispose →
   * `dispose()`, which de-registers it from the per-session set.
   */
  close(): void {
    this.panel.dispose();
  }

  static disposeForSession(sessionId: number): void {
    const set = BasicInspector.panels.get(sessionId);
    if (set) {
      for (const inspector of set) inspector.panel.dispose();
      BasicInspector.panels.delete(sessionId);
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: ActiveSession,
    private readonly rootOop: bigint,
    private readonly rootLabel: string,
  ) {
    this.panel = panel;
    this.sessionId = session.id;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: BasicInspectorMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private dispose(): void {
    this.releasePins();
    BasicInspector.panels.get(this.sessionId)?.delete(this);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private makeExecutor(): QueryExecutor {
    return (code: string) => executeFetchString(this.session, code);
  }

  // ── Message dispatch ─────────────────────────────────

  private handleMessage(msg: BasicInspectorMessage): void {
    try {
      switch (msg.command) {
        case 'ready':
          this.postColumn('addRoot', 0, this.rootOop, this.rootLabel);
          return;
        case 'fetchTab':
          this.postTabData(msg.columnId, BigInt(msg.oop), msg.tab, msg.from, msg.all === true);
          return;
        case 'inspectRow':
          this.postColumn('addChild', this.nextColumnId++, BigInt(msg.oop), msg.label, {
            sourceColumnId: msg.sourceColumnId,
          });
          return;
        case 'diveHere':
          this.postColumn('replaceColumn', msg.columnId, BigInt(msg.oop), msg.label, {
            remember: msg.remember,
          });
          return;
        case 'evaluate':
          this.evaluate(msg.columnId, BigInt(msg.oop), msg.expression, msg.mode);
          return;
        case 'setSlot':
          this.setSlot(msg);
          return;
        case 'revertSlot':
          this.revertSlot(msg);
          return;
        case 'fetchMethodSource':
          this.panel.webview.postMessage({
            command: 'methodSource',
            columnId: msg.columnId,
            selector: msg.selector,
            isClassSide: msg.isClassSide,
            source:
              fetchMethodSource(
                this.makeExecutor(),
                BigInt(msg.oop),
                msg.selector,
                msg.isClassSide,
              ) ?? '"Source unavailable."',
          });
          return;
        case 'browseClass':
          this.browseClass(BigInt(msg.oop));
          return;
        case 'copyText':
          void vscode.env.clipboard.writeText(msg.text).then(() => {
            vscode.window.setStatusBarMessage(`${msg.what} copied`, 2000);
          });
          return;
        case 'setTitle':
          this.panel.title = msg.title ? `Inspector: ${msg.title}` : 'Inspector';
          return;
        case 'closePanel':
          this.panel.dispose();
          return;
      }
    } catch (e: unknown) {
      logError(this.sessionId, e instanceof Error ? e.message : String(e));
    }
  }

  // ── Columns ──────────────────────────────────────────

  /**
   * Send a column's header — the cheap facts the webview needs to lay out its
   * tab bar. `kind` distinguishes a fresh root, a drilled child inserted to the
   * right, and a dive that replaces an existing column's object in place.
   */
  private postColumn(
    kind: 'addRoot' | 'addChild' | 'replaceColumn',
    columnId: number,
    oop: bigint,
    label: string,
    extra: Record<string, unknown> = {},
  ): void {
    const header = fetchObjectHeader(this.makeExecutor(), oop);
    this.panel.webview.postMessage({
      command: kind,
      columnId,
      oop: oop.toString(),
      label,
      header: header ?? unreadableHeader(),
      ...extra,
    });
  }

  /**
   * Fetch one page of one tab — or, for a "Load all", every remaining page —
   * and post the result back to the column that asked.
   */
  private postTabData(
    columnId: number,
    oop: bigint,
    tab: TabName,
    from: number,
    all = false,
  ): void {
    const exec = this.makeExecutor();
    const payload: Record<string, unknown> = { command: 'tabData', columnId, tab, from };

    switch (tab) {
      case 'slots':
        payload.rows = this.stampRevertible(oop, fetchSlots(exec, oop), 'instvar');
        break;
      case 'items':
        payload.rows = this.stampRevertible(
          oop,
          this.readPages(from, PAGE_SIZE, all, (at, count) => fetchItems(exec, oop, at, count)),
          'indexed',
        );
        break;
      case 'entries':
        payload.rows = this.stampRevertible(
          oop,
          this.readPages(from, PAGE_SIZE, all, (at, count) => fetchEntries(exec, oop, at, count)),
          'entry',
        );
        break;
      case 'bytes':
        payload.bytes = this.readPages(from, PAGE_SIZE * 4, all, (at, count) =>
          fetchBytes(exec, oop, at, count),
        );
        break;
      case 'meta':
        payload.meta = fetchObjectMeta(exec, oop);
        break;
      case 'print':
        payload.text = debug.fetchFullPrintString(this.session, oop);
        break;
    }
    this.panel.webview.postMessage(payload);
  }

  /**
   * One page, or every page left, from a paged reader.
   *
   * Each page is a synchronous round trip to the stone, so "Load all" cannot
   * simply loop to the end: an Array of a million elements would hold the
   * extension host — and with it the webview — for as long as the reads took,
   * and then hand the webview a million rows to lay out. It stops after
   * {@link LOAD_ALL_MAX_PAGES}, which leaves the tab showing a remainder and
   * its Load more / Load all still offered, so another click carries on from
   * where this one stopped. A short page means the end of the object, and ends
   * the loop whatever the ceiling is.
   */
  private readPages<T>(
    from: number,
    pageSize: number,
    all: boolean,
    readPage: (at: number, count: number) => T[],
  ): T[] {
    const first = readPage(from, pageSize);
    if (!all || first.length < pageSize) return first;
    const rows = first;
    for (let page = 1; page < LOAD_ALL_MAX_PAGES; page++) {
      const next = readPage(from + rows.length, pageSize);
      rows.push(...next);
      if (next.length < pageSize) break;
    }
    return rows;
  }

  // ── Editing ──────────────────────────────────────────

  /**
   * Identifies one writable slot. The object's OOP is part of the key because a
   * panel holds several objects at once, and two of them can have a slot at the
   * same index.
   */
  private slotKey(oop: bigint, kind: SlotKind, index: number, keyOop?: string): string {
    return `${oop}:${kind}:${kind === 'entry' ? keyOop : index}`;
  }

  /** Mark the rows the user has edited so the webview can offer a revert. */
  private stampRevertible(oop: bigint, rows: InspectorRow[], kind: SlotKind): InspectorRow[] {
    if (this.undoDirty.size === 0) return rows;
    return rows.map((row) =>
      this.undoDirty.has(this.slotKey(oop, kind, row.index, row.keyOop))
        ? { ...row, revertible: true }
        : row,
    );
  }

  /**
   * Refuse a write while the session is mid-call. One GCI call is in flight per
   * session at a time, so a write issued now would fail deep in the binding with
   * a much less helpful message than this one.
   */
  private busyError(): string | null {
    const { result: inProgress } = this.session.gci.GciTsCallInProgress(this.session.handle);
    return inProgress !== 0 ? 'Session is busy with another operation — try again.' : null;
  }

  private setSlot(msg: {
    columnId: number;
    oop: string;
    kind: SlotKind;
    index: number;
    keyOop?: string;
    expression: string;
  }): void {
    const busy = this.busyError();
    if (busy) {
      this.postSlotResult(msg.columnId, false, busy);
      return;
    }
    const oop = BigInt(msg.oop);
    try {
      // Evaluate BEFORE capturing the original: a bad expression must leave the
      // slot — and the undo bookkeeping — completely untouched.
      const valueOop = debug.evaluateWithReceiverToOop(this.session, oop, msg.expression);
      this.captureOriginal(oop, msg.kind, msg.index, msg.keyOop);
      this.writeSlot(oop, msg.kind, msg.index, msg.keyOop, valueOop);
      this.undoDirty.add(this.slotKey(oop, msg.kind, msg.index, msg.keyOop));
      this.postSlotResult(msg.columnId, true);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logError(this.sessionId, message);
      this.postSlotResult(msg.columnId, false, message);
    }
  }

  private revertSlot(msg: {
    columnId: number;
    oop: string;
    kind: SlotKind;
    index: number;
    keyOop?: string;
  }): void {
    const oop = BigInt(msg.oop);
    const key = this.slotKey(oop, msg.kind, msg.index, msg.keyOop);
    const original = this.undoOriginals.get(key);
    if (original === undefined) {
      this.postSlotResult(msg.columnId, false, 'No original value recorded for this slot.');
      return;
    }
    const busy = this.busyError();
    if (busy) {
      this.postSlotResult(msg.columnId, false, busy);
      return;
    }
    try {
      // Write the original OOP straight back — never re-evaluate. Pins stay:
      // the user can edit and revert the same slot repeatedly.
      this.writeSlot(oop, msg.kind, msg.index, msg.keyOop, original);
      this.undoDirty.delete(key);
      this.postSlotResult(msg.columnId, true);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logError(this.sessionId, message);
      this.postSlotResult(msg.columnId, false, message);
    }
  }

  /**
   * Remember what a slot held before its first edit, pinning the value against
   * garbage collection unless it's an immediate. Without the pin the object
   * could be scavenged and its OOP number reused, so a later revert would
   * restore a different object entirely.
   */
  private captureOriginal(oop: bigint, kind: SlotKind, index: number, keyOop?: string): void {
    const key = this.slotKey(oop, kind, index, keyOop);
    if (this.undoOriginals.has(key)) return; // keep the FIRST original
    let original: bigint;
    try {
      original =
        kind === 'instvar'
          ? debug.getInstVarOop(this.session, oop, index)
          : kind === 'indexed'
            ? debug.getIndexedVarOop(this.session, oop, index)
            : debug.getDictionaryValueOop(this.session, oop, BigInt(keyOop!));
    } catch {
      return; // unreadable slot — offer no revert rather than a wrong one
    }
    this.undoOriginals.set(key, original);
    if (!debug.isSpecialOop(this.session, original)) {
      try {
        debug.saveObjs(this.session, [original]);
        this.undoPinned.push(original);
      } catch (e: unknown) {
        // Couldn't pin it: drop the record rather than offer a revert that might
        // restore whatever reused the OOP.
        this.undoOriginals.delete(key);
        logError(this.sessionId, e instanceof Error ? e.message : String(e));
      }
    }
  }

  private writeSlot(
    oop: bigint,
    kind: SlotKind,
    index: number,
    keyOop: string | undefined,
    valueOop: bigint,
  ): void {
    if (kind === 'instvar') debug.setInstVar(this.session, oop, index, valueOop);
    else if (kind === 'indexed') debug.setIndexedVar(this.session, oop, index, valueOop);
    else debug.setDictionaryValue(this.session, oop, BigInt(keyOop!), valueOop);
  }

  /**
   * A successful write leaves every printString and OOP on the tab stale — the
   * slot now points at a different object — so the webview re-fetches rather
   * than patching the one row.
   */
  private postSlotResult(columnId: number, ok: boolean, error?: string): void {
    this.panel.webview.postMessage({ command: 'setSlotResult', columnId, ok, error });
  }

  private releasePins(): void {
    if (this.undoPinned.length === 0) return;
    try {
      debug.releaseObjs(this.session, this.undoPinned);
    } catch {
      // Best effort — the session may already be gone.
    }
    this.undoPinned = [];
    this.undoOriginals.clear();
    this.undoDirty.clear();
  }

  // ── Evaluation pane ──────────────────────────────────

  /**
   * Run the pane's expression with the inspected object bound to `self`, and do
   * with the result what the editor's command of the same name does: Display It
   * prints it, Execute It is silent bar a status-bar line, Inspect It opens it
   * in a new column.
   */
  private evaluate(
    columnId: number,
    oop: bigint,
    expression: string,
    mode: 'display' | 'execute' | 'inspect',
  ): void {
    const busy = this.busyError();
    if (busy) {
      this.panel.webview.postMessage({ command: 'evalResult', columnId, ok: false, text: busy });
      return;
    }
    let resultOop: bigint;
    try {
      resultOop = debug.evaluateWithReceiverToOop(this.session, oop, expression);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      logError(this.sessionId, message);
      this.panel.webview.postMessage({ command: 'evalResult', columnId, ok: false, text: message });
      return;
    }
    if (mode === 'execute') {
      // Execute It is intentionally silent about its result, in the editor and
      // here alike; the pane's output box is cleared rather than left showing
      // the answer to the previous expression.
      vscode.window.setStatusBarMessage('GemStone: Executed successfully.', 3000);
      this.panel.webview.postMessage({ command: 'evalResult', columnId, ok: true, text: '' });
      return;
    }
    if (mode === 'inspect') {
      this.postColumn('addChild', this.nextColumnId++, resultOop, expression, {
        sourceColumnId: columnId,
      });
      this.panel.webview.postMessage({ command: 'evalResult', columnId, ok: true, text: '' });
      return;
    }
    this.panel.webview.postMessage({
      command: 'evalResult',
      columnId,
      ok: true,
      text: debug.getObjectPrintString(this.session, resultOop),
    });
  }

  // ── Browse ───────────────────────────────────────────

  private browseClass(oop: bigint): void {
    const location = fetchBrowseLocation(this.makeExecutor(), oop);
    if (!location || !location.dictName) {
      void vscode.window.showWarningMessage(
        'Cannot browse this value: failed to locate its class in GemStone.',
      );
      return;
    }
    SystemBrowser.navigateBeside(this.session, {
      dictName: location.dictName,
      className: location.className,
      isMeta: false,
      selector: '',
      category: '',
      environmentId: 0,
    });
  }

  // ── Webview ──────────────────────────────────────────

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Inspector</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
    }
    /* ── Column strip (miller columns) ─────────── */
    #columnStrip {
      display: flex;
      height: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: thin;
      /* Gutters between columns: the strip's divider-colored background shows
         through the flex gap, so each column reads as a separate pane. */
      gap: 6px;
      background: var(--vscode-editorGroup-border, var(--vscode-contrastBorder, var(--vscode-panel-border)));
    }
    .column {
      flex: 1 1 auto;
      min-width: ${MIN_COLUMN_WIDTH}px;
      height: 100%;
      position: relative;
      background: var(--vscode-editor-background);
      display: flex;
    }
    .col-inner { display: flex; flex-direction: column; height: 100%; width: 100%; overflow: hidden; }
    .column.focused .header { background: var(--vscode-list-inactiveSelectionBackground); }
    .col-resize-edge { position: absolute; top: 0; right: -2px; bottom: 0; width: 5px; cursor: col-resize; z-index: 5; }
    .col-resize-edge:hover, .col-resize-edge.active { background: var(--vscode-focusBorder, #007fd4); opacity: 0.7; }
    /* ── Header ──────────────────────────────── */
    .header {
      display: flex; align-items: center; gap: 5px; padding: 3px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0; min-height: 26px; overflow: hidden;
    }
    .nav-btn {
      cursor: pointer; user-select: none; flex-shrink: 0;
      opacity: 0.75; padding: 0 3px; line-height: 1; font-size: 1.05em;
      background: none; border: none; color: inherit; font-family: inherit;
    }
    .nav-btn:hover:not(:disabled) { opacity: 1; color: var(--vscode-textLink-foreground); }
    .nav-btn:disabled { opacity: 0.25; cursor: default; }
    .obj-class { font-weight: 600; white-space: nowrap; flex-shrink: 0; }
    .obj-sep { color: var(--vscode-descriptionForeground); flex-shrink: 0; }
    .obj-label {
      color: var(--vscode-descriptionForeground); font-size: 0.88em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .header-oop {
      margin-left: auto; font-size: 0.78em; color: var(--vscode-descriptionForeground);
      white-space: nowrap; flex-shrink: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; user-select: text;
    }
    .col-close {
      cursor: pointer; flex-shrink: 0; opacity: 0.5; font-size: 1.1em;
      line-height: 1; padding: 0 2px; user-select: none;
    }
    .col-close:hover { opacity: 1; color: var(--vscode-errorForeground); }
    /* ── Tab bar ─────────────────────────────── */
    .tab-bar {
      display: flex; border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0; overflow-x: auto; scrollbar-width: thin;
    }
    .tab {
      padding: 3px 14px; cursor: pointer; font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent; user-select: none;
      margin-bottom: -1px; white-space: nowrap;
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder, var(--vscode-button-background));
    }
    /* ── Content pane ────────────────────────── */
    .content-pane { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    .placeholder { padding: 12px 10px; color: var(--vscode-descriptionForeground); font-style: italic; }
    .detail-value {
      font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap; word-break: break-word; overflow: auto;
      flex: 1; min-height: 0; padding: 8px 10px; user-select: text;
    }
    /* ── Tables ──────────────────────────────── */
    .table-wrap { overflow: auto; flex: 1; }
    table.rows { border-collapse: collapse; width: 100%; }
    table.rows th {
      position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background);
      text-align: left; padding: 2px 6px; border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600; white-space: nowrap; user-select: none;
    }
    table.rows td {
      padding: 2px 6px; border-bottom: 1px solid var(--vscode-list-hoverBackground);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 0;
    }
    table.rows tr:hover td { background: var(--vscode-list-hoverBackground); }
    table.rows tr.selected td { background: var(--vscode-list-inactiveSelectionBackground); }
    .cell-label { font-family: var(--vscode-editor-font-family); width: 30%; }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable:hover { color: var(--vscode-textLink-foreground); }
    .sort-mark { margin-left: 4px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .cell-class { color: var(--vscode-descriptionForeground); width: 22%; }
    .cell-edited { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-charts-yellow)); }
    .revert-btn {
      background: none; border: none; cursor: pointer; color: inherit;
      opacity: 0.7; padding: 0 3px; font-size: 0.95em;
    }
    .revert-btn:hover { opacity: 1; color: var(--vscode-textLink-foreground); }
    .load-more-row td { padding: 4px 8px; color: var(--vscode-textLink-foreground); cursor: pointer; font-style: italic; }
    .load-more-row:hover td { text-decoration: underline; }
    .row-editor {
      width: 100%; font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-focusBorder); padding: 1px 3px;
    }
    .edit-error { color: var(--vscode-errorForeground); font-size: 0.85em; padding: 3px 8px; }
    /* ── Bytes ───────────────────────────────── */
    /* The dump is column-aligned by spaces, so they have to survive. */
    .bytes {
      font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
      padding: 8px 10px; overflow: auto; flex: 1; user-select: text; white-space: pre;
    }
    .bytes-head {
      color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 3px; padding-bottom: 2px; position: sticky; top: 0;
      background: var(--vscode-editor-background);
    }
    .bytes .off { color: var(--vscode-descriptionForeground); }
    .bytes .txt { color: var(--vscode-textLink-foreground); }
    /* ── Meta ────────────────────────────────── */
    /* Laid out like the Enhanced Inspector's Meta tab: a class heading, an info
       bar of one-line facts, then sub-tabs over a single scrolling pane. Only
       .meta-sub-content scrolls, so the heading and sub-tab bar stay put. */
    .meta { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .meta-head { padding: 8px 12px 4px; flex-shrink: 0; }
    .meta-head-label {
      font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-bottom: 2px;
    }
    .meta-class-name {
      font-family: var(--vscode-editor-font-family); font-size: 1.15em;
      font-weight: 600; word-break: break-all;
    }
    .meta-info-bar {
      padding: 2px 12px 6px; flex-shrink: 0; font-size: 0.82em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex; gap: 12px; flex-wrap: wrap; user-select: text;
    }
    .meta-info-bar strong { color: var(--vscode-foreground); font-weight: 600; }
    .meta-sub-bar {
      display: flex; flex-shrink: 0; overflow-x: auto; scrollbar-width: thin;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .meta-sub-content { flex: 1; min-height: 0; overflow: auto; padding: 6px 10px; }
    .meta-pre {
      font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap; word-break: break-word; user-select: text; margin: 0;
    }
    .meta-comment { font-family: var(--vscode-font-family); line-height: 1.5; }
    /* A selector list is a list of clickable rows, not a paragraph of words:
       each one gets a rule under it and a disclosure caret, so where one ends
       and the next begins is not something the eye has to work out. */
    .method-list { border-top: 1px solid var(--vscode-panel-border); }
    .method-item {
      padding: 3px 6px 3px 4px; cursor: pointer; user-select: none;
      font-family: var(--vscode-editor-font-family);
      border-bottom: 1px solid var(--vscode-panel-border);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .method-item::before {
      content: '\\25B8'; display: inline-block; width: 12px;
      color: var(--vscode-descriptionForeground); font-size: 0.85em;
    }
    .method-item.open::before { content: '\\25BE'; }
    .method-item:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-textLink-foreground); }
    .method-item.open { background: var(--vscode-list-inactiveSelectionBackground); }
    .method-source-box {
      margin: 4px 0 6px 14px; padding: 6px 8px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border); border-radius: 3px;
      font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap; user-select: text;
    }
    /* ── Evaluate pane ───────────────────────── */
    .eval { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 8px 10px; gap: 6px; }
    .eval textarea {
      font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      padding: 4px 6px; resize: vertical; min-height: 60px;
    }
    .eval-body { display: flex; flex: 1; min-height: 0; gap: 8px; }
    .eval-editor { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 6px; }
    /* The clear button sits inside the expression box's top-right corner and is
       revealed only when there is text — matching the debugger's eval bar. */
    .eval-input-wrap { position: relative; display: flex; flex-shrink: 0; }
    /* Sole flex item of the wrap, so it has to be told to fill it — a bare
       textarea would otherwise fall back to its default column width. */
    .eval-input-wrap textarea { flex: 1; min-width: 0; padding-right: 1.6rem; }
    .clear-btn {
      position: absolute; right: 6px; top: 6px;
      visibility: hidden; background: none; border: none; padding: 0 2px;
      cursor: pointer; line-height: 1; font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .clear-btn:hover { color: var(--vscode-foreground); }
    .eval-input-wrap.has-text .clear-btn { visibility: visible; }
    /* The names list fills what was dead space to the right of the expression.
       Sized in ch so it holds a realistic identifier without crowding the
       editor, and it gives way first when the column is narrow. */
    .eval-vars {
      width: 26ch; min-width: 14ch; flex-shrink: 1; display: flex; flex-direction: column;
      border-left: 1px solid var(--vscode-panel-border); padding-left: 8px; min-height: 0;
    }
    .eval-vars-list { overflow: auto; flex: 1; min-height: 0; }
    /* The declaring class of the names under it — an inherited instance
       variable is as much in scope here as one the class declares itself, and
       this is what says so. */
    .eval-var-owner {
      font-size: 0.75em; color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 4px 3px 1px; margin-bottom: 2px; position: sticky; top: 0;
      background: var(--vscode-editor-background);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .eval-var-owner:first-child { padding-top: 0; }
    .eval-var {
      display: flex; align-items: baseline; gap: 6px; cursor: pointer;
      padding: 1px 3px; border-radius: 2px;
      font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
    }
    .eval-var:hover { background: var(--vscode-list-hoverBackground); }
    .eval-var-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .eval-var-class {
      margin-left: auto; font-size: 0.85em; color: var(--vscode-descriptionForeground);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1;
    }
    .eval-var-copy {
      background: none; border: none; cursor: pointer; color: inherit;
      opacity: 0; padding: 0 2px; font-size: 0.85em; flex-shrink: 0;
    }
    .eval-var:hover .eval-var-copy { opacity: 0.7; }
    .eval-var-copy:hover { opacity: 1; }
    .eval-hint { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .eval-hint.armed { color: var(--vscode-textLink-foreground); }
    .eval-out {
      flex: 1; min-height: 0; overflow: auto; white-space: pre-wrap; word-break: break-word;
      font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size);
      user-select: text; padding: 4px 6px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border); border-radius: 3px;
    }
    .eval-out.error { color: var(--vscode-errorForeground); }
    /* ── Shared bits ─────────────────────────── */
    .toolbar { display: flex; align-items: center; gap: 6px; padding: 3px 6px; flex-shrink: 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .toolbar-gap { flex: 1; }
    .btn {
      background: var(--vscode-button-secondaryBackground, transparent);
      border: 1px solid var(--vscode-panel-border); border-radius: 3px;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      cursor: pointer; padding: 1px 8px; font-size: 0.8em; font-family: var(--vscode-font-family);
    }
    .btn:hover { background: var(--vscode-list-hoverBackground); }
    .btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
    .toolbar-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .ctx-menu {
      position: fixed; display: none;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border); border-radius: 3px;
      padding: 2px 0; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .ctx-item { padding: 4px 16px; cursor: pointer; white-space: nowrap; color: var(--vscode-menu-foreground, var(--vscode-foreground)); font-size: 0.9em; }
    .ctx-item:hover { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .ctx-sep { height: 1px; margin: 3px 0; background: var(--vscode-panel-border); }
  </style>
</head>
<body>
  <div id="columnStrip"></div>
  <div id="rowCtxMenu" class="ctx-menu">
    <div class="ctx-item" data-action="inspect">Inspect</div>
    <div class="ctx-item" data-action="dive">Dive Here</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-action="edit">Edit Value…</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-action="copyValue">Copy printString</div>
    <div class="ctx-item" data-action="copyOop">Copy OOP</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-action="browse">Browse Class</div>
  </div>
  <script nonce="${nonce}">${millerColumnsJs}</script>
  <script nonce="${nonce}">${basicInspectorViewJs}</script>
  <script nonce="${nonce}">
    BasicInspectorView.init({
      strip: document.getElementById('columnStrip'),
      ctxMenu: document.getElementById('rowCtxMenu'),
      vscode: acquireVsCodeApi(),
      pageSize: ${PAGE_SIZE},
      defaultColumnWidth: ${DEFAULT_COLUMN_WIDTH},
      minColumnWidth: ${MIN_COLUMN_WIDTH},
    });
  </script>
</body>
</html>`;
  }
}

/**
 * Stand-in header for an object the stone wouldn't describe. The column still
 * renders — with a Print tab and nothing else — rather than coming up empty.
 */
function unreadableHeader(): ObjectHeader {
  return {
    className: '<unreadable>',
    superclassName: '',
    namedSize: 0,
    itemCount: 0,
    entryCount: 0,
    isBytes: false,
    isDictionary: false,
    printString: '<could not read this object>',
    sizeUnit: '',
  };
}
