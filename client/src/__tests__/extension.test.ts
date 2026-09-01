import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('vscode-languageclient/node', () => ({
  LanguageClient: class {
    start() {}
    stop() {
      return Promise.resolve();
    }
    sendRequest() {
      return Promise.resolve(null);
    }
  },
  TransportKind: { ipc: 0 },
}));

vi.mock('../browserQueries', () => ({
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(message: string, gciErrorNumber = 0) {
      super(message);
      this.gciErrorNumber = gciErrorNumber;
    }
  },
  compileMethod: vi.fn(() => 'Compiled: Array >> foo'),
  checkRefactoringSupportAvailable: vi.fn(() => false),
}));

import * as vscode from 'vscode';
import * as extension from '../extension';
import { GemStoneFileSystemProvider } from '../gemstoneFileSystemProvider';
import type { SessionManager } from '../sessionManager';
import type { GemStoneLoginItem } from '../loginTreeProvider';
import * as queries from '../browserQueries';
import { InFlightGuard } from '../inFlightGuard';
import { DEFAULT_LOGIN } from '../loginTypes';

/** Replace the mocked `tabGroups.all`, keeping the cast in one place. */
function setTabs(groups: { tabs: vscode.Tab[] }[]): void {
  (vscode.window.tabGroups as unknown as { all: { tabs: vscode.Tab[] }[] }).all = groups;
}

describe('openTextEditorOn', () => {
  const uri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(vscode.workspace.openTextDocument).mockReset();
    vi.mocked(vscode.window.showTextDocument).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
  });

  it('opens and shows the document with preview disabled, without logging an error', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);

    await extension.openTextEditorOn(uri);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(document, { preview: false });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('logs an error when openTextDocument fails and does not call showTextDocument', async () => {
    const error = new Error('open failed');
    vi.mocked(vscode.workspace.openTextDocument).mockRejectedValue(error);

    await extension.openTextEditorOn(uri);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to open text editor on ${uri.toString()}`,
      'Show Details',
    );
  });

  it('logs an error when showTextDocument fails after openTextDocument succeeds', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    const error = new Error('show failed');
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockRejectedValue(error);

    await extension.openTextEditorOn(uri);

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(document, { preview: false });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to open text editor on ${uri.toString()}`,
      'Show Details',
    );
  });
});

