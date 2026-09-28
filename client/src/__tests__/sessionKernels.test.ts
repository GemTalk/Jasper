import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logError: vi.fn(), logInfo: vi.fn() }));
vi.mock('../pythonQueries', () => ({
  evalPythonInScope: vi.fn(() => '3'),
  resetPythonScope: vi.fn(() => 'scope reset'),
}));

import {
  notebooks,
  workspace,
  EventEmitter,
  __setConfig,
  __resetConfig,
} from '../__mocks__/vscode';
import { SessionKernels, sessionKernelId } from '../sessionKernels';
import { smalltalkSessionKernel, SMALLTALK_CONTROLLER_ID } from '../smalltalkNotebookController';
import { grailSessionKernel, GRAIL_CONTROLLER_ID } from '../grailNotebookController';
import { SessionManager } from '../sessionManager';
import * as python from '../pythonQueries';
import { GemStoneNotebookKernel } from '../gemstoneNotebookKernel';

const LOGIN = { gs_user: 'DataCurator', stone: 'gs64stone', gem_host: 'localhost' };

// A session manager with sessions 1..n logged in, session 1 active.
function makeSessionManager(ids: number[]) {
  const added = new EventEmitter<number>();
  const removed = new EventEmitter<number>();
  const sessions = new Map(ids.map((id) => [id, { id, login: LOGIN }]));
  const manager = {
    getSessions: () => [...sessions.values()],
    getSession: (id: number) => sessions.get(id),
    getSelectedSession: () => sessions.get(1),
    resolveSession: vi.fn(async () => sessions.get(1)),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
    onDidAddSession: added.event,
    onDidRemoveSession: removed.event,
  } as unknown as SessionManager;
  return {
    manager,
    login: (id: number) => {
      sessions.set(id, { id, login: LOGIN });
      added.fire(id);
    },
    logout: (id: number) => {
      sessions.delete(id);
      removed.fire(id);
    },
  };
}

function created() {
  return notebooks.createNotebookController.mock.results.map((r) => r.value);
}

function byId(id: string) {
  return created().find((c) => c.id === id)!;
}

describe('SessionKernels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConfig();
    __setConfig('gemstone', 'sessionMode', 'multiple');
  });

  function changeSessionMode(mode: 'single' | 'multiple') {
    __setConfig('gemstone', 'sessionMode', mode);
    for (const [listener] of vi.mocked(workspace.onDidChangeConfiguration).mock.calls) {
      (listener as (e: unknown) => void)({
        affectsConfiguration: (key: string) => key === 'gemstone.sessionMode',
      });
    }
  }

  it('makes none in single-session mode, where they would only duplicate the default', () => {
    __setConfig('gemstone', 'sessionMode', 'single');
    const { manager, login } = makeSessionManager([1]);
    new SessionKernels(manager, [smalltalkSessionKernel, grailSessionKernel]);
    login(2);
    expect(created()).toHaveLength(0);
  });

  it('follows the mode setting: adds them when switched to multiple, removes them when switched back', () => {
    __setConfig('gemstone', 'sessionMode', 'single');
    const { manager } = makeSessionManager([1, 2]);
    new SessionKernels(manager, [smalltalkSessionKernel]);

    changeSessionMode('multiple');
    expect(created().map((c) => c.id)).toEqual([
      sessionKernelId(SMALLTALK_CONTROLLER_ID, 1),
      sessionKernelId(SMALLTALK_CONTROLLER_ID, 2),
    ]);

    changeSessionMode('single');
    expect(created().every((c) => c.dispose.mock.calls.length > 0)).toBe(true);
  });

  it('stops listening once disposed: releases its login, logout and settings subscriptions', () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => ({ dispose: unsubscribe }));
    const manager = {
      getSessions: () => [],
      onDidAddSession: subscribe,
      onDidRemoveSession: subscribe,
    } as unknown as SessionManager;
    vi.mocked(workspace.onDidChangeConfiguration).mockReturnValueOnce({ dispose: unsubscribe });

    new SessionKernels(manager, [smalltalkSessionKernel]).dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });

  it('lists every session already logged in, for Smalltalk and Python', () => {
    const { manager } = makeSessionManager([1, 2, 3]);
    new SessionKernels(manager, [smalltalkSessionKernel, grailSessionKernel]);

    expect(created().map((c) => c.id)).toEqual([
      sessionKernelId(SMALLTALK_CONTROLLER_ID, 1),
      sessionKernelId(GRAIL_CONTROLLER_ID, 1),
      sessionKernelId(SMALLTALK_CONTROLLER_ID, 2),
      sessionKernelId(GRAIL_CONTROLLER_ID, 2),
      sessionKernelId(SMALLTALK_CONTROLLER_ID, 3),
      sessionKernelId(GRAIL_CONTROLLER_ID, 3),
    ]);
    expect(byId(sessionKernelId(SMALLTALK_CONTROLLER_ID, 3)).label).toBe(
      'GemStone Smalltalk · Session 3 · DataCurator on gs64stone (localhost)',
    );
  });

  it('adds a session logged in later, and removes one that logs out', () => {
    const { manager, login, logout } = makeSessionManager([1]);
    new SessionKernels(manager, [smalltalkSessionKernel]);

    login(4);
    const kernel = byId(sessionKernelId(SMALLTALK_CONTROLLER_ID, 4));
    expect(kernel.label).toContain('Session 4');

    logout(4);
    expect(kernel.dispose).toHaveBeenCalled();
    expect(byId(sessionKernelId(SMALLTALK_CONTROLLER_ID, 1)).dispose).not.toHaveBeenCalled();
  });

  it('does not add a second kernel for a session it already has', () => {
    const { manager, login } = makeSessionManager([1]);
    new SessionKernels(manager, [smalltalkSessionKernel]);
    login(1);
    expect(created()).toHaveLength(1);
  });

  it('disposes every kernel it made when disposed', () => {
    const { manager } = makeSessionManager([1, 2]);
    new SessionKernels(manager, [smalltalkSessionKernel]).dispose();
    expect(created().every((c) => c.dispose.mock.calls.length > 0)).toBe(true);
  });
});

