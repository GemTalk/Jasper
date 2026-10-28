import { expect } from 'vitest';
import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { armForceStop } from '../forceStop';
import { NbCancelledError, runNbCall, stoppedRunHolds } from '../nbRunner';
import { endGemAfterTest } from './leftoverGem';

/** What the Force Stop stone tests share, for the session `getSession` answers. */
export function forceStopSupport(getSession: () => ActiveSession) {
  const listed = (serial: string) =>
    getSession().executeAndFetchString(
      `(System currentSessions includes: ${serial}) printString`,
    ) === 'true';

  /** A session of its own, armed as a login arms it; its gem is ended whatever the test does. */
  function armedSession(): ActiveSession {
    const { session: own, err } = getSession().transientLogin(getSession().login);
    if (!own) throw new Error(`Login failed: ${err.message}`);
    endGemAfterTest(getSession, own);
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

  /** Waits for `run` to end either way a stop ends it: given up on, or answered. */
  async function settled(run: Promise<unknown>): Promise<void> {
    await run.then(
      () => {},
      (e) => {
        if (!(e instanceof NbCancelledError)) throw e;
      },
    );
  }

  const armed = (own: ActiveSession) =>
    own.executeAndFetchString('System signaledGemStoneSessionErrorStatus printString');

  return { listed, armedSession, deps, stopAndAbandon, settled, armed };
}
