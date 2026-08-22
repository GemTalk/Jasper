import { vi } from 'vitest';
import { URI as Uri } from 'vscode-uri';

export { Uri };

// ── Configuration mock ─────────────────────────────────────

const configStore: Record<string, Record<string, unknown>> = {};

function getConfiguration(section: string) {
  if (!configStore[section]) {
    configStore[section] = {};
  }
  return {
    get<T>(key: string, defaultValue?: T): T {
      const val = configStore[section][key];
      return (val !== undefined ? val : defaultValue) as T;
    },
    inspect<T>(key: string): {
      key: string;
      globalValue?: T;
      workspaceValue?: T;
      workspaceFolderValue?: T;
    } {
      const val = configStore[section][key];
      // A seeded value stands in for an explicitly-set (global-scope) value;
      // otherwise all scope fields are absent, matching the real API's shape
      // for a key the user never set.
      return val !== undefined
        ? { key: `${section}.${key}`, globalValue: val as T }
        : { key: `${section}.${key}` };
    },
    update: vi.fn(async (key: string, value: unknown, _target?: number) => {
      configStore[section][key] = value;
    }),
  };
}

/** Reset all stored config values between tests. */
export function __resetConfig(): void {
  for (const key of Object.keys(configStore)) {
    delete configStore[key];
  }
}

/** Pre-seed a config section for testing. */
export function __setConfig(section: string, key: string, value: unknown): void {
  if (!configStore[section]) {
    configStore[section] = {};
  }
  configStore[section][key] = value;
}

// ── TreeItem mock ──────────────────────────────────────────

export class TreeItem {
  label?: string;
  id?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  collapsibleState?: number;
  checkboxState?: number;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

export const TreeItemCheckboxState = {
  Unchecked: 0,
  Checked: 1,
};

// ── ThemeIcon mock ─────────────────────────────────────────

export class ThemeIcon {
  constructor(
    public readonly id: string,
    // Real ThemeIcon takes an optional ThemeColor; kept here so a test can assert
    // which colour a row was painted (pass vs. failed vs. stale).
    public readonly color?: { id: string },
  ) {}
}

// ── CancellationTokenSource mock ───────────────────────────

export class CancellationTokenSource {
  private listeners: Array<() => void> = [];

  readonly token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    },
  };

  cancel(): void {
    this.token.isCancellationRequested = true;
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ── EventEmitter mock ──────────────────────────────────────

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ── ConfigurationTarget mock ───────────────────────────────

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

// ── ViewColumn mock ────────────────────────────────────────

export const ViewColumn = {
  Active: -1,
  One: 1,
  Two: 2,
  Three: 3,
  Beside: -2,
};

// ── TextEditorRevealType mock ──────────────────────────────

export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
};

export const TextEditorSelectionChangeKind = {
  Keyboard: 1,
  Mouse: 2,
  Command: 3,
};

// ── OverviewRulerLane mock ────────────────────────────────

export const OverviewRulerLane = {
  Left: 1,
  Center: 2,
  Right: 4,
  Full: 7,
};

// ── ThemeColor mock ───────────────────────────────────────

export class ThemeColor {
  constructor(public readonly id: string) {}
}

// ── Window mock ────────────────────────────────────────────

function createMockWebview() {
  return {
    html: '',
    postMessage: vi.fn(),
    onDidReceiveMessage: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
  };
}

function createMockPanel() {
  const webview = createMockWebview();
  return {
    webview,
    title: '',
    active: true,
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
    onDidChangeViewState: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
  };
}

function createMockTextEditor() {
  return {
    document: {
      uri: Uri.file(''),
      languageId: '',
      getText: vi.fn(() => ''),
      lineCount: 0,
      lineAt: vi.fn((line: number) => ({
        lineNumber: line,
        text: '',
        firstNonWhitespaceCharacterIndex: 0,
        range: new Range(line, 0, line, 0),
      })),
      positionAt: vi.fn((offset: number) => new Position(0, offset)),
      getWordRangeAtPosition: vi.fn(() => undefined),
    },
    selection: new Selection(new Position(0, 0), new Position(0, 0)),
    selections: [],
    viewColumn: undefined as number | undefined,
    setDecorations: vi.fn(),
    revealRange: vi.fn(),
    edit: vi.fn(
      async (
        cb: (b: { replace: typeof vi.fn; insert: typeof vi.fn; delete: typeof vi.fn }) => void,
      ) => {
        cb({ replace: vi.fn(), insert: vi.fn(), delete: vi.fn() } as never);
        return true;
      },
    ),
  };
}

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

