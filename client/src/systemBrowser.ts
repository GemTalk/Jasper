import * as vscode from 'vscode';
import { beginMethodDeletion, beginMethodEdit, readMethodSlotState } from './undo/recordMethodEdit';
import { slotLabel } from './undo/undoTypes';
import { notifyUndoable } from './undo/undoableToast';
import { beginClassDeletion } from './undo/recordClassEdit';
import { recordDictionaryAdd } from './undo/recordDictionaryEdit';
import { extractSelector } from './methodPattern';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession } from './sessionManager';
import { ExportManager } from './exportManager';
import { parseTopazDocument } from './topazFileIn';
import * as queries from './browserQueries';
import { GlobalsBrowser } from './globalsBrowser';
import { ClassBrowser } from './classBrowser';
import { CommentBrowser } from './commentBrowser';
import {
  buildNewMethodUri,
  buildMethodUri,
  closeGemstoneTabsForSession,
  escapeSelectorSlashes,
} from './gemstoneFileSystemProvider';
import { SourceEditorPlacement } from './sourceEditorPlacement';
import { generateAndSaveGrailStub } from './grailStubGenerator';

/**
 * The webview HTML is a large template literal in getHtml(). Embedding JS directly
 * inside that string is hard to work with and the file keeps growing. listFilter.js is kept as a
 * standalone file so it gets proper IDE support and can be edited in isolation.
 *
 * We can't use a regular import because the webview needs the raw source text to
 * inject into a <script> tag — not a compiled module.
 * Reading the file at runtime is the simplest approach that works in both environments.
 */
const listFilterJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'listFilter.js'), 'utf8');
const methodListViewJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'methodListView.js'),
  'utf8',
);
const browserColumnResizeJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'browserColumnResize.js'),
  'utf8',
);

// ── Types ────────────────────────────────────────────────────

interface BrowserState {
  dictionaries: string[];
  selectedDictIndex: number | null; // 1-based
  classCategories: string[];
  selectedCategory: string | null;
  classes: string[];
  selectedClass: string | null;
  isMeta: boolean;
  selectedEnvId: number;
  methodCategories: string[];
  selectedMethodCategory: string | null;
  methods: string[];
  selectedMethod: string | null;
  viewMode: 'category' | 'hierarchy';
  hierarchyEntries: queries.ClassHierarchyEntry[];
  hierarchyClassName: string | null;
}

// ── File-out planning ────────────────────────────────────────

export interface DictFileOutFile {
  className: string;
  fileName: string; // includes the .gs extension
}

export interface DictFileOutPlan {
  /** One per-class file, in the order they should be filed back in. */
  files: DictFileOutFile[];
  /**
   * The loader (index) file's contents: a forward-reference block that binds
   * every class name to nil, followed by a Topaz `input` line per class.
   */
  indexContent: string;
}