describe('a session-bound kernel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function runOneCell(controller: ReturnType<typeof byId>) {
    await controller.executeHandler([
      { document: { getText: () => '3 + 4' }, notebook: { uri: { toString: () => 'nb' } } },
    ]);
    return controller.createNotebookCellExecution.mock.results[0].value;
  }

  it('runs in its own session, not the active one', async () => {
    const { manager } = makeSessionManager([1, 2]);
    const evaluate = vi.fn(() => '7');
    new GemStoneNotebookKernel(manager, {
      id: 'bound',
      label: 'Bound',
      description: '',
      supportedLanguages: ['x'],
      evaluate,
      sessionId: 2,
    });

    await runOneCell(byId('bound'));

    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), '3 + 4', 'nb');
    expect(manager.resolveSession).not.toHaveBeenCalled();
  });

  it('says its session has logged out rather than running somewhere else', async () => {
    const { manager, logout } = makeSessionManager([1, 2]);
    const evaluate = vi.fn(() => '7');
    new GemStoneNotebookKernel(manager, {
      id: 'bound',
      label: 'Bound',
      description: '',
      supportedLanguages: ['x'],
      evaluate,
      sessionId: 2,
    });
    logout(2);

    const execution = await runOneCell(byId('bound'));

    expect(evaluate).not.toHaveBeenCalled();
    expect(execution.end).toHaveBeenCalledWith(false, expect.any(Number));
    const item = execution.replaceOutput.mock.calls[0][0][0].items[0];
    expect(new TextDecoder().decode(item.data)).toContain('Session 2 has logged out');
  });

  it('keeps its label when the active session changes', () => {
    const { manager } = makeSessionManager([1, 2]);
    smalltalkSessionKernel(manager, 2);
    expect(manager.onDidChangeSelection).not.toHaveBeenCalled();
  });
});

describe('the real per-session factories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Session 2 is not the active one, so a kernel that fell back to the active
  // session would reach session 1's gci instead.
  function managerWithGci() {
    const gciOf = (id: number) => ({
      // Busy, so evalSmalltalk stops at its first GCI call — the one that shows
      // which session it went to.
      GciTsCallInProgress: vi.fn(() => ({ result: 1, err: { number: 0 } })),
      id,
    });
    const sessions = new Map(
      [1, 2].map((id) => [id, { id, login: LOGIN, gci: gciOf(id), handle: { id } }]),
    );
    const manager = {
      getSessions: () => [...sessions.values()],
      getSession: (id: number) => sessions.get(id),
      getSelectedSession: () => sessions.get(1),
      resolveSession: vi.fn(async () => sessions.get(1)),
      onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
      onDidAddSession: vi.fn(() => ({ dispose: () => {} })),
      onDidRemoveSession: vi.fn(() => ({ dispose: () => {} })),
    } as unknown as SessionManager;
    return { manager, sessions };
  }

  const cell = (text: string) => ({
    document: { getText: () => text },
    notebook: { uri: { toString: () => 'file:///demo.ipynb' } },
  });

  it('grailSessionKernel runs Python in its session, keeping one scope per notebook', async () => {
    const { manager, sessions } = managerWithGci();
    grailSessionKernel(manager, 2);
    const kernel = byId(sessionKernelId(GRAIL_CONTROLLER_ID, 2));

    expect(kernel.supportedLanguages).toEqual(['python']);
    await kernel.executeHandler([cell('x = 1')]);

    expect(python.evalPythonInScope).toHaveBeenCalledWith(
      sessions.get(2),
      'x = 1',
      'file:///demo.ipynb',
    );
  });

  it('smalltalkSessionKernel runs Smalltalk in its session', async () => {
    const { manager, sessions } = managerWithGci();
    smalltalkSessionKernel(manager, 2);
    const kernel = byId(sessionKernelId(SMALLTALK_CONTROLLER_ID, 2));

    expect(kernel.supportedLanguages).toEqual(['gemstone-smalltalk']);
    await kernel.executeHandler([cell('3 + 4')]);

    expect(sessions.get(2)!.gci.GciTsCallInProgress).toHaveBeenCalledWith(sessions.get(2)!.handle);
    expect(sessions.get(1)!.gci.GciTsCallInProgress).not.toHaveBeenCalled();
  });
});

describe('sessionKernelId', () => {
  it('differs between window runs, so a remembered binding cannot land on a new Session 2', async () => {
    const thisRun = sessionKernelId('kernel', 2);
    vi.resetModules();
    const { sessionKernelId: nextRun } = await import('../sessionKernels.js');

    expect(thisRun).toMatch(/^kernel\.session-2-/);
    expect(nextRun('kernel', 2)).toMatch(/^kernel\.session-2-/);
    expect(nextRun('kernel', 2)).not.toBe(thisRun);
  });

  it('is stable within one run, so the kernel keeps its id while the window is open', () => {
    expect(sessionKernelId('kernel', 2)).toBe(sessionKernelId('kernel', 2));
  });
});
