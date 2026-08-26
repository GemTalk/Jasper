import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';
import { ExportManager } from './exportManager';
import { logInfo } from './gciLog';
import { receiver } from './queries/util';
import {
  splitOutCategory,
  withCategoryLine,
  classNameFromDefinition,
  dictNameFromDefinition,
  DEFAULT_CLASS_CATEGORY,
} from './classDefinitionText';
import { extractSelector } from './methodPattern';
import { beginMethodEdit, MethodEditRecording, present } from './undo/recordMethodEdit';
import { notifyUndoable } from './undo/undoableToast';
import { beginClassEdit } from './undo/recordClassEdit';
import { beginClassCommentEdit } from './undo/recordClassComment';
import { MethodSlot, slotLabel, UndoEntry } from './undo/undoTypes';

// A binary selector can contain '/', but a slash in a URI path segment (raw or
// %2F-encoded) is collapsed by VS Code's path normalization, losing the
// selector. Callers escape slashes to this sentinel — which is not a path
// separator and never appears in a Smalltalk selector — for transport in the
// path; parseUri reverses it.
const SELECTOR_SLASH = '⁄'; // FRACTION SLASH
export function escapeSelectorSlashes(selector: string): string {
  return selector.split('/').join(SELECTOR_SLASH);
}
export function unescapeSelectorSlashes(segment: string): string {
  return segment.split(SELECTOR_SLASH).join('/');
}

// ── URI Structure ────────────────────────────────────────────
// Method:     gemstone://{sessionId}/{dictName}/{className}/{side}/{category}/{selector}
// Definition: gemstone://{sessionId}/{dictName}/{className}/definition
// Comment:    gemstone://{sessionId}/{dictName}/{className}/comment
// New class:  gemstone://{sessionId}/{dictName}/new-class
// New method: gemstone://{sessionId}/{dictName}/{className}/{side}/{category}/new-method

interface ParsedMethodUri {
  kind: 'method';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  selector: string;
  environmentId: number;
  // Optional 1-based SymbolList index (?dict=N) — scopes the class lookup to a
  // specific dictionary. Falls back to dictName when absent.
  dictIndex?: number;
  // When true, serve the PERSISTENT base method source (what a session override
  // shadows) rather than the session/merged source. Used by the override diff.
  base?: boolean;
  // True when the selector segment carried a " (…)" display label (the override
  // diff decorates each side so its filename reads "sel (base)" / "sel (session
  // override)"). Such view URIs are always read-only.
  diffView?: boolean;
}

interface ParsedDefinitionUri {
  kind: 'definition';
  sessionId: number;
  dictName: string;
  className: string;
  // Optional 1-based SymbolList index (?dict=N). Scopes the class lookup to a
  // specific dictionary — disambiguates the same key in two dictionaries, which
  // can even share a name. Falls back to dictName when absent.
  dictIndex?: number;
}

interface ParsedCommentUri {
  kind: 'comment';
  sessionId: number;
  dictName: string;
  className: string;
  dictIndex?: number;
}

interface ParsedNewClassUri {
  kind: 'new-class';
  sessionId: number;
  dictName: string;
  category?: string;
}

interface ParsedNewMethodUri {
  kind: 'new-method';
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  category: string;
  environmentId: number;
  dictIndex?: number;
}

export type ParsedUri =
  ParsedMethodUri | ParsedDefinitionUri | ParsedCommentUri | ParsedNewClassUri | ParsedNewMethodUri;

