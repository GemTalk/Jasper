import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type { ActiveSession } from '../activeSession';
import { window } from '../__mocks__/vscode';
import { OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { armForceStop, forceStop, FORCE_STOP_WAIT_MS, rearmAfterForceStop } from '../forceStop';
import {
  NbCancelledError,
  runNbCall,
  setRunInProgressHandler,
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
import * as queries from '../browserQueries';
import { applyBreakpointRules, resumeOnWorker } from '../debugger/conditionalBreakpoints';
import type { StepResult } from '../debugger/debugQueries';
import { compiledMethodExpr } from '../queries/util';
import { GCI_PERFORM_FLAG_ENABLE_DEBUG, GCI_PERFORM_FLAG_INTERPRETED } from '../gciConstants';
import { evalSmalltalk } from '../smalltalkNotebookController';
import { evalPythonInScopeNb } from '../pythonQueries';
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

  it("stops a notebook cell from the cell's own stop, and Force Stop frees the session", async () => {
    const own = armedSession();
    installTranscriptSink(own);
    let cancel: (() => void) | undefined;
    const cellRun = evalSmalltalk(
      own,
      '[[true] whileTrue] on: Break do: [:e | e resume]',
      (c) => (cancel = c),
    );
    cellRun.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 500));
    cancel!();

    await expect(cellRun).rejects.toBeInstanceOf(NbCancelledError);
    expect(stoppedRunHolds(own)).toBe(true);
    await expect(forceStop(own, deps)).resolves.toBe(true);
    await expect(evalSmalltalk(own, '3 + 4')).resolves.toBe('7');
  }, 30_000);

  // No test stone has Grail, so this shows the path works, not a stop of real Python.
  it('runs a Python cell without blocking, handing out its canceller', async () => {
    const own = armedSession();
    const onStart = vi.fn();

    const answer = await evalPythonInScopeNb(own, 'x = 1', 'file:///nb.ipynb', onStart);

    expect(answer).toMatch(/^Grail \(GemStone-Python\) not detected/);
    expect(onStart).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
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

  it('offers Stop when an Explorer query meets a run still going', async () => {
    const told = vi.fn();
    setRunInProgressHandler(told);
    onTestFinished(() => setRunInProgressHandler(undefined));
    const own = armedSession();
    let cancel: (() => void) | undefined;
    const run = runNbCall(
      own,
      () =>
        own.GciTsNbExecute(
          '(Delay forSeconds: 30) wait',
          OOP_CLASS_UTF8,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      () => own.GciTsNbResult(),
      { suppressNotification: true, disposableProcess: true, onStart: (c) => (cancel = c) },
    );
    run.catch(() => {});

    expect(() => executeFetchString(own, '(3 + 4) printString')).toThrow(BrowserQueryError);
    expect(told).toHaveBeenCalledWith(own);

    cancel!();
    await run.catch(() => {});
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
        expect(() => executeFetchString(own, '3 printString')).toThrow(BrowserQueryError);

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
