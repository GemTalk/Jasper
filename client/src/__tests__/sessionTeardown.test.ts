import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

const { panelMock } = vi.hoisted(() => ({
  panelMock: () => ({ disposeForSession: vi.fn() }),
}));
vi.mock('../enhancedInspector/enhancedInspector', () => ({ EnhancedInspector: panelMock() }));
vi.mock('../basicInspector/basicInspector', () => ({ BasicInspector: panelMock() }));
vi.mock('../debugger/debuggerPanel', () => ({ DebuggerPanel: panelMock() }));
// The pin registry is the real one; only its calls to the stone are stubbed.
vi.mock('../debugger/debugQueries', () => ({ saveObjs: vi.fn(), releaseObjs: vi.fn() }));

import { registerSessionTeardown } from '../sessionTeardown';
import { EnhancedInspector } from '../enhancedInspector/enhancedInspector';
import { BasicInspector } from '../basicInspector/basicInspector';
import { DebuggerPanel } from '../debugger/debuggerPanel';
import { pinCount, pinObject, unpinObjects } from '../exportSetPins';
import { releaseObjs } from '../debugger/debugQueries';
import type { ActiveSession } from '../activeSession';

const panels = {
  EnhancedInspector,
  BasicInspector,
  DebuggerPanel,
};
const sessionWithId = (id: number) => ({ id }) as ActiveSession;

/**
 * Closing a session's inspectors and debuggers and clearing its breakpoints and
 * pins whenever any logout removes it, not only the Logout command's (#775).
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

  it('closes its inspectors and debuggers, and clears its breakpoints, for the session that left', () => {
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