// ── QuickPickItemKind mock ─────────────────────────────────

export const QuickPickItemKind = {
  Separator: -1,
  Default: 0,
};

export const window = {
  activeTextEditor: undefined as unknown,
  activeNotebookEditor: undefined as unknown,
  createWebviewPanel: vi.fn((_viewType: string, title: string) => {
    const panel = createMockPanel();
    panel.title = title;
    return panel;
  }),
  showTextDocument: vi.fn(async (_a: unknown, b?: unknown) => {
    const editor = createMockTextEditor();
    let col: number | undefined;
    if (typeof b === 'number') col = b;
    else if (b && typeof b === 'object' && 'viewColumn' in b)
      col = (b as { viewColumn?: number }).viewColumn;
    // Resolve Active (-1) / Beside (-2) / unspecified to a concrete column, as real
    // VS Code does, so callers can record the column an editor actually landed in.
    editor.viewColumn = col === undefined || col < 0 ? 1 : col;
    return editor;
  }),
  showNotebookDocument: vi.fn(async (doc: unknown) => ({ notebook: doc })),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  createTreeView: vi.fn(() => ({
    onDidChangeVisibility: new EventEmitter<{ visible: boolean }>().event,
    onDidChangeCheckboxState: new EventEmitter<{ items: [unknown, number][] }>().event,
    reveal: vi.fn(),
    dispose: () => {},
  })),
  registerFileDecorationProvider: vi.fn(() => ({ dispose: () => {} })),
  createOutputChannel: vi.fn(() => ({
    append: vi.fn(),
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
  visibleTextEditors: [] as unknown[],
  onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: () => {} })),
  onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: () => {} })),
  onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: () => {} })),
  createTerminal: vi.fn((_nameOrOptions: string | { name?: string }) => ({
    show: vi.fn(),
    sendText: vi.fn(),
    dispose: vi.fn(),
  })),
  onDidCloseTerminal: vi.fn((_handler: (terminal: unknown) => void) => ({ dispose: vi.fn() })),
  setStatusBarMessage: vi.fn(),
  createStatusBarItem: vi.fn(() => ({
    text: '',
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: () => {} })),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  // Controllable low-level QuickPick. Each call returns a fresh instance whose
  // registered handlers can be fired from a test via `__accept()` / `__hide()`
  // (or `hide()`), after inspecting/setting `items`, `activeItems`, and
  // `selectedItems`. Grab the created instance with
  // `vi.mocked(vscode.window.createQuickPick).mock.results.at(-1).value`.
  createQuickPick: vi.fn(() => {
    let onAccept: (() => void | Promise<void>) | undefined;
    let onHide: (() => void) | undefined;
    let visible = false;
    // Mirror real VS Code: hide()/dispose() only fire onDidHide while the input
    // is still visible, and at most once — dispose() cascades to a hide if the
    // input hasn't been hidden yet, so `dispose()` after a still-visible show()
    // fires onDidHide (which a disposed-then-nothing input does not re-fire).
    const fireHide = () => {
      if (!visible) return;
      visible = false;
      onHide?.();
    };
    const qp: Record<string, unknown> = {
      title: '',
      placeholder: '',
      value: '',
      items: [] as unknown[],
      selectedItems: [] as unknown[],
      activeItems: [] as unknown[],
      enabled: true,
      busy: false,
      matchOnDescription: false,
      matchOnDetail: false,
      onDidAccept: vi.fn((h: () => void | Promise<void>) => {
        onAccept = h;
        return { dispose: vi.fn() };
      }),
      onDidHide: vi.fn((h: () => void) => {
        onHide = h;
        return { dispose: vi.fn() };
      }),
      show: vi.fn(() => {
        visible = true;
      }),
      hide: vi.fn(() => fireHide()),
      dispose: vi.fn(() => fireHide()),
      __accept: async () => {
        await onAccept?.();
      },
      __hide: () => fireHide(),
    };
    return qp;
  }),
  // Controllable low-level InputBox, same shape and lifecycle rules as
  // createQuickPick above. Fire the registered handlers from a test with
  // `__type(text)` (a keystroke — sets `value` and fires onDidChangeValue),
  // `__accept()` (Enter) and `__hide()` (Escape). Grab the created instance with
  // `vi.mocked(vscode.window.createInputBox).mock.results.at(-1).value`.
  //
  // The Enter/Escape distinction is the point: real VS Code fires onDidHide for
  // BOTH, and onDidAccept only for Enter — so a caller that wants to tell an
  // accepted edit from an abandoned one has to track that itself.
  createInputBox: vi.fn(() => {
    let onChange: ((value: string) => void) | undefined;
    let onAccept: (() => void | Promise<void>) | undefined;
    let onHide: (() => void) | undefined;
    let visible = false;
    const fireHide = () => {
      if (!visible) return;
      visible = false;
      onHide?.();
    };
    const box: Record<string, unknown> = {
      title: '',
      placeholder: '',
      prompt: '',
      value: '',
      enabled: true,
      busy: false,
      onDidChangeValue: vi.fn((h: (value: string) => void) => {
        onChange = h;
        return { dispose: vi.fn() };
      }),
      onDidAccept: vi.fn((h: () => void | Promise<void>) => {
        onAccept = h;
        return { dispose: vi.fn() };
      }),
      onDidHide: vi.fn((h: () => void) => {
        onHide = h;
        return { dispose: vi.fn() };
      }),
      show: vi.fn(() => {
        visible = true;
      }),
      hide: vi.fn(() => fireHide()),
      dispose: vi.fn(() => fireHide()),
      __type: (text: string) => {
        box.value = text;
        onChange?.(text);
      },
      __accept: async () => {
        await onAccept?.();
      },
      __hide: () => fireHide(),
    };
    return box;
  }),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  tabGroups: {
    all: [] as {
      viewColumn?: number;
      activeTab?: { input: unknown; isDirty?: boolean; isPinned?: boolean };
      tabs: { input: unknown; isDirty?: boolean; isPinned?: boolean }[];
    }[],
    close: vi.fn(),
    onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
  },
  withProgress: vi.fn(
    async (_opts: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => {
      const progress = { report: vi.fn() };
      const token = { isCancellationRequested: false };
      return task(progress, token);
    },
  ),
};

