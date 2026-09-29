import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { EventEmitter, workspace, __setConfig, __resetConfig } from '../__mocks__/vscode';
import {
  chooseActiveSession,
  followActiveSessionLabel,
  SessionPanelTitle,
  WorkspaceSessionLensProvider,
  WORKSPACE_SESSION_SELECTORS,
} from '../activeSessionDisplay';
import { SessionManager } from '../sessionManager';

const LOGIN = { gs_user: 'DataCurator', stone: 'gs64stone', gem_host: 'localhost' };

function makeSessionManager(sessionIds: number[], selectedId?: number) {
  const selection = new EventEmitter<number | null>();
  const added = new EventEmitter<number>();
  const removed = new EventEmitter<number>();
  const sessions = sessionIds.map((id) => ({ id, login: LOGIN }));
  const state = { selectedId };
  const manager = {
    getSelectedSession: () => sessions.find((s) => s.id === state.selectedId),
    getSessions: () => sessions,
    onDidChangeSelection: selection.event,
    onDidAddSession: added.event,
    onDidRemoveSession: removed.event,
  } as unknown as SessionManager;
  const select = (id: number) => {
    state.selectedId = id;
    selection.fire(id);
  };
  const login = (id: number) => {
    sessions.push({ id, login: LOGIN });
    added.fire(id);
  };
  const logout = (id: number) => {
    sessions.splice(
      sessions.findIndex((s) => s.id === id),
      1,
    );
    removed.fire(id);
  };
  return { manager, select, login, logout };
}

function changeSessionMode(mode: 'single' | 'multiple') {
  __setConfig('gemstone', 'sessionMode', mode);
  for (const [listener] of vi.mocked(workspace.onDidChangeConfiguration).mock.calls) {
    (listener as (e: unknown) => void)({
      affectsConfiguration: (key: string) => key === 'gemstone.sessionMode',
    });
  }
}

function lens(provider: WorkspaceSessionLensProvider) {
  const lenses = provider.provideCodeLenses();
  expect(lenses).toHaveLength(1);
  expect(lenses[0].range.start.line).toBe(0);
  return lenses[0].command!;
}

describe('WorkspaceSessionLensProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConfig();
    __setConfig('gemstone', 'sessionMode', 'multiple');
  });

  it('shows nothing in single-session mode, where there is only one session to run in', () => {
    __setConfig('gemstone', 'sessionMode', 'single');
    const { manager } = makeSessionManager([3], 3);
    expect(new WorkspaceSessionLensProvider(manager).provideCodeLenses()).toEqual([]);
  });

  it('redraws when the mode setting changes, appearing and disappearing with it', () => {
    __setConfig('gemstone', 'sessionMode', 'single');
    const { manager } = makeSessionManager([3], 3);
    const provider = new WorkspaceSessionLensProvider(manager);
    const redraw = vi.fn();
    provider.onDidChangeCodeLenses(redraw);

    changeSessionMode('multiple');
    expect(lens(provider).title).toContain('Session 3');
    changeSessionMode('single');
    expect(provider.provideCodeLenses()).toEqual([]);
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  it('names the active session and switches it on click', () => {
    const { manager } = makeSessionManager([3], 3);
    const command = lens(new WorkspaceSessionLensProvider(manager));
    expect(command.title).toContain('Session 3 · DataCurator on gs64stone (localhost)');
    expect(command.command).toBe('gemstone.selectSession');
  });

  it('asks for a session when some are logged in but none is active', () => {
    const { manager } = makeSessionManager([3, 4]);
    const command = lens(new WorkspaceSessionLensProvider(manager));
    expect(command.title).toContain('No active session');
    expect(command.command).toBe('gemstone.selectSession');
  });

  it('says not logged in, unclickable, with no sessions', () => {
    const { manager } = makeSessionManager([]);
    const command = lens(new WorkspaceSessionLensProvider(manager));
    expect(command.title).toContain('Not logged in');
    expect(command.command).toBe('');
  });

  it('asks VS Code to redraw, with the new session, when the active session changes', () => {
    const { manager, select } = makeSessionManager([3, 4], 3);
    const provider = new WorkspaceSessionLensProvider(manager);
    const redraw = vi.fn();
    provider.onDidChangeCodeLenses(redraw);

    select(4);

    expect(redraw).toHaveBeenCalledTimes(1);
    expect(lens(provider).title).toContain('Session 4');
  });

  it('redraws on a login and a logout, not only on a selection change', () => {
    const { manager, login, logout } = makeSessionManager([]);
    const provider = new WorkspaceSessionLensProvider(manager);
    const redraw = vi.fn();
    provider.onDidChangeCodeLenses(redraw);

    login(5);
    expect(lens(provider).title).toContain('No active session');
    logout(5);
    expect(lens(provider).title).toContain('Not logged in');
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes from all three session events when disposed', () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => ({ dispose: unsubscribe }));
    const manager = {
      onDidChangeSelection: subscribe,
      onDidAddSession: subscribe,
      onDidRemoveSession: subscribe,
    } as unknown as SessionManager;

    new WorkspaceSessionLensProvider(manager).dispose();

    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });
});

