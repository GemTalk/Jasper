import { describe, it, expect, vi } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import type { ActiveSession } from '../sessionManager';
import {
  OOP_NIL,
  OOP_ILLEGAL,
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
} from '../gciConstants';
import { stepOver, stepOverNb, continueExecution, clearStack } from '../debugQueries';
import { runNbCall, NbCancelledError } from '../nbRunner';

const GCI_ERR_HALT = 2709;
const GCI_ERR_STEP_POINT = 6002; // "Single-step breakpoint encountered" — a successful step
const OOP_FORTY_TWO = 338n; // SmallInteger 42: (42 << 3) | 2

/**
 * Automatic GCI integration tests for debugger single-stepping. Executions are
 * started with GCI_PERFORM_FLAG_INTERPRETED (GemStone cannot step native code —
 * error 6014 — and a process must START interpreted to be steppable); the
 * step/continue performs carry the same flag. The halt is raised inside real
 * compiled methods, not a doit frame, so on stones where native code is enabled
 * (x86 — Darwin/ARM builds don't support it) these tests prove the flag keeps
 * the process steppable. Errors 6014 here mean the flag scheme regressed.
 */
describe('debugger single-stepping (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const exec = (code: string, flags: number) => {
    const strClass = gci.resolveSymbol(handle, 'String');
    return gci.GciTsExecute(handle, code, strClass, OOP_ILLEGAL, OOP_NIL, flags, 0);
  };

  // Compiles a throwaway class (session-local; the harness's per-test abort
  // discards it) whose `outer` calls `inner`, which halts — then runs it and
  // returns the halted GsProcess. The halt sits inside compiled methods so the
  // parked frames are ordinary methods, which native code (where supported)
  // would otherwise compile.
  function haltedProcess(): bigint {
    const compiled = exec(
      `| cls |
cls := Object subclass: 'ZzSteppingProbe' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
cls compileMethod: 'inner ^ self halt' dictionaries: System myUserProfile symbolList category: #probe.
cls compileMethod: 'outer self inner. ^ 42' dictionaries: System myUserProfile symbolList category: #probe.
'compiled'`,
      0,
    );
    expect(compiled.err.number).toBe(0);

    const { err } = exec(
      'ZzSteppingProbe new outer',
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );

    expect(err.number).toBe(GCI_ERR_HALT);
    expect(err.context).not.toBe(0n);
    return err.context;
  }

  it('single-steps a process halted inside a compiled method', () => {
    let gsProcess = haltedProcess();
    let ranToCompletion = false;
    const stepErrorNumbers: number[] = [];

    try {
      // gciStepOverFromLevel: blocks synchronously on the native GCI call, so a
      // stuck loop can't be interrupted by vitest's test timeout — there's no
      // await for it to fire on. This cap is a runaway guard, not a tuned
      // bound: on stones without native code (e.g. Darwin/ARM — see the class
      // comment) stepping advances by bytecode-level step points rather than
      // by source statement, so completing even this small method legitimately
      // takes more than a couple of steps. 500 is far beyond anything a real
      // stepping run should ever need, however the bytecode shape varies.
      for (let i = 0; i < 500 && !ranToCompletion; i++) {
        const step = stepOver(session(), gsProcess, 1);
        ranToCompletion = step.completed;
        if (!ranToCompletion) {
          stepErrorNumbers.push(step.errorNumber!);
          gsProcess = step.errorContext!;
        }
      }
    } finally {
      if (!ranToCompletion) clearStack(session(), gsProcess);
    }

    expect(ranToCompletion).toBe(true);
    for (const errorNumber of stepErrorNumbers) {
      expect(errorNumber).toBe(GCI_ERR_STEP_POINT);
    }
  });

  /**
   * A process halted where the rest of its work is a long arithmetic loop, and
   * the level to step from -- the outermost frame, so the step has to run
   * everything below it rather than advancing one step point.
   *
   * The loop is what makes the cancel land mid-step every time. It sends
   * nothing, so the soft break has no safe point to be delivered at and the
   * call is still in flight when the hard break follows it; a fixture that
   * waits on Delays instead is stopped by the soft break and settles before the
   * second press, and never reaches the path under test. Verified on 3.6.2: the
   * process is left `status=debug` with its stack, and against the code this
   * guards, `status=terminated` with no stack at all.
   */
  function haltedInLongLoop(): { gsProcess: bigint; outermostLevel: number } {
    const compiled = exec(
      `| cls |
cls := Object subclass: 'ZzStepCancelProbe' instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #().
cls compileMethod: 'inner | n | self halt. n := 0. [n < 2000000000] whileTrue: [n := n + 1]. ^ n' dictionaries: System myUserProfile symbolList category: #probe.
cls compileMethod: 'outer ^ self inner' dictionaries: System myUserProfile symbolList category: #probe.
'compiled'`,
      0,
    );
    expect(compiled.err.number).toBe(0);

    const { err } = exec(
      'ZzStepCancelProbe new outer',
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    expect(err.number).toBe(GCI_ERR_HALT);
    expect(err.context).not.toBe(0n);
    return { gsProcess: err.context, outermostLevel: stackDepth(err.context) };
  }

  const stackDepth = (gsProcess: bigint): number =>
    Number(
      gci
        .executeAndFetchString(
          handle,
          `(Object _objectForOop: ${gsProcess}) localStackDepth printString`,
        )
        .trim(),
    );

  // A trivial nb call resolves only once an abandoned one has been drained --
  // runNbCall waits on the drain before starting. Without it the reads below
  // meet a session that still reports a call in progress.
  const waitForSessionFree = (): Promise<void> =>
    runNbCall(
      session(),
      () => gci.GciTsNbExecute(handle, 'nil', OOP_NIL, OOP_ILLEGAL, OOP_NIL, 0, 0),
      () => {
        gci.GciTsNbResult(handle);
      },
      { suppressNotification: true, disposableProcess: true },
    );

  it('leaves the debugged process intact when its step is cancelled', async () => {
    // A step performs its message ON the process the debugger is showing, so the
    // process a hard break stops is the user's stack, not litter belonging to
    // the call. Clearing it would unwind that stack to nothing while the panel
    // says "Step cancelled." and still offers to step, resume and inspect it.
    //
    // Asserted on the process itself rather than on which GCI calls were made,
    // so it holds however the cleanup is spelled.
    const { gsProcess, outermostLevel } = haltedInLongLoop();

    let cancel: (() => void) | undefined;
    const step = stepOverNb(session(), gsProcess, outermostLevel, {
      suppressNotification: true,
      onStart: (c) => {
        cancel = c;
      },
    });
    // Claimed now: it rejects inside a timer tick, before `expect` attaches.
    step.catch(() => {});
    try {
      cancel!();
      cancel!();
      // Required, not tolerated: a step that finished on its own was never
      // interrupted mid-call, and would leave this test asserting nothing.
      await expect(step).rejects.toBeInstanceOf(NbCancelledError);
      await waitForSessionFree();

      expect(stackDepth(gsProcess)).toBeGreaterThan(0);
      // Not merely a surviving oop: still a process the panel can drive.
      const after = gci.executeAndFetchString(
        handle,
        `(Object _objectForOop: ${gsProcess}) printString`,
      );
      expect(after).toContain('status=debug');
      const resumed = stepOver(session(), gsProcess, 1);
      expect(resumed.completed || resumed.errorNumber === GCI_ERR_STEP_POINT).toBe(true);
    } finally {
      cancel?.();
      await step.catch(() => {});
      await waitForSessionFree().catch(() => {});
      clearStack(session(), gsProcess);
    }
    // Same reason as the transcript sink's hard-break test: the cancel is
    // followed by a drain the next call waits out, and a loaded runner makes
    // that wait longer than the 5s default allows.
  }, 30_000);

  it('continues a halted process to normal completion with its result', () => {
    const gsProcess = haltedProcess();

    const result = continueExecution(session(), gsProcess);

    expect(result.completed).toBe(true);
    expect(result.resultOop).toBe(OOP_FORTY_TWO);
  });
});
