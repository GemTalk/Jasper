import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { notebooks, EventEmitter } from '../__mocks__/vscode';
import { SessionKernels } from '../sessionKernels';
import { smalltalkSessionKernel, SMALLTALK_CONTROLLER_ID } from '../smalltalkNotebookController';
import { grailSessionKernel, GRAIL_CONTROLLER_ID } from '../grailNotebookController';
import { SessionManager } from '../sessionManager';
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
  });

  it('lists every session already logged in, for Smalltalk and Python', () => {
    const { manager } = makeSessionManager([1, 2, 3]);
    new SessionKernels(manager, [smalltalkSessionKernel, grailSessionKernel]);

    expect(created().map((c) => c.id)).toEqual([
      `${SMALLTALK_CONTROLLER_ID}.session-1`,
      `${GRAIL_CONTROLLER_ID}.session-1`,
      `${SMALLTALK_CONTROLLER_ID}.session-2`,
      `${GRAIL_CONTROLLER_ID}.session-2`,
      `${SMALLTALK_CONTROLLER_ID}.session-3`,
      `${GRAIL_CONTROLLER_ID}.session-3`,
    ]);
    expect(byId(`${SMALLTALK_CONTROLLER_ID}.session-3`).label).toBe(
      'GemStone Smalltalk · Session 3 · DataCurator on gs64stone (localhost)',
    );
  });

  it('adds a session logged in later, and removes one that logs out', () => {
    const { manager, login, logout } = makeSessionManager([1]);
    new SessionKernels(manager, [smalltalkSessionKernel]);

    login(4);
    const kernel = byId(`${SMALLTALK_CONTROLLER_ID}.session-4`);
    expect(kernel.label).toContain('Session 4');

    logout(4);
    expect(kernel.dispose).toHaveBeenCalled();
    expect(byId(`${SMALLTALK_CONTROLLER_ID}.session-1`).dispose).not.toHaveBeenCalled();
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
