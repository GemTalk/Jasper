import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import {
  clearInBackground,
  runNbCall,
  setStillRunningHandler,
  setStoppedRunCollectedHandler,
  stoppedRunHolds,
} from '../nbRunner';
import {
  drainTranscript,
  endClientForwarderMode,
  installTranscriptSink,
  settleNbResult,
  startClientForwarderMode,
} from '../transcriptSink';
import { executeFetchString } from '../browserQueries';
import { SESSION_BUSY_MESSAGE } from '../gciLibraryError';
import { GCI_PERFORM_FLAG_ENABLE_DEBUG, GCI_PERFORM_FLAG_INTERPRETED } from '../gciConstants';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { forceStopSupport } from './forceStopSupport';

describe('clearing a stopped run in the background (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  afterEach(() => {
    setStoppedRunCollectedHandler(undefined);
    setStillRunningHandler(undefined);
  });

  const { armedSession } = forceStopSupport(() => session);

  // Clearing a paused run runs its ensure: blocks inside the call.
  describe('clearing a stopped run', () => {
    /** A run paused at a halt, whose clean-up is `ensure`. */
    function pausedWithCleanUp(own: ActiveSession, ensure: string): bigint {
      const { err } = own.GciTsExecute(
        `[nil halt] ensure: [${ensure}]`,
        OOP_CLASS_UTF8,
        OOP_ILLEGAL,
        OOP_NIL,
        GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
        0,
      );
      expect(err.number).toBe(2709);
      return BigInt(err.context);
    }

    it('runs slow clean-up without holding up VS Code, and holds the session meanwhile', async () => {
      const told = vi.fn();
      setStillRunningHandler(told);
      const own = armedSession();
      const process = pausedWithCleanUp(own, '(Delay forSeconds: 2) wait');
      let ticks = 0;
      const ticking = setInterval(() => ticks++, 100);
      onTestFinished(() => clearInterval(ticking));

      const startedAt = Date.now();
      const clearing = clearInBackground(own, process);
      expect(() => executeFetchString(own, '3 printString')).toThrow(SESSION_BUSY_MESSAGE);
      expect(told).toHaveBeenCalledWith(own);
      await clearing;

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
      expect(ticks).toBeGreaterThan(10);
      expect(stoppedRunHolds(own)).toBe(false);
      expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
    }, 30_000);

    it("keeps a clean-up's Transcript writes when forwarding is ended before the clear, as Execute It does", async () => {
      // On 3.7.5 a clean-up that writes to the Transcript while forwarding is on
      // stops at that write, and the rest of it never runs.
      const own = armedSession();
      installTranscriptSink(own);
      const code =
        "[[true] whileTrue] ensure: [Transcript show: 'cleaned up'. " +
        "UserGlobals at: #ForceStopCleanUp put: 'ran to the end']";
      own.executeAndFetchString(`UserGlobals at: #ForceStopCleanUp put: 'not'. 'ok'`);
      startClientForwarderMode(own, code);
      let cancel: (() => void) | undefined;
      const run = runNbCall(
        own,
        () =>
          own.GciTsNbExecute(
            code,
            OOP_CLASS_UTF8,
            OOP_ILLEGAL,
            OOP_NIL,
            GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
            0,
          ),
        (signal) => settleNbResult(own, () => {}, signal),
        { suppressNotification: true, onStart: (c) => (cancel = c) },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      cancel!();
      const { err } = await run;
      expect(err.number).toBe(6003);

      endClientForwarderMode(own);
      let written = '';
      await clearInBackground(own, err.context, () => (written = drainTranscript(own)));

      expect(written).toContain('cleaned up');
      expect(own.executeAndFetchString('(UserGlobals at: #ForceStopCleanUp) printString')).toBe(
        "'ran to the end'",
      );
      own.executeAndFetchString(`UserGlobals removeKey: #ForceStopCleanUp. 'ok'`);
    }, 30_000);

    it('runs `then` only once the session is free again', async () => {
      const own = armedSession();
      const process = pausedWithCleanUp(own, '(Delay milliseconds: 300) wait');
      let answer = '';
      await clearInBackground(own, process, () => {
        answer = own.executeAndFetchString('(3 + 4) printString');
      });
      expect(answer).toBe('7');
    }, 30_000);
  });
});
