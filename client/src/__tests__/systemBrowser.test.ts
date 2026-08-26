import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getDictionaryNames: vi.fn(),
  getDictionaryEntries: vi.fn(),
  getDictionaryClassFileOutOrder: vi.fn(),
  fileOutClass: vi.fn(),
  getGlobalsForDictionary: vi.fn(),
  getClassEnvironments: vi.fn(),
  getClassHierarchy: vi.fn(),
  addDictionary: vi.fn(),
  moveDictionaryUp: vi.fn(),
  moveDictionaryDown: vi.fn(),
  deleteClass: vi.fn(),
  moveClass: vi.fn(),
  deleteMethod: vi.fn(),
  recategorizeMethod: vi.fn(),
  recategorizeClass: vi.fn(),
  copyMethodToClass: vi.fn(),
  getClassNames: vi.fn(),
  removeDictionary: vi.fn(),
  renameCategory: vi.fn(),
  getMethodCategories: vi.fn(),
  getClassesWithCategory: vi.fn(),
  referencesToObject: vi.fn(),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's method-slot capture — mocked so the flow records without a stone (#434).
vi.mock('../undo/queries/methodSlotQueries', () => ({ captureMethodSlots: vi.fn() }));
vi.mock('../undo/queries/dictionaryQueries', () => ({ captureDictionary: vi.fn() }));
vi.mock('../undo/queries/classSlotQueries', () => ({
  captureClassSlots: vi.fn(),
  newStashKey: vi.fn(() => 'k1'),
}));

vi.mock('../globalsBrowser', () => ({
  GlobalsBrowser: {
    showOrUpdate: vi.fn().mockResolvedValue(undefined),
    disposeForSession: vi.fn(),
  },
}));

vi.mock('../classBrowser', () => ({
  ClassBrowser: {
    showOrUpdate: vi.fn().mockResolvedValue(undefined),
    disposeForSession: vi.fn(),
  },
}));

