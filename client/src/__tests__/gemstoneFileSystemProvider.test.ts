import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// Mock browserQueries
vi.mock('../browserQueries', () => ({
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(message: string, gciErrorNumber = 0) {
      super(message);
      this.gciErrorNumber = gciErrorNumber;
    }
  },
  getMethodSource: vi.fn(() => 'at: index\n  ^self basicAt: index'),
  getBaseMethodSource: vi.fn(() => 'isVowel\n  ^ base impl'),
  getClassDefinition: vi.fn(() => "Object subclass: 'Array'\n  instVarNames: #()"),
  getClassCategory: vi.fn(() => ''),
  classExistsInDictionary: vi.fn(() => false),
  recategorizeClass: vi.fn(),
  getClassComment: vi.fn(() => 'An ordered collection.'),
  compileMethod: vi.fn(() => 'Compiled: Array >> at:'),
  compileClassDefinition: vi.fn(),
  setClassComment: vi.fn(),
  canClassBeWritten: vi.fn(() => true),
  // Listing queries used by readDirectory (the breadcrumb drill-down).
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
  getClassNames: vi.fn(() => ['Array', 'OrderedCollection']),
  getMethodCategories: vi.fn(() => ['accessing', 'testing']),
  getMethodList: vi.fn(() => [
    { isMeta: false, category: 'accessing', selector: 'at:' },
    { isMeta: false, category: 'accessing', selector: 'at:put:' },
    { isMeta: false, category: 'testing', selector: 'isEmpty' },
    { isMeta: true, category: 'instance creation', selector: 'new' },
  ]),
}));

// Keep the real gciLog but spy logInfo so the recategorize soft-failure log is observable.
vi.mock('../gciLog', async (orig) => ({
  ...(await orig()),
  logInfo: vi.fn(),
}));

import {
  Uri,
  FilePermission,
  window,
  languages,
  TabInputText,
  TabInputTextDiff,
  FileChangeType,
} from '../__mocks__/vscode';
import { logInfo } from '../gciLog';
import {
  GemStoneFileSystemProvider,
  buildMethodUri,
  buildNewMethodUri,
  buildClassDefinitionUri,
  buildClassCommentUri,
  closeGemstoneTabsForSession,
  installStaleGemstoneTabReaper,
  escapeSelectorSlashes,
  parseUri,
  parseDirUri,
  parseMethodUri,
  isMethodEditorUri,
  listOpenGemstoneTabs,
} from '../gemstoneFileSystemProvider';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { BrowserQueryError } from '../browserQueries';
import type { ExportManager } from '../exportManager';

function makeSession(id = 1, gs_user = 'DataCurator') {
  return { id, gci: {}, handle: {}, login: { label: 'Test', gs_user }, stoneVersion: '3.7.2' };
}

function makeSessionManager(gs_user = 'DataCurator') {
  const session = makeSession(1, gs_user);
  return {
    getSessions: vi.fn(() => [session]),
    getSession: vi.fn((id: number) => (id === 1 ? session : undefined)),
  } as unknown as SessionManager;
}

