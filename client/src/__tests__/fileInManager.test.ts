import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../topazFileIn', () => ({
  fileInClass: vi.fn(() => ({
    success: true,
    errors: [],
    compiledMethods: 2,
    compiledClassDef: true,
    deletedMethods: 0,
  })),
}));

vi.mock('../systemBrowser', () => ({
  SystemBrowser: { refresh: vi.fn() },
}));

vi.mock('../browserQueries', () => ({
  deleteClass: vi.fn(),
  removeDictionary: vi.fn(),
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals']),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's symbol-list read — mocked so the flow records without a stone (#434).
vi.mock('../undo/queries/dictionaryQueries', () => ({ captureDictionary: vi.fn() }));

import * as vscode from 'vscode';
import { FileInManager, newClassTemplate } from '../fileInManager';
import { SessionManager, ActiveSession } from '../sessionManager';
import { ExportManager } from '../exportManager';
import { GemStoneLogin } from '../loginTypes';
import { fileInClass } from '../topazFileIn';
import { SystemBrowser } from '../systemBrowser';
import * as queries from '../browserQueries';
import { captureDictionary } from '../undo/queries/dictionaryQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undo/undoStack';

function createMockSession(overrides?: Partial<GemStoneLogin>): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: {
      label: 'Test',
      version: '3.7.2',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: '',
      netldi: 'gs64ldi',
      host_user: '',
      host_password: '',
      ...overrides,
    },
    stoneVersion: '3.7.2',
  };
}

function createMockSessionManager(sessions: ActiveSession[] = []): SessionManager {
  return {
    getSessions: vi.fn(() => sessions),
  } as unknown as SessionManager;
}

function createMockExportManager(
  overrides: {
    exportRoot?: string;
    sessionRoot?: string;
    isWriting?: boolean;
  } = {},
): ExportManager {
  return {
    getExportRoot: vi.fn(() => overrides.exportRoot ?? '/workspace/gemstone'),
    getSessionRoot: vi.fn(
      () => overrides.sessionRoot ?? '/workspace/gemstone/localhost/gs64stone/DataCurator',
    ),
    isWriting: overrides.isWriting ?? false,
    removeClassFile: vi.fn(),
    scheduleRefresh: vi.fn(),
  } as unknown as ExportManager;
}

function createMockDocument(
  fsPath: string,
  options: { scheme?: string; isDirty?: boolean; authority?: string } = {},
): vscode.TextDocument {
  return {
    uri: {
      scheme: options.scheme ?? 'file',
      fsPath,
      authority: options.authority ?? '',
      toString: () => `${options.scheme ?? 'file'}://${fsPath}`,
    },
    isDirty: options.isDirty ?? false,
    getText: vi.fn(() => ''),
  } as unknown as vscode.TextDocument;
}

describe('FileInManager', () => {
  let manager: FileInManager;
  let mockSessionManager: SessionManager;
  let mockExportManager: ExportManager;
  let mockSession: ActiveSession;

  beforeEach(() => {
    vi.clearAllMocks();
    (fileInClass as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      errors: [],
      compiledMethods: 2,
      compiledClassDef: true,
      deletedMethods: 0,
    });
    mockSession = createMockSession();
    mockSessionManager = createMockSessionManager([mockSession]);
    mockExportManager = createMockExportManager();
    manager = new FileInManager(mockSessionManager, mockExportManager);
  });

  describe('resolveSessionFromPath', () => {
    it('matches session by gem_host/stone/gs_user path segments', () => {
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals/MyClass.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBe(mockSession);
    });

    it('returns undefined for paths outside export root', () => {
      const fsPath = '/other/path/MyClass.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBeUndefined();
    });

    it('returns undefined when no session matches', () => {
      const fsPath = '/workspace/gemstone/otherhost/otherstone/otheruser/1-Dict/MyClass.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBeUndefined();
    });

    it('returns undefined when session root is undefined', () => {
      mockExportManager = createMockExportManager();
      (mockExportManager.getSessionRoot as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      manager = new FileInManager(mockSessionManager, mockExportManager);

      const result = manager.resolveSessionFromPath('/some/path/MyClass.gs');
      expect(result).toBeUndefined();
    });

    it('matches the correct session among multiple', () => {
      const session2 = createMockSession({ gem_host: 'remote', stone: 'prod', gs_user: 'Admin' });
      session2.id = 2;
      mockSessionManager = createMockSessionManager([mockSession, session2]);
      (mockExportManager.getSessionRoot as ReturnType<typeof vi.fn>).mockImplementation(
        (s: ActiveSession) =>
          `/workspace/gemstone/${s.login.gem_host}/${s.login.stone}/${s.login.gs_user}`,
      );
      manager = new FileInManager(mockSessionManager, mockExportManager);

      const fsPath = '/workspace/gemstone/remote/prod/Admin/1-Globals/Object.gs';
      const result = manager.resolveSessionFromPath(fsPath);
      expect(result).toBe(session2);
    });
  });

  describe('hasUnsavedChanges', () => {
    it('returns true when dirty .gs files exist under session root', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals/MyClass.gs',
        { isDirty: true },
      );
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(true);
    });

    it('returns false when no dirty files exist', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals/MyClass.gs',
        { isDirty: false },
      );
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });

    it('returns false for dirty files outside session root', () => {
      const doc = createMockDocument(
        '/workspace/gemstone/otherhost/otherstone/otheruser/1-Dict/Other.gs',
        { isDirty: true },
      );
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });

    it('returns true for dirty gemstone:// method editors for this session', () => {
      const doc = {
        uri: { scheme: 'gemstone', authority: '1', fsPath: '', toString: () => 'gemstone://1/...' },
        isDirty: true,
        getText: vi.fn(() => ''),
      } as unknown as vscode.TextDocument;
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(true);
    });

    it('returns false for dirty gemstone:// editors for a different session', () => {
      const doc = {
        uri: {
          scheme: 'gemstone',
          authority: '99',
          fsPath: '',
          toString: () => 'gemstone://99/...',
        },
        isDirty: true,
        getText: vi.fn(() => ''),
      } as unknown as vscode.TextDocument;
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });

    it('returns false when session root is undefined', () => {
      (mockExportManager.getSessionRoot as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      const doc = createMockDocument('/some/path/MyClass.gs', { isDirty: true });
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [doc];

      expect(manager.hasUnsavedChanges(mockSession)).toBe(false);
    });
  });

  describe('newClassTemplate', () => {
    it('includes class definition with Object superclass', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("Object subclass: 'MyClass'");
    });

    it('uses the given dictionary name in inDictionary:', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain('inDictionary: UserGlobals');
    });

    it('includes a comment template', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("MyClass comment: 'A brief description of MyClass.'");
    });

    it('includes class-side new method with instance creation category', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("category: 'instance creation'");
      expect(template).toContain('classmethod: MyClass');
      expect(template).toContain('new');
      expect(template).toContain('self basicNew');
      expect(template).toContain('initialize');
      expect(template).toContain('yourself');
    });

    it('includes instance-side initialize method with initialization category', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain("category: 'initialization'");
      expect(template).toContain('method: MyClass');
      expect(template).toContain('super initialize.');
    });

    it('uses class name and dictionary name in all appropriate places', () => {
      const template = newClassTemplate('Account', 'Published');
      expect(template).toContain("Object subclass: 'Account'");
      expect(template).toContain('inDictionary: Published');
      expect(template).toContain('classmethod: Account');
      expect(template).toContain('method: Account');
      expect(template).toContain("Account comment: 'A brief description of Account.'");
    });

    it('includes standard class definition fields', () => {
      const template = newClassTemplate('MyClass', 'UserGlobals');
      expect(template).toContain('instVarNames: #()');
      expect(template).toContain('classVars: #()');
      expect(template).toContain('classInstVars: #()');
      expect(template).toContain('poolDictionaries: #()');
      expect(template).toContain('options: #()');
    });
  });

  describe('handleFileCreate', () => {
    let tmpDir: string;
    let exportRoot: string;
    let createHandler: (e: { files: vscode.Uri[] }) => void;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filein-test-'));
      exportRoot = tmpDir;
      mockExportManager = createMockExportManager({ exportRoot, sessionRoot: exportRoot });
      manager = new FileInManager(mockSessionManager, mockExportManager);

      (vscode.workspace.onDidCreateFiles as ReturnType<typeof vi.fn>).mockImplementation(
        (handler: (e: { files: vscode.Uri[] }) => void) => {
          createHandler = handler;
          return { dispose: () => {} };
        },
      );
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      manager.register(context);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function createUri(fsPath: string): vscode.Uri {
      return { scheme: 'file', fsPath } as unknown as vscode.Uri;
    }

    it('populates an empty .gs file with template', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain("Object subclass: 'MyClass'");
      expect(content).toContain('inDictionary: UserGlobals');
    });

    it('extracts dictionary name from numbered directory', () => {
      const dictDir = path.join(exportRoot, '3-Published');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'Account.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('inDictionary: Published');
      expect(content).toContain("Object subclass: 'Account'");
    });

    it('skips non-empty files', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, 'existing content', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('existing content');
    });

    it('skips non-.gs files with an extension', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'notes.txt');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('appends .gs and populates template when file has no extension', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      expect(fs.existsSync(filePath)).toBe(false);
      const renamed = filePath + '.gs';
      expect(fs.existsSync(renamed)).toBe(true);
      const content = fs.readFileSync(renamed, 'utf-8');
      expect(content).toContain("Object subclass: 'MyClass'");
    });

    it('skips files outside export root', () => {
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'other-'));
      const dictDir = path.join(otherDir, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
      fs.rmSync(otherDir, { recursive: true, force: true });
    });

    it('uses raw directory name as dict name when no numeric prefix', () => {
      const dictDir = path.join(exportRoot, 'UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('inDictionary: UserGlobals');
      expect(content).toContain("Object subclass: 'MyClass'");
    });

    it('skips when isWriting is true', () => {
      Object.defineProperty(mockExportManager, 'isWriting', {
        get: () => true,
        configurable: true,
      });

      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('skips non-file scheme URIs', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'MyClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      const uri = { scheme: 'gemstone', fsPath: filePath } as unknown as vscode.Uri;
      createHandler({ files: [uri] });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe('');
    });

    it('files in the template and refreshes the browser', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'NewClass.gs');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      expect(fileInClass).toHaveBeenCalledWith(
        mockSession,
        expect.stringContaining("Object subclass: 'NewClass'"),
      );
      expect(SystemBrowser.refresh).toHaveBeenCalledWith(mockSession.id);
    });

    it('files in and refreshes browser when file has no extension', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'James');
      fs.writeFileSync(filePath, '', 'utf-8');

      createHandler({ files: [createUri(filePath)] });

      expect(fileInClass).toHaveBeenCalledWith(
        mockSession,
        expect.stringContaining("Object subclass: 'James'"),
      );
      expect(SystemBrowser.refresh).toHaveBeenCalledWith(mockSession.id);
    });

    it('closes the stale tab when file is renamed to .gs', () => {
      const dictDir = path.join(exportRoot, '1-UserGlobals');
      fs.mkdirSync(dictDir, { recursive: true });
      const filePath = path.join(dictDir, 'James');
      fs.writeFileSync(filePath, '', 'utf-8');

      const mockClose = vi.fn();
      const mockTab = { input: { uri: { fsPath: filePath } } };
      (vscode.window as Record<string, unknown>).tabGroups = {
        all: [{ tabs: [mockTab] }],
        close: mockClose,
      };

      createHandler({ files: [createUri(filePath)] });

      expect(mockClose).toHaveBeenCalledWith(mockTab);
    });
  });

  describe('handleFileDelete', () => {
    let deleteHandler: (e: { files: vscode.Uri[] }) => void;

    beforeEach(() => {
      mockExportManager = createMockExportManager();
      manager = new FileInManager(mockSessionManager, mockExportManager);

      (vscode.workspace.onDidDeleteFiles as ReturnType<typeof vi.fn>).mockImplementation(
        (handler: (e: { files: vscode.Uri[] }) => void) => {
          deleteHandler = handler;
          return { dispose: () => {} };
        },
      );
      const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
      manager.register(context);
    });

    function createUri(fsPath: string): vscode.Uri {
      return { scheme: 'file', fsPath } as unknown as vscode.Uri;
    }

    it('removes class from GemStone when .gs file is deleted', () => {
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals/MyClass.gs';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.deleteClass).toHaveBeenCalledWith(mockSession, 1, 'MyClass');
      // Drop the (already-deleted) class from the persisted mirror state too.
      expect(mockExportManager.removeClassFile).toHaveBeenCalledWith(
        mockSession,
        1,
        'UserGlobals',
        'MyClass',
      );
      expect(SystemBrowser.refresh).toHaveBeenCalledWith(mockSession.id);
    });

    it('records the removal, so Undo can put the dictionary back (#434)', () => {
      // Deleting the mirror directory is the same destructive act as the Explorer's Remove
      // Dictionary, and gets the same way back -- including the POSITION it held.
      resetUndoStacks();
      vi.mocked(captureDictionary).mockReturnValue({
        present: true,
        name: 'Published',
        index: 3,
      });
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/3-Published';

      deleteHandler({ files: [createUri(fsPath)] });

      const entry = peekUndoEntry(mockSession.id);
      expect(entry).toMatchObject({
        kind: 'dictionaryEdit',
        label: 'Remove dictionary Published',
        before: { present: true, name: 'Published', index: 3 },
        after: { present: false },
      });
      // The dictionary itself is pinned in SessionTemps: unlisting does not destroy it, but
      // nothing else references it once it is off the list.
      expect(entry?.kind === 'dictionaryEdit' && entry.stashKey).not.toBeNull();
      // The name is taken from the directory, with the index prefix stripped.
      expect(captureDictionary).toHaveBeenCalledWith(
        expect.anything(),
        'Published',
        expect.any(String),
      );
    });

    it('records nothing when the removal itself failed', () => {
      resetUndoStacks();
      vi.mocked(captureDictionary).mockReturnValue({
        present: true,
        name: 'Published',
        index: 3,
      });
      vi.mocked(queries.removeDictionary).mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/3-Published';

      deleteHandler({ files: [createUri(fsPath)] });

      expect(undoStackDepth(mockSession.id)).toBe(0);
    });

    it('removes dictionary from GemStone when directory is deleted', () => {
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/3-Published';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.removeDictionary).toHaveBeenCalledWith(mockSession, 3);
      // Reconcile the mirror after the dictionary is gone.
      expect(mockExportManager.scheduleRefresh).toHaveBeenCalledWith(mockSession);
      expect(SystemBrowser.refresh).toHaveBeenCalledWith(mockSession.id);
    });

    it('skips files outside export root', () => {
      const fsPath = '/other/path/MyClass.gs';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.deleteClass).not.toHaveBeenCalled();
      expect(queries.removeDictionary).not.toHaveBeenCalled();
    });

    it('skips when isWriting is true', () => {
      Object.defineProperty(mockExportManager, 'isWriting', {
        get: () => true,
        configurable: true,
      });

      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals/MyClass.gs';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.deleteClass).not.toHaveBeenCalled();
    });

    it('skips non-file scheme URIs', () => {
      const uri = {
        scheme: 'gemstone',
        fsPath: '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals/MyClass.gs',
      } as unknown as vscode.Uri;
      deleteHandler({ files: [uri] });

      expect(queries.deleteClass).not.toHaveBeenCalled();
    });

    it('skips when no session matches the path', () => {
      const fsPath = '/workspace/gemstone/otherhost/otherstone/otheruser/1-Dict/MyClass.gs';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.deleteClass).not.toHaveBeenCalled();
    });

    it('skips directories that are not recognized dictionaries', () => {
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/notes';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.removeDictionary).not.toHaveBeenCalled();
    });

    it('looks up dict index by name for directories without numeric prefix', () => {
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/UserGlobals/MyClass.gs';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.deleteClass).toHaveBeenCalledWith(mockSession, 1, 'MyClass');
    });

    it('shows error when class deletion fails', () => {
      // Once-only: a sticky mockImplementation here survives the suite's
      // clearAllMocks() and makes deleteClass throw in every later test under
      // sequence.shuffle (breaking the happy-path removeClassFile assertions).
      vi.mocked(queries.deleteClass).mockImplementationOnce(() => {
        throw new Error('GCI error');
      });

      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals/MyClass.gs';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove class'),
      );
    });

    it('shows error when dictionary deletion fails', () => {
      // Once-only — see the note on the class-deletion test above.
      vi.mocked(queries.removeDictionary).mockImplementationOnce(() => {
        throw new Error('GCI error');
      });

      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/1-UserGlobals';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove dictionary'),
      );
    });

    it('parses multi-digit dictionary index correctly', () => {
      const fsPath = '/workspace/gemstone/localhost/gs64stone/DataCurator/12-Published/Account.gs';
      deleteHandler({ files: [createUri(fsPath)] });

      expect(queries.deleteClass).toHaveBeenCalledWith(mockSession, 12, 'Account');
    });
  });
});