describe('WORKSPACE_SESSION_SELECTORS', () => {
  it('covers workspace buffers but not notebook cells, which show the session in the kernel label', () => {
    const schemes = WORKSPACE_SESSION_SELECTORS.map((s) => s.scheme);
    expect(schemes).toEqual(['untitled', 'file']);
    expect(schemes).not.toContain('vscode-notebook-cell');
  });
});

describe('chooseActiveSession', () => {
  it('offers the choice whenever there are two or more, even with one already active', async () => {
    const resolveSession = vi.fn(async () => undefined);
    const getSessions = () => [
      { id: 1, login: LOGIN },
      { id: 2, login: LOGIN },
    ];
    await chooseActiveSession({ resolveSession, getSessions } as unknown as SessionManager);
    expect(resolveSession).toHaveBeenCalledWith(expect.objectContaining({ alwaysAsk: true }));
  });
});

describe('followActiveSessionLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConfig();
    __setConfig('gemstone', 'sessionMode', 'multiple');
  });

  it('names the active session at once, and again when it changes', () => {
    const { manager, select } = makeSessionManager([3, 4], 3);
    const labels: (string | undefined)[] = [];
    followActiveSessionLabel(manager, (label) => labels.push(label));

    select(4);

    expect(labels).toEqual([
      'Session 3 · DataCurator on gs64stone (localhost)',
      'Session 4 · DataCurator on gs64stone (localhost)',
    ]);
  });

  it('gives no label in single-session mode, and follows the mode setting', () => {
    __setConfig('gemstone', 'sessionMode', 'single');
    const { manager } = makeSessionManager([3], 3);
    const labels: (string | undefined)[] = [];
    followActiveSessionLabel(manager, (label) => labels.push(label));

    changeSessionMode('multiple');
    changeSessionMode('single');

    expect(labels).toEqual([
      undefined,
      'Session 3 · DataCurator on gs64stone (localhost)',
      undefined,
    ]);
  });

  it('clears the label when the last session logs out', () => {
    const { manager, logout } = makeSessionManager([3], 3);
    const labels: (string | undefined)[] = [];
    followActiveSessionLabel(manager, (label) => labels.push(label));

    // The fake manager, like the real one, stops answering a session once it is gone.
    logout(3);

    expect(labels.at(-1)).toBeUndefined();
  });
});

describe('SessionPanelTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConfig();
    __setConfig('gemstone', 'sessionMode', 'multiple');
  });

  it('tags the title with the session number in multiple-session mode', () => {
    const panel = { title: '' };
    new SessionPanelTitle(panel, 2, 'Inspector');
    expect(panel.title).toBe('Inspector · Session 2');
  });

  it('leaves the title alone in single-session mode', () => {
    __setConfig('gemstone', 'sessionMode', 'single');
    const panel = { title: '' };
    new SessionPanelTitle(panel, 2, 'Inspector');
    expect(panel.title).toBe('Inspector');
  });

  it('keeps the tag through a new title and a new session', () => {
    const panel = { title: '' };
    const title = new SessionPanelTitle(panel, 2, 'Inspector');

    title.setTitle('Inspector: anArray');
    expect(panel.title).toBe('Inspector: anArray · Session 2');
    title.setSession(5);
    expect(panel.title).toBe('Inspector: anArray · Session 5');
  });

  it('adds and drops the tag as the mode setting changes, until disposed', () => {
    const panel = { title: '' };
    const title = new SessionPanelTitle(panel, 2, 'GemStone Debugger');

    changeSessionMode('single');
    expect(panel.title).toBe('GemStone Debugger');
    changeSessionMode('multiple');
    expect(panel.title).toBe('GemStone Debugger · Session 2');

    const unsubscribe = vi.mocked(workspace.onDidChangeConfiguration).mock.results[0].value;
    const dispose = vi.spyOn(unsubscribe, 'dispose');
    title.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});