export const env = {
  clipboard: {
    writeText: vi.fn(async (_text: string) => {}),
    readText: vi.fn(async () => ''),
  },
};

// ── Workspace mock ─────────────────────────────────────────

export const TextDocumentSaveReason = {
  Manual: 1,
  AfterDelay: 2,
  FocusOut: 3,
};

export class TextEdit {
  constructor(
    public range: Range,
    public newText: string,
  ) {}
  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }
  static insert(position: Position, newText: string): TextEdit {
    return new TextEdit(new Range(position, position), newText);
  }
  static delete(range: Range): TextEdit {
    return new TextEdit(range, '');
  }
}

export class WorkspaceEdit {
  private edits: Array<{ uri: Uri; edit: TextEdit }> = [];
  replace(uri: Uri, range: Range, newText: string): void {
    this.edits.push({ uri, edit: new TextEdit(range, newText) });
  }
  insert(uri: Uri, position: Position, newText: string): void {
    this.edits.push({ uri, edit: TextEdit.insert(position, newText) });
  }
  delete(uri: Uri, range: Range): void {
    this.edits.push({ uri, edit: TextEdit.delete(range) });
  }
}

export const workspace = {
  getConfiguration,
  onDidChangeConfiguration: vi.fn(() => ({ dispose: () => {} })),
  onDidChangeTextDocument: vi.fn(() => ({ dispose: () => {} })),
  onDidSaveTextDocument: vi.fn(() => ({ dispose: () => {} })),
  onWillSaveTextDocument: vi.fn(() => ({ dispose: () => {} })),
  onDidCreateFiles: vi.fn(() => ({ dispose: () => {} })),
  onDidDeleteFiles: vi.fn(() => ({ dispose: () => {} })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: () => {} })),
  onDidOpenTextDocument: vi.fn(() => ({ dispose: () => {} })),
  registerTextDocumentContentProvider: vi.fn(() => ({ dispose: () => {} })),
  registerFileSystemProvider: vi.fn(() => ({ dispose: () => {} })),
  openTextDocument: vi.fn(async (_uri: unknown) => ({
    uri: _uri,
    getText: vi.fn(() => ''),
    isDirty: false,
  })),
  openNotebookDocument: vi.fn(async (notebookType: string, data?: unknown) => ({
    notebookType,
    data,
  })),
  applyEdit: vi.fn(async () => true),
  textDocuments: [] as unknown[],
  workspaceFolders: undefined as { uri: { fsPath: string; path: string } }[] | undefined,
};

