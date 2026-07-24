import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ActiveSession } from './sessionManager';
import * as debug from './debugQueries';
import { executeFetchString } from './browserQueries';
import {
  getEnhancedInspectorViewSpecs,
  fetchEnhancedInspectorPrintTabData,
  fetchEnhancedInspectorTextData,
  fetchEnhancedInspectorListData,
  fetchEnhancedInspectorForwardListData,
  fetchEnhancedInspectorForwardListTotal,
  fetchEnhancedInspectorRowOop,
  fetchEnhancedInspectorForwardRowOop,
  fetchEnhancedInspectorTreeChildren,
  fetchEnhancedInspectorListTotal,
  fetchObjectMeta,
  fetchMethodSource,
  fetchMethodBrowseLocation,
} from './queries/getEnhancedInspectorViewSpecs';
import { SystemBrowser } from './systemBrowser';
import { QueryExecutor } from './queries/types';

// Column-strip model, injected into the webview as a <script> tag (read at
// runtime, not bundled — same pattern as listFilter.js / methodListView.js).
const enhancedInspectorColumnsJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'enhancedInspectorColumns.js'),
  'utf8',
);

const PAGE_SIZE = 100;
// Preferred starting width of a column (its flex-basis). Columns grow past this
// to fill spare horizontal space and shrink toward MIN_COLUMN_WIDTH when
// crowded; below that the strip scrolls horizontally.
const DEFAULT_COLUMN_WIDTH = 340;
const MIN_COLUMN_WIDTH = 280;

type InspectorMessage =
  | { command: 'ready' }
  | {
      command: 'fetchEnhancedInspectorViewData';
      columnId: number;
      oop: string;
      methodSelector: string;
      viewName: string;
    }
  | {
      command: 'fetchMoreRows';
      columnId: number;
      oop: string;
      methodSelector: string;
      viewName: string;
      fromIndex: number;
    }
  | {
      command: 'fetchEnhancedInspectorViewTotal';
      columnId: number;
      oop: string;
      methodSelector: string;
      viewName: string;
    }
  | {
      command: 'fetchEnhancedInspectorRangeData';
      columnId: number;
      oop: string;
      methodSelector: string;
      viewName: string;
      fromIndex: number;
      rangeStart: number;
    }
  | {
      command: 'fetchEnhancedInspectorTreeChildren';
      columnId: number;
      itemOop: string;
      methodSelector: string;
      path: number[];
    }
  | {
      command: 'enhancedInspectRow';
      columnId: number;
      itemOop: string;
      methodSelector: string;
      nodeId: number;
      viewName: string;
    }
  | { command: 'fetchFullPrintString'; columnId: number; oop: string; methodSelector: string }
  | {
      command: 'fetchMethodSource';
      columnId: number;
      oop: string;
      methodSelector: string;
      isClassSide: boolean;
    }
  | {
      command: 'browseMethod';
      columnId: number;
      oop: string;
      methodSelector: string;
      isClassSide: boolean;
    }
  | { command: 'setTitle'; title: string }
  | { command: 'closePanel' };

/** Object metadata the extension fetches once per column and posts to the webview. */
interface ColumnPayload {
  title: string;
  className: string;
  specs: unknown;
  meta: string | null;
}

export class EnhancedInspector {
  private static panels = new Map<number, Set<EnhancedInspector>>();
  private readonly panel: vscode.WebviewPanel;
  private readonly sessionId: number;
  private disposables: vscode.Disposable[] = [];
  private currentOop: bigint;
  private currentLabel: string;
  /** Monotonic id handed to each miller column; the root column is 0. */
  private readonly rootColumnId = 0;
  private nextColumnId = 1;