describe('GemStoneFileSystemProvider', () => {
  let provider: GemStoneFileSystemProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GemStoneFileSystemProvider(makeSessionManager());
  });

  describe('notifyChanged', () => {
    it('announces a document the stone changed, so an open editor re-reads it', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/Widget/definition/Widget');
      const seen: unknown[] = [];
      provider.onDidChangeFile((events) => seen.push(...events));

      provider.notifyChanged(uri);

      expect(seen).toEqual([{ type: FileChangeType.Changed, uri }]);
    });
  });

  describe('stat', () => {
    it('returns a file stat', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.type).toBe(1); // FileType.File
      expect(stat.ctime).toBe(0);
      expect(stat.mtime).toBeGreaterThan(0);
    });

    it('does not permission-check method URIs — the save path is the source of truth', () => {
      provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('leaves method-source editors writable', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });

    it('leaves class-definition editors writable', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/definition'));
      expect(stat.permissions).toBeUndefined();
    });

    it('leaves class-comment editors writable', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/comment'));
      expect(stat.permissions).toBeUndefined();
    });

    it('returns read-only for an override-diff view URI', () => {
      const stat = provider.stat(
        Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A%20(base)?base=1'),
      );
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('always returns writable for new-class URIs without calling canClassBeWritten', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/UserGlobals/new-class'));
      expect(stat.permissions).toBeUndefined();
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('always returns writable for new-method URIs without calling canClassBeWritten', () => {
      const stat = provider.stat(
        Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method'),
      );
      expect(stat.permissions).toBeUndefined();
      expect(queries.canClassBeWritten).not.toHaveBeenCalled();
    });

    it('returns writable when session is not found', () => {
      const mgr = {
        getSessions: vi.fn(() => []),
        getSession: vi.fn(() => undefined),
      } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);
      const stat = p.stat(Uri.parse('gemstone://99/Globals/Array/instance/accessing/at%3A'));
      expect(stat.permissions).toBeUndefined();
    });
  });

  describe('parseDirUri (breadcrumb drill-down classification)', () => {
    it('classifies the session root as the dictionary list', () => {
      expect(parseDirUri(Uri.parse('gemstone://1/'))?.kind).toBe('root');
      expect(parseDirUri(Uri.parse('gemstone://1'))?.kind).toBe('root');
    });

    it('classifies a dictionary, a class, a side, and a category', () => {
      expect(parseDirUri(Uri.parse('gemstone://1/Globals'))).toMatchObject({
        kind: 'dict',
        dictName: 'Globals',
      });
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array'))).toMatchObject({
        kind: 'class',
        className: 'Array',
      });
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array/instance'))).toMatchObject({
        kind: 'side',
        isMeta: false,
      });
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array/class'))).toMatchObject({
        kind: 'side',
        isMeta: true,
      });
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array/instance/accessing'))).toMatchObject(
        {
          kind: 'category',
          category: 'accessing',
          isMeta: false,
        },
      );
    });

    it('carries the ?dict index into deeper levels for scoped lookups', () => {
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array?dict=7'))).toMatchObject({
        kind: 'class',
        className: 'Array',
        dictIndex: 7,
      });
    });

    it('does NOT classify real files as directories', () => {
      // method, definition, comment, new-class, new-method are files parseUri owns
      expect(
        parseDirUri(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A')),
      ).toBeNull();
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array/definition'))).toBeNull();
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array/comment'))).toBeNull();
      expect(parseDirUri(Uri.parse('gemstone://1/UserGlobals/new-class'))).toBeNull();
      expect(
        parseDirUri(Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method')),
      ).toBeNull();
      // The 5-segment definition/comment display variants stay files too.
      expect(parseDirUri(Uri.parse('gemstone://1/Globals/Array/definition/Array'))).toBeNull();
    });

    it('ignores non-gemstone schemes', () => {
      expect(parseDirUri(Uri.parse('file:///Globals/Array'))).toBeNull();
    });
  });

  describe('stat (directory levels)', () => {
    it('reports a read-only Directory for an intermediate breadcrumb URI', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance'));
      expect(stat.type).toBe(2); // FileType.Directory
      expect(stat.permissions).toBe(FilePermission.Readonly);
    });

    it('still reports a File for a method URI', () => {
      const stat = provider.stat(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'));
      expect(stat.type).toBe(1); // FileType.File
    });
  });

  describe('readDirectory (breadcrumb drill-down listing)', () => {
    it('lists dictionaries at the root', () => {
      const entries = provider.readDirectory(Uri.parse('gemstone://1/'));
      expect(entries).toEqual([
        ['UserGlobals', 2],
        ['Globals', 2],
      ]);
    });

    it('lists classes in a dictionary', () => {
      const entries = provider.readDirectory(Uri.parse('gemstone://1/Globals'));
      expect(entries).toEqual([
        ['Array', 2],
        ['OrderedCollection', 2],
      ]);
    });

    it('lists the two sides plus the class definition under a class', () => {
      const entries = provider.readDirectory(Uri.parse('gemstone://1/Globals/Array'));
      expect(entries).toEqual([
        ['instance', 2],
        ['class', 2],
        ['definition', 1],
      ]);
    });

    it('lists method categories under a side', () => {
      const entries = provider.readDirectory(Uri.parse('gemstone://1/Globals/Array/instance'));
      expect(entries).toEqual([
        ['accessing', 2],
        ['testing', 2],
      ]);
    });

    it('lists only the selectors of the matching side and category', () => {
      const entries = provider.readDirectory(
        Uri.parse('gemstone://1/Globals/Array/instance/accessing'),
      );
      expect(entries).toEqual([
        ['at:', 1],
        ['at:put:', 1],
      ]);
    });

    it('escapes slashes in binary selectors so they survive the URI path', () => {
      vi.mocked(queries.getMethodList).mockReturnValueOnce([
        { isMeta: false, category: 'arithmetic', selector: '/' },
      ]);
      const entries = provider.readDirectory(
        Uri.parse('gemstone://1/Globals/Number/instance/arithmetic'),
      );
      expect(entries).toEqual([[escapeSelectorSlashes('/'), 1]]);
      expect(entries[0][0]).not.toContain('/');
    });

    it('returns an empty listing when a query throws (no broken breadcrumb)', () => {
      vi.mocked(queries.getClassNames).mockImplementationOnce(() => {
        throw new BrowserQueryError('session busy');
      });
      expect(provider.readDirectory(Uri.parse('gemstone://1/Globals'))).toEqual([]);
    });

    it('returns an empty listing for a dead session without reaping tabs', () => {
      const mgr = {
        getSessions: vi.fn(() => []),
        getSession: vi.fn(() => undefined),
      } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);
      expect(p.readDirectory(Uri.parse('gemstone://99/Globals'))).toEqual([]);
    });
  });

  describe('readFile', () => {
    it('reads a method source', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toBe('at: index\n  ^self basicAt: index');
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'Array',
        false,
        'at:',
        0,
        'Globals',
      );
    });

    it('reads a class-side method source', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        true,
        'new:',
        0,
        'Globals',
      );
    });

    it('reads a method source with environment from query param', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/python/__len__?env=2');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        false,
        '__len__',
        2,
        'Globals',
      );
    });

    it('reads the persistent base source for a ?base=1 method URI', () => {
      const uri = Uri.parse('gemstone://1/Globals/Character/instance/converting/isVowel?base=1');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(queries.getBaseMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Character',
        false,
        'isVowel',
        0,
        'Globals',
      );
      expect(queries.getMethodSource).not.toHaveBeenCalled();
      expect(content).toContain('base impl');
    });

    it('reads the session/merged source (not base) for a plain method URI', () => {
      const uri = Uri.parse('gemstone://1/Globals/Character/instance/converting/isVowel');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalled();
      expect(queries.getBaseMethodSource).not.toHaveBeenCalled();
    });

    it('strips the " (base)" diff label to recover the real selector', () => {
      const uri = Uri.parse(
        'gemstone://1/Globals/Character/instance/converting/isVowel%20(base)?base=1',
      );
      provider.readFile(uri);
      expect(queries.getBaseMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Character',
        false,
        'isVowel',
        0,
        'Globals',
      );
    });

    it('strips the " (session override)" diff label to recover the real selector', () => {
      const uri = Uri.parse(
        'gemstone://1/Globals/Character/instance/converting/isVowel%20(session%20override)',
      );
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Character',
        false,
        'isVowel',
        0,
        'Globals',
      );
    });

    it('recovers a binary selector containing a slash', () => {
      const uri = Uri.parse(
        `gemstone://1/Globals/FileReference/instance/accessing/${encodeURIComponent('/')}`,
      );
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'FileReference',
        false,
        '/',
        0,
        'Globals',
      );
    });

    it('recovers a binary selector made only of slashes', () => {
      const uri = Uri.parse(
        `gemstone://1/Globals/Number/instance/arithmetic/${encodeURIComponent('//')}`,
      );
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Number',
        false,
        '//',
        0,
        'Globals',
      );
    });

    it('recovers a slash selector escaped with the sentinel (the real open path)', () => {
      const seg = encodeURIComponent(escapeSelectorSlashes('/'));
      const uri = Uri.parse(`gemstone://1/Globals/FileReference/class/cross%20platform/${seg}`);
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'FileReference',
        true,
        '/',
        0,
        'Globals',
      );
    });

    it('reads a class definition, scoped to the dictionary (name fallback when no ?dict)', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("Object subclass: 'Array'");
      expect(queries.getClassDefinition).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        'Globals',
      );
    });

    it('scopes a class definition to the SymbolList index given by ?dict', () => {
      provider.readFile(Uri.parse('gemstone://1/Globals/Array/definition?dict=9'));
      expect(queries.getClassDefinition).toHaveBeenCalledWith(expect.anything(), 'Array', 9);
    });

    it('reads a class comment, scoped to the dictionary', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/comment');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toBe('An ordered collection.');
      expect(queries.getClassComment).toHaveBeenCalledWith(expect.anything(), 'Array', 'Globals');
    });

    it('returns new-class template with dictionary name', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("Object subclass: 'NameOfClass'");
      expect(content).toContain('inDictionary: UserGlobals');
    });

    it('new-class template always includes an editable category line, defaulting to User Classes when none was selected', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("category: 'User Classes'\n  options: #()");
    });

    it('new-class template pre-fills the selected category when one was passed', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class?category=Kernel-Numbers');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain("category: 'Kernel-Numbers'\n  options: #()");
    });

    it('returns new-method template', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const content = new TextDecoder().decode(provider.readFile(uri));
      expect(content).toContain('messageSelector');
      expect(content).toContain('"comment"');
    });

    it('throws FileNotFound for invalid URI', () => {
      const uri = Uri.parse('gemstone://1/too/few');
      expect(() => provider.readFile(uri)).toThrow();
    });
  });

  describe('writeFile', () => {
    const encode = (s: string) => new TextEncoder().encode(s);

    it('compiles a method on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), {
        create: false,
        overwrite: true,
      });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        false,
        'accessing',
        'at: index\n  ^self basicAt: index',
        0,
        'Globals',
      );
    });

    it('compiles a method with environment on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/python/__len__?env=1');
      provider.writeFile(uri, encode('__len__\n  ^self size'), { create: false, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        false,
        'python',
        '__len__\n  ^self size',
        1,
        'Globals',
      );
    });

    it('confirms a method compile when the class is writable', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');

      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), {
        create: false,
        overwrite: true,
      });

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Compiled method'),
      );
    });

    it('warns that the save did not persist when a method compiles into a non-writable class', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValueOnce(false);
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');

      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), {
        create: false,
        overwrite: true,
      });

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('NOT persisted'),
      );
      expect(window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('compiles a class definition on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      const source = "Object subclass: 'Array'\n  instVarNames: #()";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
      provider.writeFile(uri, encode(source), { create: false, overwrite: true });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(expect.anything(), source);
    });

    it('warns that the save did not persist when an existing class definition recompiles transiently', () => {
      vi.mocked(queries.canClassBeWritten).mockReturnValueOnce(false);
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');

      provider.writeFile(uri, encode("Object subclass: 'Array'\n  instVarNames: #()"), {
        create: false,
        overwrite: true,
      });

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('NOT persisted'),
      );
    });

    it('sets class comment on save, scoped to the dictionary', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/comment?dict=9');
      provider.writeFile(uri, encode('Updated comment'), { create: false, overwrite: true });
      expect(queries.setClassComment).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        'Updated comment',
        9,
      );
    });

    it('compiles new-class on save', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(expect.anything(), source);
    });

    it('shows a success message with the class name when new-class compiles', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');

      provider.writeFile(uri, encode("Object subclass: 'MyClass'"), {
        create: true,
        overwrite: true,
      });

      expect(window.showInformationMessage).toHaveBeenCalledWith('Class created: MyClass');
    });

    it('emits onClassDefinitionCompiled when new-class compiles successfully', async () => {
      const newClassUri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(newClassUri, encode(source), { create: true, overwrite: true });
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousUri.toString()).toBe(newClassUri.toString());
      expect(event.uri.toString()).toBe('gemstone://1/UserGlobals/MyClass/definition/MyClass');
      expect(event.previousUriIsTemplate).toBe(true);
    });

    it('fires onDidChangeFile with the new-class uri on successful compile', () => {
      const newClassUri = Uri.parse('gemstone://1/UserGlobals/new-class');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      provider.writeFile(newClassUri, encode("Object subclass: 'MyClass'"), {
        create: true,
        overwrite: true,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 1, uri: newClassUri })]),
      );
    });

    it('does not fire onClassDefinitionCompiled and sets a diagnostic when new-class compilation throws', async () => {
      const newClassUri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals";
      vi.mocked(queries.compileClassDefinition).mockImplementationOnce(() => {
        throw new BrowserQueryError('Class not found', 0);
      });
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      expect(() =>
        provider.writeFile(newClassUri, encode(source), { create: true, overwrite: true }),
      ).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).not.toHaveBeenCalled();
      const collection = vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
      expect(collection.set).toHaveBeenCalledWith(
        newClassUri,
        expect.arrayContaining([expect.objectContaining({ message: 'Class not found' })]),
      );
    });

    it('shows the class category on its own line (Class>>definition omits it)', () => {
      vi.mocked(queries.getClassDefinition).mockReturnValueOnce(
        "Object subclass: 'Array'\n  inDictionary: Globals\n  options: #()",
      );
      vi.mocked(queries.getClassCategory).mockReturnValueOnce('Collections-Ordered');

      const content = new TextDecoder().decode(
        provider.readFile(Uri.parse('gemstone://1/Globals/Array/definition')),
      );

      expect(content).toContain("category: 'Collections-Ordered'\n  options: #()");
      expect(queries.getClassCategory).toHaveBeenCalledWith(expect.anything(), 'Array', 'Globals');
    });

    it('strips the category line before compiling and applies it via recategorizeClass', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source =
        "Object subclass: 'MyClass'\n  inDictionary: UserGlobals\n  category: 'User Classes'\n  options: #()";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');

      provider.writeFile(uri, encode(source), { create: true, overwrite: true });

      // The compiled source must NOT carry a category: keyword — no base image has
      // the 8-keyword subclass:…category:options: selector.
      const compiledSource = vi.mocked(queries.compileClassDefinition).mock.calls[0][1];
      expect(compiledSource).not.toContain('category:');
      expect(queries.recategorizeClass).toHaveBeenCalledWith(
        expect.anything(),
        'MyClass',
        'User Classes',
        'UserGlobals',
      );
    });

    it('clears the category (recategorize with empty) when the category line is removed', () => {
      // The editor always shows a category: line; deleting it is how the user clears
      // the category. An absent line must still recategorize (to ''), not be skipped.
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source = "Object subclass: 'MyClass'\n  inDictionary: UserGlobals\n  options: #()";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      vi.mocked(queries.recategorizeClass).mockReturnValueOnce('Recategorized: MyClass');

      provider.writeFile(uri, encode(source), { create: true, overwrite: true });

      expect(queries.recategorizeClass).toHaveBeenCalledWith(
        expect.anything(),
        'MyClass',
        '',
        expect.anything(),
      );
    });

    it('logs a recategorize soft-failure (returned status) and still reports the save succeeded', () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      const source =
        "Object subclass: 'MyClass'\n  inDictionary: UserGlobals\n  category: 'Widgets'\n  options: #()";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('MyClass');
      // recategorizeClass reports a soft failure by RETURNING (not throwing).
      vi.mocked(queries.recategorizeClass).mockReturnValueOnce('Class not found: MyClass');

      provider.writeFile(uri, encode(source), { create: true, overwrite: true });

      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('did not apply'));
      // The soft failure must not block the class creation.
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Class created'),
      );
    });

    it('targets the dictionary named by inDictionary:, not the selected one, for a new class', async () => {
      // URI dictionary is Globals (the selected one), but the definition names
      // UserGlobals — the class is created there, so the existence check,
      // recategorize, and reopened definition tab must all target UserGlobals.
      const uri = Uri.parse('gemstone://1/Globals/new-class');
      const source =
        "Object subclass: 'Fnoodle'\n  inDictionary: UserGlobals\n  category: 'Collections-Internals'\n  options: #()";
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Fnoodle');
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      await new Promise((resolve) => setImmediate(resolve));

      expect(queries.classExistsInDictionary).toHaveBeenCalledWith(
        expect.anything(),
        'Fnoodle',
        'UserGlobals',
      );
      expect(queries.recategorizeClass).toHaveBeenCalledWith(
        expect.anything(),
        'Fnoodle',
        'Collections-Internals',
        'UserGlobals',
      );
      const firedUri: Uri = listener.mock.calls[0][0].uri;
      expect(firedUri.path).toBe('/UserGlobals/Fnoodle/definition/Fnoodle');
    });

    it('refuses a new-class save that would overwrite an existing class in the dictionary', async () => {
      const uri = Uri.parse('gemstone://1/UserGlobals/new-class');
      vi.mocked(queries.classExistsInDictionary).mockReturnValueOnce(true);
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(uri, encode("Object subclass: 'Existing'\n  inDictionary: UserGlobals"), {
        create: true,
        overwrite: true,
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(queries.compileClassDefinition).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      const collection = vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
      expect(collection.set).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('already exists') }),
        ]),
      );
    });

    it('shows a success message with the class name when an existing class definition is saved', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');

      provider.writeFile(uri, encode("Object subclass: 'Array'\n  instVarNames: #()"), {
        create: false,
        overwrite: true,
      });

      expect(window.showInformationMessage).toHaveBeenCalledWith(
        'Class definition updated for Array',
      );
    });

    it('emits onClassDefinitionCompiled when an existing class definition is saved with unchanged name', async () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(uri, encode("Object subclass: 'Array'\n  instVarNames: #()"), {
        create: false,
        overwrite: true,
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousUriIsTemplate).toBe(false);
      // The reopened definition URI repeats the class name so the tab shows it.
      expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/definition/Array');
      expect(event.previousUri.toString()).toBe(uri.toString());
    });

    it('emits onClassDefinitionCompiled with the new uri when an existing class definition is saved with a changed name', async () => {
      const previousUri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('RenamedArray');
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      provider.writeFile(
        previousUri,
        encode("Object subclass: 'RenamedArray'\n  instVarNames: #()"),
        { create: false, overwrite: true },
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousUriIsTemplate).toBe(false);
      expect(event.previousUri.toString()).toBe(previousUri.toString());
      expect(event.uri.toString()).toBe(
        'gemstone://1/Globals/RenamedArray/definition/RenamedArray',
      );
    });

    it('does not fire onClassDefinitionCompiled and sets a diagnostic when an existing class definition save throws', async () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error', 0);
      });
      const listener = vi.fn();
      provider.onClassDefinitionCompiled(listener);

      expect(() =>
        provider.writeFile(uri, encode("Object subclass: 'Array'"), {
          create: false,
          overwrite: true,
        }),
      ).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).not.toHaveBeenCalled();
      const collection = vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
      expect(collection.set).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([expect.objectContaining({ message: 'Syntax error' })]),
      );
    });

    it('fires onDidChangeFile with the definition uri on successful compile', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/definition');
      vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      provider.writeFile(uri, encode("Object subclass: 'Array'\n  instVarNames: #()"), {
        create: false,
        overwrite: true,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 1, uri })]),
      );
    });

    describe('mirror sync after save', () => {
      const makeExportManager = () => ({
        syncClass: vi.fn(() => Promise.resolve()),
        scheduleRefresh: vi.fn(),
      });

      it('re-files-out the edited class after a method save', () => {
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(
          makeSessionManager(),
          em as unknown as ExportManager,
        );
        p.writeFile(
          Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'),
          encode('at: i\n  ^self basicAt: i'),
          { create: false, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1 }),
          'Globals',
          'Array',
        );
      });

      it('syncs the compiled class name after a definition save with unchanged name', () => {
        vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Array');
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(
          makeSessionManager(),
          em as unknown as ExportManager,
        );
        p.writeFile(
          Uri.parse('gemstone://1/Globals/Array/definition'),
          encode("Object subclass: 'Array'\n  instVarNames: #()"),
          { create: false, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1 }),
          'Globals',
          'Array',
        );
      });

      it('syncs the new class name after a definition save that renames the class', () => {
        vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('RenamedArray');
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(
          makeSessionManager(),
          em as unknown as ExportManager,
        );
        p.writeFile(
          Uri.parse('gemstone://1/Globals/Array/definition'),
          encode("Object subclass: 'RenamedArray'\n  instVarNames: #()"),
          { create: false, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1 }),
          'Globals',
          'RenamedArray',
        );
      });

      it('syncs the compiled class name after a new-class save', () => {
        vi.mocked(queries.compileClassDefinition).mockReturnValueOnce('Foo');
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(
          makeSessionManager(),
          em as unknown as ExportManager,
        );
        p.writeFile(
          Uri.parse('gemstone://1/UserGlobals/new-class'),
          encode("Object subclass: 'Foo'\n  inDictionary: UserGlobals"),
          { create: true, overwrite: true },
        );
        expect(em.syncClass).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1 }),
          'UserGlobals',
          'Foo',
        );
      });

      it('does not call syncClass when new-class compilation throws', () => {
        vi.mocked(queries.compileClassDefinition).mockImplementationOnce(() => {
          throw new BrowserQueryError('Syntax error', 0);
        });
        const em = makeExportManager();
        const p = new GemStoneFileSystemProvider(
          makeSessionManager(),
          em as unknown as ExportManager,
        );
        expect(() =>
          p.writeFile(
            Uri.parse('gemstone://1/UserGlobals/new-class'),
            encode("Object subclass: 'MyClass'\n  inDictionary: UserGlobals"),
            { create: true, overwrite: true },
          ),
        ).not.toThrow();
        expect(em.syncClass).not.toHaveBeenCalled();
      });

      it('does not throw when no export manager is wired', () => {
        const p = new GemStoneFileSystemProvider(makeSessionManager());
        expect(() =>
          p.writeFile(
            Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A'),
            encode('at: i\n  ^1'),
            { create: false, overwrite: true },
          ),
        ).not.toThrow();
      });
    });

    it('compiles new-method on save', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const source = 'foo\n  ^42';
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');
      provider.writeFile(uri, encode(source), { create: true, overwrite: true });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        false,
        'accessing',
        source,
        0,
        'Globals',
      );
    });

    it('emits onMethodCompiled event when new-method compiles successfully', async () => {
      const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const source = 'foo\n  ^42';
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');
      const listener = vi.fn();
      provider.onMethodCompiled(listener);

      provider.writeFile(newMethodUri, encode(source), { create: true, overwrite: true });
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousUri.toString()).toBe(newMethodUri.toString());
      expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
      expect(event.previousUriIsTemplate).toBe(true);
    });

    it('emits onMethodCompiled when an existing method is saved with unchanged selector', async () => {
      const methodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> at:');
      const listener = vi.fn();
      provider.onMethodCompiled(listener);

      provider.writeFile(methodUri, encode('at: i\n  ^self basicAt: i'), {
        create: false,
        overwrite: true,
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousUriIsTemplate).toBe(false);
      expect(event.uri.toString()).toBe(methodUri.toString());
      expect(event.previousUri.toString()).toBe(methodUri.toString());
    });

    it('emits onMethodCompiled when an existing method is saved with a changed selector', async () => {
      const previousUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> newSelector');
      const listener = vi.fn();
      provider.onMethodCompiled(listener);

      provider.writeFile(previousUri, encode('newSelector\n  ^42'), {
        create: false,
        overwrite: true,
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0];
      expect(event.previousUriIsTemplate).toBe(false);
      expect(event.previousUri.toString()).toBe(previousUri.toString());
      expect(event.uri.toString()).toBe(
        'gemstone://1/Globals/Array/instance/accessing/newSelector',
      );
    });

    it('trims trailing whitespace from the selector when building the compiled method uri', async () => {
      const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo ');
      const listener = vi.fn();
      provider.onMethodCompiled(listener);

      provider.writeFile(newMethodUri, encode('foo\n  ^42'), { create: true, overwrite: true });
      await new Promise((resolve) => setImmediate(resolve));

      const event = listener.mock.calls[0][0];
      expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
    });

    it('trims leading whitespace from the selector when building the compiled method uri', async () => {
      const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >>  foo');
      const listener = vi.fn();
      provider.onMethodCompiled(listener);

      provider.writeFile(newMethodUri, encode('foo\n  ^42'), { create: true, overwrite: true });
      await new Promise((resolve) => setImmediate(resolve));

      const event = listener.mock.calls[0][0];
      expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
    });

    it('does not fire onMethodCompiled after dispose', async () => {
      const newMethodUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');
      const listener = vi.fn();
      provider.onMethodCompiled(listener);

      provider.dispose();
      provider.writeFile(newMethodUri, encode('foo\n  ^42'), { create: true, overwrite: true });
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).not.toHaveBeenCalled();
    });

    it('sets diagnostic (no throw) when new-method compile result cannot extract selector', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const source = 'foo\n  ^42';
      const listener = vi.fn();
      provider.onMethodCompiled(listener);
      vi.mocked(queries.compileMethod).mockReturnValueOnce('Class not found: Array');

      expect(() =>
        provider.writeFile(uri, encode(source), { create: true, overwrite: true }),
      ).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
      const collection = vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
      expect(collection.set).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([expect.objectContaining({ message: 'Class not found: Array' })]),
      );
    });

    it('shows success message after compiling a method', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: i\n  ^self basicAt: i'), {
        create: false,
        overwrite: true,
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Compiled method Array>>#at:'),
      );
    });

    it('shows success message for class-side method compilation', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.writeFile(uri, encode('new: size\n  ^self basicNew: size'), {
        create: false,
        overwrite: true,
      });
      expect(queries.compileMethod).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        true,
        'creation',
        'new: size\n  ^self basicNew: size',
        0,
        'Globals',
      );
    });

    it('fires onDidChangeFile event on success', () => {
      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: i\n  ^self basicAt: i'), {
        create: false,
        overwrite: true,
      });

      expect(listener).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 1, uri })]),
      );
    });
  });

  describe('writeFile diagnostics', () => {
    const encode = (s: string) => new TextEncoder().encode(s);

    function getDiagCollection() {
      // The provider creates the collection during field initialization (constructor),
      // which runs after vi.clearAllMocks() in the outer beforeEach.
      return vi.mocked(languages.createDiagnosticCollection).mock.results[0].value;
    }

    it('does not throw on BrowserQueryError — shows diagnostic instead', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error near line 3, column 5', 100);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      expect(() => {
        provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });
      }).not.toThrow();
    });

    it('sets a diagnostic on compile failure', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Syntax error near line 3, column 5', 100);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      expect(collection.set).toHaveBeenCalledWith(
        uri,
        expect.arrayContaining([
          expect.objectContaining({ message: 'Syntax error near line 3, column 5' }),
        ]),
      );
    });

    it('parses line number from error message for the diagnostic range', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Error at line 5: unexpected token', 0);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      const [[, diags]] = (collection.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(diags[0].range.start.line).toBe(4); // line 5 → 0-indexed = 4
    });

    it('uses line 0 when no line number in the error message', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new BrowserQueryError('Generic compile error', 0);
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });

      const collection = getDiagCollection();
      const [[, diags]] = (collection.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(diags[0].range.start.line).toBe(0);
    });

    it('clears diagnostics on successful compile', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      provider.writeFile(uri, encode('at: index\n  ^self basicAt: index'), {
        create: false,
        overwrite: true,
      });

      const collection = getDiagCollection();
      expect(collection.delete).toHaveBeenCalledWith(uri);
      expect(collection.set).not.toHaveBeenCalled();
    });

    it('rethrows non-BrowserQueryError exceptions', () => {
      vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
        throw new Error('Unexpected internal error');
      });
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
      expect(() => {
        provider.writeFile(uri, encode('bad code'), { create: false, overwrite: true });
      }).toThrow('Unexpected internal error');
    });
  });

  describe('session lookup', () => {
    it('throws Unavailable when session is gone', () => {
      const mgr = {
        getSessions: vi.fn(() => []),
        getSession: vi.fn(() => undefined),
      } as unknown as SessionManager;
      const p = new GemStoneFileSystemProvider(mgr);
      const uri = Uri.parse('gemstone://99/Globals/Array/definition');
      expect(() => p.readFile(uri)).toThrow();
    });
  });

  describe('URI parsing', () => {
    it('parses method URI with special characters', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3Aput%3A');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        false,
        'at:put:',
        0,
        'Globals',
      );
    });

    it('parses class side correctly', () => {
      const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A');
      provider.readFile(uri);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        true,
        'new:',
        0,
        'Globals',
      );
    });

    it('distinguishes new-method from regular method', () => {
      // new-method URI
      const uri1 = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');
      const content1 = new TextDecoder().decode(provider.readFile(uri1));
      expect(content1).toContain('messageSelector');

      // regular method called "size"
      const uri2 = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size');
      provider.readFile(uri2);
      expect(queries.getMethodSource).toHaveBeenCalledWith(
        expect.anything(),
        'Array',
        false,
        'size',
        0,
        'Globals',
      );
    });
  });
});