export function parseUri(uri: vscode.Uri): ParsedUri {
  const sessionId = parseInt(uri.authority, 10);
  const parts = uri.path.split('/').map(decodeURIComponent);
  // parts[0] is '' (leading /)

  // Parse optional ?env=N from query string
  const envMatch = uri.query?.match(/env=(\d+)/);
  const environmentId = envMatch ? parseInt(envMatch[1], 10) : 0;
  const base = /(?:^|&)base=1(?:&|$)/.test(uri.query ?? '');
  // Optional ?dict=N — the 1-based SymbolList index that scopes a class lookup.
  const dictMatch = uri.query?.match(/(?:^|&)dict=(\d+)(?:&|$)/);
  const dictIndex = dictMatch ? parseInt(dictMatch[1], 10) : undefined;

  if (parts.length === 3 && parts[2] === 'new-class') {
    const catMatch = uri.query?.match(/category=([^&]+)/);
    const category = catMatch ? decodeURIComponent(catMatch[1]) : undefined;
    return { kind: 'new-class', sessionId, dictName: parts[1], category };
  }
  // 4-segment `/dict/Class/definition`, or 5-segment `/dict/Class/definition/Class`
  // — the trailing repeat makes the editor tab read as the class name (see
  // buildClassDefinitionUri). Both resolve to the same definition.
  if ((parts.length === 4 || parts.length === 5) && parts[3] === 'definition') {
    return { kind: 'definition', sessionId, dictName: parts[1], className: parts[2], dictIndex };
  }
  // 4-segment `/dict/Class/comment`, or 5-segment `/dict/Class/comment/Class comment`
  // — the trailing label makes the editor tab read as "Class comment" (see
  // buildClassCommentUri). Both resolve to the same comment.
  if ((parts.length === 4 || parts.length === 5) && parts[3] === 'comment') {
    return { kind: 'comment', sessionId, dictName: parts[1], className: parts[2], dictIndex };
  }
  if (parts.length === 6 && parts[5] === 'new-method') {
    return {
      kind: 'new-method',
      sessionId,
      dictName: parts[1],
      className: parts[2],
      isMeta: parts[3] === 'class',
      category: unescapeSelectorSlashes(parts[4]),
      environmentId,
      dictIndex,
    };
  }
  if (parts.length >= 6) {
    // The first five segments (dict/class/side/category) are slash-free names,
    // so anything after them is the selector. Rejoin the tail with '/' and undo
    // the slash-sentinel escaping to recover binary selectors containing a
    // slash ('/', '//'): a %2F-encoded slash decodes to a real separator that
    // VS Code's path normalization then collapses, so it can't ride in the path
    // literally (see escapeSelectorSlashes).
    const rawSelector = unescapeSelectorSlashes(parts.slice(5).join('/'));
    // The override diff decorates each side's selector segment with a display
    // label — "sel (base)" / "sel (session override)". Strip it for the real
    // selector; its presence marks a read-only comparison view.
    const labelled = rawSelector.match(/^(.*) \((?:base|session override)\)$/);
    return {
      kind: 'method',
      sessionId,
      dictName: parts[1],
      className: parts[2],
      isMeta: parts[3] === 'class',
      category: unescapeSelectorSlashes(parts[4]),
      selector: labelled ? labelled[1] : rawSelector,
      environmentId,
      base,
      diffView: labelled != null,
      dictIndex,
    };
  }
  throw vscode.FileSystemError.FileNotFound(uri);
}

// A saved method's coordinates, recovered from its gemstone:// source URI.
export interface MethodUriRef {
  sessionId: number;
  dictName: string;
  className: string;
  isMeta: boolean;
  selector: string;
  environmentId: number;
  dictIndex?: number;
  // True for a read-only base / session-override diff view (its selector has
  // already been un-labelled). Callers that mutate the method — e.g. setting a
  // breakpoint — skip these; read-only consumers (highlighting, code lenses)
  // ignore the flag and use the real selector.
  diffView: boolean;
}

// Parse a gemstone:// method-source URI into its method coordinates, or null
// when the URI isn't a saved method: a non-gemstone scheme, a definition /
// comment / new-* template, or an unparseable path. The one reverse of the
// method-URI format, so callers don't re-split the path by hand and re-acquire
// the slash-selector and diff-label bugs that hand-rolled parse carries.
export function parseMethodUri(uri: vscode.Uri): MethodUriRef | null {
  if (uri.scheme !== 'gemstone') return null;
  let parsed: ParsedUri;
  try {
    parsed = parseUri(uri);
  } catch {
    return null;
  }
  if (parsed.kind !== 'method') return null;
  return {
    sessionId: parsed.sessionId,
    dictName: parsed.dictName,
    className: parsed.className,
    isMeta: parsed.isMeta,
    selector: parsed.selector,
    environmentId: parsed.environmentId,
    dictIndex: parsed.dictIndex,
    diffView: parsed.diffView ?? false,
  };
}

export function buildNewMethodUri(
  sessionId: number,
  dictName: string,
  className: string,
  isMeta: boolean,
  category: string,
  environmentId: number,
  dictIndex?: number,
): vscode.Uri {
  return buildMethodUri({
    kind: 'method',
    sessionId,
    dictName,
    className,
    isMeta,
    category,
    selector: 'new-method',
    environmentId,
    dictIndex,
  });
}

export function buildClassDefinitionUri(
  sessionId: number,
  dictName: string,
  className: string,
  dictIndex?: number,
): vscode.Uri {
  assertIsValidUriPath('Dictionary name', dictName);
  assertIsValidUriPath('Class name', className);
  return vscode.Uri.from({
    scheme: 'gemstone',
    authority: String(sessionId),
    // The class name is repeated as the final segment so the editor *tab* shows
    // the class name (VS Code labels a tab by its URI basename) — otherwise every
    // class definition reads just "definition". parseUri accepts this 5-segment
    // form as well as the legacy 4-segment `…/definition`.
    path: `/${dictName}/${className}/definition/${className}`,
    // The 1-based SymbolList index scopes the class lookup to a specific
    // dictionary (dictionaries can share a name). Omitted → dictName fallback.
    query: dictIndex !== undefined ? `dict=${dictIndex}` : '',
  });
}