  static create(session: ActiveSession, oop: bigint, label: string): EnhancedInspector {
    const panel = vscode.window.createWebviewPanel(
      'gemstoneEnhancedInspector',
      'Inspector',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    const inspector = new EnhancedInspector(panel, session, oop, label);
    if (!EnhancedInspector.panels.has(session.id)) {
      EnhancedInspector.panels.set(session.id, new Set());
    }
    EnhancedInspector.panels.get(session.id)!.add(inspector);
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
    const set = EnhancedInspector.panels.get(sessionId);
    if (set) {
      for (const inspector of set) inspector.panel.dispose();
      EnhancedInspector.panels.delete(sessionId);
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: ActiveSession,
    oop: bigint,
    label: string,
  ) {
    this.panel = panel;
    this.sessionId = session.id;
    this.currentOop = oop;
    this.currentLabel = label;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: InspectorMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  /** Fetch everything a column needs to render an object: title, class, view specs, meta. */
  private buildColumnPayload(oop: bigint): ColumnPayload {
    const exec = this.makeExecutor();
    const ps = debug.fetchPrintString(this.session, oop, 40);
    const title = ps.value + (ps.truncated ? '…' : '');
    const className = debug.getObjectClassName(this.session, oop);
    const specs = getEnhancedInspectorViewSpecs(exec, oop);
    const meta = fetchObjectMeta(exec, oop);
    return { title, className, specs, meta };
  }

  private handleMessage(msg: InspectorMessage): void {
    switch (msg.command) {
      case 'ready': {
        const payload = this.buildColumnPayload(this.currentOop);
        this.panel.title = payload.title;
        this.panel.webview.postMessage({
          command: 'enhancedInspectorViewSpecs',
          columnId: this.rootColumnId,
          oop: this.currentOop.toString(),
          specs: payload.specs,
          className: payload.className,
          label: this.currentLabel,
          meta: payload.meta,
          title: payload.title,
        });
        break;
      }

      case 'fetchEnhancedInspectorViewData': {
        const oop = BigInt(msg.oop);
        if (
          msg.viewName === 'GtPhlowTextEditorViewSpecification' &&
          msg.methodSelector === 'gtPrintFor:'
        ) {
          const result = fetchEnhancedInspectorPrintTabData(
            this.makeExecutor(),
            oop,
            msg.methodSelector,
          );
          this.panel.webview.postMessage({
            command: 'enhancedInspectorViewData',
            columnId: msg.columnId,
            methodSelector: msg.methodSelector,
            data: result.data,
            truncated: result.truncated,
          });
        } else {
          const data = this.fetchEnhancedInspectorViewData(oop, msg.methodSelector, msg.viewName);
          this.panel.webview.postMessage({
            command: 'enhancedInspectorViewData',
            columnId: msg.columnId,
            methodSelector: msg.methodSelector,
            data,
          });
        }
        break;
      }

      case 'fetchMoreRows': {
        const more = this.fetchEnhancedInspectorViewData(
          BigInt(msg.oop),
          msg.methodSelector,
          msg.viewName,
          msg.fromIndex,
        );
        this.panel.webview.postMessage({
          command: 'enhancedInspectorMoreRows',
          columnId: msg.columnId,
          methodSelector: msg.methodSelector,
          data: more,
        });
        break;
      }

      case 'fetchEnhancedInspectorViewTotal': {
        const isForward = msg.viewName === 'GtPhlowForwardViewSpecification';
        const total = isForward
          ? fetchEnhancedInspectorForwardListTotal(
              this.makeExecutor(),
              BigInt(msg.oop),
              msg.methodSelector,
            )
          : fetchEnhancedInspectorListTotal(
              this.makeExecutor(),
              BigInt(msg.oop),
              msg.methodSelector,
            );
        this.panel.webview.postMessage({
          command: 'enhancedInspectorViewTotal',
          columnId: msg.columnId,
          methodSelector: msg.methodSelector,
          total,
        });
        break;
      }

      case 'fetchEnhancedInspectorRangeData': {
        const rangeData =
          msg.viewName === 'GtPhlowForwardViewSpecification'
            ? fetchEnhancedInspectorForwardListData(
                this.makeExecutor(),
                BigInt(msg.oop),
                msg.methodSelector,
                msg.fromIndex,
                PAGE_SIZE,
              )
            : fetchEnhancedInspectorListData(
                this.makeExecutor(),
                BigInt(msg.oop),
                msg.methodSelector,
                msg.fromIndex,
                PAGE_SIZE,
              );
        this.panel.webview.postMessage({
          command: 'enhancedInspectorRangeData',
          columnId: msg.columnId,
          methodSelector: msg.methodSelector,
          rangeStart: msg.rangeStart,
          data: rangeData,
        });
        break;
      }

      case 'fetchEnhancedInspectorTreeChildren': {
        const children = fetchEnhancedInspectorTreeChildren(
          this.makeExecutor(),
          BigInt(msg.itemOop),
          msg.methodSelector,
          msg.path,
        );
        this.panel.webview.postMessage({
          command: 'enhancedInspectorTreeChildren',
          columnId: msg.columnId,
          methodSelector: msg.methodSelector,
          path: msg.path,
          data: children,
        });
        break;
      }

      case 'fetchFullPrintString': {
        const fullText = debug.fetchFullPrintString(this.session, BigInt(msg.oop));
        const data = JSON.stringify({ string: fullText, stylerSpecification: null });
        this.panel.webview.postMessage({
          command: 'fullPrintString',
          columnId: msg.columnId,
          methodSelector: msg.methodSelector,
          data,
        });
        break;
      }

      case 'browseMethod': {
        const loc = fetchMethodBrowseLocation(
          this.makeExecutor(),
          BigInt(msg.oop),
          msg.methodSelector,
          msg.isClassSide,
        );
        if (!loc) {
          vscode.window.showWarningMessage(
            `Cannot browse ${msg.methodSelector}: failed to locate class in GemStone.`,
          );
          break;
        }
        SystemBrowser.navigateBeside(this.session, {
          dictName: loc.dictName,
          className: loc.className,
          isMeta: msg.isClassSide,
          selector: msg.methodSelector,
          category: loc.category,
        });
        break;
      }

      case 'fetchMethodSource': {
        const source = fetchMethodSource(
          this.makeExecutor(),
          BigInt(msg.oop),
          msg.methodSelector,
          msg.isClassSide,
        );
        this.panel.webview.postMessage({
          command: 'methodSource',
          columnId: msg.columnId,
          methodSelector: msg.methodSelector,
          isClassSide: msg.isClassSide,
          source,
        });
        break;
      }

      case 'enhancedInspectRow': {
        const rowOop =
          msg.viewName === 'GtPhlowForwardViewSpecification'
            ? fetchEnhancedInspectorForwardRowOop(
                this.makeExecutor(),
                BigInt(msg.itemOop),
                msg.methodSelector,
                msg.nodeId,
              )
            : fetchEnhancedInspectorRowOop(
                this.makeExecutor(),
                BigInt(msg.itemOop),
                msg.methodSelector,
                msg.nodeId,
              );
        if (rowOop !== null) {
          const columnId = this.nextColumnId++;
          const label = msg.methodSelector + '[' + msg.nodeId + ']';
          const payload = this.buildColumnPayload(rowOop);
          this.panel.webview.postMessage({
            command: 'addColumn',
            columnId,
            sourceColumnId: msg.columnId,
            oop: rowOop.toString(),
            specs: payload.specs,
            className: payload.className,
            label,
            meta: payload.meta,
            title: payload.title,
          });
        }
        break;
      }

      case 'setTitle': {
        this.panel.title = msg.title;
        break;
      }

      case 'closePanel': {
        this.panel.dispose();
        break;
      }
    }
  }

  private makeExecutor(): QueryExecutor {
    return (code) => executeFetchString(this.session, code);
  }

  private fetchEnhancedInspectorViewData(
    oop: bigint,
    methodSelector: string,
    viewName: string,
    fromIndex = 1,
  ): string | null {
    const execute = this.makeExecutor();
    if (
      viewName === 'GtPhlowTextViewSpecification' ||
      viewName === 'GtPhlowTextEditorViewSpecification'
    ) {
      return fetchEnhancedInspectorTextData(execute, oop, methodSelector);
    }
    if (viewName === 'GtPhlowForwardViewSpecification') {
      return fetchEnhancedInspectorForwardListData(
        execute,
        oop,
        methodSelector,
        fromIndex,
        PAGE_SIZE,
      );
    }
    return fetchEnhancedInspectorListData(execute, oop, methodSelector, fromIndex, PAGE_SIZE);
  }

  private dispose(): void {
    EnhancedInspector.panels.get(this.sessionId)?.delete(this);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const pageSize = PAGE_SIZE;
    const defaultColumnWidth = DEFAULT_COLUMN_WIDTH;
    const minColumnWidth = MIN_COLUMN_WIDTH;
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
      /* Gutters between inspectors: the strip's divider-colored background shows
         through the flex gap, so each column reads as a separate pane. */
      gap: 6px;
      background: var(--vscode-editorGroup-border, var(--vscode-contrastBorder, var(--vscode-panel-border)));
    }
    .column {
      flex: 1 1 auto;
      min-width: ${minColumnWidth}px;
      height: 100%;
      position: relative;
      background: var(--vscode-editor-background);
      display: flex;
    }
    .col-inner {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    .column.focused .header { background: var(--vscode-list-inactiveSelectionBackground); }
    .col-resize-edge {
      position: absolute;
      top: 0; right: -2px; bottom: 0;
      width: 5px;
      cursor: col-resize;
      z-index: 5;
    }
    .col-resize-edge:hover, .col-resize-edge.active { background: var(--vscode-focusBorder, #007fd4); opacity: 0.7; }
    /* ── Header ──────────────────────────────── */
    .header {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      min-height: 26px;
      overflow: hidden;
    }
    .obj-class { font-weight: 600; white-space: nowrap; flex-shrink: 0; }
    .obj-sep { color: var(--vscode-descriptionForeground); flex-shrink: 0; }
    .obj-label {
      color: var(--vscode-descriptionForeground);
      font-size: 0.88em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .header-oop {
      margin-left: auto;
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      /* Shrink/ellipsis a long OOP so the close button (fixed) is never pushed
         past the header's overflow:hidden edge. */
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: text;
    }
    .col-close {
      cursor: pointer;
      flex-shrink: 0;
      opacity: 0.5;
      font-size: 1.1em;
      line-height: 1;
      padding: 0 2px;
      user-select: none;
    }
    .col-close:hover { opacity: 1; color: var(--vscode-errorForeground); }
    /* ── Tab bar ─────────────────────────────── */
    .tab-bar {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      overflow-x: auto;
      scrollbar-width: thin;
    }
    .tab {
      padding: 3px 14px;
      cursor: pointer;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent;
      user-select: none;
      margin-bottom: -1px;
      white-space: nowrap;
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder, var(--vscode-button-background));
    }
    /* ── Content pane ────────────────────────── */
    .content-pane {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 8px 10px;
    }
    .detail-value {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-break: break-all;
      overflow: auto;
      flex: 1;
      min-height: 0;
    }
    .placeholder { padding: 12px 8px; color: var(--vscode-descriptionForeground); font-style: italic; }
    /* ── view table ───────────────────────── */
    .ei-table-wrap { overflow: auto; flex: 1; }
    .ei-table { border-collapse: collapse; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    .ei-table th { position: sticky; top: 0; z-index: 1; background: var(--vscode-editor-background); text-align: left; padding: 2px 20px 2px 6px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: none; }
    .ei-table td { padding: 2px 6px; border-bottom: 1px solid var(--vscode-list-hoverBackground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .col-resize-handle { position: absolute; top: 0; right: 0; bottom: 0; width: 5px; cursor: col-resize; background: transparent; }
    .col-resize-handle:hover, .col-resize-handle.active { background: var(--vscode-focusBorder, #007fd4); opacity: 0.7; }
    .load-more-row td { padding: 4px 8px; color: var(--vscode-textLink-foreground); cursor: pointer; font-style: italic; }
    .load-more-row:hover td { text-decoration: underline; }
    .table-toolbar { display:flex; align-items:center; gap:8px; padding:2px 4px; flex-shrink:0; border-bottom:1px solid var(--vscode-panel-border); }
    .table-btn { background:var(--vscode-button-secondaryBackground,transparent); border:1px solid var(--vscode-panel-border); border-radius:3px; color:var(--vscode-button-secondaryForeground,var(--vscode-foreground)); cursor:pointer; padding:1px 8px; font-size:0.8em; font-family:var(--vscode-font-family); }
    .table-btn:hover { background:var(--vscode-list-hoverBackground); }
    .table-btn.active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:var(--vscode-button-background); }
    .toolbar-label { font-size:0.8em; color:var(--vscode-descriptionForeground); }
    .range-node td { background:var(--vscode-editor-background); font-family:var(--vscode-font-family); cursor:pointer; padding:3px 8px; border-bottom:1px solid var(--vscode-panel-border); }
    .range-node:hover td { background:var(--vscode-list-hoverBackground); }
    .tree-toggle { background: none; border: none; cursor: pointer; color: inherit; padding: 0 2px; font-size: 0.85em; opacity: 0.6; width: 16px; text-align: center; }
    .tree-toggle:hover { opacity: 1; }
    .ctx-menu { position: fixed; display: none; background: var(--vscode-menu-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 2px 0; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .ctx-item { padding: 4px 16px; cursor: pointer; white-space: nowrap; color: var(--vscode-menu-foreground, var(--vscode-foreground)); font-size: 0.9em; }
    .ctx-item:hover { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .method-item { padding: 2px 0; cursor: pointer; user-select: none; }
    .method-item:hover .method-label { color: var(--vscode-textLink-foreground); }
    .method-source-box { margin: 4px 0 4px 14px; padding: 6px 8px; background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); user-select: text; }
    .method-source-header { display: flex; justify-content: flex-end; margin-bottom: 4px; padding-bottom: 3px; border-bottom: 1px solid var(--vscode-panel-border); }
    .method-browse-btn { cursor: pointer; color: var(--vscode-textLink-foreground); font-size: 0.8em; font-family: var(--vscode-font-family); user-select: none; }
    .method-browse-btn:hover { text-decoration: underline; }
    .method-source-code { white-space: pre-wrap; cursor: text; }
  </style>
</head>
<body>
  <div id="columnStrip"></div>
  <div id="rowCtxMenu" class="ctx-menu">
    <div class="ctx-item" id="rowCtxInspect">Inspect</div>
  </div>
  <script nonce="${nonce}">${enhancedInspectorColumnsJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const PAGE_SIZE = ${pageSize};
    const DEFAULT_COLUMN_WIDTH = ${defaultColumnWidth};
    const MIN_COLUMN_WIDTH = ${minColumnWidth};

    const strip = document.getElementById('columnStrip');
    let resizingCol = null;        // active table data-column resize
    let resizingPane = null;       // active miller-pane width resize
    let ctxMenuNodeId = null;
    let ctxMenuColumnId = null;

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function metaDataOf(col) {
      try { return col.metaData ? JSON.parse(col.metaData) : null; } catch { return null; }
    }

    // ── Column DOM + content ──────────────────
    // The miller-column MODEL (add/insert-right/close/focus/width) lives in the
    // injected enhancedInspectorColumns.js (unit-tested in jsdom). Here we only
    // build a column's DOM and populate its content; the model calls back into
    // these via buildColumnDom/populate below.

    function createColumnDom(col) {
      const root = document.createElement('div');
      root.className = 'column';
      root.dataset.colId = col.id;
      root.innerHTML =
        '<div class="col-inner">' +
          '<div class="header">' +
            '<span class="obj-class"></span>' +
            '<span class="obj-sep" style="display:none">&#8250;</span>' +
            '<span class="obj-label"></span>' +
            '<span class="header-oop"></span>' +
            '<span class="col-close" title="Close">&#215;</span>' +
          '</div>' +
          '<div class="tab-bar"><div class="placeholder">Loading&#8230;</div></div>' +
          '<div class="content-pane"><div class="placeholder">Loading&#8230;</div></div>' +
        '</div>' +
        '<div class="col-resize-edge"></div>';
      col.el = {
        root: root,
        objClass: root.querySelector('.obj-class'),
        objSep: root.querySelector('.obj-sep'),
        objLabel: root.querySelector('.obj-label'),
        headerOop: root.querySelector('.header-oop'),
        tabBar: root.querySelector('.tab-bar'),
        contentPane: root.querySelector('.content-pane'),
      };
      return root;
    }

    function populateColumn(col, msg) {
      col.oop = msg.oop;
      col.specs = msg.specs || null;
      col.metaData = msg.meta || null;
      col.className = msg.className || '';
      col.label = msg.label || '';
      col.title = msg.title || '';
      col.activeMethodSelector = null;
      col.cachedViewData = {}; col.loadedRowCounts = {}; col.colWidths = {};
      col.rangesMode = {}; col.rangeTotals = {}; col.rangeDataCache = {}; col.methodSourceCache = {};
      col.metaSubTab = 'instanceMethods'; col.openMethodSel = null;

      const e = col.el;
      e.objClass.textContent = col.className;
      const hasLabel = !!col.label;
      e.objSep.style.display = hasLabel ? '' : 'none';
      e.objLabel.textContent = hasLabel ? col.label : '';
      e.headerOop.textContent = 'OOP: ' + (col.oop || '');
      buildTabBar(col);
      // Always append a Meta tab
      e.tabBar.insertAdjacentHTML('beforeend',
        '<div class="tab" data-selector="__meta__" title="Class and package metadata">Meta</div>');
      if (col.specs && col.specs.length > 0) activateTab(col, col.specs[0].methodSelector);
      else activateTab(col, '__meta__');
    }

    // Column-strip model (injected enhancedInspectorColumns.js). Owns column
    // order, additive insert-right drilling, independent close, focus→title,
    // and width inherit/pin. Rendering is supplied via the two callbacks.
    const Columns = EnhancedInspectorColumns.createColumnStrip({
      strip: strip,
      postMessage: function (m) { vscode.postMessage(m); },
      defaultWidth: DEFAULT_COLUMN_WIDTH,
      minWidth: MIN_COLUMN_WIDTH,
      buildColumnDom: createColumnDom,
      populate: populateColumn,
    });

    // ── Tab bar ───────────────────────────────

    function buildTabBar(col) {
      const tabBar = col.el.tabBar;
      const viewSpecs = col.specs;
      if (!viewSpecs || !viewSpecs.length) {
        tabBar.innerHTML = '<div class="placeholder">No views available.</div>';
        return;
      }
      tabBar.innerHTML = viewSpecs.map(s => {
        const full = s.title;
        const label = full.length > 22 ? full.slice(0, 20) + '…' : full;
        return '<div class="tab" data-selector="' + esc(s.methodSelector) + '" title="' + esc(full) + '">' + esc(label) + '</div>';
      }).join('');
    }

    function activateTab(col, methodSelector) {
      col.activeMethodSelector = methodSelector;
      col.el.tabBar.querySelectorAll('.tab').forEach(t =>
        t.classList.toggle('active', t.dataset.selector === methodSelector));
      const contentPane = col.el.contentPane;
      if (methodSelector === '__meta__') {
        renderMetaTab(col, contentPane);
        return;
      }
      const spec = col.specs && col.specs.find(s => s.methodSelector === methodSelector);
      if (!spec) return;
      if (col.cachedViewData[methodSelector] !== undefined) {
        renderEnhancedInspectorContent(col, contentPane, spec, col.cachedViewData[methodSelector]);
      } else {
        contentPane.innerHTML = '<div class="placeholder">Loading…</div>';
        vscode.postMessage({ command: 'fetchEnhancedInspectorViewData', columnId: col.id, oop: col.oop, methodSelector, viewName: spec.viewName });
      }
    }

    // ── Delegated interactions on the strip ────

    // Focus, close, main-tab activation
    strip.addEventListener('click', e => {
      const col = Columns.columnOf(e.target);
      if (!col) return;
      Columns.focus(col);
      if (e.target.closest('.col-close')) { Columns.close(col); return; }
      const tab = e.target.closest('.tab');
      if (tab && tab.parentElement === col.el.tabBar && tab.dataset.selector) {
        activateTab(col, tab.dataset.selector);
      }
    });

    // Range node expand/collapse
    strip.addEventListener('click', e => {
      const rangeNode = e.target.closest('.range-node');
      if (!rangeNode) return;
      const col = Columns.columnOf(rangeNode);
      if (!col || !col.activeMethodSelector) return;
      e.stopPropagation();
      const spec = col.specs && col.specs.find(s => s.methodSelector === col.activeMethodSelector);
      if (!spec) return;
      const start = parseInt(rangeNode.dataset.rangeStart, 10);
      if (rangeNode.dataset.expanded === 'true') {
        let next = rangeNode.nextElementSibling;
        while (next && next.dataset.parentRange === String(start)) {
          const rm = next; next = next.nextElementSibling; rm.remove();
        }
        rangeNode.dataset.expanded = 'false';
        rangeNode.querySelector('.range-expand').textContent = '▶';
      } else {
        const cached = col.rangeDataCache[col.activeMethodSelector] && col.rangeDataCache[col.activeMethodSelector][start];
        if (cached) {
          insertRangeItems(col, rangeNode, cached, spec);
        } else {
          rangeNode.querySelector('.range-expand').textContent = '…';
          vscode.postMessage({ command: 'fetchEnhancedInspectorRangeData', columnId: col.id, oop: col.oop, methodSelector: col.activeMethodSelector, viewName: spec.viewName, fromIndex: start, rangeStart: start });
        }
      }
    });

    // Double-click a row → drill in (append a column)
    strip.addEventListener('dblclick', e => {
      const col = Columns.columnOf(e.target);
      if (!col || !col.activeMethodSelector) return;
      const tr = e.target.closest('tr[data-nodeid]');
      if (!tr) return;
      Columns.focus(col);
      const nodeId = parseInt(tr.dataset.nodeid, 10);
      const activeSpec = col.specs && col.specs.find(s => s.methodSelector === col.activeMethodSelector);
      const viewName = activeSpec ? activeSpec.viewName : '';
      vscode.postMessage({ command: 'enhancedInspectRow', columnId: col.id, itemOop: col.oop, methodSelector: col.activeMethodSelector, nodeId, viewName });
    });

    // Row context menu → Inspect
    strip.addEventListener('contextmenu', e => {
      const tr = e.target.closest('tr[data-nodeid]');
      if (!tr) return;
      const col = Columns.columnOf(tr);
      if (!col || !col.activeMethodSelector) return;
      e.preventDefault();
      Columns.focus(col);
      ctxMenuColumnId = col.id;
      ctxMenuNodeId = parseInt(tr.dataset.nodeid, 10);
      const menu = document.getElementById('rowCtxMenu');
      menu.style.display = 'block';
      const w = menu.offsetWidth || 80, h = menu.offsetHeight || 30;
      menu.style.left = Math.min(e.clientX, window.innerWidth - w - 4) + 'px';
      menu.style.top  = Math.min(e.clientY, window.innerHeight - h - 4) + 'px';
    });

    document.getElementById('rowCtxInspect').addEventListener('click', () => {
      const col = ctxMenuColumnId != null ? Columns.get(ctxMenuColumnId) : null;
      if (ctxMenuNodeId !== null && col && col.activeMethodSelector) {
        const activeSpec = col.specs && col.specs.find(s => s.methodSelector === col.activeMethodSelector);
        const viewName = activeSpec ? activeSpec.viewName : '';
        vscode.postMessage({ command: 'enhancedInspectRow', columnId: col.id, itemOop: col.oop, methodSelector: col.activeMethodSelector, nodeId: ctxMenuNodeId, viewName });
      }
      hideCtxMenu();
    });

    function hideCtxMenu() {
      document.getElementById('rowCtxMenu').style.display = 'none';
      ctxMenuNodeId = null;
      ctxMenuColumnId = null;
    }
    document.addEventListener('click', hideCtxMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });

    // Load more
    strip.addEventListener('click', e => {
      const btn = e.target.closest('.load-more-row');
      if (!btn) return;
      const col = Columns.columnOf(btn);
      if (!col || !col.activeMethodSelector) return;
      const spec = col.specs && col.specs.find(s => s.methodSelector === col.activeMethodSelector);
      if (!spec) return;
      const fromIndex = (col.loadedRowCounts[col.activeMethodSelector] || 0) + 1;
      btn.querySelector('td').textContent = 'Loading…';
      vscode.postMessage({ command: 'fetchMoreRows', columnId: col.id, oop: col.oop, methodSelector: col.activeMethodSelector, viewName: spec.viewName, fromIndex });
    });

    // Tree expand/collapse
    strip.addEventListener('click', e => {
      const btn = e.target.closest('.tree-toggle');
      if (!btn) return;
      const col = Columns.columnOf(btn);
      if (!col || !col.activeMethodSelector) return;
      const tr = btn.closest('tr[data-nodeid]');
      if (!tr) return;
      const nodeId = parseInt(tr.dataset.nodeid, 10);
      const path = JSON.parse(tr.dataset.path || '[' + nodeId + ']');
      if (btn.dataset.state === 'expanded') {
        const prefix = JSON.stringify(path);
        const table = tr.closest('table');
        if (table) {
          Array.from(table.querySelectorAll('tr[data-path]')).forEach(r => {
            if (r !== tr) {
              const rPath = r.dataset.path || '';
              if (rPath.startsWith(prefix.slice(0, -1) + ',') || rPath === prefix) r.remove();
            }
          });
        }
        btn.textContent = '▶';
        btn.dataset.state = 'collapsed';
      } else {
        btn.textContent = '▼';
        btn.dataset.state = 'expanded';
        vscode.postMessage({ command: 'fetchEnhancedInspectorTreeChildren', columnId: col.id, itemOop: col.oop, methodSelector: col.activeMethodSelector, path });
      }
    });

    // Meta sub-tab bar + method item interactions
    strip.addEventListener('click', e => {
      const col = Columns.columnOf(e.target);
      if (!col) return;
      const metaTab = e.target.closest('[data-metatab]');
      if (metaTab && e.target.closest('.meta-sub-tab-bar')) {
        col.metaSubTab = metaTab.dataset.metatab;
        col.openMethodSel = null;
        renderMetaTab(col, col.el.contentPane);
        return;
      }
      if (col.activeMethodSelector !== '__meta__') return;
      if (col.metaSubTab !== 'instanceMethods' && col.metaSubTab !== 'classMethods') return;
      const browseBtn = e.target.closest('.method-browse-btn');
      if (browseBtn) {
        vscode.postMessage({ command: 'browseMethod', columnId: col.id, oop: col.oop, methodSelector: browseBtn.dataset.sel, isClassSide: browseBtn.dataset.classSide === 'true' });
        return;
      }
      if (e.target.closest('.method-source-box')) return;
      const item = e.target.closest('.method-item');
      if (!item) return;
      const sel = item.dataset.sel;
      const isClassSide = col.metaSubTab === 'classMethods';
      const cacheKey = (isClassSide ? 'c:' : 'i:') + sel;
      col.openMethodSel = (sel && col.openMethodSel !== cacheKey) ? cacheKey : null;
      if (col.openMethodSel && !(col.openMethodSel in col.methodSourceCache)) {
        vscode.postMessage({ command: 'fetchMethodSource', columnId: col.id, oop: col.oop, methodSelector: sel, isClassSide });
      }
      const sc = col.el.contentPane.querySelector('.meta-sub-content');
      if (sc) sc.innerHTML = renderMetaSubTab(col, metaDataOf(col));
    });

    // ── Column resize ─────────────────────────

    strip.addEventListener('mousedown', e => {
      const edge = e.target.closest('.col-resize-edge');
      if (edge) {
        e.preventDefault();
        const col = Columns.columnOf(edge);
        if (!col) return;
        edge.classList.add('active');
        resizingPane = { col, edge, startX: e.clientX, startWidth: col.el.root.getBoundingClientRect().width };
        return;
      }
      const handle = e.target.closest('.col-resize-handle');
      if (!handle) return;
      const col = Columns.columnOf(handle);
      if (!col) return;
      e.preventDefault();
      e.stopPropagation();
      const th = handle.closest('th');
      const colIndex = parseInt(th.dataset.colindex, 10);
      const table = th.closest('table');
      const colEl = table.querySelectorAll('col')[colIndex];
      if (!colEl) return;
      handle.classList.add('active');
      resizingCol = { col, colEl, handle, index: colIndex, startX: e.clientX, startWidth: th.getBoundingClientRect().width };
    });

    document.addEventListener('mousemove', e => {
      if (resizingPane) {
        Columns.pinWidth(resizingPane.col, resizingPane.startWidth + (e.clientX - resizingPane.startX));
        return;
      }
      if (!resizingCol) return;
      const newWidth = Math.max(40, resizingCol.startWidth + (e.clientX - resizingCol.startX));
      resizingCol.colEl.style.width = newWidth + 'px';
      const col = resizingCol.col;
      if (col.activeMethodSelector) {
        if (!col.colWidths[col.activeMethodSelector]) col.colWidths[col.activeMethodSelector] = [];
        col.colWidths[col.activeMethodSelector][resizingCol.index] = newWidth;
      }
    });

    document.addEventListener('mouseup', () => {
      if (resizingPane) { resizingPane.edge.classList.remove('active'); resizingPane = null; return; }
      if (!resizingCol) return;
      resizingCol.handle.classList.remove('active');
      resizingCol = null;
    });

    // ── Message handler ───────────────────────

    window.addEventListener('message', ev => {
      const msg = ev.data;
      if (msg.command === 'enhancedInspectorViewSpecs') { Columns.addRoot(msg); return; }
      if (msg.command === 'addColumn') { Columns.addChild(msg); return; }

      const col = msg.columnId != null ? Columns.get(msg.columnId) : null;
      if (!col) return;

      if (msg.command === 'enhancedInspectorViewData') {
        col.cachedViewData[msg.methodSelector] = msg.data;
        if (msg.methodSelector === col.activeMethodSelector) {
          const spec = col.specs && col.specs.find(s => s.methodSelector === msg.methodSelector);
          const contentPane = col.el.contentPane;
          if (spec) {
            renderEnhancedInspectorContent(col, contentPane, spec, msg.data);
            if (msg.truncated) {
              const bar = document.createElement('div');
              bar.style.cssText = 'padding:4px 0;border-top:1px solid var(--vscode-panel-border);margin-top:2px';
              const link = document.createElement('a');
              link.textContent = 'Show all…';
              link.style.cssText = 'cursor:pointer;color:var(--vscode-textLink-foreground);font-size:0.85em';
              const capturedSelector = msg.methodSelector;
              link.addEventListener('click', function() {
                bar.remove();
                vscode.postMessage({ command: 'fetchFullPrintString', columnId: col.id, oop: col.oop, methodSelector: capturedSelector });
              });
              bar.appendChild(link);
              contentPane.appendChild(bar);
            }
          }
        }

      } else if (msg.command === 'enhancedInspectorViewTotal') {
        col.rangeTotals[msg.methodSelector] = msg.total;
        if (msg.methodSelector === col.activeMethodSelector && col.rangesMode[msg.methodSelector]) {
          const spec = col.specs && col.specs.find(s => s.methodSelector === msg.methodSelector);
          if (spec) renderEnhancedInspectorContent(col, col.el.contentPane, spec, col.cachedViewData[msg.methodSelector]);
        }

      } else if (msg.command === 'enhancedInspectorRangeData') {
        if (msg.methodSelector !== col.activeMethodSelector || !msg.data) return;
        const spec = col.specs && col.specs.find(s => s.methodSelector === msg.methodSelector);
        if (!spec) return;
        const table = col.el.contentPane.querySelector('.ei-table');
        if (!table) return;
        const rangeNode = table.querySelector('[data-range-start="' + msg.rangeStart + '"]');
        if (rangeNode) insertRangeItems(col, rangeNode, msg.data, spec);

      } else if (msg.command === 'enhancedInspectorMoreRows') {
        if (msg.methodSelector !== col.activeMethodSelector || !msg.data) return;
        const spec = col.specs && col.specs.find(s => s.methodSelector === msg.methodSelector);
        if (!spec) return;
        let newRows;
        try { newRows = JSON.parse(msg.data); } catch { return; }
        const table = col.el.contentPane.querySelector('.ei-table');
        if (!table) return;
        const cols = spec.columnSpecifications || [];
        const isTree = spec.viewName && spec.viewName.includes('Tree');
        const oldBtn = table.querySelector('.load-more-row');
        if (oldBtn) oldBtn.remove();
        newRows.forEach(row => { table.insertAdjacentHTML('beforeend', makeRowHtml(row, cols, isTree, 0, [row.nodeId])); });
        col.loadedRowCounts[msg.methodSelector] = (col.loadedRowCounts[msg.methodSelector] || 0) + newRows.length;
        if (newRows.length >= PAGE_SIZE) table.insertAdjacentHTML('beforeend', makeLoadMoreHtml());

      } else if (msg.command === 'fullPrintString') {
        col.cachedViewData[msg.methodSelector] = msg.data;
        if (msg.methodSelector === col.activeMethodSelector) {
          const spec = col.specs && col.specs.find(s => s.methodSelector === msg.methodSelector);
          if (spec) renderEnhancedInspectorContent(col, col.el.contentPane, spec, msg.data);
        }

      } else if (msg.command === 'methodSource') {
        const cacheKey = (msg.isClassSide ? 'c:' : 'i:') + msg.methodSelector;
        col.methodSourceCache[cacheKey] = msg.source;
        if (cacheKey === col.openMethodSel && col.activeMethodSelector === '__meta__') {
          const sc = col.el.contentPane.querySelector('.meta-sub-content');
          if (sc) sc.innerHTML = renderMetaSubTab(col, metaDataOf(col));
        }

      } else if (msg.command === 'enhancedInspectorTreeChildren') {
        if (msg.methodSelector !== col.activeMethodSelector || !msg.data) return;
        const spec = col.specs && col.specs.find(s => s.methodSelector === msg.methodSelector);
        if (!spec) return;
        let children;
        try { children = JSON.parse(msg.data); } catch { return; }
        const path = msg.path;
        const table = col.el.contentPane.querySelector('.ei-table');
        if (!table) return;
        const cols = spec.columnSpecifications || [];
        const parentDepth = path.length - 1;
        const parentRow = table.querySelector('tr[data-path="' + JSON.stringify(path) + '"]');
        if (!parentRow) return;
        if (!children.length) {
          const btn = parentRow.querySelector('.tree-toggle');
          if (btn) { btn.textContent = '–'; btn.dataset.state = 'leaf'; btn.style.opacity = '0.3'; }
          return;
        }
        let insertAfter = parentRow;
        children.forEach(child => {
          const childPath = path.concat(child.nodeId);
          const html = makeRowHtml(child, cols, true, parentDepth + 1, childPath);
          insertAfter.insertAdjacentHTML('afterend', html);
          insertAfter = insertAfter.nextElementSibling;
        });
      }
    });

    // ── view rendering ─────────────────────

    const GT_COLORS = {
      yellow: 'rgba(230,200,0,0.35)', red: '#e05252', green: '#52a852',
      blue: '#5277e0', orange: '#e08052', gray: '#888', black: '#000', white: '#fff',
    };

    function cssColor(c) {
      if (!c) return '';
      const a = c.a !== undefined ? c.a : 1;
      if (c.name) {
        const hex = GT_COLORS[c.name];
        if (!hex) return c.name;
        if (a < 1) {
          const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
          return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
        }
        return hex;
      }
      if (c.r !== undefined) return 'rgba(' + Math.round(c.r*255) + ',' + Math.round(c.g*255) + ',' + Math.round(c.b*255) + ',' + a + ')';
      return '';
    }

    // A2: Map icon names to styled symbols
    const GT_ICON_MAP = {
      collectionIcon: ['[]', '#4fc1ff'], orderedCollectionIcon: ['[]', '#4fc1ff'],
      dictionaryIcon: ['{}', '#4fc1ff'], setIcon: ['{}', '#4fc1ff'],
      magnitudeIcon:  ['##', '#b5cea8'], numberIcon: ['##', '#b5cea8'],
      stringIcon:     ['""', '#ce9178'], symbolIcon: ['#·', '#9cdcfe'],
      characterIcon:  ['$·', '#9cdcfe'], booleanIcon: ['⊙', '#569cd6'],
      nilIcon:        ['∅',  '#808080'], classIcon: ['Ⓒ', '#ee9d28'],
      methodIcon:     ['→',  '#c586c0'], dateIcon:  ['◷', '#dcdcaa'],
      errorIcon:      ['⚠',  '#f48771'], exceptionIcon: ['⚠', '#f48771'],
      objectIcon:     ['●',  '#c6c6c6'],
    };
    function iconHtml(name) {
      const def = GT_ICON_MAP[name] || ['·', '#808080'];
      return '<span style="color:' + def[1] + ';font-family:monospace;font-size:0.85em">' + esc(def[0]) + '</span>';
    }

    function attrToCss(attr) {
      switch (attr.__typeLabel) {
        case 'phlowTextHighlightAttribute':  return 'background-color:' + cssColor(attr.color);
        case 'phlowTextForegroundAttribute': return 'color:' + cssColor(attr.color);
        case 'phlowFontWeightAttribute':     return 'font-weight:' + (attr.weight === 'thin' ? '100' : attr.weight);
        case 'phlowFontEmphasisAttribute':   return 'font-style:' + attr.emphasis;
        case 'phlowFontSizeAttribute':       return 'font-size:' + attr.size + 'px';
        case 'phlowFontNameAttribute':       return '';
        case 'phlowTextDecorationAttribute': {
          const d = attr.decoration;
          if (!d) return '';
          const lines = (d.typeNames || []).map(t => t === 'lineThrough' ? 'line-through' : t).join(' ');
          let css = 'text-decoration-line:' + lines;
          if (d.styleName) css += ';text-decoration-style:' + d.styleName;
          if (d.color)     css += ';text-decoration-color:' + cssColor(d.color);
          if (d.thickness) css += ';text-decoration-thickness:' + d.thickness + 'px';
          return css;
        }
        default: return '';
      }
    }

    function applyRuns(str, runs) {
      if (!runs || !runs.length) return esc(str);
      const charCss = new Array(str.length).fill('');
      for (const run of runs) {
        const css = (run.attributes || []).map(attrToCss).filter(Boolean).join(';');
        if (!css) continue;
        const s = Math.max(0, (run.startIndex || 1) - 1);
        const e = Math.min(str.length, run.endIndex || str.length);
        for (let i = s; i < e; i++) charCss[i] += ';' + css;
      }
      let html = '', i = 0;
      while (i < str.length) {
        const css = charCss[i]; let j = i + 1;
        while (j < str.length && charCss[j] === css) j++;
        const chunk = esc(str.slice(i, j));
        html += css ? '<span style="' + css + '">' + chunk + '</span>' : chunk;
        i = j;
      }
      return html;
    }

    // A1: JSON syntax highlighting
    function highlightJson(str) {
      return esc(str).replace(
        /(&quot;(\\\\u[a-fA-F0-9]{4}|\\\\[^u]|[^\\\\&])*&quot;(s*:)?|\b(true|false|null)\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g,
        m => {
          let col = 'color:#b5cea8';
          if (m.startsWith('&quot;')) col = m.endsWith(':') ? 'color:#9cdcfe' : 'color:#ce9178';
          else if (/true|false|null/.test(m)) col = 'color:#569cd6';
          return '<span style="' + col + '">' + m + '</span>';
        }
      );
    }

    // A1: Parser-based + attribute-run text rendering
    function renderStyledText(el, textData) {
      const str = textData.string || '';
      const styler = textData.stylerSpecification;
      el.className = 'detail-value';
      // Clear inline styles left behind by a prior table/tree render into this
      // shared pane. renderEnhancedInspectorTable sets el.style.cssText to include
      // 'display:flex;flex-direction:column', which (as an inline style) wins
      // over the .detail-value class and would stack each styled run on its own
      // line. Reset before laying out the text.
      el.style.cssText = '';
      el.style.whiteSpace = 'pre-wrap';
      el.style.overflow = 'auto';
      el.style.minHeight = '0';
      if (styler && styler.__typeLabel === 'remotePhlowTextParserStylerSpecification') {
        el.innerHTML = styler.parserClassName === 'JSONParser' ? highlightJson(str) : esc(str);
        return;
      }
      const runs = (styler && styler.attributeRuns && styler.attributeRuns.items) || [];
      el.innerHTML = applyRuns(str, runs);
    }

    // A3: Cell HTML — preserves styling in gtPhlowRunBasedText cells.
    // NOTE: 'gtPhlowRunBasedText' is the server's wire value (GtPhlowRunBasedText
    // class>>typeLabel in gtoolkit-remote.gs), NOT a Jasper identifier — do not rename.
    function cellHtml(raw) {
      if (typeof raw === 'string') return esc(raw);
      if (!raw) return '';
      if (raw.__typeLabel === 'gtPhlowRunBasedText') {
        return applyRuns(raw.sourceString || '', (raw.attributeRuns && raw.attributeRuns.items) || []);
      }
      if (raw.sourceString !== undefined) return esc(raw.sourceString);
      if (raw.string !== undefined) return esc(raw.string);
      return esc(JSON.stringify(raw));
    }

    // A5/A1/A2: Build a single table row HTML string
    function makeRowHtml(row, cols, isTree, depth, path, parentRange) {
      const nv = row.nodeValue;
      if (!nv) return '';
      const pathAttr = ' data-path="' + esc(JSON.stringify(path)) + '"';
      const depthAttr = ' data-depth="' + depth + '"';
      const parentAttr = parentRange != null ? ' data-parent-range="' + parentRange + '"' : '';
      let html = '<tr data-nodeid="' + row.nodeId + '"' + pathAttr + depthAttr + parentAttr + '>';
      const indent = depth > 0 ? 'padding-left:' + (8 + depth * 16) + 'px;' : '';
      const toggle = isTree ? '<button class="tree-toggle" data-state="collapsed">▶</button>' : '';
      if (nv.columnValues) {
        for (let i = 0; i < nv.columnValues.length; i++) {
          const cell = nv.columnValues[i];
          const col = cols[i];
          const bg = cell.background ? 'background-color:' + cssColor(cell.background) + ';' : '';
          const pre = (i === 0) ? toggle : '';
          const ind = (i === 0) ? indent : '';
          const content = (col && col.type === 'icon')
            ? iconHtml(typeof cell.itemText === 'string' ? cell.itemText : (cell.itemText && cell.itemText.sourceString) || '')
            : cellHtml(cell.itemText);
          html += '<td style="' + ind + bg + '">' + pre + content + '</td>';
        }
      } else if (nv.itemText !== undefined) {
        html += '<td style="' + indent + '">' + toggle + cellHtml(nv.itemText) + '</td>';
      }
      html += '</tr>';
      return html;
    }

    function makeLoadMoreHtml() {
      return '<tr class="load-more-row"><td>Load more…</td></tr>';
    }

    // A4/A5: Table + tree rendering
    function applyColWidths(table, widths) {
      let cg = table.querySelector('colgroup');
      if (!cg) { cg = document.createElement('colgroup'); table.insertBefore(cg, table.firstChild); }
      cg.innerHTML = widths.map(w => '<col style="width:' + w + 'px">').join('');
      table.style.tableLayout = 'fixed';
    }

    function makeTableHtml(selector, cols, isTree) {
      return '<table class="ei-table" data-selector="' + esc(selector) + '">' +
        (cols.length > 0
          ? '<tr>' + cols.map((c, i) => '<th data-colindex="' + i + '">' + esc(c.title) + '<div class="col-resize-handle"></div></th>').join('') + '</tr>'
          : '');
    }

    function insertRangeItems(col, rangeNode, rawData, spec) {
      let rows;
      try { rows = JSON.parse(rawData); } catch { return; }
      const selector = spec.methodSelector;
      const cols = spec.columnSpecifications || [];
      const isTree = spec.viewName && spec.viewName.includes('Tree');
      const start = parseInt(rangeNode.dataset.rangeStart, 10);
      if (!col.rangeDataCache[selector]) col.rangeDataCache[selector] = {};
      col.rangeDataCache[selector][start] = rawData;
      rangeNode.querySelector('.range-expand').textContent = '▼';
      rangeNode.dataset.expanded = 'true';
      let insertAfter = rangeNode;
      rows.forEach(row => {
        insertAfter.insertAdjacentHTML('afterend', makeRowHtml(row, cols, isTree, 0, [row.nodeId], start));
        insertAfter = insertAfter.nextElementSibling;
      });
    }

    function renderEnhancedInspectorTable(col, el, spec, rawData) {
      let rows;
      try { rows = JSON.parse(rawData); } catch { el.innerHTML = '<div class="placeholder">Error parsing data.</div>'; return; }
      if (!rows || !rows.length) { el.innerHTML = '<div class="placeholder">No items.</div>'; return; }
      const cols = spec.columnSpecifications || [];
      const isTree = spec.viewName && spec.viewName.includes('Tree');
      const selector = spec.methodSelector;
      const hasMore = rows.length >= PAGE_SIZE;
      const inRangesMode = col.rangesMode[selector];
      const total = col.rangeTotals[selector];

      el.className = '';
      el.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column';

      // Toolbar (shown when list may have more items)
      let html = '';
      if (hasMore || total) {
        html += '<div class="table-toolbar">' +
          '<button class="table-btn' + (inRangesMode ? ' active' : '') + '" id="rangesToggle">' +
          (inRangesMode ? 'Flat' : 'Ranges') + '</button>' +
          (total ? '<span class="toolbar-label">' + total + ' items</span>' : '') +
          '</div>';
      }

      if (inRangesMode && total) {
        // Ranges view — one row per PAGE_SIZE chunk
        html += '<div class="ei-table-wrap">' + makeTableHtml(selector, cols, isTree);
        for (let start = 1; start <= total; start += PAGE_SIZE) {
          const end = Math.min(start + PAGE_SIZE - 1, total);
          const cached = col.rangeDataCache[selector] && col.rangeDataCache[selector][start];
          const expanded = !!cached;
          html += '<tr class="range-node" data-range-start="' + start + '" data-range-end="' + end +
            '" data-expanded="' + expanded + '">' +
            '<td colspan="' + (cols.length || 1) + '">' +
            '<span class="range-expand">' + (expanded ? '▼' : '▶') + '</span>' +
            ' [' + start + '..' + end + ']' +
            ' <span style="color:var(--vscode-descriptionForeground)">(' + (end - start + 1) + ')</span>' +
            '</td></tr>';
          if (expanded) {
            let cachedRows; try { cachedRows = JSON.parse(cached); } catch { cachedRows = []; }
            cachedRows.forEach(row => { html += makeRowHtml(row, cols, isTree, 0, [row.nodeId], start); });
          }
        }
        html += '</table></div>';
      } else {
        // Flat view
        html += '<div class="ei-table-wrap">' + makeTableHtml(selector, cols, isTree);
        rows.forEach(row => { html += makeRowHtml(row, cols, isTree, 0, [row.nodeId]); });
        col.loadedRowCounts[selector] = rows.length;
        if (hasMore) html += makeLoadMoreHtml();
        html += '</table></div>';
      }

      el.innerHTML = html;

      // Wire up ranges toggle button
      const btn = el.querySelector('#rangesToggle');
      if (btn) btn.addEventListener('click', () => {
        if (col.rangesMode[selector]) {
          col.rangesMode[selector] = false;
          renderEnhancedInspectorTable(col, el, spec, rawData);
        } else {
          col.rangesMode[selector] = true;
          if (col.rangeTotals[selector]) {
            renderEnhancedInspectorTable(col, el, spec, rawData);
          } else {
            el.querySelector('.ei-table-wrap').innerHTML = '<div class="placeholder">Loading…</div>';
            vscode.postMessage({ command: 'fetchEnhancedInspectorViewTotal', columnId: col.id, oop: col.oop, methodSelector: selector, viewName: spec.viewName });
          }
        }
      });

      // Bake column widths for resizing (flat mode only — ranges use colspan)
      if (!inRangesMode) {
        const table = el.querySelector('.ei-table');
        if (col.colWidths[selector]) {
          applyColWidths(table, col.colWidths[selector]);
        } else if (cols.length > 0) {
          const measured = Array.from(table.querySelectorAll('th')).map(th => Math.ceil(th.getBoundingClientRect().width));
          if (measured.some(w => w > 0)) { col.colWidths[selector] = measured; applyColWidths(table, measured); }
        }
      }
    }

    function renderMetaTab(col, el) {
      const d = metaDataOf(col);
      el.className = '';
      el.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column';

      const className = d ? d.className : (col.oop ? 'OOP ' + col.oop : '');
      const superclass = d ? d.superclassName : '';
      const category   = d ? d.category : '';

      let html =
        // Class chip + name
        '<div style="padding:8px 12px 4px 12px;flex-shrink:0">' +
          '<div style="font-size:0.75em;color:var(--vscode-descriptionForeground);margin-bottom:2px">Class</div>' +
          '<div style="font-family:var(--vscode-editor-font-family);font-size:1.15em;font-weight:600;word-break:break-all">' + esc(className) + '</div>' +
        '</div>' +
        // Info bar: Superclass | Package | Tag
        '<div style="padding:2px 12px 6px 12px;flex-shrink:0;font-size:0.82em;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border);display:flex;gap:12px;flex-wrap:wrap">' +
          '<span>Superclass: <strong style="color:var(--vscode-foreground)">' + esc(superclass || '—') + '</strong></span>' +
          '<span>Package: <strong style="color:var(--vscode-foreground)">' + esc(category || '—') + '</strong></span>' +
          '<span>OOP: <strong style="color:var(--vscode-foreground)">' + esc(col.oop || '') + '</strong></span>' +
        '</div>' +
        // Sub-tab bar
        '<div class="tab-bar meta-sub-tab-bar" style="flex-shrink:0;border-bottom:1px solid var(--vscode-panel-border)">';

      const subTabs = [['instanceMethods','Instance Methods'],['classMethods','Class Methods'],['definition','Definition'],['comment','Comment']];
      subTabs.forEach(([id, label]) => {
        html += '<div class="tab' + (col.metaSubTab === id ? ' active' : '') + '" data-metatab="' + id + '">' + label + '</div>';
      });
      html += '</div>' +
        // Sub-tab content
        '<div class="meta-sub-content" style="flex:1;overflow:auto;padding:8px 12px">' +
          renderMetaSubTab(col, d) +
        '</div>';

      el.innerHTML = html;
    }

    function renderMetaSubTab(col, d) {
      if (!d) return '<div class="placeholder">No metadata available.</div>';
      if (col.metaSubTab === 'instanceMethods' || col.metaSubTab === 'classMethods') {
        const isClassTab = col.metaSubTab === 'classMethods';
        const dotColor = isClassTab ? '#e08052' : 'var(--vscode-button-background)';
        const methods = isClassTab ? (d.classMethodSelectors || []) : (d.methodSelectors || []);
        if (!methods.length) return '<div class="placeholder">No methods.</div>';
        return methods.map(sel => {
          const cacheKey = (isClassTab ? 'c:' : 'i:') + sel;
          const isOpen = col.openMethodSel === cacheKey;
          return '<div class="method-item" data-sel="' + esc(sel) + '">' +
            '<div style="display:flex;align-items:center;gap:6px">' +
            '<span style="width:8px;height:8px;border-radius:2px;background:' + dotColor + ';flex-shrink:0;display:inline-block"></span>' +
            '<span class="method-label" style="font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)">' + esc(sel) + '</span>' +
            '</div>' +
            (isOpen
              ? '<div class="method-source-box">' +
                '<div class="method-source-header">' +
                '<span class="method-browse-btn" data-sel="' + esc(sel) + '" data-class-side="' + isClassTab + '">Browse →</span>' +
                '</div>' +
                '<span class="method-source-code">' +
                (cacheKey in col.methodSourceCache
                  ? (col.methodSourceCache[cacheKey] !== null ? esc(col.methodSourceCache[cacheKey]) : '<span style="color:var(--vscode-errorForeground)">Error fetching source.</span>')
                  : '<span style="color:var(--vscode-descriptionForeground)">Loading…</span>') +
                '</span>' +
                '</div>'
              : '') +
            '</div>';
        }).join('');
      }
      if (col.metaSubTab === 'definition') {
        return '<pre style="font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);white-space:pre-wrap;margin:0">' +
          esc(d.definition || '') + '</pre>';
      }
      if (col.metaSubTab === 'comment') {
        const comment = d.comment || '';
        return comment
          ? '<pre style="font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);white-space:pre-wrap;margin:0;line-height:1.5">' + esc(comment) + '</pre>'
          : '<div class="placeholder">No comment.</div>';
      }
      return '';
    }

    function renderEnhancedInspectorContent(col, el, spec, data) {
      if (data === null || data === undefined) { el.innerHTML = '<div class="placeholder">No data.</div>'; return; }
      const effectiveViewName = spec.resolvedViewName || spec.viewName;
      if (effectiveViewName === 'GtPhlowTextViewSpecification' || effectiveViewName === 'GtPhlowTextEditorViewSpecification') {
        let textData;
        try { textData = JSON.parse(data); } catch { textData = { string: data }; }
        renderStyledText(el, textData);
      } else {
        const effectiveSpec = spec.resolvedViewName
          ? Object.assign({}, spec, { viewName: spec.resolvedViewName, columnSpecifications: spec.resolvedColumnSpecifications || spec.columnSpecifications })
          : spec;
        renderEnhancedInspectorTable(col, el, effectiveSpec, data);
      }
    }

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