// Escape a string for embedding inside a Smalltalk '...' literal.
function smalltalkString(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Plan a "file out dictionary as many files" write: one `.gs` file per class
 * plus a loader file. `orderedClassNames` must already be in file-in order (a
 * superclass before its subclasses) so that each class's *definition*
 * (`<Superclass> subclass: ...`) resolves when read.
 *
 * The loader opens with a forward-reference block that first ensures the
 * dictionary exists — creating it at the front of the symbol list (so its names
 * resolve first) when absent — then binds every class name to nil so that
 * *method* bodies referencing sibling classes (including circular references the
 * load order can't satisfy) compile against the dictionary's association rather
 * than failing on an unknown global; each class file then replaces its nil with
 * the real class. This mirrors the dictionary-creation and forward-reference
 * steps in Grail's install.gs.
 *
 * File names collide case-insensitively on case-insensitive filesystems, so a
 * name already taken (ignoring case) gets a `_` appended until it is unique —
 * matching Jade's fileOutDictionaryMany.
 */
export function planDictionaryFileOut(
  dictName: string,
  orderedClassNames: string[],
): DictFileOutPlan {
  const used = new Set<string>();
  const files: DictFileOutFile[] = orderedClassNames.map((className) => {
    let base = className;
    while (used.has(base.toUpperCase())) base += '_';
    used.add(base.toUpperCase());
    return { className, fileName: `${base}.gs` };
  });

  if (files.length === 0) return { files, indexContent: '' };

  const escDict = smalltalkString(dictName);
  const forwardRefs = [
    '! Forward references: ensure the dictionary exists (creating it at the front',
    '! of the symbol list so its names resolve first), then bind every class name',
    '! to nil before loading, so a method that references a sibling class',
    '! (including a circular reference the load order cannot satisfy) compiles',
    '! against the dictionary association instead of failing on an unknown global.',
    '! Each class file below replaces its nil with the real class.',
    'run',
    '| dict |',
    `dict := System myUserProfile symbolList objectNamed: #'${escDict}'.`,
    'dict isNil ifTrue: [',
    `\tdict := SymbolDictionary new name: #'${escDict}'; yourself.`,
    '\tSystem myUserProfile insertDictionary: dict at: 1.',
    '].',
    'dict',
    ...orderedClassNames.map((n) => `\tat: #'${smalltalkString(n)}' put: nil;`),
    '\tyourself.',
    '%',
  ].join('\n');
  const inputs = files.map((f) => `input ${f.fileName}`).join('\n');
  const indexContent = `${forwardRefs}\n\n${inputs}\n`;
  return { files, indexContent };
}

// Sentinel categories that can be selected so the next column populates all items.
// These strings are part of the extension↔webview wire format — the webview
// template in getHtml() interpolates these same constants, so there is nothing
// else to keep in sync when this value changes.
export const ALL_CLASSES_CATEGORY = '** ALL CLASSES **';
export const ALL_METHODS_CATEGORY = '** ALL METHODS **';
// Computed category, shown at the head of the list (right after ALL METHODS)
// only when the browsed class carries session methods on the current side/env.
// Selecting it lists every session method (extension + override). Like the
// other sentinels it is interpolated into the webview template.
export const SESSION_METHODS_CATEGORY = '** SESSION METHODS **';

// The synthetic categories are display-only: they can never be the target of a
// category operation (rename, a new method's default category, or a method drop).
export function isComputedMethodCategory(category: string | null | undefined): boolean {
  return category === ALL_METHODS_CATEGORY || category === SESSION_METHODS_CATEGORY;
}

// Save-dialog file filters for file-out, matching Jade's GemStone/Smalltalk/All.
const FILE_OUT_FILTERS: Record<string, string[]> = {
  'GemStone Files': ['gs'],
  'Smalltalk Files': ['st'],
  'All Files': ['*'],
};

// ── SystemBrowser ────────────────────────────────────────────

export class SystemBrowser {
  private static panels = new Map<number, Set<SystemBrowser>>();
  private static lastActive = new Map<number, SystemBrowser>();
  private static sharedExportManager: ExportManager | undefined;
  private static pendingNavigation = new Map<number, queries.MethodSearchResult>();

  static setExportManager(em: ExportManager): void {
    SystemBrowser.sharedExportManager = em;
  }

  /** Navigate an existing browser, or open a new one in ViewColumn.One and navigate once ready.
   *  Layout-disruptive side effects (setEditorLayout, ClassBrowser, GlobalsBrowser) are
   *  suppressed during the programmatic navigation so the inspector panel is not displaced. */
  static navigateBeside(session: ActiveSession, result: queries.MethodSearchResult): void {
    if (SystemBrowser.navigateTo(session.id, result, true, true)) return;
    if (!SystemBrowser.sharedExportManager) return;
    SystemBrowser.pendingNavigation.set(session.id, result);
    SystemBrowser.show(session, SystemBrowser.sharedExportManager, vscode.ViewColumn.One);
  }

  /** Open a new browser beside the currently active panel with no navigation. */
  static showBeside(session: ActiveSession): void {
    if (!SystemBrowser.sharedExportManager) return;
    SystemBrowser.show(session, SystemBrowser.sharedExportManager, vscode.ViewColumn.Beside);
  }

  /**
   * ALWAYS open a NEW browser in `viewColumn` and navigate it to `result` once it
   * signals ready (via `pendingNavigation`). Unlike `navigateBeside`, this never
   * reuses an existing browser — the caller (the Enhanced Debugger's "Browse"
   * frame action) wants a fresh browser to the right of the debugger each time.
   * The deferred navigation runs with `skipClassBrowser`, so the layout-disruptive
   * side effects (setEditorLayout / ClassBrowser / GlobalsBrowser) that would
   * displace open inspector panels are suppressed.
   */
  static openAndNavigate(
    session: ActiveSession,
    result: queries.MethodSearchResult,
    viewColumn: vscode.ViewColumn,
  ): void {
    if (!SystemBrowser.sharedExportManager) return;
    SystemBrowser.pendingNavigation.set(session.id, result);
    SystemBrowser.show(session, SystemBrowser.sharedExportManager, viewColumn);
  }

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private state: BrowserState;
  private syncingFromBrowser = false; // prevent cursor→browser feedback loops

  // Caches
  private dictEntryCache = new Map<number, queries.DictEntry[]>();
  private envCache = new Map<string, queries.EnvCategoryLine[]>();
  private hierarchyCache = new Map<string, queries.ClassHierarchyEntry[]>();
  // The `original` (base) URI string of the open session-override diff, if any,
  // so it can be closed again when the user navigates off that override.
  private comparisonDiffBaseUri: string | null = null;
  // Serializes override-diff toggling: opening/closing the diff is async, so a
  // rapid second ± click must be ignored until the first settles — otherwise
  // overlapping runs interleave and the editor state goes haywire.
  private comparisonBusy = false;

  // Dimming
  private dimDecorationType: vscode.TextEditorDecorationType;
  private dimmedEditorUri: string | undefined;

  // Owns where this browser's source editors land: reuses the group holding its
  // own editors, else splits a fresh group below the webview. Tracks only the
  // editors it opened so it never lands in another browser's (e.g. the GemStone
  // Explorer's) editor column. See sourceEditorPlacement.ts.
  private readonly placement = new SourceEditorPlacement(async () => {
    this.panel.reveal(undefined, false);
    await vscode.commands.executeCommand('workbench.action.newGroupBelow');
    return vscode.ViewColumn.Active;
  });

  /**
   * Refresh the browser for a given session (e.g. after abort or commit).
   */
  static refresh(sessionId: number): void {
    const browsers = SystemBrowser.panels.get(sessionId);
    if (browsers) {
      for (const browser of browsers) browser.handleRefresh();
    }
  }

  /**
   * Notify browsers that a method was compiled (new or existing) so the
   * method list can be refreshed without a full browser reset.
   */
  static methodCompiled(sessionId: number, className: string): void {
    const browsers = SystemBrowser.panels.get(sessionId);
    if (!browsers) return;
    for (const browser of browsers) {
      if (browser.state.selectedClass === className) {
        browser.refreshMethodList();
      }
    }
  }

  static show(
    session: ActiveSession,
    exportManager: ExportManager,
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
  ): void {
    const panel = vscode.window.createWebviewPanel('gemstoneSystemBrowser', 'Browser', viewColumn, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });

    const browser = new SystemBrowser(panel, session, exportManager);
    let set = SystemBrowser.panels.get(session.id);
    if (!set) {
      set = new Set();
      SystemBrowser.panels.set(session.id, set);
    }
    set.add(browser);
  }

  static disposeForSession(sessionId: number): void {
    const browsers = SystemBrowser.panels.get(sessionId);
    if (browsers) {
      for (const browser of [...browsers]) browser.panel.dispose();
    }
    SystemBrowser.lastActive.delete(sessionId);
  }

  /**
   * Navigate the browser to a specific method from external search results
   * (e.g. Implementors of / Senders of). Returns true if at least one browser
   * was found and navigated (meaning the caller does NOT need to open the file
   * separately), false if no browser is open for this session.
   */
  static navigateTo(
    sessionId: number,
    result: queries.MethodSearchResult,
    openFile = true,
    skipClassBrowser = false,
  ): boolean {
    const browser = SystemBrowser.activeBrowser(sessionId);
    if (!browser) return false;
    browser.handleNavigateTo(result, openFile, skipClassBrowser);
    return true;
  }

  /**
   * Navigate the browser to a specific class (no method selected).
   * Returns true if a browser was found and navigated.
   */
  static navigateToClass(
    sessionId: number,
    dictName: string,
    className: string,
    dictIndex?: number,
  ): boolean {
    const browser = SystemBrowser.activeBrowser(sessionId);
    if (!browser) return false;
    browser.handleNavigateToClass(dictName, className, dictIndex);
    return true;
  }

  /**
   * Return the most recently active browser for a session, or the first one if
   * none has been activated yet.
   */
  private static activeBrowser(sessionId: number): SystemBrowser | undefined {
    const browsers = SystemBrowser.panels.get(sessionId);
    if (!browsers || browsers.size === 0) return undefined;
    const last = SystemBrowser.lastActive.get(sessionId);
    if (last && browsers.has(last)) return last;
    return browsers.values().next().value;
  }

  /**
   * Return the currently selected class in the first browser for this session,
   * or null if no browser is open or no class is selected.
   */
  static getSelectedClassName(
    sessionId: number,
  ): { dictName: string; className: string; dictIndex: number } | null {
    const browsers = SystemBrowser.panels.get(sessionId);
    if (!browsers) return null;
    for (const browser of browsers) {
      const cls = browser.state.selectedClass;
      const idx = browser.state.selectedDictIndex;
      if (cls && idx) {
        return {
          dictName: browser.state.dictionaries[idx - 1],
          className: cls,
          dictIndex: idx,
        };
      }
    }
    return null;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private session: ActiveSession,
    private exportManager: ExportManager,
  ) {
    this.panel = panel;

    this.state = {
      dictionaries: [],
      selectedDictIndex: null,
      classCategories: [],
      selectedCategory: null,
      classes: [],
      selectedClass: null,
      isMeta: false,
      selectedEnvId: 0,
      methodCategories: [],
      selectedMethodCategory: null,
      methods: [],
      selectedMethod: null,
      viewMode: 'category',
      hierarchyEntries: [],
      hierarchyClassName: null,
    };

    this.dimDecorationType = vscode.window.createTextEditorDecorationType({
      opacity: '0.4',
    });

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables,
    );

    // Track the most recently active browser so navigate commands target it
    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.active) {
          SystemBrowser.lastActive.set(this.session.id, this);
        }
      },
      null,
      this.disposables,
    );
    // First browser created becomes the default target
    if (!SystemBrowser.lastActive.has(this.session.id)) {
      SystemBrowser.lastActive.set(this.session.id, this);
    }

    // Clear dimming when user navigates to a different editor
    const editorSub = vscode.window.onDidChangeActiveTextEditor(() => {
      this.clearDimming();
    });
    this.disposables.push(editorSub);

    // Sync browser webview when cursor moves in a session file
    const selSub = vscode.window.onDidChangeTextEditorSelection((e) => {
      this.handleCursorSync(e);
    });
    this.disposables.push(selSub);
  }

  // ── Cursor-based browser sync ──────────────────────────────

  private handleCursorSync(e: vscode.TextEditorSelectionChangeEvent): void {
    if (this.syncingFromBrowser) return;

    const filePath = e.textEditor.document.uri.fsPath;
    const sessionRoot = this.exportManager.getSessionRoot(this.session);
    if (!sessionRoot || !filePath.startsWith(sessionRoot)) return;

    // Parse path: sessionRoot / "{index}-{DictName}" / "ClassName.gs"
    const relative = filePath.slice(sessionRoot.length + 1); // skip leading /
    const sep = relative.indexOf(path.sep);
    if (sep < 0) return;
    const dictLabel = relative.slice(0, sep);
    const classFile = relative.slice(sep + 1);
    if (!classFile.endsWith('.gs')) return;
    const className = classFile.slice(0, -3);

    const dashPos = dictLabel.indexOf('-');
    if (dashPos < 0) return;
    const dictIndex = parseInt(dictLabel.slice(0, dashPos), 10);
    if (isNaN(dictIndex)) return;

    // Find which method the cursor is in
    const cursorLine = e.selections[0].active.line;
    const content = e.textEditor.document.getText();
    const regions = parseTopazDocument(content);
    const cursorRegion = regions.find(
      (r) => r.kind === 'smalltalk-method' && cursorLine >= r.startLine && cursorLine <= r.endLine,
    );

    const selector = cursorRegion
      ? extractSelector(cursorRegion.text.split('\n')[0]?.trim() ?? '')
      : null;
    const isMeta = cursorRegion ? cursorRegion.command === 'classmethod' : this.state.isMeta;

    // Skip if already in sync
    if (
      this.state.selectedDictIndex === dictIndex &&
      this.state.selectedClass === className &&
      this.state.selectedMethod === (selector ?? null) &&
      this.state.isMeta === isMeta
    ) {
      return;
    }

    // Update dictionary if changed
    if (this.state.selectedDictIndex !== dictIndex) {
      this.handleSelectDictionary(dictIndex).catch((e) => this.postError(e));
      this.panel.webview.postMessage({
        command: 'selectDictionaryItem',
        index: dictIndex,
      });
    }

    // Ensure the class is visible — if the current category doesn't include
    // this class, switch to the "All classes" pseudo-category
    if (this.state.selectedClass !== className) {
      if (!this.state.classes.includes(className)) {
        this.handleSelectCategory(ALL_CLASSES_CATEGORY);
      }
      this.state.selectedClass = className;
      this.state.selectedMethodCategory = null;
      this.state.selectedMethod = null;
      this.loadMethodCategories();
    }

    if (isMeta !== this.state.isMeta) {
      this.handleToggleSide(isMeta);
    }

    // Find the method category containing this selector and load its methods
    if (selector) {
      const envData = this.getCachedEnvData(dictIndex, className);
      const matchingEnv = envData.find(
        (entry) =>
          entry.isMeta === this.state.isMeta &&
          entry.envId === this.state.selectedEnvId &&
          entry.selectors.includes(selector),
      );
      if (matchingEnv && matchingEnv.category !== this.state.selectedMethodCategory) {
        this.handleSelectMethodCategory(matchingEnv.category);
      }
      this.state.selectedMethod = selector;
    } else {
      this.state.selectedMethod = null;
    }

    // Refresh all webview column selections
    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
      selected: this.state.selectedCategory,
    });
    this.panel.webview.postMessage({
      command: 'loadClasses',
      items: this.state.classes,
      selected: className,
    });
    this.panel.webview.postMessage({
      command: 'loadMethodCategories',
      items: this.state.methodCategories,
      selected: this.state.selectedMethodCategory,
    });
    this.postMethods(this.state.methods, selector);

    // Update dimming to highlight the current method
    if (cursorRegion) {
      this.applyDimming(e.textEditor, cursorRegion.startLine, cursorRegion.endLine);
    } else {
      this.clearDimming();
    }
  }

  private dispose(): void {
    const set = SystemBrowser.panels.get(this.session.id);
    if (set) {
      set.delete(this);
      if (set.size === 0) SystemBrowser.panels.delete(this.session.id);
    }
    if (SystemBrowser.lastActive.get(this.session.id) === this) {
      SystemBrowser.lastActive.delete(this.session.id);
    }
    this.clearDimming();
    this.dimDecorationType.dispose();
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();

    // When the last browser for this session closes, close the companion tabs it
    // opened: the Globals and Comment webviews (per-session singletons) and the
    // class-definition / method-source editors (gemstone:// tabs). While another
    // browser for the session is still open they're left alone — they're shared.
    if (!set || set.size === 0) {
      GlobalsBrowser.disposeForSession(this.session.id);
      CommentBrowser.disposeForSession(this.session.id);
      void closeGemstoneTabsForSession(this.session.id);
    }
  }

  // ── Message dispatch ──────────────────────────────────────

  private handleMessage(message: { command: string; [key: string]: unknown }): void {
    try {
      switch (message.command) {
        case 'ready':
          this.handleReady();
          break;
        case 'selectDictionary':
          this.handleSelectDictionary(message.index as number, false, true).catch((e) =>
            this.postError(e),
          );
          break;
        case 'selectCategory':
          this.handleSelectCategory(message.name as string);
          break;
        case 'selectClass':
          this.applyClassSelection(message.name as string, false, true);
          break;
        case 'toggleSide':
          this.handleToggleSide(message.isMeta as boolean, true);
          break;
        case 'selectMethodCategory':
          this.handleSelectMethodCategory(message.name as string);
          break;
        case 'selectMethod':
          this.handleSelectMethod(message.selector as string);
          break;
        case 'compareSessionOverride':
          this.handleCompareSessionOverride(message.selector as string).catch((e) =>
            this.postError(e),
          );
          break;
        case 'refresh':
          this.handleRefresh();
          break;
        case 'toggleViewMode':
          this.handleToggleViewMode(message.mode as string);
          break;
        case 'selectHierarchyClass':
          this.handleSelectHierarchyClass(message.className as string);
          break;
        case 'toggleEnvironment':
          this.handleToggleEnvironment(message.envId as number);
          break;
        // Context menu commands
        case 'ctxAddDictionary':
          this.handleAddDictionary().catch((e) => this.postError(e));
          break;
        case 'ctxMoveDictUp':
          this.handleMoveDictUp();
          break;
        case 'ctxMoveDictDown':
          this.handleMoveDictDown();
          break;
        case 'ctxRemoveDictionary':
          this.handleRemoveDictionary().catch((e) => this.postError(e));
          break;
        case 'ctxNewClassCategory':
          this.handleNewClassCategory().catch((e) => this.postError(e));
          break;
        case 'ctxNewClass':
          this.handleNewClass();
          break;
        case 'ctxDeleteClass':
          this.handleDeleteClass().catch((e) => this.postError(e));
          break;
        case 'ctxMoveClass':
          this.handleMoveClass().catch((e) => this.postError(e));
          break;
        case 'ctxFileOutClass':
          this.handleFileOutClass().catch((e) => this.postError(e));
          break;
        case 'ctxGenerateGrailStub':
          this.handleGenerateGrailStub().catch((e) => this.postError(e));
          break;
        case 'ctxFileOutDictionaryMany':
          this.handleFileOutDictionaryMany().catch((e) => this.postError(e));
          break;
        case 'ctxRunTests':
          this.handleRunTests();
          break;
        case 'ctxRunCategoryTests':
          this.handleRunCategoryTests().catch((e) => this.postError(e));
          break;
        case 'ctxRunDictionaryTests':
          this.handleRunDictionaryTests().catch((e) => this.postError(e));
          break;
        case 'ctxNewMethod':
          this.handleNewMethod().catch((e) => this.postError(e));
          break;
        case 'ctxRenameCategory':
          this.handleRenameCategory().catch((e) => this.postError(e));
          break;
        case 'ctxDeleteMethod':
          this.handleDeleteMethod().catch((e) => this.postError(e));
          break;
        case 'ctxRunMethodTests':
          this.handleRunMethodTests().catch((e) => this.postError(e));
          break;
        case 'ctxRunMethodCategoryTests':
          this.handleRunMethodCategoryTests().catch((e) => this.postError(e));
          break;
        case 'ctxMoveToCategory':
          this.handleMoveToCategory().catch((e) => this.postError(e));
          break;
        case 'ctxSendersOf':
          this.handleSendersOf();
          break;
        case 'ctxImplementorsOf':
          this.handleImplementorsOf();
          break;
        case 'ctxBrowseSendersOfString':
          this.promptAndBrowse('senders').catch((e) => this.postError(e));
          break;
        case 'ctxBrowseImplementorsOfString':
          this.promptAndBrowse('implementors').catch((e) => this.postError(e));
          break;
        case 'ctxBrowseMethodsContaining':
          this.promptAndBrowse('source').catch((e) => this.postError(e));
          break;
        case 'showHierarchyImpls':
          this.handleShowHierarchyImpls(
            message.selector as string,
            message.direction as 'up' | 'down',
          );
          break;
        case 'ctxBrowseReferences':
          this.handleBrowseReferences(message.name as string);
          break;
        case 'ctxMoveClassToCategory':
          this.handleMoveClassToCategory().catch((e) => this.postError(e));
          break;
        case 'ctxCopyMethodToClass':
          this.handleCopyMethodToClass().catch((e) => this.postError(e));
          break;
      }
    } catch (e: unknown) {
      this.postError(e);
    }
  }

  private postError(e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.panel.webview.postMessage({ command: 'showError', message: msg });
  }

  // ── Handlers ──────────────────────────────────────────────

  private handleReady(): void {
    const maxEnv = this.getMaxEnvironment();
    if (maxEnv > 0) {
      this.panel.webview.postMessage({
        command: 'setMaxEnvironment',
        maxEnv,
      });
    }
    this.state.dictionaries = queries.getDictionaryNames(this.session);
    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
    const pending = SystemBrowser.pendingNavigation.get(this.session.id);
    if (pending) {
      SystemBrowser.pendingNavigation.delete(this.session.id);
      this.handleNavigateTo(pending, true, true);
    }
  }

  /**
   * Selecting a dictionary resets the downstream selection (category, class,
   * method) and loads the dictionary's class categories into the Classes
   * column.
   *
   * `skipPanels` suppresses opening the Globals / Class browser panels.
   * `autoSelectAllClassesCategory` auto-selects the "all classes"
   * pseudo-category so the Classes column fills immediately instead of
   * staying blank until the user clicks a category.
   */
  private async handleSelectDictionary(
    dictIndex: number,
    skipPanels = false,
    autoSelectAllClassesCategory = false,
  ): Promise<void> {
    this.state.selectedDictIndex = dictIndex;
    this.state.selectedCategory = null;
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    const entries = this.getCachedDictEntries(dictIndex);

    // Build unique class categories, sorted
    const categorySet = new Set<string>();
    for (const entry of entries) {
      if (entry.isClass) {
        categorySet.add(entry.category || '');
      }
    }
    const sorted = [...categorySet].sort();
    this.state.classCategories = [ALL_CLASSES_CATEGORY, ...sorted];

    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
      selected: autoSelectAllClassesCategory ? ALL_CLASSES_CATEGORY : undefined,
    });

    if (autoSelectAllClassesCategory) {
      this.handleSelectCategory(ALL_CLASSES_CATEGORY);
    }

    if (skipPanels) return;

    const dictName = this.state.dictionaries[dictIndex - 1];
    // Set the editor layout before creating panels so they appear in the right order
    await vscode.commands.executeCommand('vscode.setEditorLayout', {
      orientation: 1, // vertical (top/bottom)
      groups: [{ size: 0.6 }, { size: 0.4 }],
    });
    try {
      await GlobalsBrowser.showOrUpdate(this.session, dictName, dictIndex);
    } catch (e) {
      this.postError(e);
    }
    ClassBrowser.showOrUpdate(this.session, this.state.dictionaries, dictIndex, null).catch((e) =>
      this.postError(e),
    );
  }

  private handleSelectCategory(category: string): void {
    this.state.selectedCategory = category;
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const entries = this.getCachedDictEntries(dictIndex);
    let names: string[];
    if (category === ALL_CLASSES_CATEGORY) {
      names = entries.filter((e) => e.isClass).map((e) => e.name);
    } else {
      names = entries
        .filter((e) => e.isClass && (e.category || '') === category)
        .map((e) => e.name);
    }
    this.state.classes = names.sort();

    this.panel.webview.postMessage({
      command: 'loadClasses',
      items: this.state.classes,
    });
  }

  // Loads method categories and auto-selects the "all methods" pseudo-category.
  private selectAllMethods(): void {
    this.loadMethodCategories(ALL_METHODS_CATEGORY);
    this.handleSelectMethodCategory(ALL_METHODS_CATEGORY);
  }

  /**
   * Single source of truth for "the selected class has changed": resets
   * method-list state, updates the panel title, refreshes the method-list
   * columns, and refreshes the Class Definition panel (when one is open).
   *
   * Every entry point that lands on a class — the column click, the
   * find-class quick-pick, the hierarchy-view click, external Implementors-of
   * / Senders-of navigation — routes through here so the Class Definition
   * panel never goes stale relative to the column-list selection.
   *
   * Does NOT open the class's source file. Paths that should *also* reveal
   * source (external method navigation) call `openClassFile` separately
   * afterwards. The column click (and the hierarchy click) leaves the
   * editor untouched on purpose — clicking a class shouldn't shove a new
   * file in front of whatever the user was editing.
   *
   * `skipClassBrowser` suppresses the Class Definition panel refresh (used
   * when the Class Browser is already handling the selection independently).
   * `autoSelectAllMethodsCategory` auto-selects the "all methods"
   * pseudo-category so the Methods column fills immediately; when false, only
   * the method-category list is loaded with no category pre-selected.
   */
  private applyClassSelection(
    className: string,
    skipClassBrowser = false,
    autoSelectAllMethodsCategory = false,
  ): void {
    void this.closeComparisonDiff();
    this.state.selectedClass = className;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.panel.title = `Browser: ${className}`;

    if (autoSelectAllMethodsCategory) {
      this.selectAllMethods();
    } else {
      this.loadMethodCategories();
    }

    if (!skipClassBrowser) {
      const dictIndex = this.state.selectedDictIndex;
      if (dictIndex) {
        const dictName = this.state.dictionaries[dictIndex - 1];
        // Open the definition BEFORE the comment so its tab sits to the left:
        // ClassBrowser awaits openTextDocument, whereas CommentBrowser creates its
        // webview synchronously — without sequencing, the comment tab lands first.
        ClassBrowser.showOrUpdate(this.session, this.state.dictionaries, dictIndex, className)
          .catch((e) => this.postError(e))
          .then(() =>
            CommentBrowser.showOrUpdate(
              this.session,
              dictName,
              dictIndex,
              className,
              this.exportManager,
            ),
          )
          .catch((e) => this.postError(e));
      }
    }
  }

  /**
   * Toggles the instance / class side for the currently selected class and
   * clears the method selection (category + method).
   *
   * When `autoSelectAllMethodsCategory` is set and a class is selected,
   * re-selects the "all methods" pseudo-category so the Methods column
   * re-fills for the newly toggled side; otherwise it just reloads the method
   * categories.
   */
  private handleToggleSide(isMeta: boolean, autoSelectAllMethodsCategory = false): void {
    void this.closeComparisonDiff();
    this.state.isMeta = isMeta;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;

    if (this.state.selectedClass) {
      if (autoSelectAllMethodsCategory) {
        this.selectAllMethods();
      } else {
        this.loadMethodCategories();
      }
    }
  }

  private handleSelectMethodCategory(category: string): void {
    void this.closeComparisonDiff();
    this.state.selectedMethodCategory = category;
    this.state.selectedMethod = null;
    this.clearDimming();

    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const envData = this.getCachedEnvData(dictIndex, className);
    const filtered = envData.filter(
      (e) => e.isMeta === this.state.isMeta && e.envId === this.state.selectedEnvId,
    );

    let methods: string[];
    if (category === ALL_METHODS_CATEGORY) {
      const set = new Set<string>();
      for (const entry of filtered) {
        for (const sel of entry.selectors) set.add(sel);
      }
      methods = [...set].sort();
    } else if (category === SESSION_METHODS_CATEGORY) {
      methods = this.sessionMethodsFor(filtered).sort();
    } else {
      const entry = filtered.find((e) => e.category === category);
      methods = entry ? [...entry.selectors] : [];
    }
    this.state.methods = methods;

    this.postMethods(this.state.methods);
  }

  private handleSelectMethod(selector: string): void {
    // Leaving the override we were comparing — the diff should disappear.
    void this.closeComparisonDiff();
    this.state.selectedMethod = selector;

    const className = this.state.selectedClass;
    if (!className) return;

    this.openClassFile(className, selector, this.state.isMeta).catch((e) => this.postError(e));
  }

  // Open a side-by-side diff of a session override against the persistent base
  // method it shadows, in the browser's source pane. Each side's selector
  // segment is decorated ("(base)" / "(session override)") so the diff tab and
  // per-pane breadcrumb name which is which; both are served read-only by the
  // gemstone:// FS provider (the base via a ?base=1 variant). Clicking the same
  // override's glyph again toggles the diff off, back to the session source.
  private async handleCompareSessionOverride(selector: string): Promise<void> {
    if (this.comparisonBusy) return;
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    this.comparisonBusy = true;
    try {
      const isMeta = this.state.isMeta;
      const dictName = this.state.dictionaries[dictIndex - 1];
      const category = this.methodCategoryFor(className, isMeta, selector);
      const environmentId = this.state.selectedEnvId;
      const common = {
        kind: 'method' as const,
        sessionId: this.session.id,
        dictName,
        className,
        isMeta,
        category,
        environmentId,
        dictIndex,
      };
      const baseUri = buildMethodUri({ ...common, selector: `${selector} (base)`, base: true });

      // Toggle: if this override's diff is actually open, a second click returns
      // to the session source. Keyed off the live tab (not just the tracked URI)
      // so it stays correct even if the diff was dismissed via its ✕ or Esc.
      // Open the source FIRST — while the diff is still open — so its group is
      // found and reused (the source replaces the diff there); THEN drop the
      // diff tab. Closing first would leave the group holding only a non-text
      // tab (e.g. the Globals webview) that getBrowserViewColumn can't match,
      // spawning a new group that splits the layout.
      if (this.findComparisonDiffTab(baseUri.toString())) {
        this.state.selectedMethod = selector;
        await this.openClassFile(className, selector, isMeta);
        await this.closeComparisonDiff();
        return;
      }

      const overrideUri = buildMethodUri({ ...common, selector: `${selector} (session override)` });
      await this.closeComparisonDiff();
      this.state.selectedMethod = selector;
      const viewColumn = await this.getBrowserViewColumn();
      const title = `${className}${isMeta ? ' class' : ''}>>${selector} - base vs session override`;
      this.comparisonDiffBaseUri = baseUri.toString();
      this.placement.remember(overrideUri);
      await vscode.commands.executeCommand('vscode.diff', baseUri, overrideUri, title, {
        viewColumn,
        preview: true,
      });
    } finally {
      this.comparisonBusy = false;
    }
  }

  // The open diff tab whose left/original side is `baseUriString`, if any.
  private findComparisonDiffTab(baseUriString: string): vscode.Tab | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputTextDiff &&
          input.original.toString() === baseUriString
        ) {
          return tab;
        }
      }
    }
    return undefined;
  }

  // Close the open session-override diff, if any (matched by its base/original
  // URI). Safe to call when nothing is open.
  private async closeComparisonDiff(): Promise<void> {
    const target = this.comparisonDiffBaseUri;
    if (!target) return;
    this.comparisonDiffBaseUri = null;
    const tab = this.findComparisonDiffTab(target);
    if (tab) await vscode.window.tabGroups.close(tab);
  }

  private handleNavigateTo(
    result: queries.MethodSearchResult,
    openFile = true,
    skipClassBrowser = false,
  ): void {
    const { dictName, className, isMeta, category, selector } = result;

    // Find 1-based dict index
    const dictIndex = this.state.dictionaries.indexOf(dictName) + 1;
    if (dictIndex === 0) return; // Dict not known yet

    // Reveal the panel without stealing focus from the method editor
    this.panel.reveal(undefined, true);

    // Update dictionary if changed
    if (this.state.selectedDictIndex !== dictIndex) {
      void this.handleSelectDictionary(dictIndex, skipClassBrowser);
      this.panel.webview.postMessage({ command: 'selectDictionaryItem', index: dictIndex });
    }

    // Ensure the class is visible — switch to the "All classes" pseudo-category if needed
    if (!this.state.classes.includes(className)) {
      this.handleSelectCategory(ALL_CLASSES_CATEGORY);
      this.panel.webview.postMessage({ command: 'selectCategoryItem', name: ALL_CLASSES_CATEGORY });
    }

    // Route through the canonical class-selection helper so the Class
    // Definition panel updates alongside the method-list columns. The
    // earlier inline mutation here skipped that update, leaving the
    // Class Definition stale relative to whatever method we navigated to.
    if (this.state.selectedClass !== className) {
      this.applyClassSelection(className, skipClassBrowser);
    }

    // Update instance/class side if changed
    if (this.state.isMeta !== isMeta) {
      this.handleToggleSide(isMeta);
      this.panel.webview.postMessage({ command: 'setSide', isMeta });
    }

    // Update method category if changed
    if (this.state.selectedMethodCategory !== category) {
      this.handleSelectMethodCategory(category);
    }

    // Select the method and refresh all webview columns
    this.state.selectedMethod = selector;
    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
      selected: this.state.selectedCategory,
    });
    this.panel.webview.postMessage({
      command: 'loadClasses',
      items: this.state.classes,
      selected: className,
    });
    this.panel.webview.postMessage({
      command: 'loadMethodCategories',
      items: this.state.methodCategories,
      selected: category,
    });
    this.postMethods(this.state.methods, selector);

    if (openFile) this.openClassFile(className, selector, isMeta).catch((e) => this.postError(e));
  }

  /**
   * Navigates the browser to a class without targeting a specific method.
   * Auto-selects "all methods" so the Methods column fills immediately —
   * distinguishing it from `handleNavigateTo`, which navigates to a specific method.
   */
  private handleNavigateToClass(
    dictName: string,
    className: string,
    explicitDictIndex?: number,
  ): void {
    // Prefer the caller's exact SymbolList index (unambiguous even when two
    // dictionaries share a name); fall back to resolving by name.
    const dictIndex = explicitDictIndex ?? this.state.dictionaries.indexOf(dictName) + 1;
    if (dictIndex === 0) return;

    this.panel.reveal(undefined, true);

    if (this.state.selectedDictIndex !== dictIndex) {
      this.handleSelectDictionary(dictIndex).catch((e) => this.postError(e));
      this.panel.webview.postMessage({ command: 'selectDictionaryItem', index: dictIndex });
    }

    if (!this.state.classes.includes(className)) {
      this.handleSelectCategory(ALL_CLASSES_CATEGORY);
      this.panel.webview.postMessage({ command: 'selectCategoryItem', name: ALL_CLASSES_CATEGORY });
    }

    this.panel.webview.postMessage({
      command: 'loadClasses',
      items: this.state.classes,
      selected: className,
    });

    this.applyClassSelection(className, false, true);
  }

  private handleRefresh(): void {
    const prev = { ...this.state };

    this.dictEntryCache.clear();
    this.envCache.clear();
    this.hierarchyCache.clear();
    this.clearDimming();

    this.state = {
      dictionaries: [],
      selectedDictIndex: null,
      classCategories: [],
      selectedCategory: null,
      classes: [],
      selectedClass: null,
      isMeta: prev.isMeta,
      selectedEnvId: prev.selectedEnvId,
      methodCategories: [],
      selectedMethodCategory: null,
      methods: [],
      selectedMethod: null,
      viewMode: 'category',
      hierarchyEntries: [],
      hierarchyClassName: null,
    };

    this.panel.title = 'Browser';
    this.panel.webview.postMessage({ command: 'setViewMode', mode: 'category' });
    this.handleReady();

    // Restore previous selections when the items still exist after refresh
    if (!prev.selectedDictIndex || prev.selectedDictIndex > this.state.dictionaries.length) return;

    this.handleSelectDictionary(prev.selectedDictIndex).catch((e) => this.postError(e));
    this.panel.webview.postMessage({
      command: 'selectDictionaryItem',
      index: prev.selectedDictIndex,
    });

    const prevCategory =
      prev.selectedCategory && this.state.classCategories.includes(prev.selectedCategory)
        ? prev.selectedCategory
        : null;
    if (prevCategory) {
      this.handleSelectCategory(prevCategory);
    }

    if (prev.selectedClass && this.state.classes.includes(prev.selectedClass)) {
      this.state.selectedClass = prev.selectedClass;
      this.panel.title = `Browser: ${prev.selectedClass}`;

      // Tell the webview which class category, class, and side are selected
      this.panel.webview.postMessage({
        command: 'loadClassCategories',
        items: this.state.classCategories,
        selected: prevCategory,
      });
      this.panel.webview.postMessage({
        command: 'loadClasses',
        items: this.state.classes,
        selected: prev.selectedClass,
      });
      this.panel.webview.postMessage({ command: 'setSide', isMeta: this.state.isMeta });
      this.loadMethodCategories(prev.selectedMethodCategory);

      if (prev.selectedMethodCategory) {
        this.state.selectedMethodCategory = prev.selectedMethodCategory;
        this.handleSelectMethodCategory(prev.selectedMethodCategory);
      }

      // Capture into locals: the narrowing of prev.selectedDictIndex to a number
      // (guarded above) doesn't survive into the deferred .then() closure.
      const prevDictIndex = prev.selectedDictIndex;
      const prevDictName = this.state.dictionaries[prevDictIndex - 1];
      const prevClass = prev.selectedClass;
      // Definition before comment (see applyClassSelection for why sequencing matters).
      ClassBrowser.showOrUpdate(this.session, this.state.dictionaries, prevDictIndex, prevClass)
        .catch((e) => this.postError(e))
        .then(() =>
          CommentBrowser.showOrUpdate(
            this.session,
            prevDictName,
            prevDictIndex,
            prevClass,
            this.exportManager,
          ),
        )
        .catch((e) => this.postError(e));
    } else if (prevCategory) {
      // No class to restore — just highlight the category in the webview
      this.panel.webview.postMessage({
        command: 'loadClassCategories',
        items: this.state.classCategories,
        selected: prevCategory,
      });
    }
  }

  private handleToggleViewMode(mode: string): void {
    this.state.viewMode = mode as 'category' | 'hierarchy';

    if (mode === 'hierarchy') {
      if (this.state.selectedClass) {
        this.sendHierarchy(this.state.selectedClass);
      } else {
        this.panel.webview.postMessage({ command: 'setViewMode', mode: 'hierarchy' });
        this.panel.webview.postMessage({
          command: 'loadHierarchy',
          items: [],
          selectedClass: null,
        });
      }
    } else {
      this.panel.webview.postMessage({ command: 'setViewMode', mode: 'category' });
      // Re-send category data so the columns are populated, restoring selection
      if (this.state.selectedDictIndex) {
        this.panel.webview.postMessage({
          command: 'loadClassCategories',
          items: this.state.classCategories,
          selected: this.state.selectedCategory,
        });
        if (this.state.selectedCategory) {
          this.panel.webview.postMessage({
            command: 'loadClasses',
            items: this.state.classes,
            selected: this.state.selectedClass,
          });
          if (this.state.selectedClass) {
            this.loadMethodCategories(this.state.selectedMethodCategory);
            if (this.state.selectedMethodCategory) {
              this.postMethods(this.state.methods, this.state.selectedMethod);
            }
          }
        }
      }
    }
  }

  private handleSelectHierarchyClass(className: string): void {
    void this.closeComparisonDiff();
    // Find which dictionary contains this class from the hierarchy entries
    const entry = this.state.hierarchyEntries.find((e) => e.className === className);
    if (!entry) return;

    const dictIndex = this.state.dictionaries.indexOf(entry.dictName) + 1;
    if (dictIndex < 1) return;

    this.state.selectedDictIndex = dictIndex;
    // Route through the canonical class-selection helper so the Class
    // Definition panel updates too — the earlier inline mutations did
    // not, so a hierarchy-view click left Class Definition stale. This
    // mirrors the column click: definition-only, no source-file reveal.
    this.applyClassSelection(className, false, true);
  }

  private handleToggleEnvironment(envId: number): void {
    void this.closeComparisonDiff();
    const previousCategory = this.state.selectedMethodCategory;
    this.state.selectedEnvId = envId;
    this.state.selectedMethod = null;

    if (this.state.selectedClass) {
      const dictIndex = this.state.selectedDictIndex!;
      const envData = this.getCachedEnvData(dictIndex, this.state.selectedClass);
      const availableInNewEnv = new Set(
        envData
          .filter((e) => e.isMeta === this.state.isMeta && e.envId === envId)
          .map((e) => e.category),
      );
      const categoryToSelect =
        previousCategory !== null && availableInNewEnv.has(previousCategory)
          ? previousCategory
          : ALL_METHODS_CATEGORY;
      this.state.selectedMethodCategory = categoryToSelect;
      this.loadMethodCategories(categoryToSelect);
      this.handleSelectMethodCategory(categoryToSelect);
    }
  }

  // ── Context menu handlers ────────────────────────────────

  // Re-file-out the currently selected class to its mirror file after an
  // in-place change (method add/delete/recategorize, category rename).
  private syncSelectedClass(className: string): void {
    const dictIndex = this.state.selectedDictIndex;
    const dictName = dictIndex ? this.state.dictionaries[dictIndex - 1] : undefined;
    if (dictName) void this.exportManager.syncClass(this.session, dictName, className);
  }

  private async handleAddDictionary(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'New dictionary name',
      placeHolder: 'e.g. MyProject',
    });
    if (!name) return;

    queries.addDictionary(this.session, name);
    this.dictEntryCache.clear();
    this.state.dictionaries = queries.getDictionaryNames(this.session);
    // Recorded after the fact: there is nothing to capture before a dictionary exists, and
    // the position it landed at is only knowable afterwards (#434).
    notifyUndoable(`Added dictionary ${name}`, recordDictionaryAdd(this.session, name));

    // Reconcile the mirror (creates the new dir, updates state) via the manifest
    // diff rather than poking the filesystem directly.
    this.exportManager.scheduleRefresh(this.session);

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
  }

  private handleMoveDictUp(): void {
    const idx = this.state.selectedDictIndex;
    if (!idx || idx <= 1) return;

    queries.moveDictionaryUp(this.session, idx);
    this.exportManager.scheduleRefresh(this.session);
    const dicts = this.state.dictionaries;
    [dicts[idx - 1], dicts[idx - 2]] = [dicts[idx - 2], dicts[idx - 1]];
    this.state.selectedDictIndex = idx - 1;
    this.dictEntryCache.delete(idx);
    this.dictEntryCache.delete(idx - 1);

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
    this.panel.webview.postMessage({
      command: 'selectDictionaryItem',
      index: idx - 1,
    });
  }

  private handleMoveDictDown(): void {
    const idx = this.state.selectedDictIndex;
    if (!idx || idx >= this.state.dictionaries.length) return;

    queries.moveDictionaryDown(this.session, idx);
    this.exportManager.scheduleRefresh(this.session);
    const dicts = this.state.dictionaries;
    [dicts[idx - 1], dicts[idx]] = [dicts[idx], dicts[idx - 1]];
    this.state.selectedDictIndex = idx + 1;
    this.dictEntryCache.delete(idx);
    this.dictEntryCache.delete(idx + 1);

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
    this.panel.webview.postMessage({
      command: 'selectDictionaryItem',
      index: idx + 1,
    });
  }

  private async handleRemoveDictionary(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const dictName = this.state.dictionaries[dictIndex - 1];

    const confirmed = await vscode.window.showWarningMessage(
      `Remove dictionary "${dictName}" from symbol list?`,
      { modal: true },
      'Remove',
    );
    if (confirmed !== 'Remove') return;

    queries.removeDictionary(this.session, dictIndex);

    // Reconcile the mirror (prunes the dir, drops its classes from state, fixes
    // shifted indices) via the manifest diff.
    this.exportManager.scheduleRefresh(this.session);

    // Re-fetch dictionaries — indices have shifted
    this.dictEntryCache.clear();
    this.envCache.clear();
    this.hierarchyCache.clear();
    this.state.dictionaries = queries.getDictionaryNames(this.session);
    this.state.selectedDictIndex = null;
    this.state.selectedCategory = null;
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    this.panel.webview.postMessage({
      command: 'loadDictionaries',
      items: this.state.dictionaries,
    });
    this.panel.webview.postMessage({ command: 'loadClassCategories', items: [] });
    this.panel.webview.postMessage({ command: 'loadClasses', items: [] });
    this.panel.webview.postMessage({ command: 'loadMethodCategories', items: [] });
    this.panel.webview.postMessage({ command: 'loadMethods', items: [] });
  }

  private async handleNewClassCategory(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) {
      vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'New class category name',
      placeHolder: 'e.g. Model',
    });
    if (!name) return;

    if (!this.state.classCategories.includes(name)) {
      // Insert sorted, keeping the "All classes" pseudo-category at front
      const rest = this.state.classCategories.slice(1);
      rest.push(name);
      rest.sort();
      this.state.classCategories = [ALL_CLASSES_CATEGORY, ...rest];
    }
    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
    });
    this.handleSelectCategory(name);
  }

  private handleNewClass(): void {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) {
      vscode.window.showWarningMessage('Select a dictionary first.');
      return;
    }

    const dictName = this.state.dictionaries[dictIndex - 1];
    const category =
      this.state.selectedCategory && this.state.selectedCategory !== ALL_CLASSES_CATEGORY
        ? this.state.selectedCategory
        : undefined;
    const categoryQuery = category ? `?category=${encodeURIComponent(category)}` : '';
    const uri = vscode.Uri.parse(
      `gemstone://${this.session.id}/${encodeURIComponent(dictName)}/new-class${categoryQuery}`,
    );
    vscode.commands.executeCommand('gemstone.openDocument', uri);
  }

  private async handleDeleteClass(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Delete class "${className}" from dictionary?`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return;

    // Snapshot before removing: deleteClass unbinds the name, and the class version is only
    // reachable afterwards while something holds it (#434).
    const recording = beginClassDeletion(this.session, [{ dict: dictIndex, className }]);
    queries.deleteClass(this.session, dictIndex, className);
    notifyUndoable(`Deleted class ${className}`, recording?.commit());
    this.exportManager.removeClassFile(
      this.session,
      dictIndex,
      this.state.dictionaries[dictIndex - 1],
      className,
    );
    this.dictEntryCache.delete(dictIndex);
    this.envCache.clear();
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    const entries = this.getCachedDictEntries(dictIndex);
    const category = this.state.selectedCategory;
    let classes: string[];
    if (!category || category === ALL_CLASSES_CATEGORY) {
      classes = entries.filter((e) => e.isClass).map((e) => e.name);
    } else {
      classes = entries
        .filter((e) => e.isClass && (e.category || '') === category)
        .map((e) => e.name);
    }
    this.state.classes = classes.sort();

    this.panel.webview.postMessage({ command: 'loadClasses', items: this.state.classes });
    this.panel.webview.postMessage({ command: 'loadMethodCategories', items: [] });
    this.panel.webview.postMessage({ command: 'loadMethods', items: [] });
  }

  private async handleMoveClass(): Promise<void> {
    const srcIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!srcIndex || !className) return;

    const items = this.state.dictionaries
      .map((name, i) => ({ label: name, index: i + 1 }))
      .filter((item) => item.index !== srcIndex);

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Move ${className} to which dictionary?`,
    });
    if (!picked) return;

    queries.moveClass(this.session, srcIndex, picked.index, className);
    this.exportManager.removeClassFile(
      this.session,
      srcIndex,
      this.state.dictionaries[srcIndex - 1],
      className,
    );
    void this.exportManager.syncClass(this.session, picked.label, className);
    this.dictEntryCache.delete(srcIndex);
    this.dictEntryCache.delete(picked.index);
    this.envCache.clear();
    this.state.selectedClass = null;
    this.state.selectedMethodCategory = null;
    this.state.selectedMethod = null;
    this.clearDimming();

    this.handleSelectCategory(this.state.selectedCategory || ALL_CLASSES_CATEGORY);
    vscode.window.showInformationMessage(`Moved ${className} to ${picked.label}.`);
  }

  // Write `aSelectedClass fileOutClass` to a user-chosen path, mirroring Jade's
  // System Browser "File Out Class…". The default name drops a trailing
  // "TestCase" so a test class files out under its subject's name.
  private async handleFileOutClass(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const defaultName = className.endsWith('TestCase')
      ? className.slice(0, -'TestCase'.length)
      : className;
    const uri = await vscode.window.showSaveDialog({
      title: `File Out ${className}`,
      defaultUri: this.defaultFileOutUri(`${defaultName}.gs`),
      filters: FILE_OUT_FILTERS,
    });
    if (!uri) return;

    const source = queries.fileOutClass(this.session, className, dictIndex);
    fs.writeFileSync(uri.fsPath, source, 'utf8');
    void vscode.window.showTextDocument(uri);
  }

  // Generate an editable Grail (.py) stub for the selected class, mirroring the
  // "File Out Class…" flow but producing a Grail @smalltalk_class module.
  private async handleGenerateGrailStub(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    const dictName = this.dictNameForIndex(dictIndex);
    if (!dictIndex || !className || !dictName) return;

    await generateAndSaveGrailStub(this.session, className, dictName, dictIndex);
  }

  // File out every class in the selected dictionary as one `.gs` file per class
  // plus a loader file of `input` lines, mirroring Jade's "File Out as Many
  // Files". The chosen path is the loader; the per-class files are written
  // alongside it. Classes are filed in superclass-first order so the loader
  // recreates them cleanly.
  private async handleFileOutDictionaryMany(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;
    const dictName = this.state.dictionaries[dictIndex - 1];

    const uri = await vscode.window.showSaveDialog({
      title: `File Out ${dictName}`,
      defaultUri: this.defaultFileOutUri(`${dictName}.gs`),
      filters: FILE_OUT_FILTERS,
    });
    if (!uri) return;

    const ordered = queries.getDictionaryClassFileOutOrder(this.session, dictIndex);
    if (ordered.length === 0) {
      vscode.window.showWarningMessage(`Dictionary "${dictName}" has no classes to file out.`);
      return;
    }

    const plan = planDictionaryFileOut(dictName, ordered);
    const dir = path.dirname(uri.fsPath);
    for (const file of plan.files) {
      const source = queries.fileOutClass(this.session, file.className, dictIndex);
      fs.writeFileSync(path.join(dir, file.fileName), source, 'utf8');
    }
    fs.writeFileSync(uri.fsPath, plan.indexContent, 'utf8');
    void vscode.window.showInformationMessage(
      `Filed out ${plan.files.length} class(es) from ${dictName} to ${path.basename(uri.fsPath)}.`,
    );
  }

  /** Default save location for a file-out: the given name under the workspace root. */
  private defaultFileOutUri(fileName: string): vscode.Uri | undefined {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return wsRoot ? vscode.Uri.file(path.join(wsRoot, fileName)) : undefined;
  }

  /** Resolve a 1-based symbolList index to its dictionary name. */
  private dictNameForIndex(dictIndex: number | null): string | undefined {
    if (!dictIndex) return undefined;
    return this.state.dictionaries[dictIndex - 1];
  }

  private handleRunTests(): void {
    const className = this.state.selectedClass;
    const dictName = this.dictNameForIndex(this.state.selectedDictIndex);
    if (!className || !dictName) return;
    vscode.commands.executeCommand('gemstone.runSunitClass', { dictName, className });
  }

  private async handleRunCategoryTests() {
    const categoryName = this.state.selectedCategory;
    const dictName = this.dictNameForIndex(this.state.selectedDictIndex);
    if (!categoryName || !dictName) return;

    await vscode.commands.executeCommand('gemstone.runSunitClasses', dictName, this.state.classes);
  }

  private async handleRunDictionaryTests() {
    const dictIndex = this.state.selectedDictIndex;
    const dictName = this.dictNameForIndex(dictIndex);
    if (!dictIndex || !dictName) return;

    const entries = this.getCachedDictEntries(dictIndex);
    const classNames = entries.filter((e) => e.isClass).map((e) => e.name);
    if (classNames.length === 0) return;

    await vscode.commands.executeCommand('gemstone.runSunitClasses', dictName, classNames);
  }

  private async handleRunMethodTests() {
    const className = this.state.selectedClass;
    const selector = this.state.selectedMethod;
    const dictName = this.dictNameForIndex(this.state.selectedDictIndex);
    if (!className || !selector || !dictName) return;

    await vscode.commands.executeCommand('gemstone.runSunitMethods', dictName, className, [
      selector,
    ]);
  }

  private async handleRunMethodCategoryTests() {
    const className = this.state.selectedClass;
    const category = this.state.selectedMethodCategory;
    const dictName = this.dictNameForIndex(this.state.selectedDictIndex);
    if (!className || !category || !dictName) return;

    await vscode.commands.executeCommand(
      'gemstone.runSunitMethodCategory',
      dictName,
      className,
      category,
    );
  }

  private async handleNewMethod(): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) {
      vscode.window.showWarningMessage('Select a class first.');
      return;
    }

    const dictName = this.state.dictionaries[dictIndex - 1];
    const category =
      this.state.selectedMethodCategory &&
      !isComputedMethodCategory(this.state.selectedMethodCategory)
        ? this.state.selectedMethodCategory
        : 'as yet unclassified';
    const uri = buildNewMethodUri(
      this.session.id,
      dictName,
      className,
      this.state.isMeta,
      category,
      this.state.selectedEnvId,
      dictIndex,
    );
    const viewColumn = await this.getBrowserViewColumn();
    this.placement.remember(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    vscode.window.showTextDocument(doc, { viewColumn, preview: true });
  }

  private async handleRenameCategory(): Promise<void> {
    const className = this.state.selectedClass;
    const oldCategory = this.state.selectedMethodCategory;
    const dictIndex = this.state.selectedDictIndex;
    if (!className || !oldCategory || isComputedMethodCategory(oldCategory) || !dictIndex) return;

    const newName = await vscode.window.showInputBox({
      prompt: `Rename category "${oldCategory}" to:`,
      value: oldCategory,
    });
    if (!newName || newName === oldCategory) return;

    queries.renameCategory(
      this.session,
      className,
      this.state.isMeta,
      oldCategory,
      newName,
      dictIndex,
    );
    this.syncSelectedClass(className);
    this.envCache.delete(`${dictIndex}/${className}`);
    this.state.selectedMethodCategory = newName;
    this.loadMethodCategories();
  }

  private async handleDeleteMethod(): Promise<void> {
    const className = this.state.selectedClass;
    const selector = this.state.selectedMethod;
    const dictIndex = this.state.selectedDictIndex;
    if (!className || !selector || !dictIndex) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Delete method #${selector} from ${className}?`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return;

    // Snapshot before removing: the source only exists until the removal lands (#434).
    const recording = beginMethodDeletion(this.session, {
      dict: dictIndex,
      className,
      isMeta: this.state.isMeta,
      selector,
      environmentId: 0,
    });
    queries.deleteMethod(this.session, className, this.state.isMeta, selector, dictIndex);
    notifyUndoable(
      `Deleted ${className}${this.state.isMeta ? ' class' : ''}>>#${selector}`,
      recording?.commit(),
    );
    this.syncSelectedClass(className);
    this.envCache.delete(`${dictIndex}/${className}`);
    this.state.selectedMethod = null;
    this.clearDimming();
    this.loadMethodCategories();
    if (this.state.selectedMethodCategory) {
      this.handleSelectMethodCategory(this.state.selectedMethodCategory);
    }
  }

  private async handleMoveToCategory(): Promise<void> {
    const className = this.state.selectedClass;
    const selector = this.state.selectedMethod;
    const dictIndex = this.state.selectedDictIndex;
    if (!className || !selector || !dictIndex) return;

    const categories = queries.getMethodCategories(
      this.session,
      className,
      this.state.isMeta,
      dictIndex,
    );
    const picked = await vscode.window.showQuickPick(categories, {
      placeHolder: `Move #${selector} to which category?`,
    });
    if (!picked) return;

    // Snapshot the slot before moving: its captured state carries the CATEGORY as well as
    // the source, so the ordinary method-edit reversal puts the category back (#434).
    const slot = {
      dict: dictIndex,
      className,
      isMeta: this.state.isMeta,
      selector,
      environmentId: 0,
    };
    const recording = beginMethodEdit(this.session, [slot]);

    queries.recategorizeMethod(
      this.session,
      className,
      this.state.isMeta,
      selector,
      picked,
      dictIndex,
    );
    this.syncSelectedClass(className);
    this.envCache.delete(`${dictIndex}/${className}`);
    this.loadMethodCategories();
    if (this.state.selectedMethodCategory) {
      this.handleSelectMethodCategory(this.state.selectedMethodCategory);
    }

    const after = recording ? readMethodSlotState(this.session, [slot]) : undefined;
    notifyUndoable(
      `Moved #${selector} to '${picked}'.`,
      after && recording
        ? recording.commit(`Move ${slotLabel(slot)} to '${picked}'`, after)
        : undefined,
    );
  }

  private handleSendersOf(): void {
    const selector = this.state.selectedMethod;
    if (!selector) return;
    vscode.commands.executeCommand('gemstone.sendersOfSelector', {
      selector,
      sessionId: this.session.id,
    });
  }

  private handleImplementorsOf(): void {
    const selector = this.state.selectedMethod;
    if (!selector) return;
    vscode.commands.executeCommand('gemstone.implementorsOfSelector', {
      selector,
      sessionId: this.session.id,
    });
  }

  // Prompt for a string and browse senders/implementors of it (as a selector) or
  // methods whose source contains it. Unlike "Senders Of" / "Implementors Of",
  // which act on the selected method, these ask for an arbitrary string — so they
  // don't require a selection. All three reuse the same ClassOrganizer-backed
  // search + results view as the existing commands.
  private async promptAndBrowse(kind: 'senders' | 'implementors' | 'source'): Promise<void> {
    const input = (
      await vscode.window.showInputBox(
        kind === 'source'
          ? { prompt: 'Browse methods containing string', placeHolder: 'e.g. asString' }
          : { prompt: `Browse ${kind} of selector`, placeHolder: 'e.g. at:put:' },
      )
    )?.trim();
    if (!input) return;

    if (kind === 'source') {
      await vscode.commands.executeCommand('gemstone.searchMethodsFor', {
        term: input,
        sessionId: this.session.id,
      });
    } else {
      const command =
        kind === 'senders' ? 'gemstone.sendersOfSelector' : 'gemstone.implementorsOfSelector';
      await vscode.commands.executeCommand(command, {
        selector: input,
        sessionId: this.session.id,
      });
    }
  }

  // Clicking an override arrow: show the implementations of `selector` in the
  // current class's superclass chain ('up') or its subclasses ('down').
  private handleShowHierarchyImpls(selector: string, direction: 'up' | 'down'): void {
    const className = this.state.selectedClass;
    const dictIndex = this.state.selectedDictIndex;
    if (!selector || !className || !dictIndex) return;
    vscode.commands.executeCommand('gemstone.hierarchyImplementorsOf', {
      selector,
      className,
      dictIndex,
      isMeta: this.state.isMeta,
      direction,
      sessionId: this.session.id,
    });
  }

  private handleBrowseReferences(objectName: string): void {
    if (!objectName) return;
    vscode.commands.executeCommand('gemstone.browseReferences', {
      objectName,
      sessionId: this.session.id,
    });
  }

  // Move the selected class to a different class category (Class>>category:).
  private async handleMoveClassToCategory(): Promise<void> {
    const className = this.state.selectedClass;
    const dictIndex = this.state.selectedDictIndex;
    if (!className || !dictIndex) return;

    // Offer the dictionary's existing (real) class categories, dropping the
    // "all classes" pseudo-entry and the empty "uncategorized" bucket. New
    // categories are created via the categories column's "New Class Category".
    const categories = this.state.classCategories.filter(
      (c) => c !== ALL_CLASSES_CATEGORY && c !== '',
    );
    const picked = await vscode.window.showQuickPick(categories, {
      placeHolder: `Move ${className} to which category?`,
    });
    if (!picked) return;

    queries.recategorizeClass(this.session, className, picked, dictIndex);
    void this.exportManager.syncClass(
      this.session,
      this.state.dictionaries[dictIndex - 1],
      className,
    );
    // The class may leave its old category — re-read the dictionary and rebuild
    // the categories column and class list.
    this.dictEntryCache.delete(dictIndex);
    this.rebuildClassCategories();
    vscode.window.showInformationMessage(`Moved ${className} to category '${picked}'.`);
  }

  // Copy the selected method's source into another class, preserving its category.
  private async handleCopyMethodToClass(): Promise<void> {
    const sourceClass = this.state.selectedClass;
    const selector = this.state.selectedMethod;
    const dictIndex = this.state.selectedDictIndex;
    if (!sourceClass || !selector || !dictIndex) return;

    const targets = queries
      .getClassNames(this.session, dictIndex)
      .filter((name) => name !== sourceClass)
      .sort();
    if (targets.length === 0) {
      vscode.window.showInformationMessage('No other classes in this dictionary to copy to.');
      return;
    }
    const picked = await vscode.window.showQuickPick(targets, {
      placeHolder: `Copy #${selector} to which class?`,
    });
    if (!picked) return;

    queries.copyMethodToClass(
      this.session,
      sourceClass,
      picked,
      this.state.isMeta,
      selector,
      this.state.selectedEnvId,
      dictIndex,
    );
    void this.exportManager.syncClass(this.session, this.state.dictionaries[dictIndex - 1], picked);
    this.envCache.delete(`${dictIndex}/${picked}`);
    vscode.window.showInformationMessage(`Copied #${selector} to ${picked}.`);
  }

  // Recompute the class categories from the (freshly-read) dictionary entries and
  // reload the categories column + the current category's class list.
  private rebuildClassCategories(): void {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const entries = this.getCachedDictEntries(dictIndex);
    const categorySet = new Set<string>();
    for (const entry of entries) {
      if (entry.isClass) categorySet.add(entry.category || '');
    }
    this.state.classCategories = [ALL_CLASSES_CATEGORY, ...[...categorySet].sort()];

    const selected = this.state.selectedCategory || ALL_CLASSES_CATEGORY;
    this.panel.webview.postMessage({
      command: 'loadClassCategories',
      items: this.state.classCategories,
      selected,
    });
    this.handleSelectCategory(selected);
  }

  // ── Data helpers ──────────────────────────────────────────

  private getCachedDictEntries(dictIndex: number): queries.DictEntry[] {
    let entries = this.dictEntryCache.get(dictIndex);
    if (!entries) {
      entries = queries.getDictionaryEntries(this.session, dictIndex);
      this.dictEntryCache.set(dictIndex, entries);
    }
    return entries;
  }

  private getMaxEnvironment(): number {
    return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
  }

  private getCachedEnvData(dictIndex: number, className: string): queries.EnvCategoryLine[] {
    const key = `${dictIndex}/${className}`;
    let data = this.envCache.get(key);
    if (!data) {
      data = queries.getClassEnvironments(
        this.session,
        dictIndex,
        className,
        this.getMaxEnvironment(),
      );
      this.envCache.set(key, data);
    }
    return data;
  }

  // Override indicators (▲ overrides super, ▼ overridden in subclass) for the
  // currently displayed selectors on the current side. Derived from the cached
  // env data so it costs no extra round trip.
  private methodOverrideBitsFor(items: string[]): Record<string, number> {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className || items.length === 0) return {};
    const itemSet = new Set(items);
    const bits: Record<string, number> = {};
    for (const line of this.getCachedEnvData(dictIndex, className)) {
      if (line.isMeta !== this.state.isMeta || !line.methodOverrideBits) continue;
      for (const sel of Object.keys(line.methodOverrideBits)) {
        if (itemSet.has(sel)) bits[sel] = line.methodOverrideBits[sel];
      }
    }
    return bits;
  }

  // Session methods (extensions + overrides) among the given already-filtered
  // (current side/env) category lines, derived from cached env data — no extra
  // round trip. Empty when the class carries no session methods here.
  private sessionMethodsFor(filtered: queries.EnvCategoryLine[]): string[] {
    const set = new Set<string>();
    for (const entry of filtered) {
      if (!entry.sessionMethodBits) continue;
      for (const sel of entry.selectors) {
        if (entry.sessionMethodBits[sel]) set.add(sel);
      }
    }
    return [...set];
  }

  // Per-selector session-method flag (1 = extension, 2 = override) for the
  // currently displayed selectors on the current side. Same cheap derivation as
  // methodOverrideBitsFor — no extra round trip.
  private sessionMethodBitsFor(items: string[]): Record<string, number> {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className || items.length === 0) return {};
    const itemSet = new Set(items);
    const bits: Record<string, number> = {};
    for (const line of this.getCachedEnvData(dictIndex, className)) {
      if (line.isMeta !== this.state.isMeta || !line.sessionMethodBits) continue;
      for (const sel of Object.keys(line.sessionMethodBits)) {
        if (itemSet.has(sel)) bits[sel] = line.sessionMethodBits[sel];
      }
    }
    return bits;
  }

  // Post the methods column to the webview with override bits attached.
  private postMethods(items: string[], selected?: string | null): void {
    this.panel.webview.postMessage({
      command: 'loadMethods',
      items,
      selected: selected ?? undefined,
      methodOverrideBits: this.methodOverrideBitsFor(items),
      sessionMethodBits: this.sessionMethodBitsFor(items),
    });
  }

  private refreshMethodList(): void {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    this.envCache.delete(`${dictIndex}/${className}`);
    this.loadMethodCategories(this.state.selectedMethodCategory);
    if (this.state.selectedMethodCategory) {
      this.handleSelectMethodCategory(this.state.selectedMethodCategory);
    }
  }

  private loadMethodCategories(selected?: string | null): void {
    const dictIndex = this.state.selectedDictIndex;
    const className = this.state.selectedClass;
    if (!dictIndex || !className) return;

    const envData = this.getCachedEnvData(dictIndex, className);
    const filtered = envData.filter(
      (e) => e.isMeta === this.state.isMeta && e.envId === this.state.selectedEnvId,
    );

    const categories = filtered.map((e) => e.category).sort();
    // Surface the computed Session Methods category at the head, right after
    // ALL METHODS, only when this side/env actually has session methods — so it
    // is never buried among the real categories and absent when there are none.
    const head =
      this.sessionMethodsFor(filtered).length > 0
        ? [ALL_METHODS_CATEGORY, SESSION_METHODS_CATEGORY]
        : [ALL_METHODS_CATEGORY];
    this.state.methodCategories = [...head, ...categories];

    this.panel.webview.postMessage({
      command: 'loadMethodCategories',
      items: this.state.methodCategories,
      ...(selected ? { selected } : {}),
    });
  }

  private sendHierarchy(className: string): void {
    let entries = this.hierarchyCache.get(className);
    if (!entries) {
      entries = queries.getClassHierarchy(this.session, className);
      this.hierarchyCache.set(className, entries);
    }
    this.state.hierarchyEntries = entries;
    this.state.hierarchyClassName = className;

    const superCount = entries.filter((e) => e.kind === 'superclass').length;
    const items = entries.map((e, i) => ({
      className: e.className,
      dictName: e.dictName,
      kind: e.kind,
      indent: e.kind === 'superclass' ? i : e.kind === 'self' ? superCount : superCount + 1,
    }));

    this.panel.webview.postMessage({ command: 'setViewMode', mode: 'hierarchy' });
    this.panel.webview.postMessage({
      command: 'loadHierarchy',
      items,
      selectedClass: className,
    });
  }

  // ── File navigation + dimming ─────────────────────────────

  // The method's actual category, looked up from the cached environment data.
  // Used for the gemstone:// method URI so the breadcrumb — and, on save, the
  // recompile category — reflect the method's real category rather than the
  // pseudo "** ALL METHODS **" / "** SESSION METHODS **" selection (which would
  // otherwise fall back to 'as yet unclassified' and silently recategorize the
  // method when saved).
  private methodCategoryFor(className: string, isMeta: boolean, selector: string): string {
    const dictIndex = this.state.selectedDictIndex;
    if (dictIndex) {
      const entry = this.getCachedEnvData(dictIndex, className).find(
        (e) =>
          e.isMeta === isMeta &&
          e.envId === this.state.selectedEnvId &&
          e.selectors.includes(selector),
      );
      if (entry) return entry.category;
    }
    return this.state.selectedMethodCategory &&
      !isComputedMethodCategory(this.state.selectedMethodCategory)
      ? this.state.selectedMethodCategory
      : 'as yet unclassified';
  }

  private async openClassFile(
    className: string,
    selector?: string,
    isMeta?: boolean,
  ): Promise<void> {
    const dictIndex = this.state.selectedDictIndex;
    if (!dictIndex) return;

    const dictName = this.state.dictionaries[dictIndex - 1];

    if (!selector) {
      // Open the read-only .gs file for class-level navigation
      const sessionRoot = this.exportManager.getSessionRoot(this.session);
      if (!sessionRoot) return;
      const filePath = path.join(sessionRoot, `${dictIndex}-${dictName}`, `${className}.gs`);
      if (!fs.existsSync(filePath)) return;
      this.clearDimming();
      // Resolve the column only once we're committed to opening — homeColumn may
      // split a fresh group, and doing that before the guards above would leave
      // an orphaned empty group when there's nothing to open.
      const viewColumn = await this.getBrowserViewColumn();
      this.placement.remember(vscode.Uri.file(filePath));
      vscode.window.showTextDocument(vscode.Uri.file(filePath), { viewColumn, preview: false });
      return;
    }

    // Open the method in a gemstone:// editor tab (editable, one method at a time)
    const side = isMeta ? 'class' : 'instance';
    const category = this.methodCategoryFor(className, !!isMeta, selector);
    // ?dict=<index> scopes the method's class lookup to this exact dictionary,
    // disambiguating the same key in two dictionaries (which can share a name).
    const params = [`dict=${dictIndex}`];
    if (this.state.selectedEnvId > 0) params.push(`env=${this.state.selectedEnvId}`);
    const uri = vscode.Uri.parse(
      `gemstone://${this.session.id}/${encodeURIComponent(dictName)}/` +
        `${encodeURIComponent(className)}/${side}/` +
        `${encodeURIComponent(category)}/${encodeURIComponent(escapeSelectorSlashes(selector))}?${params.join('&')}`,
    );
    const viewColumn = await this.getBrowserViewColumn();
    this.placement.remember(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    vscode.window.showTextDocument(doc, { viewColumn, preview: true });
  }

  // The column this browser opens source into: the group already holding its
  // own definition/method/diff editors (kept together as peers), or a fresh
  // group split below the webview. Only this browser's editors are considered,
  // so the source never jumps into the GemStone Explorer's balanced columns.
  // Callers must `this.placement.remember(uri)` after opening so the group can
  // be re-found on the next click.
  private getBrowserViewColumn(): Promise<vscode.ViewColumn> {
    return this.placement.homeColumn();
  }

  private applyDimming(
    editor: vscode.TextEditor,
    methodStartLine: number,
    methodEndLine: number,
  ): void {
    const ranges: vscode.Range[] = [];
    const lastLine = editor.document.lineCount - 1;

    if (methodStartLine > 0) {
      ranges.push(new vscode.Range(0, 0, methodStartLine - 1, Number.MAX_SAFE_INTEGER));
    }

    if (methodEndLine < lastLine) {
      ranges.push(new vscode.Range(methodEndLine + 1, 0, lastLine, Number.MAX_SAFE_INTEGER));
    }

    editor.setDecorations(this.dimDecorationType, ranges);
    this.dimmedEditorUri = editor.document.uri.toString();
  }

  private clearDimming(): void {
    if (!this.dimmedEditorUri) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === this.dimmedEditorUri) {
        editor.setDecorations(this.dimDecorationType, []);
      }
    }
    this.dimmedEditorUri = undefined;
  }

  // ── HTML generation ───────────────────────────────────────

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>System Browser</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      align-items: center;
      padding: 4px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .toolbar-cell {
      flex: 1;
      padding: 0 8px;
    }

    .toolbar-mode {
      flex: 2;
      text-align: center;
    }

    .toolbar button {
      padding: 2px 8px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .toolbar button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .toolbar button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .toolbar .session-label {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }

    .toolbar-session {
      text-align: right;
    }

    .columns {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .column {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--vscode-panel-border);
      min-width: 0;
      position: relative;
    }

    .column:last-child {
      border-right: none;
    }

    /* Drag-to-resize splitter straddling a column's right border. Sits above the
       column content so it can be grabbed; highlights on hover and while active. */
    .column-resizer {
      position: absolute;
      top: 0;
      right: -3px;
      bottom: 0;
      width: 6px;
      cursor: col-resize;
      z-index: 5;
    }

    .column-resizer:hover,
    .column-resizer.active {
      background: var(--vscode-focusBorder, #007fd4);
      opacity: 0.7;
    }

    .column-header {
      padding: 4px 8px;
      font-weight: 600;
      font-size: 0.8em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .column-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .column-list .item {
      padding: 1px 8px;
      cursor: default;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: none;
    }

    .column-list .item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .column-list .item.selected {
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .column-list .item.virtual {
      font-style: italic;
      color: var(--vscode-descriptionForeground);
    }

    .column-list .item.virtual.selected {
      color: var(--vscode-list-activeSelectionForeground);
    }

    /* Leading indicator column for a method row. It holds three fixed slots in a
       stable order — up arrow, down arrow, session glyph — so each marker keeps
       the same horizontal position whether or not the markers to its left are
       present, and every method name aligns. Each slot (marker or empty
       placeholder) is sized to its own indicator's width via the two vars below;
       the arrows are narrower than the session glyph. Total gutter width is the
       sum of the three slots. */
    .method-gutter {
      --arrow-slot: 0.8em;
      --session-slot: 0.9em;
      display: inline-block;
      vertical-align: middle;
      white-space: nowrap;
    }

    /* An empty placeholder occupying one slot. It carries the SAME width as the
       marker it stands in for (arrow vs session), so a present marker and a
       missing one take identical space and the columns never shift. */
    .indicator-slot {
      display: inline-block;
      vertical-align: middle;
    }
    .indicator-slot.arrow { width: var(--arrow-slot, 0.8em); }
    .indicator-slot.session { width: var(--session-slot, 0.9em); }

    .override-arrow {
      display: inline-block;
      width: var(--arrow-slot, 0.8em);
      text-align: center;
      line-height: 1;
      vertical-align: middle;
      cursor: pointer;
      opacity: 0.8;
    }

    /* The small triangle is shrunk here, on the glyph, NOT on .override-arrow —
       an em width on the arrow would otherwise be scaled by this smaller
       font-size, making the arrow slot narrower than the placeholder slots. */
    .indicator-glyph {
      font-size: 0.72em;
    }

    .override-arrow.up {
      color: var(--vscode-charts-blue, var(--vscode-textLink-foreground));
    }

    .override-arrow.down {
      color: var(--vscode-charts-orange, var(--vscode-symbolIcon-methodForeground));
    }

    .override-arrow:hover {
      opacity: 1;
      color: var(--vscode-textLink-activeForeground);
    }

    /* Session methods: italic row + a muted leading glyph (+ extension, ±
       override). Italic gives an at-a-glance "this is a session method"; the
       glyph disambiguates the kind. The glyph stays upright and sits inside the
       fixed-width .method-gutter alongside any override arrows. */
    .column-list .item.session-extension,
    .column-list .item.session-override {
      font-style: italic;
    }

    .session-indicator {
      display: inline-block;
      width: var(--session-slot, 0.9em);
      text-align: center;
      font-size: 1em;
      font-weight: bold;
      line-height: 1;
      vertical-align: middle;
      font-style: normal;
      color: var(--vscode-descriptionForeground);
    }

    .column-list .item.selected .session-indicator {
      color: var(--vscode-list-activeSelectionForeground);
    }

    /* The override glyph is clickable: it opens a base-vs-override diff. */
    .session-indicator.override {
      cursor: pointer;
    }

    .session-indicator.override:hover {
      color: var(--vscode-textLink-activeForeground);
    }

    .column-footer {
      padding: 4px 8px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 12px;
      flex-shrink: 0;
    }

    .column-footer label {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      font-size: 0.9em;
    }

    .column-footer input[type="radio"] {
      accent-color: var(--vscode-focusBorder);
    }

    .mode-toggle {
      display: inline-flex;
      border-radius: 3px;
      overflow: hidden;
      border: 1px solid var(--vscode-panel-border);
    }

    .mode-btn {
      padding: 2px 8px !important;
      border-radius: 0 !important;
      border: none !important;
      background: transparent !important;
      color: var(--vscode-descriptionForeground) !important;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .mode-btn:hover {
      background: var(--vscode-list-hoverBackground) !important;
    }

    .mode-btn.active {
      background: var(--vscode-button-secondaryBackground) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .hidden { display: none !important; }

    .hierarchy-item-text {
      white-space: pre;
    }

    .hierarchy-dict {
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
      margin-left: 8px;
    }

    .hierarchy-self-marker {
      color: var(--vscode-focusBorder);
    }

    .context-menu {
      position: fixed;
      z-index: 1000;
      background: var(--vscode-menu-background, var(--vscode-editor-background));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 4px 0;
      min-width: 160px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      display: none;
    }

    .ctx-item {
      padding: 4px 12px;
      cursor: pointer;
      white-space: nowrap;
      font-size: var(--vscode-font-size);
    }

    .ctx-item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground));
    }

    .ctx-separator {
      height: 1px;
      margin: 4px 0;
      background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border));
    }

    .loading {
      padding: 8px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    .error-banner {
      padding: 6px 10px;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #f88);
      border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      font-size: 0.9em;
      display: none;
    }
    .toolbar {
         display: flex;
    }
  </style>
  <script nonce="${nonce}">${listFilterJs}</script>
  <script nonce="${nonce}">${methodListViewJs}</script>
  <script nonce="${nonce}">${browserColumnResizeJs}</script>
</head>
<body>
  <div class="error-banner" id="errorBanner"></div>
  <div class="toolbar">
    <div class="toolbar-cell">
      <button id="refreshBtn" title="Refresh">&#x21bb; Refresh</button>
    </div>
    <div class="toolbar-cell">
      <button id="clearFiltersBtn" title="Clear filters">✕ Clear filters</button>
    </div>
    <div class="toolbar-cell toolbar-mode">
      <span class="mode-toggle">
        <button id="catBtn" class="mode-btn active" title="Category view">Category</button>
        <button id="hierBtn" class="mode-btn" title="Hierarchy view">Hierarchy</button>
      </span>
    </div>
    <div class="toolbar-cell"></div>
    <div class="toolbar-cell"></div>
    <div class="toolbar-cell toolbar-session"><span class="session-label" id="sessionLabel"></span></div>
  </div>
  <div class="columns">
    <div class="column">
      <div class="column-header">Dictionaries</div>
      <list-filter for="list-dicts"></list-filter>
      <div class="column-list" id="list-dicts"></div>
    </div>
    <div class="column" id="col-categories">
      <div class="column-header">Class Categories</div>
      <list-filter for="list-categories"></list-filter>
      <div class="column-list" id="list-categories"></div>
    </div>
    <div class="column" id="col-classes">
      <div class="column-header">Classes</div>
      <list-filter for="list-classes"></list-filter>
      <div class="column-list" id="list-classes"></div>
      <div class="column-footer">
        <label><input type="radio" name="side" value="instance" checked> Instance</label>
        <label><input type="radio" name="side" value="class"> Class</label>
      </div>
    </div>
    <div class="column hidden" id="col-hierarchy" style="flex:2">
      <div class="column-header">Hierarchy</div>
      <div class="column-list" id="list-hierarchy"></div>
      <div class="column-footer">
        <label><input type="radio" name="hier-side" value="instance" checked> Instance</label>
        <label><input type="radio" name="hier-side" value="class"> Class</label>
      </div>
    </div>
    <div class="column">
      <div class="column-header">Method Categories</div>
      <list-filter for="list-method-cats"></list-filter>
      <div class="column-list" id="list-method-cats"></div>
      <div class="column-footer hidden" id="envFooter"></div>
    </div>
    <div class="column">
      <div class="column-header">Methods</div>
      <list-filter for="list-methods"></list-filter>
      <div class="column-list" id="list-methods"></div>
    </div>
  </div>

  <div class="context-menu" id="contextMenu"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ── Column references ──────────────────────────
    const cols = {
      dicts:      document.getElementById('list-dicts'),
      categories: document.getElementById('list-categories'),
      classes:    document.getElementById('list-classes'),
      methodCats: document.getElementById('list-method-cats'),
      methods:    document.getElementById('list-methods'),
      hierarchy:  document.getElementById('list-hierarchy'),
    };

    const colCategories = document.getElementById('col-categories');
    const colClasses = document.getElementById('col-classes');
    const colHierarchy = document.getElementById('col-hierarchy');
    const catBtn = document.getElementById('catBtn');
    const hierBtn = document.getElementById('hierBtn');
    const errorBanner = document.getElementById('errorBanner');

    // Drag-to-resize splitters between the browser columns.
    BrowserColumnResize.setupColumnResize({ container: document.querySelector('.columns'), minWidth: 80 });
    // ── Populate a column with items ───────────────
    function populateColumn(listEl, items, virtualItems, methodOverrideBits, sessionMethodBits, withIndicatorGutter) {
      listEl.innerHTML = '';
      const virtualSet = new Set(virtualItems || []);
      for (const item of items) {
        const div = document.createElement('div');
        div.className = 'item' + (virtualSet.has(item) ? ' virtual' : '');
        div.dataset.value = item;
        const methodOverrideBit = (methodOverrideBits && methodOverrideBits[item]) || 0;
        const sessionBit = (sessionMethodBits && sessionMethodBits[item]) || 0;
        // The methods column always gets the gutter (even with no indicators) so
        // names align in a dedicated indicator column; other columns render plain.
        if (withIndicatorGutter || methodOverrideBit || sessionBit) {
          MethodListView.applyMethodIndicators(div, item, methodOverrideBit, sessionBit);
        } else {
          div.textContent = item;
        }
        listEl.appendChild(div);
      }

      ListFilter.refreshFilterOf(listEl);
    }

    function selectItemInColumn(listEl, value) {
      if (!value) return;
      for (const child of listEl.children) {
        if (child.dataset.value === value) {
          child.classList.add('selected');
          child.scrollIntoView({ block: 'nearest' });
          break;
        }
      }
    }

    // ── Clear columns to the right ─────────────────
    function clearFrom(startCol) {
      const order = ['dicts', 'categories', 'classes', 'methodCats', 'methods'];
      const idx = order.indexOf(startCol);
      for (let i = idx; i < order.length; i++) {
        cols[order[i]].innerHTML = '';
      }
    }

    // ── Selection handler ──────────────────────────
    function setupClickHandler(listEl, callback) {
      listEl.addEventListener('click', (e) => {
        const item = e.target.closest('.item');
        if (!item) return;
        // Deselect previous
        const prev = listEl.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        callback(item.dataset.value);
      });
    }

    setupClickHandler(cols.dicts, (name) => {
      const idx = Array.from(cols.dicts.children).findIndex(el => el.dataset.value === name);
      vscode.postMessage({ command: 'selectDictionary', index: idx + 1 });
    });

    setupClickHandler(cols.categories, (name) => {
      vscode.postMessage({ command: 'selectCategory', name });
    });

    setupClickHandler(cols.classes, (name) => {
      vscode.postMessage({ command: 'selectClass', name });
    });

    setupClickHandler(cols.methodCats, (name) => {
      vscode.postMessage({ command: 'selectMethodCategory', name });
    });

    // Methods column: clicking an override arrow shows the hierarchy
    // implementations; clicking anywhere else selects the method as usual.
    cols.methods.addEventListener('click', (e) => {
      const message = MethodListView.methodListClickMessage(e, cols.methods);
      if (message) vscode.postMessage(message);
    });

    // ── Instance / Class toggle ────────────────────
    document.querySelectorAll('input[name="side"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        vscode.postMessage({
          command: 'toggleSide',
          isMeta: e.target.value === 'class',
        });
      });
    });

    // ── Refresh button ─────────────────────────────
    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
    
    // ── Clear filters button ─────────────────────────────
    document.getElementById('clearFiltersBtn').addEventListener('click', () => {
      ListFilter.clearAllFilters();
    });

    // ── Category / Hierarchy toggle ─────────────────
    catBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'toggleViewMode', mode: 'category' });
    });
    hierBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'toggleViewMode', mode: 'hierarchy' });
    });

    // ── Hierarchy column click ──────────────────────
    cols.hierarchy.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item) return;
      const prev = cols.hierarchy.querySelector('.item.selected');
      if (prev) prev.classList.remove('selected');
      item.classList.add('selected');
      vscode.postMessage({ command: 'selectHierarchyClass', className: item.dataset.className });
    });

    // ── Hierarchy Instance/Class toggle ─────────────
    document.querySelectorAll('input[name="hier-side"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        // Sync the category-mode radios to match
        document.querySelectorAll('input[name="side"]').forEach((r) => {
          r.checked = (r.value === e.target.value);
        });
        vscode.postMessage({
          command: 'toggleSide',
          isMeta: e.target.value === 'class',
        });
      });
    });

    // Sync hierarchy radios when category radios change
    document.querySelectorAll('input[name="side"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        document.querySelectorAll('input[name="hier-side"]').forEach((r) => {
          r.checked = (r.value === e.target.value);
        });
      });
    });

    // ── Context menu ────────────────────────────────
    const contextMenu = document.getElementById('contextMenu');

    function showContextMenu(x, y, items) {
      contextMenu.innerHTML = '';
      for (const item of items) {
        if (item.separator) {
          const sep = document.createElement('div');
          sep.className = 'ctx-separator';
          contextMenu.appendChild(sep);
        } else {
          const div = document.createElement('div');
          div.className = 'ctx-item';
          div.textContent = item.label;
          div.addEventListener('click', () => {
            hideContextMenu();
            item.action();
          });
          contextMenu.appendChild(div);
        }
      }
      contextMenu.style.display = 'block';
      const rect = contextMenu.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      contextMenu.style.left = Math.min(x, Math.max(0, maxX)) + 'px';
      contextMenu.style.top = Math.min(y, Math.max(0, maxY)) + 'px';
    }

    function hideContextMenu() {
      contextMenu.style.display = 'none';
    }

    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) hideContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideContextMenu();
    });

    cols.dicts.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item) {
        const prev = cols.dicts.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        const idx = Array.from(cols.dicts.children).indexOf(item) + 1;
        vscode.postMessage({ command: 'selectDictionary', index: idx });
      }
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Add Dictionary\\u2026', action: () => vscode.postMessage({ command: 'ctxAddDictionary' }) },
        ...(item ? [
           { label: 'Remove Dictionary\\u2026', action: () => vscode.postMessage({ command: 'ctxRemoveDictionary' }) },
          { separator: true },
          { label: 'Move Up', action: () => vscode.postMessage({ command: 'ctxMoveDictUp' }) },
          { label: 'Move Down', action: () => vscode.postMessage({ command: 'ctxMoveDictDown' }) },
          { separator: true },
          { label: 'Browse References', action: () => vscode.postMessage({ command: 'ctxBrowseReferences', name: item.dataset.value }) },
          { separator: true },
          { label: 'File Out as Many Files\\u2026', action: () => vscode.postMessage({ command: 'ctxFileOutDictionaryMany' }) },
          { separator: true },
          { label: 'Run SUnit Tests', action: () => vscode.postMessage({ command: 'ctxRunDictionaryTests' }) }

        ] : []),
      ]);
    });

    cols.categories.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New Class Category\\u2026', action: () => vscode.postMessage({ command: 'ctxNewClassCategory' }) },
        { separator: true },
        { label: 'Run SUnit Tests', action: () => vscode.postMessage({ command: 'ctxRunCategoryTests' }) }
      ]);
    });

    cols.classes.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item) {
        const prev = cols.classes.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        vscode.postMessage({ command: 'selectClass', name: item.dataset.value });
      }
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New Class\\u2026', action: () => vscode.postMessage({ command: 'ctxNewClass' }) },
        ...(item ? [
          { separator: true },
          { label: 'Delete Class', action: () => vscode.postMessage({ command: 'ctxDeleteClass' }) },
          { label: 'Move to Category\\u2026', action: () => vscode.postMessage({ command: 'ctxMoveClassToCategory' }) },
          { label: 'Move to Dictionary\\u2026', action: () => vscode.postMessage({ command: 'ctxMoveClass' }) },
          { separator: true },
          { label: 'File Out Class\\u2026', action: () => vscode.postMessage({ command: 'ctxFileOutClass' }) },
          { label: 'Generate Grail .py Stub\\u2026', action: () => vscode.postMessage({ command: 'ctxGenerateGrailStub' }) },
          { separator: true },
          { label: 'Browse References', action: () => vscode.postMessage({ command: 'ctxBrowseReferences', name: item.dataset.value }) },
          { label: 'Run SUnit Tests', action: () => vscode.postMessage({ command: 'ctxRunTests' }) },
        ] : []),
      ]);
    });

    cols.methodCats.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item && !item.classList.contains('virtual')) {
        const prev = cols.methodCats.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        vscode.postMessage({ command: 'selectMethodCategory', name: item.dataset.value });
      }
      if (item && !item.classList.contains('virtual')) {
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Rename Category\\u2026', action: () => vscode.postMessage({ command: 'ctxRenameCategory' }) },
          { separator: true },
          { label: 'Run SUnit Tests', action: () => vscode.postMessage({ command: 'ctxRunMethodCategoryTests' }) },
        ]);
      }
    });

    cols.methods.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = e.target.closest('.item');
      if (item) {
        const prev = cols.methods.querySelector('.item.selected');
        if (prev) prev.classList.remove('selected');
        item.classList.add('selected');
        vscode.postMessage({ command: 'selectMethod', selector: item.dataset.value });
      }
      showContextMenu(e.clientX, e.clientY, [
        { label: 'New Method', action: () => vscode.postMessage({ command: 'ctxNewMethod' }) },
        { separator: true },
        { label: 'Browse Senders Of\\u2026', action: () => vscode.postMessage({ command: 'ctxBrowseSendersOfString' }) },
        { label: 'Browse Implementors Of\\u2026', action: () => vscode.postMessage({ command: 'ctxBrowseImplementorsOfString' }) },
        { label: 'Browse Methods Containing\\u2026', action: () => vscode.postMessage({ command: 'ctxBrowseMethodsContaining' }) },
        ...(item ? [
          { separator: true },
          { label: 'Delete Method', action: () => vscode.postMessage({ command: 'ctxDeleteMethod' }) },
          { label: 'Move to Category\\u2026', action: () => vscode.postMessage({ command: 'ctxMoveToCategory' }) },
          { label: 'Copy to Class\\u2026', action: () => vscode.postMessage({ command: 'ctxCopyMethodToClass' }) },
          { separator: true },
          { label: 'Senders Of', action: () => vscode.postMessage({ command: 'ctxSendersOf' }) },
          { label: 'Implementors Of', action: () => vscode.postMessage({ command: 'ctxImplementorsOf' }) },
          ...(item.classList.contains('session-override') ? [
            { separator: true },
            { label: 'Compare with base method', action: () => vscode.postMessage({ command: 'compareSessionOverride', selector: item.dataset.value }) },
          ] : []),
          { separator: true },
          { label: 'Run SUnit Test', action: () => vscode.postMessage({ command: 'ctxRunMethodTests' }) },
        ] : []),
      ]);
    });

    // ── Message receiver ───────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.command) {
        case 'loadDictionaries':
          clearFrom('dicts');
          populateColumn(cols.dicts, msg.items, []);
          break;
        case 'loadClassCategories':
          clearFrom('categories');
          populateColumn(cols.categories, msg.items, ['${ALL_CLASSES_CATEGORY}']);
          if (msg.selected) selectItemInColumn(cols.categories, msg.selected);
          break;
        case 'loadClasses':
          clearFrom('classes');
          populateColumn(cols.classes, msg.items, []);
          if (msg.selected) selectItemInColumn(cols.classes, msg.selected);
          break;
        case 'loadMethodCategories':
          clearFrom('methodCats');
          populateColumn(cols.methodCats, msg.items, ['${ALL_METHODS_CATEGORY}', '${SESSION_METHODS_CATEGORY}']);
          if (msg.selected) selectItemInColumn(cols.methodCats, msg.selected);
          break;
        case 'loadMethods':
          cols.methods.innerHTML = '';
          populateColumn(cols.methods, msg.items, [], msg.methodOverrideBits, msg.sessionMethodBits, true);
          if (msg.selected) selectItemInColumn(cols.methods, msg.selected);
          break;
        case 'setViewMode':
          if (msg.mode === 'hierarchy') {
            colCategories.classList.add('hidden');
            colClasses.classList.add('hidden');
            colHierarchy.classList.remove('hidden');
            catBtn.classList.remove('active');
            hierBtn.classList.add('active');
          } else {
            colCategories.classList.remove('hidden');
            colClasses.classList.remove('hidden');
            colHierarchy.classList.add('hidden');
            catBtn.classList.add('active');
            hierBtn.classList.remove('active');
          }
          break;
        case 'loadHierarchy': {
          cols.hierarchy.innerHTML = '';
          for (const entry of msg.items) {
            const div = document.createElement('div');
            div.className = 'item';
            div.dataset.className = entry.className;
            const indent = '\\u00a0\\u00a0'.repeat(entry.indent);
            let text = indent + entry.className;
            if (entry.kind === 'self') text += ' \\u25c0';
            div.innerHTML = '<span class="hierarchy-item-text">' + text + '</span>'
              + '<span class="hierarchy-dict">' + entry.dictName + '</span>';
            if (entry.className === msg.selectedClass) {
              div.classList.add('selected');
            }
            cols.hierarchy.appendChild(div);
          }
          break;
        }
        case 'selectDictionaryItem': {
          const children = cols.dicts.children;
          for (let i = 0; i < children.length; i++) {
            children[i].classList.toggle('selected', i === msg.index - 1);
          }
          break;
        }
        case 'showError':
          errorBanner.textContent = msg.message;
          errorBanner.style.display = 'block';
          setTimeout(() => { errorBanner.style.display = 'none'; }, 5000);
          break;
        case 'setMaxEnvironment': {
          const footer = document.getElementById('envFooter');
          footer.innerHTML = '';
          for (let i = 0; i <= msg.maxEnv; i++) {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'env';
            radio.value = String(i);
            if (i === 0) radio.checked = true;
            radio.addEventListener('change', () => {
              vscode.postMessage({ command: 'toggleEnvironment', envId: i });
            });
            label.appendChild(radio);
            label.appendChild(document.createTextNode(' Env ' + i));
            footer.appendChild(label);
          }
          footer.classList.remove('hidden');
          break;
        }
        case 'setSide': {
          const val = msg.isMeta ? 'class' : 'instance';
          document.querySelectorAll('input[name="side"]').forEach((r) => {
            r.checked = (r.value === val);
          });
          document.querySelectorAll('input[name="hier-side"]').forEach((r) => {
            r.checked = (r.value === val);
          });
          break;
        }
        case 'setSessionLabel':
          document.getElementById('sessionLabel').textContent = msg.label;
          break;
      }
    });

    // ── Initial load ───────────────────────────────
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