export function buildClassCommentUri(
  sessionId: number,
  dictName: string,
  className: string,
  dictIndex?: number,
): vscode.Uri {
  assertIsValidUriPath('Dictionary name', dictName);
  assertIsValidUriPath('Class name', className);
  return vscode.Uri.from({
    scheme: 'gemstone',
    authority: String(sessionId),
    // A trailing `${Class} comment` segment makes the editor tab read as e.g.
    // "Account comment" (VS Code labels a tab by its URI basename) rather than a
    // bare "comment". parseUri accepts this 5-segment form as well as the legacy
    // 4-segment `…/comment`; the label segment is ignored (className is parts[2]).
    path: `/${dictName}/${className}/comment/${className} comment`,
    query: dictIndex !== undefined ? `dict=${dictIndex}` : '',
  });
}

export function buildMethodUri(parsedUri: ParsedMethodUri): vscode.Uri {
  assertIsValidUriPath('Dictionary name', parsedUri.dictName);
  assertIsValidUriPath('Class name', parsedUri.className);
  // A method category legitimately contains '/' — `initialize/release` is a stock
  // GemStone one — so it rides in the path through the same slash sentinel the
  // selector uses, rather than being rejected. Asserting instead threw from
  // anywhere a row for such a method was built, which surfaced as a toast and
  // took the whole Methods pane down with it.
  // The selector is NOT asserted slash-free: '/' and '//' are ordinary binary
  // selectors. Escape any slashes to the sentinel so they survive the path
  // (parseUri reverses it). Idempotent, so callers that pre-escape stay correct.

  const side = parsedUri.isMeta ? 'class' : 'instance';
  const params: string[] = [];
  if (parsedUri.dictIndex !== undefined) params.push(`dict=${parsedUri.dictIndex}`);
  if (parsedUri.environmentId > 0) params.push(`env=${parsedUri.environmentId}`);
  if (parsedUri.base) params.push('base=1');
  return vscode.Uri.from({
    scheme: 'gemstone',
    authority: String(parsedUri.sessionId),
    path: `/${parsedUri.dictName}/${parsedUri.className}/${side}/${escapeSelectorSlashes(parsedUri.category)}/${escapeSelectorSlashes(parsedUri.selector)}`,
    query: params.join('&'),
  });
}

function assertIsValidUriPath(parameterName: string, value: string) {
  if (value.includes('/')) {
    throw new Error(`${parameterName} must not contain '/': ${value}`);
  }
}

/**
 * Close every open editor tab backed by a gemstone:// document for `sessionId`
 * — class definitions, class comments, method source, and override-diff views.
 * Used when a browser (or its session) goes away so its companion editors don't
 * linger against a closed session. A dirty tab still prompts to save (VS Code's
 * default for tabGroups.close).
 */
export async function closeGemstoneTabsForSession(sessionId: number): Promise<void> {
  const authority = String(sessionId);
  const belongsToSession = (uri: vscode.Uri | undefined): boolean =>
    !!uri && uri.scheme === 'gemstone' && uri.authority === authority;

  const tabs: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      const matches =
        input instanceof vscode.TabInputText
          ? belongsToSession(input.uri)
          : input instanceof vscode.TabInputTextDiff
            ? belongsToSession(input.original) || belongsToSession(input.modified)
            : false;
      if (matches) tabs.push(tab);
    }
  }
  if (tabs.length > 0) await vscode.window.tabGroups.close(tabs);
}

/**
 * Every open editor tab backed by a single gemstone:// source document. Only
 * `TabInputText` tabs are returned — the override-diff comparison is a
 * `TabInputTextDiff` and is deliberately excluded (it is a read-only view, not a
 * source editor). Used by the Open Methods pane; the reaper keeps its own walk
 * because it must also handle diff tabs.
 */
/**
 * The primary editable URI a tab points at: the document of a text tab, or the
 * modified (right-hand, editable) side of a diff tab; undefined for any other
 * tab kind. Shared so tab→uri extraction isn't hand-rolled per caller.
 */
export function tabInputUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return input.uri;
  if (input instanceof vscode.TabInputTextDiff) return input.modified;
  return undefined;
}

