import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';
import { ExportManager } from './exportManager';
import { logInfo } from './gciLog';
import { receiver } from './queries/util';

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
      category: parts[4],
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
      category: parts[4],
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
  assertIsValidUriPath('Method category name', parsedUri.category);
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
    path: `/${parsedUri.dictName}/${parsedUri.className}/${side}/${parsedUri.category}/${escapeSelectorSlashes(parsedUri.selector)}`,
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
      const categoryLine = parsed.category ? `\n  category: '${parsed.category}'` : '';
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
      case 'definition':
        text = queries.getClassDefinition(
          session,
          parsed.className,
          parsed.dictIndex ?? parsed.dictName,
        );
        break;
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
          queries.setClassComment(
            session,
            parsed.className,
            source,
            parsed.dictIndex ?? parsed.dictName,
          );
          vscode.window.showInformationMessage(`Comment updated for ${parsed.className}`);
          void this.exportManager?.syncClass(session, parsed.dictName, parsed.className);
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

  private compileMethod(
    uri: vscode.Uri,
    parsedMethodUri: ParsedNewMethodUri | ParsedMethodUri,
    sourceCode: string,
    session: ActiveSession,
  ) {
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

    const recv = receiver(parsedMethodUri.className, parsedMethodUri.isMeta);
    if (
      this.classIsWritable(
        session,
        parsedMethodUri.className,
        parsedMethodUri.dictIndex ?? parsedMethodUri.dictName,
      )
    ) {
      vscode.window.showInformationMessage(`Compiled method ${recv}>>#${selector}`);
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
    const className = queries.compileClassDefinition(session, source);

    // An existing but non-writable class recompiles transiently (like a session
    // method) without persisting, yet GemStone reports success — warn instead
    // of a misleading "updated" toast. A new class that couldn't be written to
    // its target dictionary would have thrown above, so it's always a success.
    if (
      parsed.kind === 'definition' &&
      !this.classIsWritable(session, className, parsed.dictIndex ?? parsed.dictName)
    ) {
      vscode.window.showWarningMessage(
        `${className} recompiled transiently — NOT persisted (the class is not writable). ` +
          `The change will be lost when the session ends.`,
      );
    } else {
      const message =
        parsed.kind === 'new-class'
          ? `Class created: ${className}`
          : `Class definition updated for ${className}`;
      vscode.window.showInformationMessage(message);
    }

    // Use the name GemStone returned, not parsed.className: for a new-class URI the segment is
    // a placeholder, and editing a definition with a different class name creates a new class —
    // in both cases, parsed.className does not reflect the class that was actually created.
    void this.exportManager?.syncClass(session, parsed.dictName, className);

    // Preserve the dictionary index (when the edited URI carried one) so the
    // reopened definition tab targets the same dictionary and matches the tab
    // being replaced.
    const dictIndex = parsed.kind === 'definition' ? parsed.dictIndex : undefined;
    const definitionUri = buildClassDefinitionUri(
      parsed.sessionId,
      parsed.dictName,
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