/** Set (or clear) the open workspace folders for a test. */
export function __setWorkspaceFolders(paths: string[] | undefined): void {
  workspace.workspaceFolders = paths?.map((p) => ({ uri: { fsPath: p, path: p } }));
}

// ── Commands mock ──────────────────────────────────────────

export const commands = {
  registerCommand: vi.fn((_command: string, _callback: unknown) => ({ dispose: () => {} })),
  executeCommand: vi.fn(),
};

// ── Tab input mock ────────────────────────────────────────

export class TabInputText {
  constructor(public readonly uri: Uri) {}
}

export class TabInputTextDiff {
  constructor(
    public readonly original: Uri,
    public readonly modified: Uri,
  ) {}
}

// ── FileSystemError mock ──────────────────────────────────

export class FileSystemError extends Error {
  code: string;
  constructor(message: string, code = 'Unknown') {
    super(message);
    this.code = code;
  }
  static FileNotFound(uri?: unknown): FileSystemError {
    return new FileSystemError(`File not found: ${uri}`, 'FileNotFound');
  }
  static NoPermissions(uri?: unknown): FileSystemError {
    return new FileSystemError(`No permissions: ${uri}`, 'NoPermissions');
  }
  static Unavailable(message?: string): FileSystemError {
    return new FileSystemError(message || 'Unavailable', 'Unavailable');
  }
}

// ── FileType mock ─────────────────────────────────────────

export const FileType = {
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

// ── FileChangeType mock ───────────────────────────────────

export const FileChangeType = {
  Changed: 1,
  Created: 2,
  Deleted: 3,
};

// ── FilePermission mock ──────────────────────────────────

export const FilePermission = {
  Readonly: 1,
};

// ── Position & Location mock ──────────────────────────────

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
  translate(lineDelta = 0, charDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + charDelta);
  }
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(
    startOrLine: Position | number,
    endOrChar: Position | number,
    endLine?: number,
    endChar?: number,
  ) {
    if (typeof startOrLine === 'number') {
      this.start = new Position(startOrLine, endOrChar as number);
      this.end = new Position(endLine ?? startOrLine, endChar ?? (endOrChar as number));
    } else {
      this.start = startOrLine;
      this.end = endOrChar as Position;
    }
  }
  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

export class CodeLens {
  command?: { title: string; command: string; arguments?: unknown[] };
  constructor(
    public readonly range: Range,
    command?: { title: string; command: string; arguments?: unknown[] },
  ) {
    this.command = command;
  }
  get isResolved(): boolean {
    return this.command !== undefined;
  }
}

export class Selection extends Range {
  anchor: Position;
  active: Position;
  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.anchor = anchor;
    this.active = active;
  }
  get isEmpty(): boolean {
    return this.anchor.line === this.active.line && this.anchor.character === this.active.character;
  }
}

export class Location {
  public readonly range: Range;
  // The real API normalizes a Position into an empty Range, and callers rely on
  // `location.range.start` always being there — so the mock must too.
  constructor(
    public readonly uri: Uri,
    rangeOrPosition: Position | Range,
  ) {
    this.range =
      rangeOrPosition instanceof Range
        ? rangeOrPosition
        : new Range(rangeOrPosition, rangeOrPosition);
  }
}