export function listOpenGemstoneTabs(): { tab: vscode.Tab; uri: vscode.Uri }[] {
  const out: { tab: vscode.Tab; uri: vscode.Uri }[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.scheme === 'gemstone') {
        out.push({ tab, uri: input.uri });
      }
    }
  }
  return out;
}

/**
 * Reap stale gemstone:// editor tabs — those whose session isn't live.
 *
 * VS Code persists open tabs across window reloads, but GemStone sessions do
 * not survive a reload, so a restored gemstone:// tab has no session behind it,
 * can't be served, and shows a broken "could not be opened" editor. A one-shot
 * scan at activation loses the restore race (tabs restore asynchronously and
 * often aren't in `tabGroups` yet), so we also listen for tabs appearing and
 * close any gemstone:// tab with no matching live session. During normal use a
 * freshly opened method/class tab always has a live session, so it's untouched;
 * only orphaned (post-reload, pre-login) tabs are reaped. Call once from
 * `activate()`; dispose with the returned handle.
 */
export function installStaleGemstoneTabReaper(sessionManager: SessionManager): vscode.Disposable {
  // Optional chaining keeps this from throwing (and taking down all of
  // activation with it) if it is ever wired before sessionManager exists — a
  // missing manager simply means no session is live, so the tab is stale.
  const isStale = (uri: vscode.Uri | undefined): boolean =>
    !!uri &&
    uri.scheme === 'gemstone' &&
    sessionManager?.getSession(parseInt(uri.authority, 10)) === undefined;

  const reap = () => {
    const tabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        const stale =
          input instanceof vscode.TabInputText
            ? isStale(input.uri)
            : input instanceof vscode.TabInputTextDiff
              ? isStale(input.original) || isStale(input.modified)
              : false;
        if (stale) tabs.push(tab);
      }
    }
    if (tabs.length > 0) void vscode.window.tabGroups.close(tabs);
  };

  reap();

  // VS Code restores tabs asynchronously, and the "tabs added" events for a
  // restore can fire before this reaper subscribes — so the reap() above may run
  // with the restored tabs not yet present, and onDidChangeTabs may never fire
  // for them. Re-scan a couple of times shortly after activation to catch that
  // restore race (background restored tabs otherwise linger until focused).
  const restoreSweeps = [setTimeout(() => reap(), 500), setTimeout(() => reap(), 2000)];

  const subscriptions: vscode.Disposable[] = [
    // Any tab change: catches the restore-after-reload race and sweeps away any
    // dead tab the moment the user touches the tab bar.
    vscode.window.tabGroups.onDidChangeTabs(() => reap()),
  ];
  // Session lifecycle: a logout — or the session dying (e.g. the host going
  // unresponsive) — fires NO tab event, so without this a now-dead session's
  // gemstone:// tabs would linger unservable. Reaping here removes them as soon
  // as the session leaves the manager. onDidRemoveSession catches *any* session
  // leaving (including a non-selected one, which onDidChangeSelection misses).
  if (sessionManager?.onDidChangeSelection) {
    subscriptions.push(sessionManager.onDidChangeSelection(() => reap()));
  }
  if (sessionManager?.onDidRemoveSession) {
    subscriptions.push(sessionManager.onDidRemoveSession(() => reap()));
  }
  return new vscode.Disposable(() => {
    for (const t of restoreSweeps) clearTimeout(t);
    for (const sub of subscriptions) sub.dispose();
  });
}

export interface MethodCompiledEvent {
  uri: vscode.Uri;
  previousUri: vscode.Uri;
  previousUriIsTemplate: boolean;
}

export interface ClassDefinitionCompiledEvent {
  uri: vscode.Uri;
  previousUri: vscode.Uri;
  previousUriIsTemplate: boolean;
}

// ── Undo recording for a save ─────────────────────────────────

/**
 * The method slots a save could touch (issue #434).
 *
 * Usually one — the method being saved, or the one being created. Two when the user
 * edits the MESSAGE PATTERN of an existing method: GemStone compiles that as a new
 * method and leaves the original in place, so undoing the save has to take the new one
 * away as well as leave the old one alone.
 *
 * The new selector is read from the source with `extractSelector` rather than waited for,
 * because by the time GemStone reports it authoritatively the previous state is already
 * gone. A guess that turns out wrong costs the undo, not the save: `recordSave` checks the
 * compiled selector against these slots and records nothing when it is not among them.
 */