describe('parseMethodUri', () => {
  it('returns the method coordinates for a saved method source', () => {
    const uri = Uri.parse('gemstone://1/Globals/Array/class/creation/new%3A?env=2');

    expect(parseMethodUri(uri)).toEqual({
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: true,
      selector: 'new:',
      environmentId: 2,
      dictIndex: undefined,
      diffView: false,
    });
  });

  it('recovers a selector that contains slashes rather than truncating at the first segment', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Fraction',
      isMeta: false,
      category: 'arithmetic',
      selector: '/',
      environmentId: 0,
    });

    expect(parseMethodUri(uri)?.selector).toBe('/');
  });

  it('strips the base/session-override diff label and marks the view read-only', () => {
    const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/size%20%28base%29');

    const ref = parseMethodUri(uri);

    expect(ref?.selector).toBe('size');
    expect(ref?.diffView).toBe(true);
  });

  it('rejects a new-method template URI', () => {
    const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method');

    expect(parseMethodUri(uri)).toBeNull();
  });

  it('rejects a class-definition URI', () => {
    const uri = Uri.parse('gemstone://1/Globals/Array/definition');

    expect(parseMethodUri(uri)).toBeNull();
  });

  it('rejects a non-gemstone URI', () => {
    expect(parseMethodUri(Uri.parse('file:///tmp/x.st'))).toBeNull();
  });
});

