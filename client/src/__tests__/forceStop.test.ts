import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', async (orig) => ({ ...(await orig()), logInfo: vi.fn() }));
vi.mock('../nbRunner', () => ({
  stoppedRunHolds: vi.fn(),
  isRunning: vi.fn(() => false),
  clearHolds: vi.fn(() => false),
}));

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
import { clearHolds, isRunning, stoppedRunHolds } from '../nbRunner';

let nextId = 1;

function fakeSession(serverSession = '42') {
  const executeAndFetchString = vi.fn((_code: string) => serverSession);
  const GciTsBreak = vi.fn();
  return {
    session: { id: nextId++, executeAndFetchString, GciTsBreak } as unknown as ActiveSession,
    executeAndFetchString,
    GciTsBreak,
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

  it('also sends a hard break to clean-up code a clear is running, and only then', async () => {
    // On 3.7.5 that clean-up takes neither the signal nor a soft break.
    const run = fakeSession();
    armForceStop(run.session);
    await forceStop(run.session, fakeSender().deps);
    expect(run.GciTsBreak).not.toHaveBeenCalled();

    // Held when pressed and for two polls after the signal, by clean-up that
    // only began once the signal had stopped the run.
    vi.mocked(stoppedRunHolds)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    vi.mocked(clearHolds).mockReturnValueOnce(false).mockReturnValueOnce(true);
    const cleanUp = fakeSession();
    armForceStop(cleanUp.session);
    await expect(forceStop(cleanUp.session, fakeSender().deps)).resolves.toBe(true);
    expect(cleanUp.GciTsBreak).toHaveBeenCalledTimes(1);
    expect(cleanUp.GciTsBreak).toHaveBeenCalledWith(true);
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

  it('gives a hard break sent to late clean-up a full wait of its own', async () => {
    // The clean-up starts only once the signal has stopped the run, near the end
    // of the wait; on 3.6.2 the hard break then takes about 1.5s to land.
    vi.useFakeTimers();
    try {
      const { session } = fakeSession();
      armForceStop(session);
      const startedAt = Date.now();
      const cleanUpFrom = startedAt + FORCE_STOP_WAIT_MS - 300;
      const cleanUpEnds = cleanUpFrom + 1500;
      vi.mocked(stoppedRunHolds).mockImplementation(() => Date.now() < cleanUpEnds);
      vi.mocked(clearHolds).mockImplementation(() => Date.now() >= cleanUpFrom);

      const stopping = forceStop(session, fakeSender().deps);
      await vi.advanceTimersByTimeAsync(FORCE_STOP_WAIT_MS + 1500);

      await expect(stopping).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
      vi.mocked(clearHolds).mockReset().mockReturnValue(false);
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