export class CodeActionKind {
  constructor(public readonly value: string) {}
  static readonly Empty = new CodeActionKind('');
  static readonly QuickFix = new CodeActionKind('quickfix');
  static readonly Refactor = new CodeActionKind('refactor');
  static readonly Source = new CodeActionKind('source');
  append(parts: string): CodeActionKind {
    return new CodeActionKind(this.value ? `${this.value}.${parts}` : parts);
  }
  contains(other: CodeActionKind): boolean {
    return this.value === other.value || other.value.startsWith(`${this.value}.`);
  }
}

export class CodeAction {
  command?: { command: string; title: string };
  constructor(
    public title: string,
    public kind?: CodeActionKind,
  ) {}
}

// ── SymbolInformation mock ───────────────────────────────

export const SymbolKind = {
  File: 0,
  Module: 1,
  Namespace: 2,
  Package: 3,
  Class: 4,
  Method: 5,
  Property: 6,
  Field: 7,
  Constructor: 8,
  Enum: 9,
  Interface: 10,
  Function: 11,
  Variable: 12,
};

export class SymbolInformation {
  constructor(
    public readonly name: string,
    public readonly kind: number,
    public readonly containerName: string,
    public readonly location: Location,
  ) {}
}

// ── Languages mock ───────────────────────────────────────

function createMockDiagnosticCollection() {
  const store = new Map<string, unknown[]>();
  return {
    set: vi.fn((uri: { toString(): string }, diags: unknown[]) => {
      store.set(uri.toString(), diags);
    }),
    delete: vi.fn((uri: { toString(): string }) => {
      store.delete(uri.toString());
    }),
    get: vi.fn((uri: { toString(): string }) => store.get(uri.toString())),
    forEach: vi.fn((callback: (uri: Uri, diagnostics: unknown[], collection: unknown) => void) => {
      store.forEach((_diags, uriStr) => {
        callback(Uri.parse(uriStr), _diags, undefined);
      });
    }),
    clear: vi.fn(() => store.clear()),
    dispose: vi.fn(),
    __store: store,
  };
}

export const languages = {
  registerWorkspaceSymbolProvider: vi.fn(() => ({ dispose: () => {} })),
  registerDefinitionProvider: vi.fn(() => ({ dispose: () => {} })),
  registerHoverProvider: vi.fn(() => ({ dispose: () => {} })),
  registerCompletionItemProvider: vi.fn(() => ({ dispose: () => {} })),
  registerCodeLensProvider: vi.fn(() => ({ dispose: () => {} })),
  registerInlayHintsProvider: vi.fn(() => ({ dispose: () => {} })),
  setTextDocumentLanguage: vi.fn(),
  createDiagnosticCollection: vi.fn((_name?: string) => createMockDiagnosticCollection()),
  getDiagnostics: vi.fn((_uri?: unknown) => [] as Diagnostic[]),
};

// ── Diagnostic mock ─────────────────────────────────────────

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

export class Diagnostic {
  source?: string;
  constructor(
    public readonly range: Range,
    public readonly message: string,
    public readonly severity: number = DiagnosticSeverity.Error,
  ) {}
}

export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
};

export const InputBoxValidationSeverity = {
  Ignore: 0,
  Info: 1,
  Warning: 2,
  Error: 3,
};

// ── MarkdownString mock ──────────────────────────────────

export class MarkdownString {
  // Mirror the real MarkdownString flags the extension sets: `isTrusted` enables
  // command: links, `supportThemeIcons` enables $(codicon) rendering.
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  constructor(public value: string = '') {}
  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }
  appendCodeblock(code: string, language?: string): MarkdownString {
    this.value += '\n```' + (language || '') + '\n' + code + '\n```\n';
    return this;
  }
}

// ── Hover mock ───────────────────────────────────────────

export class Hover {
  constructor(
    public contents: MarkdownString | MarkdownString[],
    public range?: Range,
  ) {}
}