describe('isMethodEditorUri', () => {
  it('is true for a method source editor', () => {
    expect(
      isMethodEditorUri(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A')),
    ).toBe(true);
  });

  it('is false for a class-definition, comment, or new-method editor', () => {
    expect(isMethodEditorUri(Uri.parse('gemstone://1/Globals/Array/definition'))).toBe(false);
    expect(isMethodEditorUri(Uri.parse('gemstone://1/Globals/Array/comment'))).toBe(false);
    expect(
      isMethodEditorUri(Uri.parse('gemstone://1/Globals/Array/instance/accessing/new-method')),
    ).toBe(false);
  });

  it('is false for a non-gemstone document and for no editor', () => {
    expect(isMethodEditorUri(Uri.parse('file:///tmp/x.st'))).toBe(false);
    expect(isMethodEditorUri(undefined)).toBe(false);
  });
});

describe('buildMethodUri', () => {
  it('uses the gemstone scheme', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 42,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.scheme).toBe('gemstone');
  });

  it('uses the session id as the authority', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 42,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.authority).toBe('42');
  });

  it('places the dictionary name at path segment 1', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'UserGlobals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.path.split('/')[1]).toBe('UserGlobals');
  });

  it('places the class name at path segment 2', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'String',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.path.split('/')[2]).toBe('String');
  });

  it('places "instance" at path segment 3 when isMeta is false', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.path.split('/')[3]).toBe('instance');
  });

  it('places "class" at path segment 3 when isMeta is true', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: true,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.path.split('/')[3]).toBe('class');
  });

  it('places the method category at path segment 4', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.path.split('/')[4]).toBe('accessing');
  });

  it('places the selector at path segment 5', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at:put:',
      environmentId: 0,
    });
    expect(uri.path.split('/')[5]).toBe('at:put:');
  });

  it('omits the env query parameter when environmentId is 0', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 0,
    });
    expect(uri.query).toBe('');
  });

  it('appends the env query parameter when environmentId is non-zero', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at',
      environmentId: 2,
    });
    expect(uri.query).toBe('env=2');
  });

  it('appends base=1 when the base flag is set', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Character',
      isMeta: false,
      category: 'converting',
      selector: 'isVowel',
      environmentId: 0,
      base: true,
    });
    expect(uri.query).toBe('base=1');
  });

  it('combines env and base in the query', () => {
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Character',
      isMeta: false,
      category: 'converting',
      selector: 'isVowel',
      environmentId: 2,
      base: true,
    });
    expect(uri.query).toBe('env=2&base=1');
  });

  it('throws when dictName contains a slash', () => {
    expect(() =>
      buildMethodUri({
        kind: 'method',
        sessionId: 1,
        dictName: 'User/Globals',
        className: 'Array',
        isMeta: false,
        category: 'accessing',
        selector: 'at',
        environmentId: 0,
      }),
    ).toThrow("Dictionary name must not contain '/': User/Globals");
  });

  it('throws when className contains a slash', () => {
    expect(() =>
      buildMethodUri({
        kind: 'method',
        sessionId: 1,
        dictName: 'Globals',
        className: 'My/Class',
        isMeta: false,
        category: 'accessing',
        selector: 'at',
        environmentId: 0,
      }),
    ).toThrow("Class name must not contain '/': My/Class");
  });

  it('carries a slash-bearing category through the path and back', () => {
    // `initialize/release` is a stock GemStone category. Rejecting it threw from
    // anywhere a row for such a method was built, taking the Methods pane with it.
    const uri = buildMethodUri({
      kind: 'method',
      sessionId: 1,
      dictName: 'Globals',
      className: 'Array',
      isMeta: false,
      category: 'initialize/release',
      selector: 'at',
      environmentId: 0,
    });

    // Escaped in the path, so the category stays one segment and the selector
    // still starts at the segment after it.
    expect(uri.path).not.toContain('initialize/release');
    expect(parseUri(uri)).toMatchObject({
      kind: 'method',
      category: 'initialize/release',
      selector: 'at',
    });
  });

  it('does not throw for a raw binary selector containing a slash', () => {
    // '/' and '//' are ordinary Smalltalk binary selectors; buildMethodUri must
    // escape them into the path rather than reject them.
    expect(() =>
      buildMethodUri({
        kind: 'method',
        sessionId: 1,
        dictName: 'Globals',
        className: 'Number',
        isMeta: false,
        category: 'arithmetic',
        selector: '/',
        environmentId: 0,
      }),
    ).not.toThrow();
    expect(() =>
      buildMethodUri({
        kind: 'method',
        sessionId: 1,
        dictName: 'Globals',
        className: 'Integer',
        isMeta: false,
        category: 'arithmetic',
        selector: '//',
        environmentId: 0,
      }),
    ).not.toThrow();
  });
});

