import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', async (orig) => ({ ...(await orig()), logInfo: vi.fn() }));
vi.mock('../nbRunner', () => ({ stoppedRunHolds: vi.fn(), isRunning: vi.fn(() => false) }));

import type { ActiveSession } from '../activeSession';
import {
  armForceStop,
  forceStop,
  forgetForceStop,
  rearmAfterForceStop,
  FORCE_STOP_WAIT_MS,
  SESSION_SIGNAL_ERROR,
} from '../forceStop';
import { GciLibraryError } from '../gciLibraryError';
import { isRunning, stoppedRunHolds } from '../nbRunner';

let nextId = 1;

function fakeSession(serverSession = '42') {
  const executeAndFetchString = vi.fn((_code: string) => serverSession);
  return {
    session: { id: nextId++, executeAndFetchString } as unknown as ActiveSession,
    executeAndFetchString,
  };
}

function fakeSender() {
  const executeAndFetchString = vi.fn((_code: string) => 'ok');
  const logout = vi.fn();
  return {
    deps: {
      loginTransient: vi.fn(() => ({
        session: { executeAndFetchString } as unknown as ActiveSession,
        logout,
      })),
    },
    executeAndFetchString,
    logout,
  };
}

const signalError = (): GciLibraryError =>
  GciLibraryError.fromGciError({ number: SESSION_SIGNAL_ERROR, message: 'signal' });

describe('Force Stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Held when Force Stop is pressed, free once the signal is sent.
    vi.mocked(stoppedRunHolds).mockReturnValue(false).mockReturnValueOnce(true);
  });

  it('is armed at login, learning the GemStone session number', () => {
    const { session, executeAndFetchString } = fakeSession();

    armForceStop(session);

    expect(executeAndFetchString).toHaveBeenCalledWith(
      expect.stringMatching(/System enableSignaledGemStoneSessionError\..*System session/),
    );
  });

  it('signals the session from a short-lived login, and logs that login out', async () => {
    const { session } = fakeSession('42');
    armForceStop(session);
    const sender = fakeSender();

    await expect(forceStop(session, sender.deps)).resolves.toBe(true);

    expect(sender.deps.loginTransient).toHaveBeenCalledWith(session);
    expect(sender.executeAndFetchString).toHaveBeenCalledWith(
      expect.stringMatching(/^System sendSignal: 1 to: 42 withMessage: /),
    );
    expect(sender.logout).toHaveBeenCalled();
  });

  it('logs the short-lived login out even when the signal fails', async () => {
    const { session } = fakeSession();
    armForceStop(session);
    const sender = fakeSender();
    sender.executeAndFetchString.mockImplementationOnce(() => {
      throw new Error('refused');
    });

    await expect(forceStop(session, sender.deps)).rejects.toThrow('refused');
    expect(sender.logout).toHaveBeenCalled();
  });

  it('sends nothing when the run has already ended', async () => {
    const { session } = fakeSession();
    armForceStop(session);
    vi.mocked(stoppedRunHolds).mockReset().mockReturnValue(false);
    const sender = fakeSender();

    await expect(forceStop(session, sender.deps)).resolves.toBe(true);
    expect(sender.deps.loginTransient).not.toHaveBeenCalled();
  });

  it('refuses a session that was never armed', async () => {
    const { session } = fakeSession();
    const sender = fakeSender();

    await expect(forceStop(session, sender.deps)).rejects.toThrow(/not available/);
    expect(sender.deps.loginTransient).not.toHaveBeenCalled();
  });

  it('re-arms the session once the run has ended', async () => {
    const { session, executeAndFetchString } = fakeSession();
    armForceStop(session);
    executeAndFetchString.mockClear();

    await forceStop(session, fakeSender().deps);

    expect(executeAndFetchString).toHaveBeenCalledTimes(1);
    expect(executeAndFetchString).toHaveBeenCalledWith(
      expect.stringContaining('enableSignaledGemStoneSessionError'),
    );
  });

  it('takes a signal that arrived after the run ended, so the next run does not', async () => {
    const { session, executeAndFetchString } = fakeSession();
    armForceStop(session);
    executeAndFetchString.mockClear();
    executeAndFetchString.mockImplementationOnce(() => {
      throw signalError();
    });

    await expect(forceStop(session, fakeSender().deps)).resolves.toBe(true);

    expect(executeAndFetchString).toHaveBeenCalledTimes(2);
  });

  it('waits for the stopped run to let go of the session', async () => {
    vi.useFakeTimers();
    try {
      const { session } = fakeSession();
      armForceStop(session);
      vi.mocked(stoppedRunHolds).mockReturnValueOnce(true).mockReturnValueOnce(true);

      const stopping = forceStop(session, fakeSender().deps);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(stopping).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers false for a run still going after the wait, and leaves it alone', async () => {
    vi.useFakeTimers();
    try {
      const { session, executeAndFetchString } = fakeSession();
      armForceStop(session);
      executeAndFetchString.mockClear();
      vi.mocked(stoppedRunHolds).mockReturnValue(true);

      const stopping = forceStop(session, fakeSender().deps);
      await vi.advanceTimersByTimeAsync(FORCE_STOP_WAIT_MS + 200);

      await expect(stopping).resolves.toBe(false);
      expect(executeAndFetchString).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms later, when the run that ignored the signal is collected', async () => {
    vi.useFakeTimers();
    try {
      const { session, executeAndFetchString } = fakeSession();
      armForceStop(session);
      vi.mocked(stoppedRunHolds).mockReturnValue(true);
      const stopping = forceStop(session, fakeSender().deps);
      await vi.advanceTimersByTimeAsync(FORCE_STOP_WAIT_MS + 200);
      await stopping;
      executeAndFetchString.mockClear();

      rearmAfterForceStop(session);
      rearmAfterForceStop(session);

      expect(executeAndFetchString).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not touch a session that a new run holds', async () => {
    const { session, executeAndFetchString } = fakeSession();
    armForceStop(session);
    executeAndFetchString.mockClear();
    vi.mocked(isRunning).mockReturnValueOnce(true);

    await expect(forceStop(session, fakeSender().deps)).resolves.toBe(true);

    expect(executeAndFetchString).not.toHaveBeenCalled();
  });

  it('re-arms nothing for a session never signalled, or one logged out', () => {
    const { session, executeAndFetchString } = fakeSession();
    armForceStop(session);
    executeAndFetchString.mockClear();

    rearmAfterForceStop(session);
    forgetForceStop(session.id);

    expect(executeAndFetchString).not.toHaveBeenCalled();
  });
});