function undoSlotsForSave(
  parsed: ParsedNewMethodUri | ParsedMethodUri,
  sourceCode: string,
): MethodSlot[] {
  const selectors: string[] = [];
  if (parsed.kind === 'method') selectors.push(parsed.selector);
  const guessed = extractSelector(sourceCode.split('\n')[0] ?? '');
  if (guessed && !selectors.includes(guessed)) selectors.push(guessed);
  return selectors.map((selector) => ({
    dict: parsed.dictIndex ?? parsed.dictName,
    className: parsed.className,
    isMeta: parsed.isMeta,
    selector,
    environmentId: parsed.environmentId,
  }));
}

/** Record a completed save against the slot GemStone actually compiled into, and answer the
 *  entry so the caller can put Undo on its toast. Every other slot is left reading exactly as
 *  it did before, so the reversal has nothing to do there. */
function recordSave(
  recording: MethodEditRecording,
  slots: MethodSlot[],
  compiledSelector: string,
  sourceCode: string,
  category: string,
): UndoEntry | undefined {
  const at = slots.findIndex((s) => s.selector === compiledSelector);
  if (at < 0) {
    logInfo(`[undo] not recording: compiled #${compiledSelector}, which was not snapshotted`);
    return undefined;
  }
  const after = slots.map((slot, i) =>
    i === at ? present(sourceCode, category) : recording.before[i],
  );
  const verb = recording.before[at].exists ? 'Save' : 'Add';
  return recording.commit(`${verb} ${slotLabel(slots[at])}`, after);
}

// ── FileSystemProvider ────────────────────────────────────────

export class GemStoneFileSystemProvider implements vscode.FileSystemProvider {
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private _onMethodCompiled = new vscode.EventEmitter<MethodCompiledEvent>();
  readonly onMethodCompiled = this._onMethodCompiled.event;

  private _onClassDefinitionCompiled = new vscode.EventEmitter<ClassDefinitionCompiledEvent>();
  readonly onClassDefinitionCompiled = this._onClassDefinitionCompiled.event;

  private diagnostics = vscode.languages.createDiagnosticCollection('gemstone-method');