describe('buildNewMethodUri', () => {
  it('uses the gemstone scheme', () => {
    const uri = buildNewMethodUri(42, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.scheme).toBe('gemstone');
  });

  it('uses the session id as the authority', () => {
    const uri = buildNewMethodUri(42, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.authority).toBe('42');
  });

  it('places the dictionary name at path segment 1', () => {
    const uri = buildNewMethodUri(1, 'UserGlobals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[1]).toBe('UserGlobals');
  });

  it('places the class name at path segment 2', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[2]).toBe('Array');
  });

  it('places "instance" at path segment 3 when isMeta is false', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[3]).toBe('instance');
  });

  it('places "class" at path segment 3 when isMeta is true', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', true, 'accessing', 0);
    expect(uri.path.split('/')[3]).toBe('class');
  });

  it('places the method category at path segment 4', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.path.split('/')[4]).toBe('accessing');
  });

  it('omits the env query parameter when environmentId is 0', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 0);
    expect(uri.query).toBe('');
  });

  it('appends the env query parameter when environmentId is non-zero', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', false, 'accessing', 2);
    expect(uri.query).toBe('env=2');
  });

  it('throws when dictName contains a slash', () => {
    expect(() => buildNewMethodUri(1, 'User/Globals', 'Array', false, 'accessing', 0)).toThrow(
      "Dictionary name must not contain '/': User/Globals",
    );
  });

  it('throws when className contains a slash', () => {
    expect(() => buildNewMethodUri(1, 'Globals', 'My/Class', false, 'accessing', 0)).toThrow(
      "Class name must not contain '/': My/Class",
    );
  });

  it('carries a slash-bearing category through the path and back', () => {
    expect(
      parseUri(buildNewMethodUri(1, 'Globals', 'Array', false, 'initialize/release', 0)),
    ).toMatchObject({ category: 'initialize/release' });
  });
});

