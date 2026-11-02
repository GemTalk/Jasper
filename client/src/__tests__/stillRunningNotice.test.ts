import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window } from '../__mocks__/vscode';
import type { ActiveSession } from '../activeSession';
import { DEFAULT_LOGIN, loginLabel } from '../loginTypes';
import {
  FORCE_STOP,
  LOG_OUT,
  SHOW_IN_SESSIONS,
  STOP,
  showRunInProgress,
  showStillRunning,
} from '../stillRunningNotice';

// Each test a minute after the last, in whatever order they run, so none falls
// inside the notice's burst window of another.
let clock = Date.parse('2026-10-26T12:00:00Z');

const session = { id: 3, login: { ...DEFAULT_LOGIN, stone: 'gs64stone' } } as ActiveSession;

function deps(registered = true, stops = true, cleaningUp = false) {
  return {
    isRegistered: vi.fn(() => registered),
    cleaningUp: vi.fn(() => cleaningUp),
    forceStop: vi.fn(async () => stops),
    logout: vi.fn(async () => true),
    showInSessions: vi.fn(),
  };
}

/** The user picks Force Stop on the notice, then answers the logout question with `confirm`. */
function pickForceStop(confirm?: string): void {
  vi.mocked(window.showWarningMessage)
    .mockResolvedValueOnce(FORCE_STOP)
    .mockResolvedValueOnce(confirm);
}

describe('the "stopped run is still running" notice', () => {
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
      expect.stringMatching(/^Jasper session 3 — .*still running on the server/),
      FORCE_STOP,
      SHOW_IN_SESSIONS,
    );
  });

  // Closing a debugger clears its process in the background, with no stop pressed.
  it('names a clean-up as one, and still offers Force Stop', async () => {
    await showStillRunning(session, deps(true, true, true));

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      `Jasper session 3 — ${loginLabel(session.login)}: a previous run is still cleaning up on the ` +
        'server. Nothing else can run on this session until it ends.',
      FORCE_STOP,
      SHOW_IN_SESSIONS,
    );
  });

  it("shows the session's row in the stone's session list, where Kill is, and nothing else", async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(SHOW_IN_SESSIONS);
    const d = deps();

    await showStillRunning(session, d);

    expect(d.showInSessions).toHaveBeenCalledWith(session);
    expect(d.forceStop).not.toHaveBeenCalled();
    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it('force-stops the run, keeps the session, and says so', async () => {
    pickForceStop();
    const d = deps();

    await showStillRunning(session, d);

    expect(d.forceStop).toHaveBeenCalledWith(session);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Jasper session 3: the run is stopped\. Uncommitted changes are kept\.$/,
      ),
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
        /^The run is ignoring Force Stop too\. Log out Jasper session 3 .*uncommitted changes .* are lost\.$/,
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
      expect.stringMatching(/^Force Stop failed: login failed\. Log out Jasper session 3/),
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

describe('the "a run is still going" notice', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime((clock += 60_000));
    vi.clearAllMocks();
    vi.mocked(window.showWarningMessage).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const runDeps = (stops = true) => ({
    isRegistered: vi.fn(() => true),
    stop: vi.fn(() => stops),
  });

  it('says a run holds the session, and offers to stop it', async () => {
    await showRunInProgress(session, runDeps());

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/^Jasper session 3 — .*a run is still going on this session/),
      STOP,
    );
  });

  it('stops the run when asked', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP);
    const d = runDeps();

    await showRunInProgress(session, d);

    expect(d.stop).toHaveBeenCalledWith(session);
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('says so when the run ended before Stop was pressed', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(STOP);

    await showRunInProgress(session, runDeps(false));

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Jasper session 3: that run has already ended.',
    );
  });

  it('shows one per burst, independently of the Force Stop notice', async () => {
    await showRunInProgress(session, runDeps());
    await showRunInProgress(session, runDeps());
    await showStillRunning(session, {
      isRegistered: () => true,
      cleaningUp: () => false,
      forceStop: async () => true,
      logout: async () => true,
      showInSessions: () => {},
    });

    expect(window.showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it("says nothing about Jasper's own short-lived logins", async () => {
    await showRunInProgress(session, { isRegistered: () => false, stop: vi.fn(() => true) });

    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });
});