vi.mock('../commentBrowser', () => ({
  CommentBrowser: {
    showOrUpdate: vi.fn().mockResolvedValue(undefined),
    disposeForSession: vi.fn(),
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import * as fs from 'fs';

import * as path from 'path';
import {
  window,
  workspace,
  ViewColumn,
  commands,
  Uri,
  TabInputText,
  TabInputTextDiff,
  __setConfig,
  __resetConfig,
} from '../__mocks__/vscode';
import {
  SystemBrowser,
  planDictionaryFileOut,
  isComputedMethodCategory,
  ALL_CLASSES_CATEGORY,
  ALL_METHODS_CATEGORY,
  SESSION_METHODS_CATEGORY,
} from '../systemBrowser';
import { extractSelector } from '../methodPattern';
import * as queries from '../browserQueries';
import { captureMethodSlots } from '../undo/queries/methodSlotQueries';
import { captureDictionary } from '../undo/queries/dictionaryQueries';
import { captureClassSlots } from '../undo/queries/classSlotQueries';
import { peekUndoEntry, resetUndoStacks } from '../undo/undoStack';
import { GlobalsBrowser } from '../globalsBrowser';
import { ClassBrowser } from '../classBrowser';
import { CommentBrowser } from '../commentBrowser';
import type { ActiveSession } from '../sessionManager';
import type { ExportManager } from '../exportManager';
import { uriFsPath } from './support/uri';

// ── Helpers ──────────────────────────────────────────────────

const SESSION_ROOT = path.join('/tmp', 'gemstone', 'localhost', 'gs64stone', 'DataCurator');

/**
 * The path a per-class file-out file lands at when writing "as many files",
 * alongside the chosen loader file.
 *
 * @remarks
 * `handleFileOutDictionaryMany` derives each class file's path with
 * `path.join(path.dirname(uri.fsPath), file.fileName)` (systemBrowser.ts).
 * Reproducing that same chain here, rather than a hardcoded literal, keeps
 * the expected value correct on every platform's separator.
 *
 * @param loaderRawPath - The POSIX-style path passed to `vscode.Uri.file(...)` for the chosen loader file.
 * @param fileName - The per-class file's name, e.g. `Object.gs`.
 * @returns The path the per-class file is expected to be written to.
 */
function fileOutPath(loaderRawPath: string, fileName: string): string {
  return path.join(path.dirname(uriFsPath(loaderRawPath)), fileName);
}

function makeSession(id = 1, label = 'test'): ActiveSession {
  return {
    id,
    sessionId: id,
    login: { label, gem_host: 'localhost', stone: 'gs64stone', gs_user: 'DataCurator' },
    gciSession: {} as unknown,
    gciVersion: '3.7.1',
    stoneVersion: '3.7.1',
  } as unknown as ActiveSession;
}

function makeExportManager(sessionRoot: string | undefined = SESSION_ROOT): ExportManager {
  return {
    getSessionRoot: vi.fn(() => sessionRoot),
    syncClass: vi.fn(() => Promise.resolve()),
    removeClassFile: vi.fn(),
    scheduleRefresh: vi.fn(),
  } as unknown as ExportManager;
}

// ── Selector extraction ──────────────────────────────────────

describe('extractSelector', () => {
  it('extracts unary selector', () => {
    expect(extractSelector('name')).toBe('name');
  });

  it('extracts unary selector ignoring whitespace', () => {
    expect(extractSelector('  size  ')).toBe('size');
  });

  it('extracts binary selector', () => {
    expect(extractSelector('+ anObject')).toBe('+');
  });

  it('extracts multi-char binary selector', () => {
    expect(extractSelector('>= other')).toBe('>=');
  });

  it('extracts single keyword selector', () => {
    expect(extractSelector('at: index')).toBe('at:');
  });

  it('extracts multi-keyword selector', () => {
    expect(extractSelector('at: index put: value')).toBe('at:put:');
  });

  it('extracts keyword selector with underscored params', () => {
    expect(extractSelector('inject: initialValue into: binaryBlock')).toBe('inject:into:');
  });

  it('returns empty string for empty input', () => {
    expect(extractSelector('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(extractSelector('   ')).toBe('');
  });

  it('extracts comma as binary', () => {
    expect(extractSelector(', aCollection')).toBe(',');
  });

  it('extracts tilde as binary', () => {
    expect(extractSelector('~ anObject')).toBe('~');
  });
});

// ── File-out planning ───────────────────────────────────────

describe('isComputedMethodCategory', () => {
  it('treats the ALL METHODS and SESSION METHODS sentinels as computed', () => {
    expect(isComputedMethodCategory(ALL_METHODS_CATEGORY)).toBe(true);
    expect(isComputedMethodCategory(SESSION_METHODS_CATEGORY)).toBe(true);
  });

  it('treats a real category, empty, null, and undefined as not computed', () => {
    expect(isComputedMethodCategory('accessing')).toBe(false);
    expect(isComputedMethodCategory('*mypkg-override')).toBe(false);
    expect(isComputedMethodCategory('')).toBe(false);
    expect(isComputedMethodCategory(null)).toBe(false);
    expect(isComputedMethodCategory(undefined)).toBe(false);
  });
});

describe('planDictionaryFileOut', () => {
  it('names each class file after the class and preserves the given order', () => {
    const plan = planDictionaryFileOut('Animals', ['Object', 'Animal', 'Dog']);
    expect(plan.files).toEqual([
      { className: 'Object', fileName: 'Object.gs' },
      { className: 'Animal', fileName: 'Animal.gs' },
      { className: 'Dog', fileName: 'Dog.gs' },
    ]);
  });

  it('binds every class name to nil before loading so circular method references compile', () => {
    const plan = planDictionaryFileOut('Animals', ['Animal', 'Dog']);
    expect(plan.indexContent).toContain("objectNamed: #'Animals'");
    expect(plan.indexContent).toContain("at: #'Animal' put: nil");
    expect(plan.indexContent).toContain("at: #'Dog' put: nil");
  });

  it('creates the dictionary at the front of the symbol list when it is absent', () => {
    const plan = planDictionaryFileOut('Animals', ['Animal']);
    expect(plan.indexContent).toContain('dict isNil ifTrue:');
    expect(plan.indexContent).toContain("SymbolDictionary new name: #'Animals'");
    expect(plan.indexContent).toContain('insertDictionary: dict at: 1');
  });

  it('inputs each class file after the forward references, in order', () => {
    const plan = planDictionaryFileOut('Animals', ['Animal', 'Dog']);
    expect(plan.indexContent).toContain('input Animal.gs\ninput Dog.gs\n');
    expect(plan.indexContent.indexOf('input Animal.gs')).toBeGreaterThan(
      plan.indexContent.indexOf("at: #'Dog' put: nil"),
    );
  });

  it('forward-references the class name but inputs the deduped file name on a collision', () => {
    const plan = planDictionaryFileOut('D', ['Foo', 'foo']);
    expect(plan.files.map((f) => f.fileName)).toEqual(['Foo.gs', 'foo_.gs']);
    expect(plan.indexContent).toContain("at: #'foo' put: nil");
    expect(plan.indexContent).toContain('input foo_.gs');
  });

  it('escapes single quotes in the dictionary name', () => {
    const plan = planDictionaryFileOut("it's", ['Foo']);
    expect(plan.indexContent).toContain("objectNamed: #'it''s'");
  });

  it('produces an empty loader for a dictionary with no classes', () => {
    expect(planDictionaryFileOut('D', [])).toEqual({ files: [], indexContent: '' });
  });
});

// ── SystemBrowser panel lifecycle ───────────────────────────

describe('SystemBrowser', () => {
  let session: ActiveSession;
  let exportManager: ExportManager;
  let mockPanel: {
    webview: {
      html: string;
      postMessage: ReturnType<typeof vi.fn>;
      onDidReceiveMessage: ReturnType<typeof vi.fn>;
    };
    title: string;
    reveal: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onDidDispose: ReturnType<typeof vi.fn>;
    onDidChangeViewState: ReturnType<typeof vi.fn>;
  };
  let messageHandler: (msg: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
    (SystemBrowser as unknown as { lastActive: Map<number, unknown> }).lastActive = new Map();
    (SystemBrowser as unknown as { sharedExportManager: unknown }).sharedExportManager = undefined;
    (SystemBrowser as unknown as { pendingNavigation: Map<number, unknown> }).pendingNavigation =
      new Map();
    window.visibleTextEditors = [];
    window.tabGroups.all = [];

    session = makeSession();
    exportManager = makeExportManager();

    // Capture the panel and the message handler
    vi.mocked(window.createWebviewPanel).mockImplementation((_type: string, title: string) => {
      mockPanel = {
        webview: {
          html: '',
          postMessage: vi.fn(),
          onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
            messageHandler = handler;
            return { dispose: () => {} };
          }),
        },
        title,
        reveal: vi.fn(),
        dispose: vi.fn(),
        onDidDispose: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
        onDidChangeViewState: vi.fn((_handler: unknown) => ({ dispose: () => {} })),
      };
      return mockPanel as unknown as ReturnType<typeof window.createWebviewPanel>;
    });

    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals']);
    vi.mocked(queries.getGlobalsForDictionary).mockReturnValue([]);
    vi.mocked(queries.getDictionaryEntries).mockReturnValue([
      { isClass: true, category: 'Kernel', name: 'Array' },
      { isClass: true, category: 'Kernel', name: 'Set' },
      { isClass: true, category: 'Collections', name: 'Bag' },
      { isClass: false, category: '', name: 'AllUsers' },
    ]);
    vi.mocked(queries.getClassEnvironments).mockReturnValue([
      { isMeta: false, envId: 0, category: 'Accessing', selectors: ['name', 'name:'] },
      { isMeta: false, envId: 0, category: 'Comparing', selectors: ['=', 'hash'] },
      { isMeta: true, envId: 0, category: 'Instance Creation', selectors: ['new', 'new:'] },
    ]);
  });

  afterEach(() => {
    (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
    (SystemBrowser as unknown as { lastActive: Map<number, unknown> }).lastActive = new Map();
  });

  describe('webview HTML', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
    });

    it('includes a list-filter for each column list', () => {
      const html = mockPanel.webview.html;
      expect(html).toContain('list-filter for="list-dicts"');
      expect(html).toContain('list-filter for="list-categories"');
      expect(html).toContain('list-filter for="list-classes"');
      expect(html).toContain('list-filter for="list-method-cats"');
      expect(html).toContain('list-filter for="list-methods"');
    });

    it('includes a Clear filters button', () => {
      expect(mockPanel.webview.html).toContain('clearFiltersBtn');
    });

    it('includes the inlined listFilter.js script tag', () => {
      expect(mockPanel.webview.html).toMatch(/<script nonce="[^"]*"><\/script>/);
    });
  });

  describe('show', () => {
    it('creates a new panel with initial title Browser', () => {
      SystemBrowser.show(session, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneSystemBrowser',
        'Browser',
        ViewColumn.One,
        expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
      );
    });

    it('creates a new panel each time for the same session', () => {
      SystemBrowser.show(session, exportManager);
      SystemBrowser.show(session, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });

    it('creates separate panels for different sessions', () => {
      const session2 = makeSession(2, 'other');
      SystemBrowser.show(session, exportManager);
      SystemBrowser.show(session2, exportManager);
      expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });

    it('updates title to Browser: ClassName when a class is selected', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(mockPanel.title).toBe('Browser: Array');
    });
  });

  describe('disposeForSession', () => {
    it('disposes all panels for the given session', () => {
      SystemBrowser.show(session, exportManager);
      SystemBrowser.disposeForSession(session.id);
      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('does nothing for unknown session', () => {
      SystemBrowser.disposeForSession(999);
      // Should not throw
    });
  });

  describe('message handling', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
    });

    it('loads dictionaries on ready', () => {
      messageHandler({ command: 'ready' });
      expect(queries.getDictionaryNames).toHaveBeenCalledWith(session);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['UserGlobals', 'Globals'],
      });
    });

    it('loads class categories on selectDictionary', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      expect(queries.getDictionaryEntries).toHaveBeenCalledWith(session, 1);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: [ALL_CLASSES_CATEGORY, 'Collections', 'Kernel'],
        selected: ALL_CLASSES_CATEGORY,
      });
    });

    it('selecting a dictionary populates the class list automatically', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Bag', 'Set'],
      });
    });

    it('loads all classes on selectCategory with ALL', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Bag', 'Set'],
      });
    });

    it('loads filtered classes on selectCategory', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: 'Kernel' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Set'],
      });
    });

    it('loads method categories on selectClass', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 1, 'Array', 0);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    it('selecting a class populates the method list automatically', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['=', 'hash', 'name', 'name:'],
        methodOverrideBits: {},
        sessionMethodBits: {},
      });
    });

    it('loads class-side method categories on toggleSide', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Instance Creation'],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    it('toggling to the class side populates the method list automatically', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['new', 'new:'],
        methodOverrideBits: {},
        sessionMethodBits: {},
      });
    });

    it('loads all methods on selectMethodCategory with ALL', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: ALL_METHODS_CATEGORY });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['=', 'hash', 'name', 'name:'],
        methodOverrideBits: {},
        sessionMethodBits: {},
      });
    });

    it('loads filtered methods on selectMethodCategory', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['name', 'name:'],
        methodOverrideBits: {},
        sessionMethodBits: {},
      });
    });

    describe('method override bits', () => {
      type LoadMethodsMsg = {
        command: string;
        items: string[];
        methodOverrideBits: Record<string, number>;
      };

      beforeEach(() => {
        vi.mocked(queries.getClassEnvironments).mockReturnValue([
          {
            isMeta: false,
            envId: 0,
            category: 'Accessing',
            selectors: ['name', 'name:'],
            methodOverrideBits: { name: 1 },
          },
          {
            isMeta: false,
            envId: 0,
            category: 'Comparing',
            selectors: ['=', 'hash'],
            methodOverrideBits: { '=': 3 },
          },
          {
            isMeta: true,
            envId: 0,
            category: 'Instance Creation',
            selectors: ['new', 'new:'],
            methodOverrideBits: { new: 2 },
          },
        ]);
      });

      function selectArray(): void {
        messageHandler({ command: 'ready' });
        messageHandler({ command: 'selectDictionary', index: 1 });
        messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
        vi.mocked(fs.existsSync).mockReturnValue(false);
        messageHandler({ command: 'selectClass', name: 'Array' });
      }

      function lastLoadMethods(): LoadMethodsMsg {
        const calls = vi
          .mocked(mockPanel.webview.postMessage)
          .mock.calls.map((c) => c[0] as LoadMethodsMsg)
          .filter((m) => m.command === 'loadMethods');
        return calls[calls.length - 1];
      }

      it('attaches bits only for displayed selectors on the current side', () => {
        selectArray();
        messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
        const msg = lastLoadMethods();
        expect(msg.items).toEqual(['name', 'name:']);
        // name: has no entry, so it is absent — only name carries a bit.
        expect(msg.methodOverrideBits).toEqual({ name: 1 });
      });

      it('aggregates bits across categories for ALL METHODS', () => {
        selectArray();
        messageHandler({ command: 'selectMethodCategory', name: ALL_METHODS_CATEGORY });
        expect(lastLoadMethods().methodOverrideBits).toEqual({ name: 1, '=': 3 });
      });

      it('uses class-side bits after toggling to the class side', () => {
        selectArray();
        messageHandler({ command: 'toggleSide', isMeta: true });
        messageHandler({ command: 'selectMethodCategory', name: 'Instance Creation' });
        const msg = lastLoadMethods();
        expect(msg.items).toEqual(['new', 'new:']);
        expect(msg.methodOverrideBits).toEqual({ new: 2 });
      });
    });

    describe('session methods', () => {
      type LoadMethodsMsg = {
        command: string;
        items: string[];
        sessionMethodBits: Record<string, number>;
      };
      type LoadCategoriesMsg = { command: string; items: string[] };

      beforeEach(() => {
        // Instance side carries session methods (an extension and an override
        // living in a *package category); the class side carries none.
        vi.mocked(queries.getClassEnvironments).mockReturnValue([
          {
            isMeta: false,
            envId: 0,
            category: 'Accessing',
            selectors: ['name', 'name:'],
            methodOverrideBits: {},
            sessionMethodBits: {},
          },
          {
            isMeta: false,
            envId: 0,
            category: '*mypkg',
            selectors: ['ext1', 'isVowel'],
            methodOverrideBits: {},
            sessionMethodBits: { ext1: 1, isVowel: 2 },
          },
          {
            isMeta: true,
            envId: 0,
            category: 'Instance Creation',
            selectors: ['new'],
            methodOverrideBits: {},
            sessionMethodBits: {},
          },
        ]);
      });

      function selectArray(): void {
        messageHandler({ command: 'ready' });
        messageHandler({ command: 'selectDictionary', index: 1 });
        messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
        vi.mocked(fs.existsSync).mockReturnValue(false);
        messageHandler({ command: 'selectClass', name: 'Array' });
      }

      function lastCategories(): LoadCategoriesMsg {
        const calls = vi
          .mocked(mockPanel.webview.postMessage)
          .mock.calls.map((c) => c[0] as LoadCategoriesMsg)
          .filter((m) => m.command === 'loadMethodCategories');
        return calls[calls.length - 1];
      }

      function lastLoadMethods(): LoadMethodsMsg {
        const calls = vi
          .mocked(mockPanel.webview.postMessage)
          .mock.calls.map((c) => c[0] as LoadMethodsMsg)
          .filter((m) => m.command === 'loadMethods');
        return calls[calls.length - 1];
      }

      it('offers the computed Session Methods category at the head, right after ALL METHODS', () => {
        selectArray();
        expect(lastCategories().items).toEqual([
          ALL_METHODS_CATEGORY,
          SESSION_METHODS_CATEGORY,
          '*mypkg',
          'Accessing',
        ]);
      });

      it('omits the Session Methods category on a side that has no session methods', () => {
        selectArray();
        messageHandler({ command: 'toggleSide', isMeta: true });
        expect(lastCategories().items).toEqual([ALL_METHODS_CATEGORY, 'Instance Creation']);
      });

      it('lists every session method (extension and override) when the category is selected', () => {
        selectArray();
        messageHandler({ command: 'selectMethodCategory', name: SESSION_METHODS_CATEGORY });
        const msg = lastLoadMethods();
        expect(msg.items).toEqual(['ext1', 'isVowel']);
        expect(msg.sessionMethodBits).toEqual({ ext1: 1, isVowel: 2 });
      });

      it('does not list ordinary persistent methods under the Session Methods category', () => {
        selectArray();
        messageHandler({ command: 'selectMethodCategory', name: SESSION_METHODS_CATEGORY });
        expect(lastLoadMethods().items).not.toContain('name');
      });

      it('attaches session flags for the displayed selectors of a normal category', () => {
        selectArray();
        messageHandler({ command: 'selectMethodCategory', name: '*mypkg' });
        expect(lastLoadMethods().sessionMethodBits).toEqual({ ext1: 1, isVowel: 2 });
      });

      function lastDiffCall(): [string, Uri, Uri, string, unknown] | undefined {
        return vi
          .mocked(commands.executeCommand)
          .mock.calls.filter((c) => c[0] === 'vscode.diff')
          .pop() as [string, Uri, Uri, string, unknown] | undefined;
      }

      function diffCallCount(): number {
        return vi.mocked(commands.executeCommand).mock.calls.filter((c) => c[0] === 'vscode.diff')
          .length;
      }

      it('compares an override against its persistent base, labeling each pane', async () => {
        selectArray();
        messageHandler({ command: 'compareSessionOverride', selector: 'isVowel' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const call = lastDiffCall();
        expect(call).toBeDefined();
        const [, baseUri, overrideUri] = call!;
        expect(baseUri.query).toContain('base=1'); // left = persistent base
        expect(overrideUri.query).not.toContain('base=1'); // right = session view
        expect(decodeURIComponent(baseUri.path)).toContain('isVowel (base)');
        expect(decodeURIComponent(overrideUri.path)).toContain('isVowel (session override)');
      });

      it('toggles the diff off and reopens the plain session source when the same override is clicked again', async () => {
        selectArray();
        messageHandler({ command: 'compareSessionOverride', selector: 'isVowel' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const [, baseUri, overrideUri] = lastDiffCall()!;
        window.tabGroups.all = [{ tabs: [{ input: new TabInputTextDiff(baseUri, overrideUri) }] }];
        const before = diffCallCount();
        vi.mocked(workspace.openTextDocument).mockClear();

        messageHandler({ command: 'compareSessionOverride', selector: 'isVowel' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Reopened the plain method source — no diff, no "(base)/(session override)" label.
        const opened = vi
          .mocked(workspace.openTextDocument)
          .mock.calls.map((c) => decodeURIComponent(String(c[0])));
        expect(
          opened.some(
            (u) =>
              u.includes('isVowel') && !u.includes('(base)') && !u.includes('(session override)'),
          ),
        ).toBe(true);
        expect(diffCallCount()).toBe(before); // no new diff opened
        expect(window.tabGroups.close).toHaveBeenCalled(); // diff closed
        // Source opens BEFORE the diff closes, so the diff's group is reused
        // (closing first would strand a webview-only group → new split group).
        const lastOpen = vi.mocked(window.showTextDocument).mock.invocationCallOrder.at(-1)!;
        const lastClose = vi.mocked(window.tabGroups.close).mock.invocationCallOrder.at(-1)!;
        expect(lastOpen).toBeLessThan(lastClose);
        window.tabGroups.all = [];
      });

      it('ignores a second ± click while the first toggle is still opening', async () => {
        selectArray();
        let releaseGroup: () => void = () => {};
        vi.mocked(commands.executeCommand).mockImplementation((cmd: string) => {
          if (cmd === 'workbench.action.newGroupBelow')
            return new Promise<void>((r) => {
              releaseGroup = r;
            });
          return undefined;
        });
        try {
          // First click starts opening the diff and blocks awaiting the new group.
          messageHandler({ command: 'compareSessionOverride', selector: 'isVowel' });
          await new Promise((resolve) => setTimeout(resolve, 0));
          // Second click lands mid-flight — the busy guard must drop it.
          messageHandler({ command: 'compareSessionOverride', selector: 'isVowel' });
          await new Promise((resolve) => setTimeout(resolve, 0));

          releaseGroup();
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(diffCallCount()).toBe(1); // only the first click opened a diff
        } finally {
          vi.mocked(commands.executeCommand).mockReset();
        }
      });

      it('closes the override diff when navigating to another method', async () => {
        selectArray();
        messageHandler({ command: 'compareSessionOverride', selector: 'isVowel' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const [, baseUri, overrideUri] = lastDiffCall()!;
        const diffTab = { input: new TabInputTextDiff(baseUri, overrideUri) };
        window.tabGroups.all = [{ tabs: [diffTab] }];

        messageHandler({ command: 'selectMethod', selector: 'name' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(window.tabGroups.close).toHaveBeenCalledWith(diffTab);
        window.tabGroups.all = [];
      });
    });

    describe('override-arrow click (showHierarchyImpls)', () => {
      function selectArray(): void {
        messageHandler({ command: 'ready' });
        messageHandler({ command: 'selectDictionary', index: 1 });
        messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
        vi.mocked(fs.existsSync).mockReturnValue(false);
        messageHandler({ command: 'selectClass', name: 'Array' });
      }

      it('forwards to gemstone.hierarchyImplementorsOf with the current context', () => {
        selectArray();
        messageHandler({ command: 'showHierarchyImpls', selector: 'name', direction: 'up' });
        expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.hierarchyImplementorsOf', {
          selector: 'name',
          className: 'Array',
          dictIndex: 1,
          isMeta: false,
          direction: 'up',
          sessionId: session.id,
        });
      });

      it('carries the class side and direction through', () => {
        selectArray();
        messageHandler({ command: 'toggleSide', isMeta: true });
        messageHandler({ command: 'showHierarchyImpls', selector: 'new', direction: 'down' });
        expect(commands.executeCommand).toHaveBeenCalledWith(
          'gemstone.hierarchyImplementorsOf',
          expect.objectContaining({ selector: 'new', isMeta: true, direction: 'down' }),
        );
      });

      it('does nothing when no class is selected', () => {
        messageHandler({ command: 'ready' });
        messageHandler({ command: 'showHierarchyImpls', selector: 'name', direction: 'up' });
        expect(commands.executeCommand).not.toHaveBeenCalledWith(
          'gemstone.hierarchyImplementorsOf',
          expect.anything(),
        );
      });
    });

    it('posts showError when a handler throws', () => {
      vi.mocked(queries.getDictionaryNames).mockImplementation(() => {
        throw new Error('GCI failure');
      });
      messageHandler({ command: 'ready' });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'showError',
        message: 'GCI failure',
      });
    });
  });

  describe('caching', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
    });

    it('caches dictionary entries', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectDictionary', index: 1 });
      expect(queries.getDictionaryEntries).toHaveBeenCalledTimes(1);
    });

    it('caches environment data', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(queries.getClassEnvironments).toHaveBeenCalledTimes(1);
    });

    it('clears caches on refresh', () => {
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'refresh' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      expect(queries.getDictionaryEntries).toHaveBeenCalledTimes(2);
    });
  });

  describe('file opening', () => {
    const gsContent = [
      'run',
      "Object subclass: 'Array'",
      '  instVarNames: #()',
      '%',
      'method: Array',
      'name',
      '',
      "  ^ 'Array'",
      '%',
      'method: Array',
      'size',
      '',
      '  ^ 0',
      '%',
    ].join('\n');

    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
    });

    it('does not open a file when selecting a class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(gsContent);
      messageHandler({ command: 'selectClass', name: 'Array' });
      expect(window.showTextDocument).not.toHaveBeenCalled();
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('opens a gemstone:// method editor when selecting a method', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'selectMethodCategory', name: 'accessing' });
      messageHandler({ command: 'selectMethod', selector: 'size' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.scheme).toBe('gemstone');
      expect(uri.path).toContain('/Array/instance/');
      expect(uri.path).toContain('/size');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preview: true }),
      );
    });

    it('includes the method category in the gemstone:// URI', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'selectMethodCategory', name: 'accessing' });
      messageHandler({ command: 'selectMethod', selector: 'size' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('accessing');
    });

    it('uses class side in URI when isMeta is true', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });

      messageHandler({ command: 'selectMethodCategory', name: 'instance creation' });
      messageHandler({ command: 'selectMethod', selector: 'new' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('/class/');
    });

    it('uses the method\'s real category (not "as yet unclassified") when ALL METHODS is selected', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: ALL_METHODS_CATEGORY });
      messageHandler({ command: 'selectMethod', selector: 'name' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('Accessing'); // name's real category
      expect(uri.path).not.toContain('as yet unclassified');
      expect(uri.path).not.toContain('ALL METHODS');
    });

    it("uses the class-side method's real category when ALL METHODS is selected", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });
      messageHandler({ command: 'selectMethodCategory', name: ALL_METHODS_CATEGORY });
      messageHandler({ command: 'selectMethod', selector: 'new' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('/class/');
      expect(uri.path).toContain('Instance Creation'); // new's real category
      expect(uri.path).not.toContain('as yet unclassified');
    });

    it('falls back to "as yet unclassified" only for a method with no environment entry', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethod', selector: 'ghostMethod' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.path).toContain('as yet unclassified');
    });

    it('opens a gemstone:// editor even when method is not found in the .gs file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'selectMethod', selector: 'nonExistentMethod' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = (workspace.openTextDocument as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(uri.scheme).toBe('gemstone');
    });
  });

  describe('hierarchy view', () => {
    const hierarchyData: queries.ClassHierarchyEntry[] = [
      { className: 'Object', dictName: 'Globals', kind: 'superclass' },
      { className: 'Collection', dictName: 'Globals', kind: 'superclass' },
      { className: 'SequenceableCollection', dictName: 'Globals', kind: 'superclass' },
      { className: 'Array', dictName: 'UserGlobals', kind: 'self' },
      { className: 'SmallArray', dictName: 'UserGlobals', kind: 'subclass' },
    ];

    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(queries.getClassHierarchy).mockReturnValue(hierarchyData);
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('fetches hierarchy and posts data when toggling to hierarchy mode', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).toHaveBeenCalledWith(session, 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'hierarchy',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadHierarchy',
        items: [
          { className: 'Object', dictName: 'Globals', kind: 'superclass', indent: 0 },
          { className: 'Collection', dictName: 'Globals', kind: 'superclass', indent: 1 },
          {
            className: 'SequenceableCollection',
            dictName: 'Globals',
            kind: 'superclass',
            indent: 2,
          },
          { className: 'Array', dictName: 'UserGlobals', kind: 'self', indent: 3 },
          { className: 'SmallArray', dictName: 'UserGlobals', kind: 'subclass', indent: 4 },
        ],
        selectedClass: 'Array',
      });
    });

    it('posts empty hierarchy when no class is selected', () => {
      // Deselect class by selecting a new dictionary
      messageHandler({ command: 'selectDictionary', index: 2 });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).not.toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'hierarchy',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadHierarchy',
        items: [],
        selectedClass: null,
      });
    });

    it('restores category data when toggling back to category mode', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'category' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'category',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: [ALL_CLASSES_CATEGORY, 'Collections', 'Kernel'],
        selected: ALL_CLASSES_CATEGORY,
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: ['Array', 'Bag', 'Set'],
        selected: 'Array',
      });
    });

    it('restores class selection and method categories when toggling back to category mode', () => {
      // Select a class so method categories are loaded
      messageHandler({ command: 'selectClass', name: 'Array' });

      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'category' });

      // Class list should include the selected class
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadClasses',
          selected: 'Array',
        }),
      );
      // Method categories should be restored
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    it('restores method category and method selection when toggling back to category mode', () => {
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      messageHandler({ command: 'selectMethod', selector: 'size' });

      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleViewMode', mode: 'category' });

      // Method categories should be restored with selection
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: 'Accessing',
      });
      // Methods should be restored with selection
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadMethods',
          selected: 'size',
        }),
      );
    });

    it('loads method categories when selecting a hierarchy class', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'selectHierarchyClass', className: 'Array' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    // Regression: a hierarchy-view click previously updated the column
    // list inline without routing through applyClassSelection, so the
    // Class Definition panel didn't refresh — the user reported it as
    // "Class Definition subtab is not updated like it is if I simply
    // click on another class." Pin that the click now refreshes the
    // Class Definition.
    it('refreshes the Class Definition panel when a hierarchy class is clicked', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();

      messageHandler({ command: 'selectHierarchyClass', className: 'Collection' });

      expect(ClassBrowser.showOrUpdate).toHaveBeenCalledWith(
        session,
        expect.any(Array),
        expect.any(Number),
        'Collection',
      );
    });

    it('resolves correct dictionary for hierarchy class from different dict', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      // Select 'Collection' which is in 'Globals' (index 2)
      messageHandler({ command: 'selectHierarchyClass', className: 'Collection' });

      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 2, 'Collection', 0);
    });

    it('ignores selectHierarchyClass for unknown class', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(queries.getClassEnvironments).mockClear();
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'selectHierarchyClass', className: 'NoSuchClass' });

      expect(queries.getClassEnvironments).not.toHaveBeenCalled();
    });

    it('caches hierarchy data per class', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      messageHandler({ command: 'toggleViewMode', mode: 'category' });
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).toHaveBeenCalledTimes(1);
    });

    it('clears hierarchy cache on refresh', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      messageHandler({ command: 'refresh' });

      // Re-navigate to a class and toggle to hierarchy
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });

      expect(queries.getClassHierarchy).toHaveBeenCalledTimes(2);
    });

    it('refresh resets view mode to category', () => {
      messageHandler({ command: 'toggleViewMode', mode: 'hierarchy' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'refresh' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setViewMode',
        mode: 'category',
      });
    });
  });

  describe('dictionary context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
    });

    it('adds a dictionary after input', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('NewDict');
      // After addDictionary, getDictionaryNames will be called again — return updated list
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals', 'NewDict']);
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'ctxAddDictionary' });

      await vi.waitFor(() =>
        expect(queries.addDictionary).toHaveBeenCalledWith(session, 'NewDict'),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['UserGlobals', 'Globals', 'NewDict'],
      });
    });

    it('records the create, so a new dictionary can be taken back off the list (#434)', async () => {
      resetUndoStacks();
      vi.mocked(window.showInputBox).mockResolvedValue('NewDict');
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals', 'NewDict']);
      vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'NewDict', index: 3 });

      messageHandler({ command: 'ctxAddDictionary' });

      await vi.waitFor(() =>
        expect(peekUndoEntry(session.id)).toMatchObject({
          kind: 'dictionaryEdit',
          label: 'Create dictionary NewDict',
          before: { present: false, name: 'NewDict' },
          after: { present: true, name: 'NewDict', index: 3 },
          stashKey: null,
        }),
      );
    });

    it('reconciles the mirror via a debounced refresh for the new dictionary', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('NewDict');
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals', 'NewDict']);

      messageHandler({ command: 'ctxAddDictionary' });

      await vi.waitFor(() => expect(exportManager.scheduleRefresh).toHaveBeenCalled());
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('does nothing when user cancels add dictionary', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue(undefined);
      messageHandler({ command: 'ctxAddDictionary' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queries.addDictionary).not.toHaveBeenCalled();
    });

    it('moves dictionary up', () => {
      messageHandler({ command: 'selectDictionary', index: 2 });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'ctxMoveDictUp' });

      expect(queries.moveDictionaryUp).toHaveBeenCalledWith(session, 2);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['Globals', 'UserGlobals'],
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'selectDictionaryItem',
        index: 1,
      });
    });

    it('does not move first dictionary up', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'ctxMoveDictUp' });
      expect(queries.moveDictionaryUp).not.toHaveBeenCalled();
    });

    it('moves dictionary down', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'ctxMoveDictDown' });

      expect(queries.moveDictionaryDown).toHaveBeenCalledWith(session, 1);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['Globals', 'UserGlobals'],
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'selectDictionaryItem',
        index: 2,
      });
    });

    it('does not move last dictionary down', () => {
      messageHandler({ command: 'selectDictionary', index: 2 });
      messageHandler({ command: 'ctxMoveDictDown' });
      expect(queries.moveDictionaryDown).not.toHaveBeenCalled();
    });

    it('removes dictionary after confirmation', async () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(window.showWarningMessage).mockResolvedValue('Remove');
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['Globals']);
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'ctxRemoveDictionary' });

      await vi.waitFor(() => expect(queries.removeDictionary).toHaveBeenCalledWith(session, 1));
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['Globals'],
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: [],
      });
    });

    it('does not remove dictionary when user cancels', async () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(window.showWarningMessage).mockResolvedValue(undefined);

      messageHandler({ command: 'ctxRemoveDictionary' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(queries.removeDictionary).not.toHaveBeenCalled();
    });

    it('reconciles the mirror via a debounced refresh when removing a dictionary', async () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(window.showWarningMessage).mockResolvedValue('Remove');
      vi.mocked(queries.getDictionaryNames).mockReturnValue(['Globals']);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      messageHandler({ command: 'ctxRemoveDictionary' });

      await vi.waitFor(() => expect(exportManager.scheduleRefresh).toHaveBeenCalled());
      expect(fs.rmSync).not.toHaveBeenCalled();
    });

    it('runs SUnit tests for all classes in the selected dictionary', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      vi.mocked(commands.executeCommand).mockClear();

      messageHandler({ command: 'ctxRunDictionaryTests' });

      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.runSunitClasses',
        'UserGlobals',
        ['Array', 'Set', 'Bag'],
      );
    });

    it('does nothing when no dictionary is selected', () => {
      // Fresh browser — no dictionary selected
      SystemBrowser.show(session, exportManager);
      const freshHandler = vi.mocked(window.createWebviewPanel).mock.results.at(-1)!.value.webview
        .onDidReceiveMessage.mock.calls[0][0] as (m: unknown) => void;
      freshHandler({ command: 'ready' });
      vi.mocked(commands.executeCommand).mockClear();

      freshHandler({ command: 'ctxRunDictionaryTests' });

      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'gemstone.runSunitClasses',
        expect.anything(),
      );
    });
  });

  describe('class category context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
    });

    it('runs SUnit tests for all classes in the selected category', () => {
      messageHandler({ command: 'selectCategory', name: 'Kernel' });
      vi.mocked(commands.executeCommand).mockClear();

      messageHandler({ command: 'ctxRunCategoryTests' });

      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.runSunitClasses',
        'UserGlobals',
        ['Array', 'Set'],
      );
    });

    it('does nothing when no category is selected', () => {
      vi.mocked(commands.executeCommand).mockClear();

      messageHandler({ command: 'ctxRunCategoryTests' });

      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'gemstone.runSunitClasses',
        expect.anything(),
      );
    });
  });

  describe('class context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('deletes class after confirmation', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue('Delete');

      messageHandler({ command: 'ctxDeleteClass' });

      await vi.waitFor(() => expect(queries.deleteClass).toHaveBeenCalledWith(session, 1, 'Array'));
      // The class's mirror file + persisted hash are dropped.
      expect(exportManager.removeClassFile).toHaveBeenCalledWith(
        session,
        1,
        'UserGlobals',
        'Array',
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses' }),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [],
      });
    });

    it('does not delete class when user cancels', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue(undefined);
      messageHandler({ command: 'ctxDeleteClass' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queries.deleteClass).not.toHaveBeenCalled();
    });

    it('moves class to another dictionary', async () => {
      vi.mocked(window.showQuickPick).mockResolvedValue({ label: 'Globals', index: 2 });

      messageHandler({ command: 'ctxMoveClass' });

      await vi.waitFor(() =>
        expect(queries.moveClass).toHaveBeenCalledWith(session, 1, 2, 'Array'),
      );
    });

    it('records the move between dictionaries as a class edit over both names (#434)', async () => {
      // `moveClass` REBINDS the same class object, so the reversal rebinds the name it left and
      // unbinds the name it arrived under.
      resetUndoStacks();
      vi.mocked(window.showQuickPick).mockResolvedValue({ label: 'Globals', index: 2 });
      let capture = 0;
      vi.mocked(captureClassSlots).mockImplementation((_e, slots) => {
        capture += 1;
        return slots.map((slot) =>
          capture === 1
            ? slot.dict === 1
              ? { bound: true, oop: '100', selectors: [] }
              : { bound: false, oop: null, selectors: [] }
            : slot.dict === 1
              ? { bound: false, oop: null, selectors: [] }
              : { bound: true, oop: '100', selectors: [] },
        );
      });

      messageHandler({ command: 'ctxMoveClass' });

      await vi.waitFor(() =>
        expect(peekUndoEntry(session.id)).toMatchObject({
          kind: 'classEdit',
          label: 'Move class Array to Globals',
        }),
      );
      const entry = peekUndoEntry(session.id);
      expect(entry?.kind === 'classEdit' && entry.slots.map((sl) => sl.dict)).toEqual([1, 2]);
    });

    it('records a move to another class category, per class (#434)', async () => {
      resetUndoStacks();
      vi.mocked(window.showQuickPick).mockResolvedValue('Printing');
      vi.mocked(queries.recategorizeClass).mockReturnValue('Recategorized: Array');
      vi.mocked(queries.getClassesWithCategory)
        .mockReturnValueOnce([{ className: 'Array', category: 'Collections', hasComment: false }])
        .mockReturnValueOnce([{ className: 'Array', category: 'Printing', hasComment: false }]);

      messageHandler({ command: 'ctxMoveClassToCategory' });

      await vi.waitFor(() =>
        expect(peekUndoEntry(session.id)).toMatchObject({
          kind: 'classCategoryEdit',
          label: 'Move class Array to category Printing',
          changes: [{ className: 'Array', before: 'Collections', after: 'Printing' }],
        }),
      );
    });

    it('delegates run tests to command', () => {
      messageHandler({ command: 'ctxRunTests' });
      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.runSunitClass', {
        dictName: 'UserGlobals',
        className: 'Array',
      });
    });
  });

  describe('file out', () => {
    beforeEach(() => {
      (workspace as unknown as { workspaceFolders: { uri: unknown }[] }).workspaceFolders = [
        { uri: Uri.file('/ws') },
      ];
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    afterEach(() => {
      delete (workspace as unknown as { workspaceFolders?: unknown }).workspaceFolders;
    });

    it('writes the selected class file-out to the chosen path', async () => {
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(queries.fileOutClass).mockReturnValue('! Array file-out');
      vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('/out/Array.gs'));

      messageHandler({ command: 'ctxFileOutClass' });

      await vi.waitFor(() =>
        expect(queries.fileOutClass).toHaveBeenCalledWith(session, 'Array', 1),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        uriFsPath('/out/Array.gs'),
        '! Array file-out',
        'utf8',
      );
    });

    it('defaults a test class file name to its subject', async () => {
      messageHandler({ command: 'selectClass', name: 'AccountTestCase' });
      vi.mocked(window.showSaveDialog).mockResolvedValue(undefined);

      messageHandler({ command: 'ctxFileOutClass' });

      await vi.waitFor(() => expect(window.showSaveDialog).toHaveBeenCalled());
      const opts = vi.mocked(window.showSaveDialog).mock.calls[0][0]!;
      expect((opts.defaultUri as { fsPath: string }).fsPath).toContain('Account.gs');
    });

    it('does not write a class file-out when the save dialog is cancelled', async () => {
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(window.showSaveDialog).mockResolvedValue(undefined);

      messageHandler({ command: 'ctxFileOutClass' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('writes one file per class plus a loader for a dictionary as many files', async () => {
      vi.mocked(queries.getDictionaryClassFileOutOrder).mockReturnValue([
        'Object',
        'Animal',
        'Dog',
      ]);
      vi.mocked(queries.fileOutClass).mockImplementation(
        (_s, className) => `! ${className} file-out`,
      );
      vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('/out/UserGlobals.gs'));

      messageHandler({ command: 'ctxFileOutDictionaryMany' });

      await vi.waitFor(() =>
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          fileOutPath('/out/UserGlobals.gs', 'Object.gs'),
          '! Object file-out',
          'utf8',
        ),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        fileOutPath('/out/UserGlobals.gs', 'Animal.gs'),
        '! Animal file-out',
        'utf8',
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        fileOutPath('/out/UserGlobals.gs', 'Dog.gs'),
        '! Dog file-out',
        'utf8',
      );
      const loader = vi
        .mocked(fs.writeFileSync)
        .mock.calls.find((c) => c[0] === uriFsPath('/out/UserGlobals.gs'))![1];
      expect(loader).toContain('input Object.gs\ninput Animal.gs\ninput Dog.gs\n');
    });

    it('files out classes in the order their superclasses require, after forward references', async () => {
      vi.mocked(queries.getDictionaryClassFileOutOrder).mockReturnValue([
        'Object',
        'Animal',
        'Dog',
      ]);
      vi.mocked(queries.fileOutClass).mockImplementation((_s, className) => `! ${className}`);
      vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('/out/UserGlobals.gs'));

      messageHandler({ command: 'ctxFileOutDictionaryMany' });

      await vi.waitFor(() =>
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          uriFsPath('/out/UserGlobals.gs'),
          expect.anything(),
          'utf8',
        ),
      );
      const loader = vi
        .mocked(fs.writeFileSync)
        .mock.calls.find((c) => c[0] === uriFsPath('/out/UserGlobals.gs'))![1] as string;
      expect(loader).toContain("at: #'Dog' put: nil");
      expect(loader.indexOf('input Object.gs')).toBeGreaterThan(
        loader.indexOf("at: #'Dog' put: nil"),
      );
      expect(loader).toContain('input Object.gs\ninput Animal.gs\ninput Dog.gs\n');
    });

    it('warns and writes nothing when a dictionary has no classes', async () => {
      vi.mocked(queries.getDictionaryClassFileOutOrder).mockReturnValue([]);
      vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('/out/UserGlobals.gs'));

      messageHandler({ command: 'ctxFileOutDictionaryMany' });

      await vi.waitFor(() => expect(window.showWarningMessage).toHaveBeenCalled());
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('method category context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('renames method category', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('Getters');

      messageHandler({ command: 'ctxRenameCategory' });

      await vi.waitFor(() =>
        expect(queries.renameCategory).toHaveBeenCalledWith(
          session,
          'Array',
          false,
          'Accessing',
          'Getters',
          1,
        ),
      );
    });

    it('does not rename when user cancels', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue(undefined);
      messageHandler({ command: 'ctxRenameCategory' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queries.renameCategory).not.toHaveBeenCalled();
    });

    it('runs SUnit tests for all methods in the selected method category', () => {
      vi.mocked(commands.executeCommand).mockClear();

      messageHandler({ command: 'ctxRunMethodCategoryTests' });

      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.runSunitMethodCategory',
        'UserGlobals',
        'Array',
        'Accessing',
      );
    });

    it('does nothing when no method category is selected', () => {
      // Deselect class entirely so selectedMethodCategory is also cleared
      messageHandler({ command: 'selectDictionary', index: 2 });
      vi.mocked(commands.executeCommand).mockClear();

      messageHandler({ command: 'ctxRunMethodCategoryTests' });

      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'gemstone.runSunitMethodCategory',
        expect.anything(),
      );
    });
  });

  describe('method context menu', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      messageHandler({ command: 'selectMethod', selector: 'name' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('deletes method after confirmation', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue('Delete');

      messageHandler({ command: 'ctxDeleteMethod' });

      await vi.waitFor(() =>
        expect(queries.deleteMethod).toHaveBeenCalledWith(session, 'Array', false, 'name', 1),
      );
      // The class's mirror file is re-filed-out to reflect the removed method.
      expect(exportManager.syncClass).toHaveBeenCalledWith(session, 'UserGlobals', 'Array');
    });

    it('refreshes method list after deletion', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue('Delete');
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'ctxDeleteMethod' });

      await vi.waitFor(() =>
        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: 'loadMethodCategories' }),
        ),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethods' }),
      );
    });

    it('does not delete method when user cancels', async () => {
      vi.mocked(window.showWarningMessage).mockResolvedValue(undefined);
      messageHandler({ command: 'ctxDeleteMethod' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queries.deleteMethod).not.toHaveBeenCalled();
    });

    it('moves method to category', async () => {
      vi.mocked(queries.getMethodCategories).mockReturnValue([
        'Accessing',
        'Comparing',
        'Printing',
      ]);
      vi.mocked(window.showQuickPick).mockResolvedValue('Printing');

      messageHandler({ command: 'ctxMoveToCategory' });

      await vi.waitFor(() =>
        expect(queries.recategorizeMethod).toHaveBeenCalledWith(
          session,
          'Array',
          false,
          'name',
          'Printing',
          1,
        ),
      );
    });

    it('records the move, so the method can be put back in its old category (#434)', async () => {
      // A method slot's captured state carries its CATEGORY as well as its source, so the
      // ordinary method-edit reversal is all a category move needs.
      resetUndoStacks();
      vi.mocked(queries.getMethodCategories).mockReturnValue(['Accessing', 'Printing']);
      vi.mocked(window.showQuickPick).mockResolvedValue('Printing');
      let capture = 0;
      vi.mocked(captureMethodSlots).mockImplementation((_e, slots) => {
        capture += 1;
        return slots.map(() => ({
          exists: true,
          source: 'name\n\t^1',
          category: capture === 1 ? 'Accessing' : 'Printing',
        }));
      });

      messageHandler({ command: 'ctxMoveToCategory' });

      await vi.waitFor(() =>
        expect(peekUndoEntry(session.id)).toMatchObject({
          kind: 'methodEdit',
          label: "Move Array>>#name to 'Printing'",
        }),
      );
      const entry = peekUndoEntry(session.id);
      expect(entry?.kind === 'methodEdit' && entry.before[0].category).toBe('Accessing');
      expect(entry?.kind === 'methodEdit' && entry.after[0].category).toBe('Printing');
    });

    it('delegates run single test to command', () => {
      vi.mocked(commands.executeCommand).mockClear();

      messageHandler({ command: 'ctxRunMethodTests' });

      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.runSunitMethods',
        'UserGlobals',
        'Array',
        ['name'],
      );
    });

    it('does nothing for run single test when no method is selected', () => {
      messageHandler({ command: 'selectDictionary', index: 2 });
      vi.mocked(commands.executeCommand).mockClear();

      messageHandler({ command: 'ctxRunMethodTests' });

      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'gemstone.runSunitMethods',
        expect.anything(),
      );
    });

    it('delegates senders to command', () => {
      messageHandler({ command: 'ctxSendersOf' });
      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.sendersOfSelector', {
        selector: 'name',
        sessionId: 1,
      });
    });

    it('delegates implementors to command', () => {
      messageHandler({ command: 'ctxImplementorsOf' });
      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.implementorsOfSelector', {
        selector: 'name',
        sessionId: 1,
      });
    });

    it('delegates browse references to command', () => {
      messageHandler({ command: 'ctxBrowseReferences', name: 'Array' });
      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.browseReferences', {
        objectName: 'Array',
        sessionId: 1,
      });
    });

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('prompts for a selector and browses its senders', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('  printOn:  ');
      messageHandler({ command: 'ctxBrowseSendersOfString' });
      await flush();

      expect(commands.executeCommand).toHaveBeenCalledWith(
        'gemstone.sendersOfSelector',
        { selector: 'printOn:', sessionId: 1 }, // trimmed
      );
    });

    it('prompts for a selector and browses its implementors', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('at:put:');
      messageHandler({ command: 'ctxBrowseImplementorsOfString' });
      await flush();

      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.implementorsOfSelector', {
        selector: 'at:put:',
        sessionId: 1,
      });
    });

    it('prompts for a string and browses methods containing it', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue('asString');
      messageHandler({ command: 'ctxBrowseMethodsContaining' });
      await flush();

      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.searchMethodsFor', {
        term: 'asString',
        sessionId: 1,
      });
    });

    it('does nothing when the browse prompt is cancelled', async () => {
      vi.mocked(window.showInputBox).mockResolvedValue(undefined);
      messageHandler({ command: 'ctxBrowseSendersOfString' });
      await flush();

      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'gemstone.sendersOfSelector',
        expect.anything(),
      );
    });

    it('opens new method template below the browser', async () => {
      vi.mocked(workspace.openTextDocument).mockClear();
      vi.mocked(window.showTextDocument).mockClear();
      vi.mocked(commands.executeCommand).mockClear();
      messageHandler({ command: 'ctxNewMethod' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as {
        scheme: string;
        path: string;
      };
      expect(uri.scheme).toBe('gemstone');
      expect(uri.path).toContain('/new-method');
      expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.newGroupBelow');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: ViewColumn.Active, preview: true }),
      );
    });

    it('uses "as yet unclassified" for new method when ALL METHODS is selected', async () => {
      messageHandler({ command: 'selectMethodCategory', name: ALL_METHODS_CATEGORY });
      vi.mocked(workspace.openTextDocument).mockClear();
      messageHandler({ command: 'ctxNewMethod' });
      await vi.waitFor(() => {
        expect(workspace.openTextDocument).toHaveBeenCalled();
      });

      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { path: string };
      expect(uri.path).toContain('as yet unclassified');
      expect(uri.path).not.toContain('ALL METHODS');
    });
  });

  describe('move class to category / copy method to class', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      messageHandler({ command: 'selectMethod', selector: 'name' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('moves the class to the chosen category', async () => {
      vi.mocked(window.showQuickPick).mockResolvedValue('Collections');

      messageHandler({ command: 'ctxMoveClassToCategory' });
      await flush();

      expect(queries.recategorizeClass).toHaveBeenCalledWith(session, 'Array', 'Collections', 1);
      expect(exportManager.syncClass).toHaveBeenCalledWith(session, 'UserGlobals', 'Array');
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        "Moved Array to category 'Collections'.",
      );
    });

    it('offers the real class categories, excluding the "all classes" pseudo-entry', async () => {
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

      messageHandler({ command: 'ctxMoveClassToCategory' });
      await flush();

      const offered = vi.mocked(window.showQuickPick).mock.calls[0][0];
      expect(offered).toEqual(['Collections', 'Kernel']);
    });

    it('does nothing to the category when the quick pick is cancelled', async () => {
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

      messageHandler({ command: 'ctxMoveClassToCategory' });
      await flush();

      expect(queries.recategorizeClass).not.toHaveBeenCalled();
    });

    it('copies the selected method to the chosen class, preserving side and environment', async () => {
      vi.mocked(queries.getClassNames).mockReturnValue(['Array', 'Bag', 'Set']);
      vi.mocked(window.showQuickPick).mockResolvedValue('Set');

      messageHandler({ command: 'ctxCopyMethodToClass' });
      await flush();

      expect(queries.copyMethodToClass).toHaveBeenCalledWith(
        session,
        'Array',
        'Set',
        false,
        'name',
        0,
        1,
      );
      expect(exportManager.syncClass).toHaveBeenCalledWith(session, 'UserGlobals', 'Set');
      expect(window.showInformationMessage).toHaveBeenCalledWith('Copied #name to Set.');
    });

    it('excludes the source class from the copy targets', async () => {
      vi.mocked(queries.getClassNames).mockReturnValue(['Array', 'Bag', 'Set']);
      vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

      messageHandler({ command: 'ctxCopyMethodToClass' });
      await flush();

      expect(vi.mocked(window.showQuickPick).mock.calls[0][0]).toEqual(['Bag', 'Set']);
    });

    it('reports when there is no other class to copy to', async () => {
      vi.mocked(queries.getClassNames).mockReturnValue(['Array']);

      messageHandler({ command: 'ctxCopyMethodToClass' });
      await flush();

      expect(window.showQuickPick).not.toHaveBeenCalled();
      expect(queries.copyMethodToClass).not.toHaveBeenCalled();
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'No other classes in this dictionary to copy to.',
      );
    });
  });

  describe('GlobalsBrowser and ClassBrowser integration', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
    });

    it('opens GlobalsBrowser when a dictionary is selected', () => {
      expect(vi.mocked(GlobalsBrowser.showOrUpdate)).toHaveBeenCalledWith(
        session,
        'UserGlobals',
        1,
      );
    });

    it('opens ClassBrowser with null className when a dictionary is selected', () => {
      expect(vi.mocked(ClassBrowser.showOrUpdate)).toHaveBeenCalledWith(
        session,
        ['UserGlobals', 'Globals'],
        1,
        null,
      );
    });

    it('does not include ** GLOBALS ** in class categories', () => {
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: [ALL_CLASSES_CATEGORY, 'Collections', 'Kernel'],
        selected: ALL_CLASSES_CATEGORY,
      });
    });

    it('opens ClassBrowser with className when a class is selected', () => {
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(vi.mocked(ClassBrowser.showOrUpdate)).toHaveBeenCalledWith(
        session,
        ['UserGlobals', 'Globals'],
        1,
        'Array',
      );
    });

    it('opens the Comment tab after the definition, for the selected class and dictionary', async () => {
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();
      vi.mocked(CommentBrowser.showOrUpdate).mockClear();
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      messageHandler({ command: 'selectClass', name: 'Array' });

      // The comment is opened only after the definition resolves, so its tab sits
      // to the right — let the ClassBrowser→CommentBrowser chain flush first.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(vi.mocked(CommentBrowser.showOrUpdate)).toHaveBeenCalledWith(
        session,
        'UserGlobals',
        1,
        'Array',
        exportManager,
      );
      expect(vi.mocked(ClassBrowser.showOrUpdate).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(CommentBrowser.showOrUpdate).mock.invocationCallOrder[0],
      );
    });
  });

  describe('multi-environment', () => {
    beforeEach(() => {
      __setConfig('gemstone', 'maxEnvironment', 2);
      vi.mocked(queries.getClassEnvironments).mockReturnValue([
        { isMeta: false, envId: 0, category: 'Accessing', selectors: ['name', 'name:'] },
        { isMeta: false, envId: 0, category: 'Comparing', selectors: ['=', 'hash'] },
        { isMeta: false, envId: 1, category: 'Ruby', selectors: ['rb_name'] },
        { isMeta: true, envId: 0, category: 'Instance Creation', selectors: ['new', 'new:'] },
      ]);
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
    });

    afterEach(() => {
      __resetConfig();
    });

    it('sends setMaxEnvironment on ready when maxEnvironment > 0', () => {
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setMaxEnvironment',
        maxEnv: 2,
      });
    });

    it('does not send setMaxEnvironment when maxEnvironment is 0', () => {
      __setConfig('gemstone', 'maxEnvironment', 0);
      (SystemBrowser as unknown as { panels: Map<number, unknown> }).panels = new Map();
      SystemBrowser.show(makeSession(2, 'other'), exportManager);
      const otherHandler = vi.mocked(window.createWebviewPanel).mock.results.at(-1)!.value.webview
        .onDidReceiveMessage.mock.calls[0][0];
      otherHandler({ command: 'ready' });

      const calls = vi.mocked(window.createWebviewPanel).mock.results.at(-1)!.value.webview
        .postMessage.mock.calls;
      expect(
        calls.some((c: unknown[]) => (c[0] as { command: string }).command === 'setMaxEnvironment'),
      ).toBe(false);
    });

    it('passes maxEnvironment to getClassEnvironments', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 1, 'Array', 2);
    });

    it('shows env 0 method categories by default', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    it('switches to env 1 method categories on toggleEnvironment', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Ruby'],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    it('shows empty categories for environment with no methods', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 2 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    it('selects the "All classes" pseudo-category when no category was selected before environment toggle', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadMethodCategories',
          selected: ALL_METHODS_CATEGORY,
        }),
      );
    });

    it('preserves selected method category when it exists in the target environment', () => {
      vi.mocked(queries.getClassEnvironments).mockReturnValue([
        { isMeta: false, envId: 0, category: 'Accessing', selectors: ['name', 'name:'] },
        { isMeta: false, envId: 1, category: 'Accessing', selectors: ['rb_name'] },
      ]);
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethodCategories', selected: 'Accessing' }),
      );
    });

    it('selects the "All classes" pseudo-category when selected category does not exist in target environment', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadMethodCategories',
          selected: ALL_METHODS_CATEGORY,
        }),
      );
    });

    it('loads methods for the auto-selected category on environment toggle', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['rb_name'],
        methodOverrideBits: {},
        sessionMethodBits: {},
      });
    });

    it('resets env to 0 on refresh', () => {
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleEnvironment', envId: 1 });

      messageHandler({ command: 'refresh' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: ALL_METHODS_CATEGORY,
      });
    });
  });

  describe('static refresh', () => {
    it('refreshes the browser for a given session', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadDictionaries',
        items: ['UserGlobals', 'Globals'],
      });
    });

    it('restores dictionary and category selection after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'selectDictionaryItem',
        index: 1,
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClassCategories',
        items: expect.any(Array),
        selected: ALL_CLASSES_CATEGORY,
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: expect.any(Array),
      });
    });

    it('does nothing when no browser exists for the session', () => {
      // No browser has been created — should not throw
      SystemBrowser.refresh(999);
    });

    it('restores class selection after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadClasses',
        items: expect.any(Array),
        selected: 'Array',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethodCategories' }),
      );
    });

    it('restores class-side toggle after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'toggleSide', isMeta: true });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'setSide',
        isMeta: true,
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Instance Creation'],
        selected: ALL_METHODS_CATEGORY,
      });
    });

    it('restores method category selection after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: 'Accessing',
      });
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['name', 'name:'],
        methodOverrideBits: {},
        sessionMethodBits: {},
      });
    });

    it('does not restore class when it no longer exists after refresh', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      // After refresh, the class no longer exists
      vi.mocked(queries.getDictionaryEntries).mockReturnValue([
        { isClass: true, category: 'Kernel', name: 'Set' },
      ]);
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.refresh(session.id);

      // Should not try to select a class that no longer exists
      const calls = vi.mocked(mockPanel.webview.postMessage).mock.calls.map((c) => c[0]);
      const loadClassesCalls = calls.filter(
        (c: Record<string, unknown>) => c.command === 'loadClasses',
      );
      for (const call of loadClassesCalls) {
        expect((call as Record<string, unknown>).selected).toBeUndefined();
      }
      // Should not load method categories (no class selected)
      const postRefreshCalls = calls.filter(
        (c: Record<string, unknown>) => c.command === 'loadMethodCategories',
      );
      expect(postRefreshCalls).toHaveLength(0);
    });
  });

  describe('methodCompiled', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });
      messageHandler({ command: 'selectMethodCategory', name: 'Accessing' });
    });

    it('refreshes method categories after a method is compiled', () => {
      vi.mocked(queries.getClassEnvironments).mockClear();
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.methodCompiled(session.id, 'Array');

      expect(queries.getClassEnvironments).toHaveBeenCalledWith(session, 1, 'Array', 0);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethodCategories',
        items: [ALL_METHODS_CATEGORY, 'Accessing', 'Comparing'],
        selected: 'Accessing',
      });
    });

    it('refreshes the method list for the selected category', () => {
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.methodCompiled(session.id, 'Array');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadMethods',
        items: ['name', 'name:'],
        methodOverrideBits: {},
        sessionMethodBits: {},
      });
    });

    it('does nothing when the compiled class is not selected', () => {
      vi.mocked(queries.getClassEnvironments).mockClear();
      vi.mocked(mockPanel.webview.postMessage).mockClear();

      SystemBrowser.methodCompiled(session.id, 'String');

      expect(queries.getClassEnvironments).not.toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('does nothing when no browser exists for the session', () => {
      SystemBrowser.methodCompiled(999, 'Array');
    });
  });

  describe('navigateTo', () => {
    const result: queries.MethodSearchResult = {
      dictName: 'UserGlobals',
      className: 'Array',
      isMeta: false,
      category: 'Accessing',
      environmentId: 0,
      selector: 'name',
    };

    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' }); // populates state.dictionaries
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('returns false when no browser is open for the session', () => {
      expect(SystemBrowser.navigateTo(999, result)).toBe(false);
    });

    it('returns true when a browser is open for the session', () => {
      expect(SystemBrowser.navigateTo(session.id, result)).toBe(true);
    });

    it('reveals the panel with preserveFocus so the editor keeps focus', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.reveal).toHaveBeenCalledWith(undefined, true);
    });

    it('does nothing when the dictName is not in the loaded dictionaries', () => {
      const unknown = { ...result, dictName: 'UnknownDict' };
      SystemBrowser.navigateTo(session.id, unknown);
      expect(mockPanel.reveal).not.toHaveBeenCalled();
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('updates the panel title to the selected class', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.title).toBe('Browser: Array');
    });

    it('posts loadClasses with the selected class', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses', selected: 'Array' }),
      );
    });

    it("selects the method's own category, never a different one", () => {
      SystemBrowser.navigateTo(session.id, result);

      const categorySelections = vi
        .mocked(mockPanel.webview.postMessage)
        .mock.calls.map(([msg]) => msg as { command: string; selected?: string })
        .filter((m) => m.command === 'loadMethodCategories')
        .map((m) => m.selected ?? null);
      // FIXME: the leading `null` is a redundant render — applyClassSelection posts
      // the category list with no selection before the final post selects the
      // method's category. Fixing the double render is outside the scope of this
      // work and will be handled separately; drop the `null` here once it is.
      expect(categorySelections).toEqual([null, 'Accessing']);
    });

    it('posts loadMethods with the selected selector', () => {
      SystemBrowser.navigateTo(session.id, result);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethods', selected: 'name' }),
      );
    });

    it('opens the method in a gemstone:// preview tab', async () => {
      SystemBrowser.navigateTo(session.id, result);
      await vi.waitFor(() => expect(workspace.openTextDocument).toHaveBeenCalled());
      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as {
        scheme: string;
        path: string;
      };
      expect(uri.scheme).toBe('gemstone');
      expect(uri.path).toContain('/Array/instance/');
      expect(uri.path).toContain('/name');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preview: true }),
      );
    });

    it('uses class side in the URI when isMeta is true', async () => {
      const classSide = { ...result, isMeta: true, category: 'Instance Creation', selector: 'new' };
      SystemBrowser.navigateTo(session.id, classSide);
      await vi.waitFor(() => expect(workspace.openTextDocument).toHaveBeenCalled());
      const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { path: string };
      expect(uri.path).toContain('/class/');
    });

    // A result row carries the environment it was FOUND in, and a selector implemented in two
    // environments is two different methods. This is the path taken whenever a browser is
    // already open — the usual one — and it used to ignore the row's environment entirely and
    // open whatever the browser happened to have selected, i.e. the wrong method or none.
    describe('honouring the environment the row was found in', () => {
      const inEnv1: queries.MethodSearchResult = {
        dictName: 'UserGlobals',
        className: 'Array',
        isMeta: false,
        category: 'Ruby',
        environmentId: 1,
        selector: 'rb_name',
      };

      beforeEach(() => {
        __setConfig('gemstone', 'maxEnvironment', 2);
        vi.mocked(queries.getClassEnvironments).mockReturnValue([
          { isMeta: false, envId: 0, category: 'Accessing', selectors: ['name', 'name:'] },
          { isMeta: false, envId: 1, category: 'Ruby', selectors: ['rb_name'] },
          { isMeta: true, envId: 0, category: 'Instance Creation', selectors: ['new', 'new:'] },
        ]);
      });

      afterEach(() => {
        __resetConfig();
      });

      it("opens the row's environment, not the one the browser was showing", async () => {
        SystemBrowser.navigateTo(session.id, inEnv1);

        await vi.waitFor(() => expect(workspace.openTextDocument).toHaveBeenCalled());
        const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { query: string };
        expect(uri.query).toContain('env=1');
      });

      it('checks the matching environment control so the browser says where it is', () => {
        SystemBrowser.navigateTo(session.id, inEnv1);

        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
          command: 'setEnvironment',
          envId: 1,
        });
      });

      it("selects the row's category, which only exists in that environment", () => {
        SystemBrowser.navigateTo(session.id, inEnv1);

        expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: 'loadMethodCategories', selected: 'Ruby' }),
        );
      });

      it('leaves an environment-0 row opening environment 0, with no env in the URI', async () => {
        SystemBrowser.navigateTo(session.id, result);

        await vi.waitFor(() => expect(workspace.openTextDocument).toHaveBeenCalled());
        const uri = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as { query: string };
        expect(uri.query).not.toContain('env=');
      });
    });

    it('navigates only the most recently active browser', async () => {
      const firstPanel = mockPanel;
      // Open a second browser for the same session
      SystemBrowser.show(session, exportManager);
      const secondPanel = vi.mocked(window.createWebviewPanel).mock.results[1]
        .value as typeof mockPanel;
      messageHandler({ command: 'ready' });

      SystemBrowser.navigateTo(session.id, result);
      // First browser was created first so it is the default active target
      expect(firstPanel.reveal).toHaveBeenCalled();
      expect(secondPanel.reveal).not.toHaveBeenCalled();
    });

    // Regression: navigateTo previously updated the column-list state
    // inline (bypassing applyClassSelection), so the Class Definition panel
    // didn't refresh when an Implementors-of / Senders-of jump landed on
    // a different class. Now routed through applyClassSelection so the
    // Class Definition tracks the column-list selection.
    it('refreshes the Class Definition panel when the selected class changes', () => {
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();
      SystemBrowser.navigateTo(session.id, result);
      expect(ClassBrowser.showOrUpdate).toHaveBeenCalledWith(
        session,
        expect.any(Array),
        expect.any(Number),
        'Array',
      );
    });

    it('splits its own group below rather than adopting a gemstone editor it did not open', async () => {
      // A gemstone editor exists (e.g. the GemStone Explorer opened one to the
      // side), but this browser never opened it — so it must not land there.
      window.tabGroups.all = [
        {
          viewColumn: ViewColumn.Two,
          tabs: [
            {
              input: new TabInputText(
                Uri.parse(`gemstone://${session.id}/Globals/Other/instance/x/y`),
              ),
            },
          ],
        },
      ];
      vi.mocked(commands.executeCommand).mockClear();
      vi.mocked(window.showTextDocument).mockClear();

      SystemBrowser.navigateTo(session.id, result);
      await vi.waitFor(() => expect(window.showTextDocument).toHaveBeenCalled());

      expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.newGroupBelow');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: ViewColumn.Active }),
      );
      window.tabGroups.all = [];
    });

    it('splits a group below on first navigation, then reuses that same group for later methods', async () => {
      vi.mocked(commands.executeCommand).mockClear();
      vi.mocked(window.showTextDocument).mockClear();

      // First navigation: this browser has opened nothing yet → new group below.
      SystemBrowser.navigateTo(session.id, result);
      await vi.waitFor(() => expect(window.showTextDocument).toHaveBeenCalled());
      expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.newGroupBelow');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: ViewColumn.Active }),
      );

      // Simulate VS Code having placed THAT editor (the one we just opened) in a
      // new group at ViewColumn.Two.
      const openedUri = vi.mocked(workspace.openTextDocument).mock.calls[0][0];
      window.tabGroups.all = [
        {
          viewColumn: ViewColumn.Two,
          tabs: [{ input: new TabInputText(openedUri as never) }],
        },
      ];
      vi.mocked(commands.executeCommand).mockClear();
      vi.mocked(window.showTextDocument).mockClear();

      // Second navigation to a different method reuses our own group, no new split.
      const result2 = { ...result, category: 'Comparing', selector: '=' };
      SystemBrowser.navigateTo(session.id, result2);
      await vi.waitFor(() => expect(window.showTextDocument).toHaveBeenCalled());

      expect(commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.newGroupBelow');
      expect(window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ viewColumn: ViewColumn.Two }),
      );
      window.tabGroups.all = [];
    });
  });

  describe('navigateToClass', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' }); // dictionaries = ['UserGlobals', 'Globals']
      vi.mocked(ClassBrowser.showOrUpdate).mockClear();
    });

    it('opens the class in the exact SymbolList index given, not the first name match', () => {
      // Pass index 2 (Globals) explicitly; the definition opens scoped to it.
      SystemBrowser.navigateToClass(session.id, 'Globals', 'Array', 2);

      expect(ClassBrowser.showOrUpdate).toHaveBeenCalledWith(
        session,
        ['UserGlobals', 'Globals'],
        2,
        'Array',
      );
    });

    it('falls back to resolving the dictionary by name when no index is given', () => {
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');

      expect(ClassBrowser.showOrUpdate).toHaveBeenCalledWith(
        session,
        ['UserGlobals', 'Globals'],
        1,
        'Array',
      );
    });

    it('returns false when no browser is open for the session', () => {
      expect(SystemBrowser.navigateToClass(999, 'Globals', 'Array', 2)).toBe(false);
    });
  });

  describe('navigateBeside', () => {
    const result: queries.MethodSearchResult = {
      dictName: 'UserGlobals',
      className: 'Array',
      isMeta: false,
      category: 'Accessing',
      environmentId: 0,
      selector: 'name',
    };

    beforeEach(() => {
      SystemBrowser.setExportManager(exportManager);
    });

    it('does nothing when no export manager has been set', () => {
      (SystemBrowser as unknown as { sharedExportManager: unknown }).sharedExportManager =
        undefined;
      SystemBrowser.navigateBeside(session, result);
      expect(window.createWebviewPanel).not.toHaveBeenCalled();
    });

    it('selects all browser columns when the browser opens with pending navigation', () => {
      SystemBrowser.navigateBeside(session, result);
      // navigateBeside called show() internally — mockPanel and messageHandler now point to the new browser
      vi.mocked(mockPanel.webview.postMessage).mockClear();
      messageHandler({ command: 'ready' });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClassCategories', selected: ALL_CLASSES_CATEGORY }),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses', selected: 'Array' }),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethodCategories', selected: 'Accessing' }),
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadMethods', selected: 'name' }),
      );
      // setEditorLayout reorganizes ALL editor groups globally — calling it would clobber the enhanced inspector panel
      expect(commands.executeCommand).not.toHaveBeenCalledWith(
        'vscode.setEditorLayout',
        expect.anything(),
      );
    });

    it('navigates an existing browser directly without opening a new panel', () => {
      // Open a browser first so navigateBeside finds it
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      vi.mocked(window.createWebviewPanel).mockClear();

      SystemBrowser.navigateBeside(session, result);

      expect(window.createWebviewPanel).not.toHaveBeenCalled();
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses', selected: 'Array' }),
      );
    });
  });

  describe('navigateToClass updating the target panel', () => {
    beforeEach(() => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      vi.mocked(mockPanel.webview.postMessage).mockClear();
    });

    it('returns false when no browser is open for the session', () => {
      expect(SystemBrowser.navigateToClass(999, 'UserGlobals', 'Array')).toBe(false);
    });

    it('returns true when a browser is open for the session', () => {
      expect(SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array')).toBe(true);
    });

    it('reveals the panel with preserveFocus', () => {
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.reveal).toHaveBeenCalledWith(undefined, true);
    });

    it('does nothing when the dictName is not in the loaded dictionaries', () => {
      SystemBrowser.navigateToClass(session.id, 'UnknownDict', 'Array');
      expect(mockPanel.reveal).not.toHaveBeenCalled();
    });

    it('updates the panel title to the selected class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.title).toBe('Browser: Array');
    });

    it('posts loadClasses with the selected class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadClasses', selected: 'Array' }),
      );
    });

    it('auto-selects all methods so the Methods column fills', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadMethods',
          items: ['=', 'hash', 'name', 'name:'],
          methodOverrideBits: {},
        }),
      );
    });

    it('posts loadMethodCategories with all-methods pre-selected', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadMethodCategories',
          selected: ALL_METHODS_CATEGORY,
        }),
      );
    });

    it('keeps method override markers when navigating to a class', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(queries.getClassEnvironments).mockReturnValue([
        {
          isMeta: false,
          envId: 0,
          category: 'Accessing',
          selectors: ['name', 'name:'],
          methodOverrideBits: { name: 1 },
        },
        {
          isMeta: false,
          envId: 0,
          category: 'Comparing',
          selectors: ['=', 'hash'],
          methodOverrideBits: { '=': 3 },
        },
      ]);

      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');

      const calls = vi
        .mocked(mockPanel.webview.postMessage)
        .mock.calls.map(
          (c) => c[0] as { command: string; methodOverrideBits?: Record<string, number> },
        )
        .filter((m) => m.command === 'loadMethods');
      const last = calls[calls.length - 1];
      expect(last.methodOverrideBits).toEqual({ name: 1, '=': 3 });
    });

    it('navigates only the most recently active browser', () => {
      const firstPanel = mockPanel;
      SystemBrowser.show(session, exportManager);
      const secondPanel = vi.mocked(window.createWebviewPanel).mock.results[1]
        .value as typeof mockPanel;
      messageHandler({ command: 'ready' });

      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      // First browser was created first so it is the default active target
      expect(firstPanel.reveal).toHaveBeenCalled();
      expect(secondPanel.reveal).not.toHaveBeenCalled();
    });

    it('switches target when onDidChangeViewState fires on another browser', () => {
      const firstPanel = mockPanel;
      SystemBrowser.show(session, exportManager);
      const secondPanel = vi.mocked(window.createWebviewPanel).mock.results[1]
        .value as typeof mockPanel;
      messageHandler({ command: 'ready' });

      // Simulate the second panel becoming active
      const viewStateHandler = secondPanel.onDidChangeViewState.mock.calls[0][0] as (e: {
        webviewPanel: { active: boolean };
      }) => void;
      viewStateHandler({ webviewPanel: { active: true } });

      vi.mocked(fs.existsSync).mockReturnValue(false);
      SystemBrowser.navigateToClass(session.id, 'UserGlobals', 'Array');
      expect(secondPanel.reveal).toHaveBeenCalled();
      expect(firstPanel.reveal).not.toHaveBeenCalled();
    });
  });

  describe('getSelectedClassName', () => {
    it('returns null when no browser is open for the session', () => {
      expect(SystemBrowser.getSelectedClassName(999)).toBeNull();
    });

    it('returns null when no class is selected', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      expect(SystemBrowser.getSelectedClassName(session.id)).toBeNull();
    });

    it('returns the selected class and dictionary name', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      messageHandler({ command: 'selectDictionary', index: 1 });
      messageHandler({ command: 'selectCategory', name: ALL_CLASSES_CATEGORY });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      messageHandler({ command: 'selectClass', name: 'Array' });

      const result = SystemBrowser.getSelectedClassName(session.id);
      expect(result).toEqual({ dictName: 'UserGlobals', className: 'Array', dictIndex: 1 });
    });
  });

  describe('closing the browser closes its companion tabs', () => {
    it('closes the Globals/Comment webviews and gemstone editor tabs when the last browser closes', () => {
      SystemBrowser.show(session, exportManager);
      messageHandler({ command: 'ready' });
      const closeHandler = vi.mocked(mockPanel.onDidDispose).mock.calls[0][0] as () => void;
      const editorTab = {
        input: new TabInputText(Uri.parse(`gemstone://${session.id}/Globals/Array/definition`)),
      };
      window.tabGroups.all = [{ tabs: [editorTab] }];
      vi.mocked(GlobalsBrowser.disposeForSession).mockClear();
      vi.mocked(CommentBrowser.disposeForSession).mockClear();
      vi.mocked(window.tabGroups.close).mockClear();

      closeHandler(); // simulate the user closing the browser tab

      expect(GlobalsBrowser.disposeForSession).toHaveBeenCalledWith(session.id);
      expect(CommentBrowser.disposeForSession).toHaveBeenCalledWith(session.id);
      expect(window.tabGroups.close).toHaveBeenCalledWith([editorTab]);
      window.tabGroups.all = [];
    });

    it('leaves companion tabs alone while another browser for the session remains open', () => {
      SystemBrowser.show(session, exportManager);
      const firstPanel = mockPanel;
      SystemBrowser.show(session, exportManager); // second browser for the same session
      messageHandler({ command: 'ready' });
      vi.mocked(GlobalsBrowser.disposeForSession).mockClear();
      vi.mocked(CommentBrowser.disposeForSession).mockClear();

      const firstClose = vi.mocked(firstPanel.onDidDispose).mock.calls[0][0] as () => void;
      firstClose(); // close only the first browser

      expect(GlobalsBrowser.disposeForSession).not.toHaveBeenCalled();
      expect(CommentBrowser.disposeForSession).not.toHaveBeenCalled();
    });
  });
});
