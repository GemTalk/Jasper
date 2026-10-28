import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

const { panelMock } = vi.hoisted(() => ({
  panelMock: () => ({ disposeForSession: vi.fn() }),
}));
vi.mock('../enhancedInspector/enhancedInspector', () => ({ EnhancedInspector: panelMock() }));
vi.mock('../basicInspector/basicInspector', () => ({ BasicInspector: panelMock() }));
vi.mock('../debugger/debuggerPanel', () => ({ DebuggerPanel: panelMock() }));
vi.mock('../systemBrowser', () => ({ SystemBrowser: panelMock() }));
vi.mock('../globalsBrowser', () => ({ GlobalsBrowser: panelMock() }));
vi.mock('../commentBrowser', () => ({ CommentBrowser: panelMock() }));
// The pin registry is the real one; only its calls to the stone are stubbed.
vi.mock('../debugger/debugQueries', () => ({ saveObjs: vi.fn(), releaseObjs: vi.fn() }));
vi.mock('../nbRunner', async (orig) => ({
  ...(await orig()),
  stopCallsOn: vi.fn(async () => {}),
}));

import { registerSessionTeardown } from '../sessionTeardown';
import { EnhancedInspector } from '../enhancedInspector/enhancedInspector';
import { BasicInspector } from '../basicInspector/basicInspector';
import { DebuggerPanel } from '../debugger/debuggerPanel';
import { SystemBrowser } from '../systemBrowser';
import { GlobalsBrowser } from '../globalsBrowser';
import { CommentBrowser } from '../commentBrowser';
import { pinCount, pinObject, unpinObjects } from '../exportSetPins';
import { releaseObjs } from '../debugger/debugQueries';
import type { ActiveSession } from '../activeSession';
import { SessionManager } from '../sessionManager';
import { fakeActiveSession } from './fakeActiveSession';

const panels = {
  EnhancedInspector,
  BasicInspector,
  DebuggerPanel,
  SystemBrowser,
  GlobalsBrowser,
  CommentBrowser,
};
const sessionWithId = (id: number) => ({ id }) as ActiveSession;

/**
 * Closing a session's browsers, inspectors and debuggers and clearing its
 * breakpoints and pins whenever any logout removes it, not only the Logout
 * command's (#775).
 */
describe('registerSessionTeardown', () => {
  let listeners: Array<(id: number) => void>;
  const sessions = {
    onDidRemoveSession: (listener: (id: number) => void) => {
      listeners.push(listener);
      return { dispose: () => (listeners = listeners.filter((l) => l !== listener)) };
    },
  };
  const removeSession = (id: number) => listeners.forEach((l) => l(id));
  const breakpoints = { clearAllForSession: vi.fn() };
  const stepPointHints = { refresh: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    listeners = [];
  });

  it('closes its browsers, inspectors and debuggers, and clears its breakpoints, for the session that left', () => {
    registerSessionTeardown(sessions, breakpoints, stepPointHints);

    removeSession(7);

    for (const [name, panel] of Object.entries(panels)) {
      expect(vi.mocked(panel.disposeForSession).mock.calls, name).toEqual([[7]]);
    }
    expect(breakpoints.clearAllForSession.mock.calls).toEqual([[7]]);
    expect(stepPointHints.refresh).toHaveBeenCalledTimes(1);
  });

  it('forgets the session’s pins, and only that session’s', () => {
    pinObject(sessionWithId(7), 42n);
    pinObject(sessionWithId(8), 42n);
    registerSessionTeardown(sessions, breakpoints, stepPointHints);

    removeSession(7);

    expect(pinCount(7, 42n)).toBe(0);
    expect(pinCount(8, 42n)).toBe(1);
  });

  // The Basic Inspector and the debugger release their pins as they close; with
  // the pins still recorded, each would call the logged-out session.
  it('lets a closing panel release its pins without calling the session', () => {
    const gone = sessionWithId(9);
    pinObject(gone, 42n);
    vi.mocked(BasicInspector.disposeForSession).mockImplementationOnce(() =>
      unpinObjects(gone, [42n]),
    );
    registerSessionTeardown(sessions, breakpoints, stepPointHints);

    removeSession(9);

    expect(releaseObjs).not.toHaveBeenCalled();
  });

  it('does nothing until a session leaves, and nothing once disposed', () => {
    const registration = registerSessionTeardown(sessions, breakpoints, stepPointHints);
    for (const panel of Object.values(panels))
      expect(panel.disposeForSession).not.toHaveBeenCalled();

    registration.dispose();
    removeSession(7);

    for (const panel of Object.values(panels))
      expect(panel.disposeForSession).not.toHaveBeenCalled();
    expect(breakpoints.clearAllForSession).not.toHaveBeenCalled();
  });
});

// Wired to a real manager, as stopping a stone logs its sessions out: only the
// sessions that actually leave lose their panels.
describe('registerSessionTeardown on a stone stop', () => {
  const breakpoints = { clearAllForSession: vi.fn() };
  const stepPointHints = { refresh: vi.fn() };
  let manager: SessionManager;

  // Each session refuses `refusals[id]` logouts, then lets go.
  const managerWith = (ids: number[], refusals: Record<number, number> = {}) => {
    manager = new SessionManager();
    const registered = (manager as unknown as { sessions: Map<number, ActiveSession> }).sessions;
    for (const id of ids) {
      let left = refusals[id] ?? 0;
      const gci = { logout: () => ({ sessionFreed: !(left-- > 0) }) };
      registered.set(id, fakeActiveSession({ id, gci, handle: {}, login: { label: `S${id}` } }));
    }
    registerSessionTeardown(manager, breakpoints, stepPointHints);
  };
  const closedFor = () =>
    Object.fromEntries(
      Object.entries(panels).map(([name, panel]) => [
        name,
        vi.mocked(panel.disposeForSession).mock.calls.map(([id]) => id),
      ]),
    );
  const everyPanel = (ids: number[]) =>
    Object.fromEntries(Object.keys(panels).map((name) => [name, ids]));

  beforeEach(() => vi.clearAllMocks());

  it('closes every panel of each session the stone took, and none of the one that stays', async () => {
    managerWith([1, 2, 3]);

    await manager.logoutAll([1, 2]);

    expect(closedFor()).toEqual(everyPanel([1, 2]));
    expect(breakpoints.clearAllForSession.mock.calls).toEqual([[1], [2]]);
  });

  it('keeps every panel of a session whose logout is refused', async () => {
    managerWith([1, 2], { 2: Infinity });

    await manager.logoutAll([1, 2]);

    expect(manager.getSession(2)).toBeDefined();
    expect(closedFor()).toEqual(everyPanel([1]));
    expect(breakpoints.clearAllForSession.mock.calls).toEqual([[1]]);
  });

  it('closes a session’s panels once its run stops and the retried logout goes through', async () => {
    managerWith([1], { 1: 1 });

    await manager.logoutAll([1]);

    expect(closedFor()).toEqual(everyPanel([1]));
  });

  it('closes them on a single logout, as the Log out command makes', async () => {
    managerWith([1, 2]);

    await manager.logout(2);

    expect(closedFor()).toEqual(everyPanel([2]));
  });

  it('closes them only once when the same session is logged out twice', async () => {
    managerWith([1]);

    await Promise.all([manager.logout(1), manager.logoutAll([1])]);

    expect(closedFor()).toEqual(everyPanel([1]));
  });
});
