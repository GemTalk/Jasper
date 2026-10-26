import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { armForceStop, forceStop, FORCE_STOP_WAIT_MS, rearmAfterForceStop } from '../forceStop';
import {
  NbCancelledError,
  runNbCall,
  setStillRunningHandler,
  setStoppedRunCollectedHandler,
  stoppedRunHolds,
} from '../nbRunner';
import {
  endClientForwarderMode,
  installTranscriptSink,
  settleNbResult,
  startClientForwarderMode,
} from '../transcriptSink';
import { BrowserQueryError, executeFetchString } from '../browserQueries';
import { SessionManager } from '../sessionManager';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';

describe('Force Stop (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  afterEach(() => {
    setStoppedRunCollectedHandler(undefined);
    setStillRunningHandler(undefined);
  });

  const listed = (serial: string) =>
    session.executeAndFetchString(`(System currentSessions includes: ${serial}) printString`) ===
    'true';

  /** A session of its own, armed as a login arms it; its gem is ended whatever the test does. */
  function armedSession(): ActiveSession {
    const { session: own, err } = session.transientLogin(session.login);
    if (!own) throw new Error(`Login failed: ${err.message}`);
    const serial = own.executeAndFetchString('System session printString');
    onTestFinished(() => {
      if (listed(serial)) session.executeAndFetchString(`System stopSession: ${serial}. 'ok'`);
    });
    armForceStop(own);
    return own;
  }

  const deps = {
    loginTransient: (from: ActiveSession) => {
      const { session: sender, err } = from.transientLogin(from.login);
      if (!sender) throw new Error(`Login failed: ${err.message}`);
      return { session: sender, logout: () => void sender.logout() };
    },
  };

  /** Start `code`, press stop, and wait until the runner gives up waiting for it. */
  async function stopAndAbandon(own: ActiveSession, code: string): Promise<void> {
    let cancel: (() => void) | undefined;
    const run = runNbCall(
      own,
      () => own.GciTsNbExecute(code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
      () => own.GciTsNbResult(),
      { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
    );
    run.catch(() => {});
    cancel!();
    await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    expect(stoppedRunHolds(own)).toBe(true);
  }

  const armed = (own: ActiveSession) =>
    own.executeAndFetchString('System signaledGemStoneSessionErrorStatus printString');

  it('stops a run that ignores the stop, keeping the session and its uncommitted changes', async () => {
    const own = armedSession();
    own.executeAndFetchString(`UserGlobals at: #ForceStopProbe put: 1. 'ok'`);
    await stopAndAbandon(own, '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]');

    const startedAt = Date.now();
    await expect(forceStop(own, deps)).resolves.toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(FORCE_STOP_WAIT_MS);

    expect(own.executeAndFetchString('System needsCommit printString')).toBe('true');
    expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
    expect(armed(own)).toBe('true');
    own.executeAndFetchString(`System abortTransaction. 'ok'`);
    expect(armed(own)).toBe('true');
  }, 30_000);

  it('can stop the same session again', async () => {
    const own = armedSession();
    for (let i = 0; i < 2; i++) {
      await stopAndAbandon(own, '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]');
      await expect(forceStop(own, deps)).resolves.toBe(true);
    }
    expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
  }, 30_000);

  it('stops a run while it streams to the Transcript', async () => {
    const own = armedSession();
    installTranscriptSink(own);
    const code =
      "[Transcript nextPutAll: 'streaming'. [true] whileTrue: [nil]] on: Break do: [:e | e resume]";
    let wroteOnce: () => void = () => {};
    const onWorker = new Promise<void>((resolve) => (wroteOnce = resolve));
    let cancel: (() => void) | undefined;
    startClientForwarderMode(own, code);
    const run = runNbCall(
      own,
      () => own.GciTsNbExecute(code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
      (signal) => settleNbResult(own, () => wroteOnce(), signal),
      {
        suppressNotification: true,
        disposableProcess: true,
        onStart: (c) => (cancel = c),
        onAbandonedCollected: () => endClientForwarderMode(own),
      },
    );
    run.catch(() => {});
    await onWorker;
    cancel!();
    await expect(run).rejects.toBeInstanceOf(NbCancelledError);

    await expect(forceStop(own, deps)).resolves.toBe(true);
    expect(own.executeAndFetchString("Transcript nextPutAll: 'after'. (3 + 4) printString")).toBe(
      '7',
    );
  }, 30_000);

  it('offers Force Stop when an Explorer query is blocked by the stopped run', async () => {
    const told = vi.fn();
    setStillRunningHandler(told);
    const own = armedSession();
    await stopAndAbandon(own, '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]');
    told.mockClear();

    expect(() => executeFetchString(own, '(3 + 4) printString')).toThrow(BrowserQueryError);
    expect(told).toHaveBeenCalledWith(own);

    await expect(forceStop(own, deps)).resolves.toBe(true);
    expect(executeFetchString(own, '(3 + 4) printString')).toBe('7');
  }, 30_000);

  it('says a run that catches every exception is still going, and re-arms once it ends', async () => {
    setStoppedRunCollectedHandler(rearmAfterForceStop);
    const own = armedSession();
    await stopAndAbandon(
      own,
      '| t | t := Time millisecondClockValue. ' +
        '[[(Time millisecondClockValue - t) < 9000] whileTrue: [nil]] on: Exception do: [:e | e resume]',
    );

    await expect(forceStop(own, deps)).resolves.toBe(false);
    expect(stoppedRunHolds(own)).toBe(true);

    const deadline = Date.now() + 15_000;
    while (stoppedRunHolds(own) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(stoppedRunHolds(own)).toBe(false);
    expect(armed(own)).toBe('true');
  }, 40_000);

  describe('logging out a session whose stopped run is still going', () => {
    /** A logged-in session of its own, running `code` that the user has stopped. */
    async function loggedInAndStopped(manager: SessionManager, code: string) {
      const own = manager.login(session.login, process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH!);
      const serial = own.executeAndFetchString('System session printString');
      onTestFinished(() => {
        if (listed(serial)) session.executeAndFetchString(`System stopSession: ${serial}. 'ok'`);
      });
      await stopAndAbandon(own, code);
      return { own, serial };
    }

    async function offTheStone(serial: string, ms = 5000): Promise<boolean> {
      const deadline = Date.now() + ms;
      while (listed(serial) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return !listed(serial);
    }

    it('ends the gem of a run that ignores the stop', async () => {
      const manager = new SessionManager();
      const { own, serial } = await loggedInAndStopped(
        manager,
        '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]',
      );

      await expect(manager.logout(own.id)).resolves.toBe(true);

      expect(await offTheStone(serial)).toBe(true);
    }, 30_000);

    it('ends the gem of a run that ignores Force Stop too', async () => {
      const manager = new SessionManager();
      const { own, serial } = await loggedInAndStopped(
        manager,
        '[[true] whileTrue: [nil]] on: Exception do: [:e | e resume]',
      );

      await expect(manager.logout(own.id)).resolves.toBe(true);

      expect(await offTheStone(serial)).toBe(true);
    }, 30_000);
  });
});