describe('buildClassDefinitionUri', () => {
  it('uses the gemstone scheme', () => {
    const uri = buildClassDefinitionUri(42, 'Globals', 'Array');
    expect(uri.scheme).toBe('gemstone');
  });

  it('uses the session id as the authority', () => {
    const uri = buildClassDefinitionUri(42, 'Globals', 'Array');
    expect(uri.authority).toBe('42');
  });

  it('places the dictionary name at path segment 1', () => {
    const uri = buildClassDefinitionUri(1, 'UserGlobals', 'Array');
    expect(uri.path.split('/')[1]).toBe('UserGlobals');
  });

  it('places the class name at path segment 2', () => {
    const uri = buildClassDefinitionUri(1, 'Globals', 'MyClass');
    expect(uri.path.split('/')[2]).toBe('MyClass');
  });

  it('places "definition" at path segment 3', () => {
    const uri = buildClassDefinitionUri(1, 'Globals', 'Array');
    expect(uri.path.split('/')[3]).toBe('definition');
  });

  it('throws when dictName contains a slash', () => {
    expect(() => buildClassDefinitionUri(1, 'User/Globals', 'Array')).toThrow(
      "Dictionary name must not contain '/': User/Globals",
    );
  });

  it('throws when className contains a slash', () => {
    expect(() => buildClassDefinitionUri(1, 'Globals', 'My/Class')).toThrow(
      "Class name must not contain '/': My/Class",
    );
  });
});