// ── CompletionItem mock ──────────────────────────────────

export class CompletionItem {
  detail?: string;
  documentation?: string;
  sortText?: string;
  constructor(
    public label: string,
    public kind?: number,
  ) {}
}

export const CompletionItemKind = {
  Method: 1,
  Field: 4,
  Variable: 5,
  Class: 6,
  Keyword: 13,
  Constant: 20,
};

// ── Debug mock ───────────────────────────────────────────

export const debug = {
  breakpoints: [] as unknown[],
  activeDebugSession: undefined as unknown,
  onDidChangeBreakpoints: vi.fn(() => ({ dispose: () => {} })),
  onDidStartDebugSession: vi.fn(() => ({ dispose: () => {} })),
  onDidTerminateDebugSession: vi.fn(() => ({ dispose: () => {} })),
  // Mirror the real API's side effect on `debug.breakpoints`, so a test can
  // drive the manager the way VS Code does and then read the list back.
  addBreakpoints: vi.fn((bps: unknown[]) => {
    debug.breakpoints = [...debug.breakpoints, ...bps];
  }),
  removeBreakpoints: vi.fn((bps: unknown[]) => {
    debug.breakpoints = debug.breakpoints.filter((bp) => !bps.includes(bp));
  }),
  startDebugging: vi.fn(),
  registerDebugAdapterDescriptorFactory: vi.fn(() => ({ dispose: () => {} })),
  registerDebugConfigurationProvider: vi.fn(() => ({ dispose: () => {} })),
};

export class Breakpoint {
  id = '';
  enabled = true;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export class SourceBreakpoint extends Breakpoint {
  constructor(
    public location: Location,
    enabled = true,
    condition?: string,
    hitCondition?: string,
    logMessage?: string,
  ) {
    super();
    this.enabled = enabled;
    this.condition = condition;
    this.hitCondition = hitCondition;
    this.logMessage = logMessage;
  }
}

// ── Inlay hint mock ──────────────────────────────────────

export const InlayHintKind = {
  Type: 1,
  Parameter: 2,
};

export class InlayHintLabelPart {
  tooltip?: unknown;
  command?: unknown;
  constructor(public value: string) {}
}

export class InlayHint {
  paddingLeft?: boolean;
  paddingRight?: boolean;
  constructor(
    public position: Position,
    public label: string | InlayHintLabelPart[],
    public kind?: number,
  ) {}
}

// ── Test API mock ────────────────────────────────────────

export class TestMessage {
  location?: Location;
  constructor(public message: string) {}
}

export const TestRunProfileKind = {
  Run: 1,
  Debug: 2,
  Coverage: 3,
};

function createMockTestItem(id: string, label: string, uri?: Uri) {
  const children = new Map<string, unknown>();
  return {
    id,
    label,
    uri,
    canResolveChildren: false,
    children: {
      get size() {
        return children.size;
      },
      replace(items: Array<{ id: string }>) {
        children.clear();
        for (const item of items) children.set(item.id, item);
      },
      forEach(cb: (item: unknown) => void) {
        children.forEach(cb);
      },
      get(key: string) {
        return children.get(key);
      },
    },
    description: undefined as string | undefined,
    error: undefined as unknown,
    range: undefined,
    tags: [] as unknown[],
  };
}

function createMockTestRun() {
  return {
    started: vi.fn(),
    passed: vi.fn(),
    failed: vi.fn(),
    errored: vi.fn(),
    skipped: vi.fn(),
    end: vi.fn(),
  };
}

function createMockTestController() {
  const items = new Map<string, unknown>();
  const controller = {
    id: 'gemstone-sunit',
    label: 'GemStone SUnit Tests',
    resolveHandler: undefined as ((item?: unknown) => Promise<void>) | undefined,
    refreshHandler: undefined as (() => Promise<void>) | undefined,
    createTestItem: vi.fn((id: string, label: string, uri?: Uri) =>
      createMockTestItem(id, label, uri),
    ),
    createRunProfile: vi.fn(),
    createTestRun: vi.fn(() => createMockTestRun()),
    items: {
      get size() {
        return items.size;
      },
      replace(newItems: Array<{ id: string }>) {
        items.clear();
        for (const item of newItems) items.set(item.id, item);
      },
      forEach(cb: (item: unknown) => void) {
        items.forEach(cb);
      },
      get(key: string) {
        return items.get(key);
      },
    },
    dispose: vi.fn(),
  };
  return controller;
}

export const tests = {
  createTestController: vi.fn((_id: string, _label: string) => createMockTestController()),
};

// ── Notebook API mock ─────────────────────────────────────

export class NotebookCellOutputItem {
  constructor(
    public readonly data: Uint8Array,
    public readonly mime: string,
  ) {}

