import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { runNbCall, setStillRunningHandler, setStoppedRunCollectedHandler } from '../nbRunner';
import { SessionManager } from '../sessionManager';
import { endServerSession } from '../forceStop';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { forceStopSupport } from './forceStopSupport';
import { endGemAfterTest, loginSerialOf } from './leftoverGem';

describe('Force Stop at logout (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  afterEach(() => {
    setStoppedRunCollectedHandler(undefined);
    setStillRunningHandler(undefined);
  });

  const { armedSession, deps, onStone, stopAndAbandon, settled } = forceStopSupport(() => session);

  // GemStone gives a gone gem's session number to a later login (in turn, wrapping
  // round at the stone's limit). Here that later login is stood in for by asking
  // to end the gone gem under another live login's number.
  it("does not end another login that has taken a gone gem's session number", async () => {
    const own = armedSession();
    const serial = loginSerialOf(own);
    own.logout();
    for (let i = 0; i < 40 && onStone(serial); i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(onStone(serial)).toBe(false);
    const { session: other } = session.transientLogin(session.login);
    onTestFinished(() => void other!.logout());
    const othersNumber = other!.executeAndFetchString('System session printString');

    endServerSession(own, othersNumber, deps);

    expect(other!.executeAndFetchString('(3 + 4) printString')).toBe('7');
  }, 30_000);

  describe('logging out a session whose stopped run is still going', () => {
    /** A logged-in session of its own, running `code` that the user has stopped. */
    async function loggedInAndStopped(
      manager: SessionManager,
      code: string,
      stop: (own: ActiveSession, code: string) => Promise<void> = stopAndAbandon,
    ) {
      const own = manager.login(session.login, process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH!);
      const serial = loginSerialOf(own);
      endGemAfterTest(() => session, own);
      await stop(own, code);
      return { own, serial };
    }

    async function offTheStone(serial: string, ms = 5000): Promise<boolean> {
      const deadline = Date.now() + ms;
      while (onStone(serial) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return !onStone(serial);
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

    it('ends the gem of a run whose clean-up ignores the stop as well', async () => {
      // The clean-up runs only once the run is stopped and thrown away, so the
      // Force Stop signal has already been used on the run; logging out is the
      // way out, as for any run Force Stop can't end.
      const manager = new SessionManager();
      const ignoresStop = '[[true] whileTrue: [nil]] on: Break do: [:e | e resume]';
      // A Break that lands outside the handler can stop the run outright; the
      // logout must end the gem either way.
      const { own, serial } = await loggedInAndStopped(
        manager,
        `[${ignoresStop}] ensure: [${ignoresStop}]`,
        async (on, code) => {
          let cancel: (() => void) | undefined;
          const run = runNbCall(
            on,
            () => on.GciTsNbExecute(code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
            () => on.GciTsNbResult(),
            { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
          );
          run.catch(() => {});
          cancel!();
          await settled(run);
        },
      );

      const startedAt = Date.now();
      await expect(manager.logout(own.id)).resolves.toBe(true);

      expect(await offTheStone(serial)).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(15_000);
    }, 60_000);

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
