import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window } from '../__mocks__/vscode';
import type { ActiveSession } from '../activeSession';
import { DEFAULT_LOGIN } from '../loginTypes';
import { FORCE_STOP, LOG_OUT, showStillRunning } from '../stillRunningNotice';

const session = { id: 3, login: { ...DEFAULT_LOGIN, stone: 'gs64stone' } } as ActiveSession;

function deps(registered = true, stops = true) {
  return {
    isRegistered: vi.fn(() => registered),
    forceStop: vi.fn(async () => stops),
    logout: vi.fn(async () => true),
  };
}

/** The user picks Force Stop on the notice, then answers the logout question with `confirm`. */
function pickForceStop(confirm?: string): void {
  vi.mocked(window.showWarningMessage)
    .mockResolvedValueOnce(FORCE_STOP)
    .mockResolvedValueOnce(confirm);
}

describe('the "stopped run is still running" notice', () => {
  // Each test a minute after the last, past the notice's burst window.
  let clock = Date.parse('2026-10-26T12:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime((clock += 60_000));
    vi.clearAllMocks();
    // Drops answers an earlier test queued and never used.
    vi.mocked(window.showWarningMessage).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('says the run is still running, and offers Force Stop', async () => {
    await showStillRunning(session, deps());

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^Session 3 — .*still running on the server/),
      FORCE_STOP,
    );
  });

  it('force-stops the run, keeps the session, and says so', async () => {
    pickForceStop();
    const d = deps();

    await showStillRunning(session, d);

    expect(d.forceStop).toHaveBeenCalledWith(session);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^Session 3: the run is stopped\. Uncommitted changes are kept\.$/),
    );
    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(d.logout).not.toHaveBeenCalled();
  });

  it('offers to log out a run that ignores Force Stop, asking first', async () => {
    pickForceStop(LOG_OUT);
    const d = deps(true, false);

    await showStillRunning(session, d);

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^The run is ignoring Force Stop too\. Log out session 3 .*uncommitted changes .* are lost\.$/,
      ),
      { modal: true },
      LOG_OUT,
    );
    expect(d.logout).toHaveBeenCalledWith(3);
  });

  it('offers to log out when Force Stop itself fails, saying why', async () => {
    pickForceStop();
    const d = deps();
    d.forceStop.mockRejectedValueOnce(new Error('login failed'));

    await showStillRunning(session, d);

    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Force Stop failed: login failed\. Log out session 3/),
      { modal: true },
      LOG_OUT,
    );
  });

  it('logs nothing out when the logout question is dismissed', async () => {
    pickForceStop(undefined);
    const d = deps(true, false);

    await showStillRunning(session, d);

    expect(d.logout).not.toHaveBeenCalled();
  });

  it('does nothing when the notice is dismissed', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(undefined);
    const d = deps();

    await showStillRunning(session, d);

    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(d.forceStop).not.toHaveBeenCalled();
  });

  it('shows the error when the logout fails', async () => {
    pickForceStop(LOG_OUT);
    const d = deps(true, false);
    d.logout.mockRejectedValueOnce(new Error('Session 3 could not be logged out'));

    await showStillRunning(session, d);

    expect(window.showErrorMessage).toHaveBeenCalledWith('Session 3 could not be logged out');
  });

  it('shows one notice for a burst of refusals, and again after it', async () => {
    const d = deps();

    await showStillRunning(session, d);
    await showStillRunning(session, d);
    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2000);
    await showStillRunning(session, d);
    expect(window.showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it("says nothing about Jasper's own short-lived logins", async () => {
    await showStillRunning(session, deps(false));

    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('does nothing when the session went away while the notice was up', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(FORCE_STOP);
    const d = deps();
    d.isRegistered.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await showStillRunning(session, d);

    expect(d.forceStop).not.toHaveBeenCalled();
  });
});