describe('closeTextEditorOn', () => {
  const targetUri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:');
  const otherUri = vscode.Uri.parse(
    'gemstone://1/SymbolDictionary/Array/instance/accessing/at:put:',
  );

  const makeTextTab = (uri: vscode.Uri): vscode.Tab =>
    ({
      input: new vscode.TabInputText(uri),
    }) as unknown as vscode.Tab;

  beforeEach(() => {
    vi.restoreAllMocks();
    setTabs([]);
    vi.mocked(vscode.window.tabGroups.close).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
  });

  it('does nothing when no tabs are opened for the given uri', async () => {
    setTabs([{ tabs: [] }]);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('closes one matching opened tab (happy path)', async () => {
    const tab = makeTextTab(targetUri);
    setTabs([{ tabs: [tab] }]);
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(tab);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('logs error when closing one matching opened tab fails', async () => {
    const tab = makeTextTab(targetUri);
    const error = new Error('close failed');
    setTabs([{ tabs: [tab] }]);
    vi.mocked(vscode.window.tabGroups.close).mockRejectedValue(error);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to close text editor on ${targetUri.toString()}`,
      'Show Details',
    );
  });

  it('closes both tabs when more than one matching tab is opened (happy path)', async () => {
    const tab1 = makeTextTab(targetUri);
    const tab2 = makeTextTab(targetUri);
    setTabs([{ tabs: [tab1, tab2] }]);
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(2);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(1, tab1);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(2, tab2);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('handles per-tab failure: first fails and second still closes', async () => {
    const tab1 = makeTextTab(targetUri);
    const tab2 = makeTextTab(targetUri);
    const error = new Error('first close failed');
    setTabs([{ tabs: [tab1, tab2] }]);
    vi.mocked(vscode.window.tabGroups.close)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(2);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(1, tab1);
    expect(vscode.window.tabGroups.close).toHaveBeenNthCalledWith(2, tab2);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      `Failed to close text editor on ${targetUri.toString()}`,
      'Show Details',
    );
  });

  it('does not close tabs for different uris', async () => {
    const matching = makeTextTab(targetUri);
    const different = makeTextTab(otherUri);
    const notText = { input: { uri: targetUri } } as unknown as vscode.Tab;
    setTabs([{ tabs: [matching, different, notText] }]);
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.closeTextEditorOn(targetUri);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(matching);
  });
});

describe('handleMethodCompiled', () => {
  const uri = vscode.Uri.parse('gemstone://1/SymbolDictionary/Array/instance/accessing/at:');
  const previousUri = vscode.Uri.parse(
    'gemstone://1/SymbolDictionary/Array/instance/accessing/at:put:',
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(vscode.workspace.openTextDocument).mockReset();
    vi.mocked(vscode.window.showTextDocument).mockReset();
    vi.mocked(vscode.window.tabGroups.close).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
    setTabs([]);
  });

  it('opens the new uri and closes the previous tab when the previous URI is a template', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);
    const previousTab = { input: new vscode.TabInputText(previousUri) } as unknown as vscode.Tab;
    setTabs([{ tabs: [previousTab] }]);
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.handleMethodCompiled({ uri, previousUri, previousUriIsTemplate: true });

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(previousTab);
    expect(vi.mocked(vscode.workspace.openTextDocument).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(vscode.window.tabGroups.close).mock.invocationCallOrder[0],
    );
  });

  it('does nothing when uri equals previousUri (selector unchanged)', async () => {
    setTabs([]);

    await extension.handleMethodCompiled({ uri, previousUri: uri, previousUriIsTemplate: false });

    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('opens the new uri but does not close the previous tab when the previous URI is not a template', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);
    const previousTab = { input: new vscode.TabInputText(previousUri) } as unknown as vscode.Tab;
    setTabs([{ tabs: [previousTab] }]);

    await extension.handleMethodCompiled({ uri, previousUri, previousUriIsTemplate: false });

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });
});

describe('handleClassDefinitionCompiled', () => {
  const previousUri = vscode.Uri.parse('gemstone://1/Globals/new-class');
  const uri = vscode.Uri.parse('gemstone://1/Globals/MyClass/definition');

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(vscode.workspace.openTextDocument).mockReset();
    vi.mocked(vscode.window.showTextDocument).mockReset();
    vi.mocked(vscode.window.tabGroups.close).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
    setTabs([]);
  });

  it('opens the definition uri when uri differs from previousUri', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);

    await extension.handleClassDefinitionCompiled({
      uri,
      previousUri,
      previousUriIsTemplate: true,
    });

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
  });

  it('does not open an editor when uri equals previousUri', async () => {
    await extension.handleClassDefinitionCompiled({
      uri,
      previousUri: uri,
      previousUriIsTemplate: false,
    });

    expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it('opens the definition uri and closes the previous tab when the previous URI is a template', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);
    const previousTab = { input: new vscode.TabInputText(previousUri) } as unknown as vscode.Tab;
    setTabs([{ tabs: [previousTab] }]);
    vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(undefined as never);

    await extension.handleClassDefinitionCompiled({
      uri,
      previousUri,
      previousUriIsTemplate: true,
    });

    expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(uri);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(previousTab);
  });

  it('does not close any tab when the previous URI is not a template', async () => {
    const document = { uri, getText: vi.fn(() => '') } as unknown as vscode.TextDocument;
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
    vi.mocked(vscode.window.showTextDocument).mockResolvedValue({} as vscode.TextEditor);

    await extension.handleClassDefinitionCompiled({
      uri,
      previousUri,
      previousUriIsTemplate: false,
    });

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });
});

describe('onMethodCompiled event subscription (functional)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleMethodCompiled is invoked when new-method is compiled', async () => {
    vi.mocked(queries.compileMethod).mockReturnValueOnce('Compiled: Array >> foo');

    const makeSession = (id = 1) => ({
      id,
      gci: {},
      handle: {},
      login: { label: 'Test', gs_user: 'DataCurator' },
      stoneVersion: '3.7.2',
    });

    const sessionManager = {
      getSessions: vi.fn(() => [makeSession(1)]),
      getSession: vi.fn((id: number) => (id === 1 ? makeSession(1) : undefined)),
    } as unknown as SessionManager;

    const provider = new GemStoneFileSystemProvider(sessionManager);
    const handler = vi.spyOn(extension, 'handleMethodCompiled');

    provider.onMethodCompiled(handler);

    const newMethodUri = vscode.Uri.parse(
      'gemstone://1/Globals/Array/instance/accessing/new-method',
    );
    const source = 'foo\n  ^42';

    provider.writeFile(newMethodUri, new TextEncoder().encode(source), {
      create: true,
      overwrite: true,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0];
    expect(event.previousUri.toString()).toBe(newMethodUri.toString());
    expect(event.uri.toString()).toBe('gemstone://1/Globals/Array/instance/accessing/foo');
    expect(event.previousUriIsTemplate).toBe(true);
  });
});

describe('confirmLogoutWithUncommittedChanges', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showWarningMessage).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
  });

  it('proceeds without prompting when the transaction is clean', async () => {
    const commit = vi.fn();

    const decision = await extension.confirmLogoutWithUncommittedChanges(3, false, commit);

    expect(decision).toBe('proceed');
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits then proceeds when the user chooses to commit before logging out', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Commit & Logout' as unknown as vscode.MessageItem,
    );
    const commit = vi.fn(() => ({ success: true, err: { number: 0, message: '' } }));

    const decision = await extension.confirmLogoutWithUncommittedChanges(3, true, commit);

    expect(commit).toHaveBeenCalledWith(3);
    expect(decision).toBe('proceed');
  });

  it('cancels the logout when the requested commit fails', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Commit & Logout' as unknown as vscode.MessageItem,
    );
    const commit = vi.fn(() => ({
      success: false,
      err: { number: 4001, message: 'no privilege' },
    }));

    const decision = await extension.confirmLogoutWithUncommittedChanges(3, true, commit);

    expect(decision).toBe('cancel');
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('proceeds without committing when the user chooses to log out anyway', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Logout Anyway' as unknown as vscode.MessageItem,
    );
    const commit = vi.fn();

    const decision = await extension.confirmLogoutWithUncommittedChanges(3, true, commit);

    expect(decision).toBe('proceed');
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels when the user dismisses the prompt', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const commit = vi.fn();

    const decision = await extension.confirmLogoutWithUncommittedChanges(3, true, commit);

    expect(decision).toBe('cancel');
    expect(commit).not.toHaveBeenCalled();
  });

  it('still prompts when the commit state could not be determined', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Logout Anyway' as unknown as vscode.MessageItem,
    );
    const commit = vi.fn();

    const decision = await extension.confirmLogoutWithUncommittedChanges(3, undefined, commit);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(decision).toBe('proceed');
  });
});

describe('abortConfirmMessage', () => {
  it('needs no confirmation when the transaction is clean and no editors are dirty', () => {
    expect(extension.abortConfirmMessage(false, false)).toBeNull();
  });

  it('warns about the transaction when there are uncommitted changes', () => {
    expect(extension.abortConfirmMessage(true, false)).toMatch(/uncommitted changes/);
  });

  it('warns that it cannot be sure when the commit state is unknown', () => {
    expect(extension.abortConfirmMessage(undefined, false)).toMatch(/could not be checked/);
  });

  it('warns about unsaved editors even when the transaction is clean', () => {
    expect(extension.abortConfirmMessage(false, true)).toMatch(/unsaved edits/);
  });

  it('mentions both losses when the transaction is dirty and editors are unsaved', () => {
    const message = extension.abortConfirmMessage(true, true);
    expect(message).toMatch(/uncommitted changes/);
    expect(message).toMatch(/unsaved edits/);
  });
});

describe('withLoginGuard', () => {
  const item = { login: DEFAULT_LOGIN } as unknown as GemStoneLoginItem;

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('ignores a repeat connect for the same target while one is in flight', async () => {
    const guard = new InFlightGuard();
    const inFlight = deferred<void>();
    const handler = vi.fn(() => inFlight.promise);
    const guarded = extension.withLoginGuard(guard, handler);

    const firstRun = guarded(item);
    await guarded(item);
    inFlight.resolve();
    await firstRun;

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('connects again for a fresh click once the previous attempt settles', async () => {
    const guard = new InFlightGuard();
    const handler = vi.fn(async () => {});
    const guarded = extension.withLoginGuard(guard, handler);

    await guarded(item);
    await guarded(item);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('connects concurrently to two different targets', async () => {
    const guard = new InFlightGuard();
    const handler = vi.fn(async () => {});
    const guarded = extension.withLoginGuard(guard, handler);
    const otherStone = {
      login: { ...DEFAULT_LOGIN, stone: 'otherstone' },
    } as unknown as GemStoneLoginItem;

    await Promise.all([guarded(item), guarded(otherStone)]);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('maybeOpenGettingStarted', () => {
  const SEEN_KEY = 'gemstone.hasSeenGettingStarted';

  function fakeContext(alreadySeen?: boolean) {
    const store = new Map<string, unknown>();
    if (alreadySeen !== undefined) store.set(SEEN_KEY, alreadySeen);
    const context = {
      globalState: {
        get: (key: string) => store.get(key),
        update: (key: string, value: unknown) => {
          if (value === undefined) store.delete(key);
          else store.set(key, value);
          return Promise.resolve();
        },
      },
    } as unknown as vscode.ExtensionContext;
    return { context, store };
  }

  const walkthroughOpenings = () =>
    vi
      .mocked(vscode.commands.executeCommand)
      .mock.calls.filter((c) => c[0] === 'workbench.action.openWalkthrough');

  beforeEach(() => {
    vi.mocked(vscode.commands.executeCommand).mockReset();
  });

  it('opens the walkthrough on the first activation', () => {
    const { context, store } = fakeContext();

    extension.maybeOpenGettingStarted(context);

    expect(walkthroughOpenings()).toHaveLength(1);
    expect(store.get(SEEN_KEY)).toBe(true);
  });

  it('stays out of the way once it has already been shown', () => {
    const { context } = fakeContext(true);

    extension.maybeOpenGettingStarted(context);

    expect(walkthroughOpenings()).toHaveLength(0);
  });

  it('opens only once per machine, however many times it is called', () => {
    const { context } = fakeContext();

    extension.maybeOpenGettingStarted(context);
    extension.maybeOpenGettingStarted(context);
    extension.maybeOpenGettingStarted(context);

    expect(walkthroughOpenings()).toHaveLength(1);
  });
});