  constructor(
    private sessionManager: SessionManager,
    private exportManager?: ExportManager,
  ) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  /**
   * Announce that these resources changed underneath VS Code, so a clean editor showing one
   * of them re-reads it.
   *
   * `writeFile` already fires this for a save. This is the entry point for a change made
   * some OTHER way — an undo recompiles a method straight over GCI, never touching the
   * provider, and an editor left showing the discarded source is how that undo gets silently
   * re-saved (#434).
   */
  notifyChanged(uris: vscode.Uri[]): void {
    if (uris.length === 0) return;
    this._onDidChangeFile.fire(uris.map((uri) => ({ type: vscode.FileChangeType.Changed, uri })));
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    logInfo(`[FS] stat ${uri.toString()}`);
    const stat: vscode.FileStat = {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };
    const parsed = parseUri(uri);
    // New documents are always writable — no existing class to check
    if (parsed.kind === 'new-class' || parsed.kind === 'new-method') return stat;
    // Override-diff view URIs are read-only on both sides — it's a comparison,
    // not an editor.
    if (parsed.kind === 'method' && parsed.diffView) {
      stat.permissions = vscode.FilePermission.Readonly;
      return stat;
    }
    // Class-definition and method-source editors are always writable. We do NOT
    // pre-lock on canClassBeWritten (segment/user authorization): if the class
    // truly can't be written, GemStone rejects the save and writeFile surfaces
    // the error as a diagnostic. Pre-locking mis-flagged authorized classes as
    // read-only, so let the save path be the source of truth.
    logInfo(`[FS] stat → writable`);
    return stat;
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const parsed = parseUri(uri);

    if (parsed.kind === 'new-class') {
      // A new class always gets an editable category line, so the user can set a
      // category regardless of the explorer's selection. Pre-fill the selected
      // category when there was one, else GemStone's default 'User Classes'.
      const category = parsed.category ?? DEFAULT_CLASS_CATEGORY;
      const categoryLine = `\n  category: '${category.replace(/'/g, "''")}'`;
      const template = `Object subclass: 'NameOfClass'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: ${parsed.dictName}${categoryLine}
  options: #()`;
      return new TextEncoder().encode(template);
    }

    if (parsed.kind === 'new-method') {
      const template = `messageSelector
  "comment"
  | temporaries |
  statements`;
      return new TextEncoder().encode(template);
    }

    const session = this.getSession(parsed.sessionId);

    let text: string;
    switch (parsed.kind) {
      case 'method': {
        const dictRef = parsed.dictIndex ?? parsed.dictName;
        text = parsed.base
          ? queries.getBaseMethodSource(
              session,
              parsed.className,
              parsed.isMeta,
              parsed.selector,
              parsed.environmentId,
              dictRef,
            )
          : queries.getMethodSource(
              session,
              parsed.className,
              parsed.isMeta,
              parsed.selector,
              parsed.environmentId,
              dictRef,
            );
        break;
      }
      case 'definition': {
        // GemStone's `definition` omits the category; show it on its own line so
        // it's visible and editable (the save path applies it separately).
        const dictRef = parsed.dictIndex ?? parsed.dictName;
        const definition = queries.getClassDefinition(session, parsed.className, dictRef);
        const category = queries.getClassCategory(session, parsed.className, dictRef);
        text = withCategoryLine(definition, category);
        break;
      }
      case 'comment':
        text = queries.getClassComment(
          session,
          parsed.className,
          parsed.dictIndex ?? parsed.dictName,
        );
        break;
    }

    return new TextEncoder().encode(text);
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): void {
    logInfo(`[FS] writeFile ${uri.toString()} (${content.length} bytes)`);
    const parsed = parseUri(uri);
    const session = this.getSession(parsed.sessionId);
    const source = new TextDecoder().decode(content);

    try {
      switch (parsed.kind) {
        case 'method':
          this.compileMethod(uri, parsed, source, session);
          break;
        case 'definition':
          this.compileClassDefinition(uri, parsed, source, session);
          break;
        case 'comment':
          this.saveClassComment(parsed, source, session);
          break;
        case 'new-class':
          this.compileClassDefinition(uri, parsed, source, session);
          break;
        case 'new-method':
          this.compileMethod(uri, parsed, source, session);
          break;
      }

      this.diagnostics.delete(uri);
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      logInfo(`[FS] writeFile → success (${parsed.kind})`);
    } catch (e: unknown) {
      if (e instanceof BrowserQueryError) {
        logInfo(`[FS] writeFile → compile error: ${e.message}`);
        // Parse line number from GCI error message (e.g. "... (line 3, ...")
        const lineMatch = e.message.match(/line\s+(\d+)/i);
        const lineNum = lineMatch ? parseInt(lineMatch[1], 10) - 1 : 0;
        const range = new vscode.Range(
          new vscode.Position(Math.max(0, lineNum), 0),
          new vscode.Position(Math.max(0, lineNum), Number.MAX_SAFE_INTEGER),
        );
        const diag = new vscode.Diagnostic(range, e.message, vscode.DiagnosticSeverity.Error);
        diag.source = 'GemStone';
        this.diagnostics.set(uri, [diag]);
        // Do not rethrow — VS Code considers the save complete; old method still
        // lives in GemStone. The user sees the red squiggle and can fix and re-save.
        return;
      }
      logInfo(`[FS] writeFile → unexpected error: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  private saveClassComment(parsed: ParsedCommentUri, source: string, session: ActiveSession): void {
    const dictRef = parsed.dictIndex ?? parsed.dictName;
    // Read the old comment BEFORE overwriting it — this is the one moment it still
    // exists (#434).
    const recording = beginClassCommentEdit(session, {
      dict: dictRef,
      className: parsed.className,
    });

    const result = queries.setClassComment(session, parsed.className, source, dictRef);
    // setClassComment reports a class it cannot resolve by RETURNING a status string rather
    // than throwing, so "Comment updated" used to appear over a save that wrote nothing —
    // and an undo entry for it would offer to put back a comment nobody replaced.
    if (!result.startsWith('Comment set:')) {
      vscode.window.showWarningMessage(`Comment for ${parsed.className} was not saved: ${result}`);
      return;
    }

    notifyUndoable(`Comment updated for ${parsed.className}`, recording?.commit(source));
    void this.exportManager?.syncClass(session, parsed.dictName, parsed.className);
  }

  private compileMethod(
    uri: vscode.Uri,
    parsedMethodUri: ParsedNewMethodUri | ParsedMethodUri,
    sourceCode: string,
    session: ActiveSession,
  ) {
    // Snapshot BEFORE compiling — this is the one moment the previous source still
    // exists. A capture that fails answers undefined and the save proceeds unrecorded.
    const slots = undoSlotsForSave(parsedMethodUri, sourceCode);
    const recording = beginMethodEdit(session, slots);

    const result = queries.compileMethod(
      session,
      parsedMethodUri.className,
      parsedMethodUri.isMeta,
      parsedMethodUri.category,
      sourceCode,
      parsedMethodUri.environmentId,
      parsedMethodUri.dictIndex ?? parsedMethodUri.dictName,
    );
    const selector = result.split('>> ')[1]?.trim();

    if (!selector) {
      throw new BrowserQueryError(result);
    }

    const undoEntry = recording
      ? recordSave(recording, slots, selector, sourceCode, parsedMethodUri.category)
      : undefined;

    const recv = receiver(parsedMethodUri.className, parsedMethodUri.isMeta);
    if (
      this.classIsWritable(
        session,
        parsedMethodUri.className,
        parsedMethodUri.dictIndex ?? parsedMethodUri.dictName,
      )
    ) {
      // The Undo button rides on THIS toast, which is the only undo affordance with no
      // discovery cost -- it is where the user is already looking (#434).
      notifyUndoable(`Compiled method ${recv}>>#${selector}`, undoEntry);
    } else {
      // A non-writable class compiles into the transient (session) method dict,
      // NOT the persistent one, so GemStone reports success but the change is
      // never persisted and vanishes when the session ends. Say so, rather than
      // a misleading "Compiled" toast (see the read-only editor policy).
      vscode.window.showWarningMessage(
        `${recv}>>#${selector} compiled as a transient session method — NOT persisted ` +
          `(the class is not writable). The change will be lost when the session ends.`,
      );
    }

    void this.exportManager?.syncClass(
      session,
      parsedMethodUri.dictName,
      parsedMethodUri.className,
    );

    const newMethodUri = buildMethodUri({
      ...parsedMethodUri,
      kind: 'method',
      selector: selector,
    });

    // Defer the event to the next event-loop iteration so VS Code has time to
    // process the completed save and mark the document clean. Firing synchronously
    // here — before writeFile returns — means the tab is still dirty when
    // closeTextEditorOn runs, which triggers a "save before closing?" dialog.
    setImmediate(() =>
      this._onMethodCompiled.fire({
        uri: newMethodUri,
        previousUri: uri,
        previousUriIsTemplate: parsedMethodUri.kind === 'new-method',
      }),
    );
  }

  private compileClassDefinition(
    uri: vscode.Uri,
    parsed: ParsedNewClassUri | ParsedDefinitionUri,
    source: string,
    session: ActiveSession,
  ) {
    // The editor shows the category on its own line, but no GemStone image can
    // compile it inside the subclass message (the 8-keyword
    // subclass:…inDictionary:category:options: selector raises MessageNotUnderstood
    // on base stones). Strip the category line, compile the always-valid
    // definition, then apply the category via Class>>category:.
    const { source: defSource, category } = splitOutCategory(source);
    // A definition may name a dictionary other than the one the tab was opened on — the
    // user can edit the `inDictionary:` line, on an existing class's definition just as
    // much as on a new-class template, and the compile simply executes the source. So the
    // class lands wherever that line says, and every post-compile step — existence check,
    // recategorize, writability, undo, sync, reopen — must target THAT dictionary, not the
    // one in the URI, or they look the class up in the wrong place. Looking it up in the
    // wrong place does not fail loudly: `canClassBeWritten` reads a class it cannot find as
    // NOT writable, so a save that moved a class used to be reported as "recompiled
    // transiently — NOT persisted" when it had in fact persisted perfectly well.
    const definedDictName = dictNameFromDefinition(defSource);
    const targetDictName: string = definedDictName ?? parsed.dictName;
    // Prefer the URI's SymbolList index while the definition leaves the class where it was:
    // an index is unambiguous where a name is not, since two dictionaries can share a name.
    // Once the definition names a different dictionary, the name is all there is to go on.
    const dictRef: number | string =
      parsed.kind === 'definition' && targetDictName === parsed.dictName
        ? (parsed.dictIndex ?? parsed.dictName)
        : targetDictName;

    // A NEW-class save must not silently redefine an existing class in the target
    // dictionary. (Editing an existing class's definition is a deliberate
    // redefinition, so this guard is new-class only.)
    if (parsed.kind === 'new-class') {
      const intended = classNameFromDefinition(defSource);
      if (intended && queries.classExistsInDictionary(session, intended, dictRef)) {
        throw new BrowserQueryError(
          `A class named ${intended} already exists in ${targetDictName} — not overwriting it. ` +
            `Choose a different name, or edit the existing class from its own definition editor.`,
        );
      }
    }

    // Snapshot the class binding BEFORE compiling, and stash the version bound now: a
    // shape-changing save answers a NEW version, and the old one is the only way back (#434).
    //
    // The name comes from the DEFINITION, never from the URI, for both kinds. A new-class
    // URI carries only a placeholder; and a definition tab whose class name has been edited
    // CREATES a class, leaving the one the tab was opened on untouched -- so watching
    // parsed.className there would see no change, record nothing, and leave the creation
    // unrevertible. parsed.className is only the fallback for a definition whose name cannot
    // be parsed, which is a definition that will not compile anyway.
    const undoName =
      classNameFromDefinition(defSource) ??
      (parsed.kind === 'definition' ? parsed.className : undefined);
    const recording = undoName
      ? beginClassEdit(session, [{ dict: dictRef, className: undoName }])
      : undefined;

    const className = queries.compileClassDefinition(session, defSource);

    // Apply the category the subclass message could not carry — always, including an
    // empty value: the editor always shows a `category:` line, so deleting/emptying it
    // is how the user clears the class's category (skipping the empty case would keep
    // the old category and read as a reverted edit on reopen). A failure here must not
    // lose the freshly compiled class, so it's logged, not thrown.
    const desiredCategory = category ?? '';
    try {
      const result = queries.recategorizeClass(session, className, desiredCategory, dictRef);
      // recategorizeClass reports soft failures (e.g. the class not resolving in
      // dictRef) by RETURNING a status string rather than throwing — surface it so the
      // typed category isn't silently dropped behind a "saved" message.
      if (!result.startsWith('Recategorized:')) {
        logInfo(`[FS] recategorize ${className} → '${desiredCategory}' did not apply: ${result}`);
      }
    } catch (e: unknown) {
      logInfo(
        `[FS] recategorize ${className} → '${desiredCategory}' failed: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // An existing but non-writable class recompiles transiently (like a session
    // method) without persisting, yet GemStone reports success — warn instead
    // of a misleading "updated" toast. A new class that couldn't be written to
    // its target dictionary would have thrown above, so it's always a success.
    if (parsed.kind === 'definition' && !this.classIsWritable(session, className, dictRef)) {
      vscode.window.showWarningMessage(
        `${className} recompiled transiently — NOT persisted (the class is not writable). ` +
          `The change will be lost when the session ends.`,
      );
    } else {
      // Created or redefined is what the CAPTURE saw, not what the URI said: a definition
      // tab whose class name was edited creates a class too, and calling that "definition
      // updated" names the wrong thing. Only when nothing was captured does the URI kind
      // have to answer for it.
      const created = recording ? !recording.before[0]?.bound : parsed.kind === 'new-class';
      const message = created
        ? `Class created: ${className}`
        : `Class definition updated for ${className}`;
      notifyUndoable(
        message,
        recording?.commit(created ? `Add class ${className}` : `Redefine class ${className}`),
      );
    }

    // Use the name GemStone returned, not parsed.className: for a new-class URI the segment is
    // a placeholder, and editing a definition with a different class name creates a new class —
    // in both cases, parsed.className does not reflect the class that was actually created.
    void this.exportManager?.syncClass(session, targetDictName, className);

    // Preserve the dictionary index (when the edited URI carried one) so the
    // reopened definition tab targets the same dictionary and matches the tab
    // being replaced. Dropped when the definition moved the class: the index still
    // points at the dictionary the tab came from, and pairing it with the new
    // dictionary's name would reopen the tab looking in the old one.
    const dictIndex =
      parsed.kind === 'definition' && targetDictName === parsed.dictName
        ? parsed.dictIndex
        : undefined;
    const definitionUri = buildClassDefinitionUri(
      parsed.sessionId,
      targetDictName,
      className,
      dictIndex,
    );

    setImmediate(() =>
      this._onClassDefinitionCompiled.fire({
        uri: definitionUri,
        previousUri: uri,
        previousUriIsTemplate: parsed.kind === 'new-class',
      }),
    );
  }

  // Whether `className` lives in a writable repository segment. A false result
  // means a compile lands only in the transient session method dict, so it is
  // reported as success but never persists. Defaults to true if the check
  // itself fails, so a transient query error never turns a real save into a
  // spurious "not persisted" warning.
  private classIsWritable(
    session: ActiveSession,
    className: string,
    dict?: number | string,
  ): boolean {
    try {
      return queries.canClassBeWritten(session, className, dict);
    } catch {
      return true;
    }
  }

  dispose(): void {
    this._onDidChangeFile.dispose();
    this._onMethodCompiled.dispose();
    this._onClassDefinitionCompiled.dispose();
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot create directories');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot delete methods from here');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Cannot rename methods');
  }

  private getSession(sessionId: number) {
    const sessions = this.sessionManager.getSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      // The tab is backed by a session that no longer exists — most commonly a
      // gemstone:// tab VS Code restored across a window/host reload, which
      // otherwise renders a broken "could not be opened" editor forever. Close
      // every stale tab for this dead session id instead. Deferred so we don't
      // mutate the tab model while VS Code is mid-open (and so the throw below
      // still surfaces if the close is somehow blocked).
      setImmediate(() => void closeGemstoneTabsForSession(sessionId));
      throw vscode.FileSystemError.Unavailable(`GemStone session ${sessionId} is no longer active`);
    }
    return session;
  }
}