describe('buildClassCommentUri', () => {
  it('places "comment" at path segment 3', () => {
    const uri = buildClassCommentUri(1, 'Globals', 'Array');
    expect(uri.path.split('/')[3]).toBe('comment');
  });

  it('labels the editor tab with the class name so it reads "<Class> comment"', () => {
    const uri = buildClassCommentUri(1, 'Globals', 'Array');

    const basename = decodeURIComponent(uri.path.split('/').pop() as string);
    expect(basename).toBe('Array comment');
  });

  it('scopes the lookup to the dictionary index via the query', () => {
    const uri = buildClassCommentUri(1, 'Globals', 'Array', 9);
    expect(uri.query).toBe('dict=9');
  });

  it('round-trips back to the class comment through parseUri', () => {
    const parsed = parseUri(buildClassCommentUri(1, 'Globals', 'Array', 9));

    expect(parsed).toMatchObject({ kind: 'comment', className: 'Array', dictIndex: 9 });
  });

  it('throws when className contains a slash', () => {
    expect(() => buildClassCommentUri(1, 'Globals', 'My/Class')).toThrow(
      "Class name must not contain '/': My/Class",
    );
  });
});

describe('closeGemstoneTabsForSession', () => {
  it("closes this session's gemstone tabs (definition, method, diff) and leaves the rest", async () => {
    vi.mocked(window.tabGroups.close).mockClear();
    const s1def = { input: new TabInputText(Uri.parse('gemstone://1/Globals/Array/definition')) };
    const s1method = {
      input: new TabInputText(Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A')),
    };
    const s1diff = {
      input: new TabInputTextDiff(
        Uri.parse('gemstone://1/Globals/Array/instance/x/y%20(base)?base=1'),
        Uri.parse('gemstone://1/Globals/Array/instance/x/y%20(session%20override)'),
      ),
    };
    const s2def = { input: new TabInputText(Uri.parse('gemstone://2/Globals/Array/definition')) };
    const plainFile = { input: new TabInputText(Uri.parse('file:///tmp/Array.gs')) };
    window.tabGroups.all = [{ tabs: [s1def, s1method, s1diff, s2def, plainFile] }];

    await closeGemstoneTabsForSession(1);

    expect(window.tabGroups.close).toHaveBeenCalledWith([s1def, s1method, s1diff]);
    window.tabGroups.all = [];
  });

  it('does nothing when no gemstone tab belongs to the session', async () => {
    vi.mocked(window.tabGroups.close).mockClear();
    window.tabGroups.all = [
      { tabs: [{ input: new TabInputText(Uri.parse('gemstone://9/Globals/Array/definition')) }] },
    ];

    await closeGemstoneTabsForSession(1);

    expect(window.tabGroups.close).not.toHaveBeenCalled();
    window.tabGroups.all = [];
  });
});

describe('installStaleGemstoneTabReaper', () => {
  it('closes gemstone tabs whose session is not live and leaves the rest', () => {
    vi.mocked(window.tabGroups.close).mockClear();
    const noSessions = { getSession: vi.fn(() => undefined) } as unknown as SessionManager;
    const staleMethod = {
      input: new TabInputText(Uri.parse('gemstone://7/Globals/Array/instance/accessing/at%3A')),
    };
    const plainFile = { input: new TabInputText(Uri.parse('file:///tmp/Array.gs')) };
    window.tabGroups.all = [{ tabs: [staleMethod, plainFile] }];

    installStaleGemstoneTabReaper(noSessions);

    expect(window.tabGroups.close).toHaveBeenCalledWith([staleMethod]);
    window.tabGroups.all = [];
  });

  it('leaves gemstone tabs whose session is live', () => {
    vi.mocked(window.tabGroups.close).mockClear();
    const session = makeSession(3);
    const mgr = {
      getSession: vi.fn((id: number) => (id === 3 ? session : undefined)),
    } as unknown as SessionManager;
    const liveTab = { input: new TabInputText(Uri.parse('gemstone://3/Globals/Array/definition')) };
    window.tabGroups.all = [{ tabs: [liveTab] }];

    installStaleGemstoneTabReaper(mgr);

    expect(window.tabGroups.close).not.toHaveBeenCalled();
    window.tabGroups.all = [];
  });

  it('does not throw with a stale tab present when no session manager is available', () => {
    vi.mocked(window.tabGroups.close).mockClear();
    const staleTab = {
      input: new TabInputText(Uri.parse('gemstone://7/Globals/Array/definition')),
    };
    window.tabGroups.all = [{ tabs: [staleTab] }];

    expect(() =>
      installStaleGemstoneTabReaper(undefined as unknown as SessionManager),
    ).not.toThrow();

    expect(window.tabGroups.close).toHaveBeenCalledWith([staleTab]);
    window.tabGroups.all = [];
  });

  it('watches for tabs appearing after activation (wins the restore race)', () => {
    vi.mocked(window.tabGroups.onDidChangeTabs).mockClear();
    const noSessions = { getSession: vi.fn(() => undefined) } as unknown as SessionManager;
    window.tabGroups.all = [];

    installStaleGemstoneTabReaper(noSessions);

    expect(window.tabGroups.onDidChangeTabs).toHaveBeenCalled();
  });

  it('reaps stale tabs on a tab change and when the session selection changes', () => {
    vi.mocked(window.tabGroups.close).mockClear();
    vi.mocked(window.tabGroups.onDidChangeTabs).mockClear();
    let sessionCb: () => void = () => {};
    const noSessions = {
      getSession: vi.fn(() => undefined),
      onDidChangeSelection: vi.fn((cb: () => void) => {
        sessionCb = cb;
        return { dispose() {} };
      }),
    } as unknown as SessionManager;
    window.tabGroups.all = [];

    installStaleGemstoneTabReaper(noSessions);

    const tabCb = (
      vi.mocked(window.tabGroups.onDidChangeTabs).mock.calls[0] as unknown[]
    )[0] as () => void;
    const stale = { input: new TabInputText(Uri.parse('gemstone://7/Globals/Array/definition')) };
    window.tabGroups.all = [{ tabs: [stale] }];

    tabCb();
    expect(window.tabGroups.close).toHaveBeenCalledWith([stale]);

    vi.mocked(window.tabGroups.close).mockClear();
    sessionCb();
    expect(window.tabGroups.close).toHaveBeenCalledWith([stale]);
    window.tabGroups.all = [];
  });
});

describe('parseUri', () => {
  const method = { kind: 'method' as const, sessionId: 1, dictName: 'Globals', className: 'Array' };

  it('round-trips an instance method built by buildMethodUri', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: false,
      category: 'accessing',
      selector: 'at:',
      environmentId: 0,
    });

    expect(parseUri(uri)).toMatchObject({
      kind: 'method',
      className: 'Array',
      isMeta: false,
      category: 'accessing',
      selector: 'at:',
      environmentId: 0,
    });
  });

  it('marks the class side when the method is meta', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: true,
      category: 'instance creation',
      selector: 'new',
      environmentId: 0,
    });

    expect(parseUri(uri)).toMatchObject({ kind: 'method', isMeta: true, selector: 'new' });
  });

  it('preserves a non-default environment id', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: false,
      category: 'accessing',
      selector: 'at:',
      environmentId: 2,
    });

    expect(parseUri(uri)).toMatchObject({ environmentId: 2 });
  });

  it('preserves the dictionary index that scopes the class lookup', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: false,
      category: 'accessing',
      selector: 'at:',
      environmentId: 0,
      dictIndex: 7,
    });

    expect(parseUri(uri)).toMatchObject({ dictIndex: 7 });
  });

  it('preserves the base-source flag used by the override diff', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: false,
      category: 'accessing',
      selector: 'at:',
      environmentId: 0,
      base: true,
    });

    expect(parseUri(uri)).toMatchObject({ base: true });
  });

  it('recovers a selector that contains a slash', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: false,
      category: 'arithmetic',
      selector: escapeSelectorSlashes('//'),
      environmentId: 0,
    });

    expect(parseUri(uri)).toMatchObject({ selector: '//' });
  });

  it('round-trips a raw single-slash binary selector', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: false,
      category: 'arithmetic',
      selector: '/',
      environmentId: 0,
    });

    expect(parseUri(uri)).toMatchObject({ selector: '/' });
  });

  it('round-trips a raw double-slash binary selector', () => {
    const uri = buildMethodUri({
      ...method,
      isMeta: false,
      category: 'arithmetic',
      selector: '//',
      environmentId: 0,
    });

    expect(parseUri(uri)).toMatchObject({ selector: '//' });
  });

  it('round-trips a class definition built by buildClassDefinitionUri', () => {
    const uri = buildClassDefinitionUri(1, 'Globals', 'Array', 5);

    expect(parseUri(uri)).toMatchObject({
      kind: 'definition',
      dictName: 'Globals',
      className: 'Array',
      dictIndex: 5,
    });
  });

  it('round-trips a new-method template built by buildNewMethodUri', () => {
    const uri = buildNewMethodUri(1, 'Globals', 'Array', true, 'accessing', 0);

    expect(parseUri(uri)).toMatchObject({
      kind: 'new-method',
      className: 'Array',
      isMeta: true,
      category: 'accessing',
    });
  });

  it('accepts the legacy four-segment class-definition form', () => {
    const parsed = parseUri(Uri.parse('gemstone://1/Globals/Array/definition'));

    expect(parsed).toMatchObject({ kind: 'definition', className: 'Array' });
  });

  it('recognizes a class-definition editor whose tab-label segment repeats the class name', () => {
    const parsed = parseUri(Uri.parse('gemstone://1/Globals/Array/definition/Array'));

    expect(parsed).toMatchObject({ kind: 'definition', className: 'Array' });
  });

  it('recognizes a class-comment editor', () => {
    const parsed = parseUri(Uri.parse('gemstone://1/Globals/Array/comment'));

    expect(parsed).toMatchObject({ kind: 'comment', className: 'Array' });
  });

  it('recognizes a class-comment editor whose tab-label segment carries the class name', () => {
    const parsed = parseUri(Uri.parse('gemstone://1/Globals/Array/comment/Array%20comment'));

    expect(parsed).toMatchObject({ kind: 'comment', className: 'Array' });
  });

  it('recognizes the new-class template and its category', () => {
    const parsed = parseUri(Uri.parse('gemstone://1/UserGlobals/new-class?category=Widgets'));

    expect(parsed).toMatchObject({
      kind: 'new-class',
      dictName: 'UserGlobals',
      category: 'Widgets',
    });
  });

  it('treats a decorated override-diff selector as a read-only diff view', () => {
    const parsed = parseUri(
      Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A%20(base)?base=1'),
    );

    expect(parsed).toMatchObject({ kind: 'method', selector: 'at:', diffView: true, base: true });
  });

  it('throws FileNotFound for a path that matches no known shape', () => {
    expect(() => parseUri(Uri.parse('gemstone://1/Globals'))).toThrow();
  });
});

describe('listOpenGemstoneTabs', () => {
  it('returns each open gemstone source tab with its uri', () => {
    const uri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
    const tab = { input: new TabInputText(uri) };
    window.tabGroups.all = [{ tabs: [tab] }];

    expect(listOpenGemstoneTabs()).toEqual([{ tab, uri }]);

    window.tabGroups.all = [];
  });

  it('ignores editors that are not gemstone documents', () => {
    window.tabGroups.all = [{ tabs: [{ input: new TabInputText(Uri.parse('file:///tmp/x.st')) }] }];

    expect(listOpenGemstoneTabs()).toEqual([]);

    window.tabGroups.all = [];
  });

  it('excludes the override-diff comparison, which is a diff tab not a source editor', () => {
    const baseUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A%20(base)');
    const overUri = Uri.parse('gemstone://1/Globals/Array/instance/accessing/at%3A');
    window.tabGroups.all = [{ tabs: [{ input: new TabInputTextDiff(baseUri, overUri) }] }];

    expect(listOpenGemstoneTabs()).toEqual([]);

    window.tabGroups.all = [];
  });
});