  static text(value: string, mime = 'text/plain'): NotebookCellOutputItem {
    return new NotebookCellOutputItem(new TextEncoder().encode(value), mime);
  }

  static error(err: Error): NotebookCellOutputItem {
    const payload = JSON.stringify({ name: err.name, message: err.message });
    return new NotebookCellOutputItem(
      new TextEncoder().encode(payload),
      'application/vnd.code.notebook.error',
    );
  }
}

export class NotebookCellOutput {
  constructor(public readonly items: NotebookCellOutputItem[]) {}
}

export const NotebookCellKind = {
  Markup: 1,
  Code: 2,
} as const;

export class NotebookCellData {
  metadata: Record<string, unknown> | undefined;
  outputs: NotebookCellOutput[] | undefined;
  constructor(
    public kind: number,
    public value: string,
    public languageId: string,
  ) {}
}

export class NotebookData {
  metadata: Record<string, unknown> | undefined;
  constructor(public cells: NotebookCellData[]) {}
}

function createMockCellExecution(cell: unknown) {
  return {
    cell,
    executionOrder: undefined as number | undefined,
    start: vi.fn(),
    end: vi.fn(),
    replaceOutput: vi.fn(async () => {}),
    appendOutput: vi.fn(async () => {}),
  };
}

function createMockNotebookController(id: string, notebookType: string, label: string) {
  return {
    id,
    notebookType,
    label,
    description: undefined as string | undefined,
    detail: undefined as string | undefined,
    supportedLanguages: undefined as string[] | undefined,
    supportsExecutionOrder: false,
    executeHandler: undefined as unknown,
    interruptHandler: undefined as unknown,
    createNotebookCellExecution: vi.fn((cell: unknown) => createMockCellExecution(cell)),
    onDidChangeSelectedNotebooks: vi.fn(() => ({ dispose: () => {} })),
    dispose: vi.fn(),
  };
}

export const notebooks = {
  createNotebookController: vi.fn((id: string, notebookType: string, label: string) =>
    createMockNotebookController(id, notebookType, label),
  ),
};

// ── DataTransfer mock ─────────────────────────────────────

export class DataTransferItem {
  constructor(public readonly value: unknown) {}
  asString(): Thenable<string> {
    return Promise.resolve(String(this.value));
  }
  asFile(): undefined {
    return undefined;
  }
}

export class DataTransfer {
  private items = new Map<string, DataTransferItem>();

  get(mimeType: string): DataTransferItem | undefined {
    return this.items.get(mimeType);
  }

  set(mimeType: string, value: DataTransferItem): void {
    this.items.set(mimeType, value);
  }

  forEach(
    callbackfn: (item: DataTransferItem, mimeType: string, dataTransfer: DataTransfer) => void,
    thisArg?: unknown,
  ): void {
    this.items.forEach((item, mime) => callbackfn.call(thisArg, item, mime, this));
  }

  [Symbol.iterator](): IterableIterator<[mimeType: string, item: DataTransferItem]> {
    return this.items.entries();
  }
}

// ── Disposable mock ───────────────────────────────────────

export class Disposable {
  constructor(private callOnDispose: () => void) {}
  dispose(): void {
    this.callOnDispose();
  }
  /** Mirrors the real API: bundle several disposables into one, disposing each in turn. */
  static from(...disposables: Array<{ dispose(): unknown }>): Disposable {
    return new Disposable(() => {
      for (const d of disposables) d.dispose();
    });
  }
}
