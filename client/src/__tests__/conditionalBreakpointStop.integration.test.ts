import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { window } from '../__mocks__/vscode';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { forceStop } from '../forceStop';
import {
  NbCancelledError,
  runNbCall,
  setStillRunningHandler,
  setStoppedRunCollectedHandler,
  STOP_CALLS_WAIT_MS,
  stopCallsOn,
  stoppedRunHolds,
} from '../nbRunner';
import { executeFetchString } from '../browserQueries';
import { SESSION_BUSY_MESSAGE } from '../gciLibraryError';
import * as queries from '../browserQueries';
import { applyBreakpointRules, resumeOnWorker } from '../debugger/conditionalBreakpoints';
import type { StepResult } from '../debugger/debugQueries';
import { compiledMethodExpr } from '../queries/util';
import { GCI_PERFORM_FLAG_ENABLE_DEBUG, GCI_PERFORM_FLAG_INTERPRETED } from '../gciConstants';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { forceStopSupport } from './forceStopSupport';

describe('stopping a run that skips conditional breakpoints (integration)', () => {
  let session: ActiveSession;

  useIntegrationTest((testContext) => {
    session = testActiveSession(testContext.gciLibrary, testContext.session);
  });

  afterEach(() => {
    setStoppedRunCollectedHandler(undefined);
    setStillRunningHandler(undefined);
  });

  const { armedSession, deps } = forceStopSupport(() => session);

  // Skipping a conditional breakpoint resumes the run on a worker thread, outside
  // the runner; its Cancel must still give the user back the session.
  describe('a run skipping conditional breakpoints', () => {
    const CLASS = 'JasperForceStopRuleTest';

    /** A session halted at a breakpoint inside a loop that `after` runs past. */
    function haltedBeforeSpin(own: ActiveSession, after: string) {
      queries.compileClassDefinition(
        own,
        `Object subclass: '${CLASS}' instVarNames: #() classVars: #() classInstVars: #() ` +
          `poolDictionaries: #() inDictionary: UserGlobals options: #()`,
      );
      const source = `spinAfter: n\n  | total |\n  total := 0.\n  1 to: n do: [:i |\n    total := total + i ].\n  ${after}.\n  ^ total`;
      queries.compileMethod(own, CLASS, false, 'test', source);
      const offsets = queries.getSourceOffsets(own, CLASS, false, 'spinAfter:', 0);
      const at = source.indexOf('total := total + i');
      const stepPoint = offsets.findIndex((offset) => offset - 1 >= at) + 1;
      queries.setBreakAtStepPoint(own, CLASS, false, 'spinAfter:', stepPoint, 0);
      const { err } = own.GciTsExecute(
        `${CLASS} new spinAfter: 3`,
        OOP_CLASS_UTF8,
        OOP_ILLEGAL,
        OOP_NIL,
        GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
        0,
      );
      expect(err.number).toBe(6005);
      return {
        process: BigInt(err.context),
        rule: (condition: string) => ({
          methodExpr: compiledMethodExpr(CLASS, false, 'spinAfter:', 0),
          stepPoint,
          condition,
        }),
      };
    }

    it.each([
      ['the code being skipped', 'false', '[[true] whileTrue] on: Break do: [:e | e resume]'],
      ['the condition', '[[true] whileTrue] on: Break do: [:e | e resume]. true', 'nil'],
    ])(
      'stops waiting when %s ignores the stop, and Force Stop frees the session',
      async (_what, condition, after) => {
        const told = vi.fn();
        setStillRunningHandler(told);
        const own = armedSession();
        const { process, rule } = haltedBeforeSpin(own, after);
        let cancel: (() => void) | undefined;
        const skipping = applyBreakpointRules(own, process, [rule(condition)], {
          onStart: (c) => (cancel = c),
          suppressNotification: true,
        });
        skipping.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(() => executeFetchString(own, '3 printString')).toThrow(SESSION_BUSY_MESSAGE);

        const pressedAt = Date.now();
        cancel!();

        await expect(skipping).rejects.toBeInstanceOf(NbCancelledError);
        expect(Date.now() - pressedAt).toBeLessThan(4000);
        expect(told).toHaveBeenCalledWith(own);
        expect(stoppedRunHolds(own)).toBe(true);
        await expect(forceStop(own, deps)).resolves.toBe(true);
        expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
      },
      30_000,
    );

    it("lets the debugger's Resume into code that ignores the stop be stopped too", async () => {
      const told = vi.fn();
      setStillRunningHandler(told);
      const own = armedSession();
      const { process, rule } = haltedBeforeSpin(
        own,
        '[[true] whileTrue] on: Break do: [:e | e resume]',
      );
      // No breakpoint ahead: the resume runs straight into the loop.
      queries.clearBreakAtStepPoint(own, CLASS, false, 'spinAfter:', rule('').stepPoint, 0);
      let cancel: (() => void) | undefined;
      let ended: (r: StepResult) => void = () => {};
      const endedAt = new Promise<StepResult>((resolve) => (ended = resolve));
      const resuming = resumeOnWorker(own, process, {
        onStart: (c) => (cancel = c),
        suppressNotification: true,
        onGivenUpSettled: ended,
      });
      resuming.catch(() => {});
      // A timer firing at all shows the resume is not holding the thread.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const pressedAt = Date.now();
      cancel!();

      await expect(resuming).rejects.toBeInstanceOf(NbCancelledError);
      expect(Date.now() - pressedAt).toBeLessThan(4000);
      expect(told).toHaveBeenCalledWith(own);
      await expect(forceStop(own, deps)).resolves.toBe(true);
      // The debugger is told where the run stopped: in the loop, by the signal.
      await expect(endedAt).resolves.toMatchObject({ completed: false, errorNumber: 6010 });
      expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
    }, 30_000);

    /** A Resume running into a loop that ignores the stop, with its Cancel. */
    async function resumedIntoLoop(own: ActiveSession) {
      const { process, rule } = haltedBeforeSpin(
        own,
        '[[true] whileTrue] on: Break do: [:e | e resume]',
      );
      queries.clearBreakAtStepPoint(own, CLASS, false, 'spinAfter:', rule('').stepPoint, 0);
      let cancel: (() => void) | undefined;
      const resuming = resumeOnWorker(own, process, {
        onStart: (c) => (cancel = c),
        suppressNotification: true,
      });
      resuming.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { resuming, cancel: cancel! };
    }

    it('stops waiting at a second press, as the runner does', async () => {
      setStillRunningHandler(vi.fn());
      const own = armedSession();
      const { resuming, cancel } = await resumedIntoLoop(own);

      const pressedAt = Date.now();
      cancel();
      cancel();

      await expect(resuming).rejects.toBeInstanceOf(NbCancelledError);
      // A first press alone waits STOP_WAITING_AFTER_MS or more.
      expect(Date.now() - pressedAt).toBeLessThan(1000);
      await expect(forceStop(own, deps)).resolves.toBe(true);
      expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
    }, 30_000);

    it('lets a logout stop waiting for a Resume that ignores the stop', async () => {
      setStillRunningHandler(vi.fn());
      const own = armedSession();
      const { resuming } = await resumedIntoLoop(own);

      const startedAt = Date.now();
      const outcome = await Promise.race([
        stopCallsOn(own).then(() => 'stopped'),
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 8000)),
      ]);

      expect(outcome).toBe('stopped');
      expect(Date.now() - startedAt).toBeLessThan(STOP_CALLS_WAIT_MS + 1000);
      await expect(resuming).rejects.toBeInstanceOf(NbCancelledError);
      // Still held, so a logout goes on to Force Stop.
      expect(stoppedRunHolds(own)).toBe(true);
      await expect(forceStop(own, deps)).resolves.toBe(true);
      expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
    }, 30_000);

    it("hands its Cancel to the run it is part of, as Execute It's is", async () => {
      const told = vi.fn();
      setStillRunningHandler(told);
      const own = armedSession();
      // Only for the class and the rule: this run starts from the top below.
      const { process: halted, rule } = haltedBeforeSpin(own, 'nil');
      own.GciTsClearStack(halted);
      queries.compileMethod(
        own,
        CLASS,
        false,
        'test',
        `spinAfter: n\n  | total |\n  total := 0.\n  1 to: n do: [:i |\n    total := total + i ].\n  [[true] whileTrue] on: Break do: [:e | e resume].\n  ^ total`,
      );
      queries.setBreakAtStepPoint(own, CLASS, false, 'spinAfter:', rule('false').stepPoint, 0);
      let cancelRules: (() => void) | undefined;
      const run = runNbCall(
        own,
        () =>
          own.GciTsNbExecute(
            `${CLASS} new spinAfter: 3`,
            OOP_CLASS_UTF8,
            OOP_ILLEGAL,
            OOP_NIL,
            GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
            0,
          ),
        async (signal) => {
          const { err } = own.GciTsNbResult();
          expect(err.number).toBe(6005);
          return await applyBreakpointRules(own, BigInt(err.context), [rule('false')], {
            signal,
            onStart: (c) => (cancelRules = c),
            suppressNotification: true,
          });
        },
        { suppressNotification: true, disposableProcess: true },
      );
      run.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1000));

      cancelRules!();

      // The enclosing run's stop, not the loop's own: only that one says so.
      expect(window.setStatusBarMessage).toHaveBeenCalledWith(
        expect.stringContaining('Stopping…'),
        expect.anything(),
      );
      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
      expect(told).toHaveBeenCalledWith(own);
      await expect(forceStop(own, deps)).resolves.toBe(true);
      expect(own.executeAndFetchString('(3 + 4) printString')).toBe('7');
    }, 30_000);
  });
});
