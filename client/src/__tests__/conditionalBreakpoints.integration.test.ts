import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { GciLibrary } from '../gciLibrary';
import * as queries from '../browserQueries';
import * as debugQueries from '../debugQueries';
import { compiledMethodExpr } from '../queries/util';
import {
  BreakpointRule,
  applyBreakpointRules,
  logMessageExpression,
} from '../conditionalBreakpoints';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
  OOP_ILLEGAL,
  OOP_NIL,
} from '../gciConstants';
import type { ActiveSession } from '../sessionManager';
import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';
import { BreakpointManager } from '../breakpointManager';
import { StepPointModel } from '../stepPointModel';
import { buildMethodUri } from '../gemstoneFileSystemProvider';
import type { SessionManager } from '../sessionManager';
import { debug, Location, Position, SourceBreakpoint } from '../__mocks__/vscode';

/**
 * Pins the GemStone behaviour conditional breakpoints are built on, against a
 * live stone. Every one of these was established by probing rather than from
 * documentation, and none of it is stated anywhere we control:
 *
 * - a method breakpoint reaches the client as error **6005** with the suspended
 *   `GsProcess` in `err.context` — there is no Smalltalk handler that can catch
 *   it first, which is the whole reason conditions are applied afterwards;
 * - `GciTsContinueWith` resumes such a process and reports the next event the
 *   same way on 3.6.x and 3.7.x: no error and the run's result when it
 *   finishes, 6005 and the next process when it stops at another breakpoint,
 *   any other error when the code raised. (The in-gem alternative does not
 *   travel: `GsProcess>>_continue` exists only on 3.6.x, and 3.7.x's
 *   `_primContinue:` refuses a GCI-suspended process outright.);
 * - the receiver in a **block** frame is the `ExecBlock`, so a condition
 *   mentioning `self` or an instance variable only works when the receiver is
 *   taken from the home frame instead (GemTalk/Jasper#561);
 * - `_stepPointAt:` reports the **home** method's step point numbering even in a
 *   block frame, which is what lets a spec set on the home method match.
 *
 * Ungated: needs only a running stone. The harness aborts afterward, so the
 * throwaway class never reaches the repository, and breakpoints are per-gem
 * state that goes away with the session regardless.
 */
describe('conditional breakpoints (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);

  const TEST_CLASS = 'VsCodeConditionalBreakpointTest';

  const exec = (code: string, flags = 0) =>
    gci.GciTsExecute(handle, code, gci.utf8ClassOop(handle), OOP_ILLEGAL, OOP_NIL, flags, 0);

  const printString = (oop: bigint): string =>
    gci.executeAndFetchString(handle, `(Object _objectForOop: ${oop}) printString`);

  /**
   * Two loops with a breakpoint-worthy statement inside each: one over an
   * inlined `to:do:` (whose block variable is an ordinary method temporary) and
   * one over a real, non-inlined block (whose frame is where the receiver
   * problem shows up).
   */
  const fixture = (): void => {
    expect(
      queries.compileClassDefinition(
        session(),
        `Object subclass: '${TEST_CLASS}'
  instVarNames: #(limit)
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
      ),
    ).toBe(TEST_CLASS);

    queries.compileMethod(session(), TEST_CLASS, false, 'test', `limit: x\n  limit := x`);
    queries.compileMethod(
      session(),
      TEST_CLASS,
      false,
      'test',
      `countTo: n\n  | total |\n  total := 0.\n  1 to: n do: [:i |\n    total := total + i ].\n  ^ total`,
    );
    queries.compileMethod(
      session(),
      TEST_CLASS,
      false,
      'test',
      `sumOf: coll\n  | total |\n  total := 0.\n  coll do: [:each |\n    total := total + each ].\n  ^ total`,
    );
    queries.compileMethod(
      session(),
      TEST_CLASS,
      false,
      'test',
      `failAt: n\n  | total |\n  total := 0.\n  1 to: 100 do: [:i |\n    total := total + i.\n` +
        `    i = n ifTrue: [ self error: 'deliberate' ] ].\n  ^ total`,
    );
  };

  /**
   * The earliest step point at or after `needle` in the method's source, which
   * is how a developer clicking that line would land on one.
   */
  const stepPointAt = (selector: string, needle: string): number => {
    const offsets = queries.getSourceOffsets(session(), TEST_CLASS, false, selector, 0);
    const source = queries.getMethodSource(session(), TEST_CLASS, false, selector, 0);
    const at = source.indexOf(needle);
    expect(at).toBeGreaterThanOrEqual(0);
    let found = 0;
    offsets.forEach((offset, index) => {
      // `_sourceOffsets` is 1-based into the source.
      if (offset - 1 >= at && (found === 0 || offset < offsets[found - 1])) found = index + 1;
    });
    expect(found).toBeGreaterThan(0);
    return found;
  };

  /** Arm a breakpoint and run `code` until it stops there. Answers the process. */
  const haltAt = (selector: string, needle: string, code: string): bigint => {
    const stepPoint = stepPointAt(selector, needle);
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, selector, stepPoint, 0);
    const { err } = exec(code, GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED);
    // 6005 is the whole premise: the break has already unwound to us.
    expect(err.number).toBe(6005);
    return BigInt(err.context);
  };

  const specFor = (selector: string, needle: string, condition: string): BreakpointRule => ({
    methodExpr: compiledMethodExpr(TEST_CLASS, false, selector, 0),
    stepPoint: stepPointAt(selector, needle),
    condition,
  });

  /** Let go of a suspended process so the gem isn't left holding it. */
  const release = (process: bigint): void => {
    try {
      debugQueries.clearStack(session(), process);
    } catch {
      /* already finished */
    }
  };

  it('stops exactly where the condition first holds', async () => {
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 200`);

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('countTo:', 'total := total + i', 'i >= 150'),
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 149 });
    // And the process is still readable and still suspended right there, which
    // is what lets the debugger open on it as if nothing had happened.
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(
      stepPointAt('countTo:', 'total := total + i'),
    );
    const frame = debugQueries.getFrameInfo(session(), process, 1);
    const i = frame.argAndTempNames.indexOf('i');
    expect(printString(frame.argAndTempOops[i])).toBe('150');
    release(process);
  });

  it('runs to completion, and answers the result, when the condition never holds', async () => {
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 200`);

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('countTo:', 'total := total + i', 'i >= 9999'),
    ]);

    expect(outcome.kind).toBe('completed');
    if (outcome.kind !== 'completed') return;
    expect(outcome.skipped).toBe(200);
    // 1 + 2 + … + 200. Answering the real result is what lets Display It render
    // as though the breakpoint had never been reached.
    expect(printString(outcome.resultOop)).toBe('20100');
  });

  it('resolves a block argument in a non-inlined block', async () => {
    fixture();
    const process = haltAt(
      'sumOf:',
      'total := total + each',
      `(${TEST_CLASS} new limit: 99) sumOf: (1 to: 200) asArray`,
    );

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('sumOf:', 'total := total + each', 'each >= 150'),
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 149 });
    release(process);
  });

  it('resolves self and an instance variable in a non-inlined block', async () => {
    // The stopped frame's receiver is the ExecBlock, so without the walk to the
    // home frame this fails as "undefined symbol limit" — the same gap the
    // debugger's eval bar has today (GemTalk/Jasper#561).
    fixture();
    const process = haltAt(
      'sumOf:',
      'total := total + each',
      `(${TEST_CLASS} new limit: 99) sumOf: (1 to: 200) asArray`,
    );

    const outcome = await applyBreakpointRules(session(), process, [
      specFor(
        'sumOf:',
        'total := total + each',
        `limit == 99 and: [ self class == ${TEST_CLASS} ]`,
      ),
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 0 });
    release(process);
  });

  it('resolves a home-method temporary from inside the block', async () => {
    fixture();
    const process = haltAt(
      'sumOf:',
      'total := total + each',
      `(${TEST_CLASS} new limit: 99) sumOf: (1 to: 200) asArray`,
    );

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('sumOf:', 'total := total + each', 'total > 5000'),
    ]);

    expect(outcome.kind).toBe('stopped');
    release(process);
  });

  it('still stops at an unconditional breakpoint reached while skipping', async () => {
    // The condition belongs to one step point. A plain breakpoint anywhere else
    // has to keep working, or arming one conditional breakpoint would quietly
    // disarm every other breakpoint in the run.
    fixture();
    const process = haltAt(
      'sumOf:',
      'total := total + each',
      `(${TEST_CLASS} new limit: 99) sumOf: (1 to: 20) asArray`,
    );
    const returnStepPoint = stepPointAt('sumOf:', '^ total');
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'sumOf:', returnStepPoint, 0);

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('sumOf:', 'total := total + each', 'each >= 9999'),
    ]);

    expect(outcome.kind).toBe('stopped');
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(returnStepPoint);
    release(process);
  });

  it('judges several conditional breakpoints, each on its own condition', async () => {
    // The decider is compiled once with every armed condition baked in, so this
    // is the case that would break if it only ever consulted the spec for the
    // stop it started at.
    fixture();
    const loopStep = stepPointAt('countTo:', 'total := total + i');
    const returnStep = stepPointAt('countTo:', '^ total');
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', loopStep, 0);
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', returnStep, 0);

    const methodExpr = compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0);
    const { err } = exec(
      `${TEST_CLASS} new countTo: 20`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    expect(err.number).toBe(6005);
    const process = BigInt(err.context);

    // The loop's condition never holds; the one on `^ total` always does. The
    // run must skip all twenty loop hits and stop at the second breakpoint.
    const outcome = await applyBreakpointRules(session(), process, [
      { methodExpr, stepPoint: loopStep, condition: 'i >= 9999' },
      { methodExpr, stepPoint: returnStep, condition: 'total > 0' },
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 20 });
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(returnStep);
    release(process);
  });

  it('lets one condition hold while another never does', async () => {
    fixture();
    const loopStep = stepPointAt('countTo:', 'total := total + i');
    const returnStep = stepPointAt('countTo:', '^ total');
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', loopStep, 0);
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', returnStep, 0);

    const methodExpr = compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0);
    const { err } = exec(
      `${TEST_CLASS} new countTo: 200`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    const process = BigInt(err.context);

    const outcome = await applyBreakpointRules(session(), process, [
      { methodExpr, stepPoint: loopStep, condition: 'i >= 150' },
      { methodExpr, stepPoint: returnStep, condition: 'total > 999999' },
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 149 });
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(loopStep);
    release(process);
  });

  it('logs a line per hit and runs to completion, without ever stopping', async () => {
    // A logpoint instruments a method without editing it: no Transcript write,
    // no recompile, nothing left behind when the breakpoint goes.
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 20`);
    const lines: string[] = [];

    const outcome = await applyBreakpointRules(
      session(),
      process,
      [
        {
          methodExpr: compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0),
          stepPoint: stepPointAt('countTo:', 'total := total + i'),
          logMessage: logMessageExpression('i={i} total={total}'),
        },
      ],
      (text) => lines.push(text),
    );

    expect(outcome.kind).toBe('completed');
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe('i=1 total=0');
    expect(lines[19]).toBe('i=20 total=190');
  });

  it('logs only where the condition holds, then still does not stop', async () => {
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 20`);
    const lines: string[] = [];

    const outcome = await applyBreakpointRules(
      session(),
      process,
      [
        {
          methodExpr: compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0),
          stepPoint: stepPointAt('countTo:', 'total := total + i'),
          condition: 'i > 17',
          logMessage: logMessageExpression('late: {i}'),
        },
      ],
      (text) => lines.push(text),
    );

    expect(outcome.kind).toBe('completed');
    expect(lines).toEqual(['late: 18', 'late: 19', 'late: 20']);
  });

  it('resolves self and instance variables in a logpoint message', async () => {
    // The message is evaluated in the suspended frame, with the same names in
    // scope a condition gets — including through the home-frame walk in a block.
    fixture();
    const process = haltAt(
      'sumOf:',
      'total := total + each',
      `(${TEST_CLASS} new limit: 99) sumOf: (1 to: 3) asArray`,
    );
    const lines: string[] = [];

    await applyBreakpointRules(
      session(),
      process,
      [
        {
          methodExpr: compiledMethodExpr(TEST_CLASS, false, 'sumOf:', 0),
          stepPoint: stepPointAt('sumOf:', 'total := total + each'),
          logMessage: logMessageExpression('{self class} limit={limit} each={each}'),
        },
      ],
      (text) => lines.push(text),
    );

    expect(lines[0]).toBe(`${TEST_CLASS} limit=99 each=1`);
  });

  it('reports a log message that cannot be evaluated, and carries on anyway', async () => {
    // A logpoint never stops — not even a broken one. Naming a variable the
    // method does not have is an easy mistake (`{i}` in a method whose loop
    // variable is `each`), and answering it with a debugger the developer did
    // not ask for would be worse than the mistake.
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 20`);
    const lines: string[] = [];
    const failures: string[] = [];

    const outcome = await applyBreakpointRules(
      session(),
      process,
      [
        {
          methodExpr: compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0),
          stepPoint: stepPointAt('countTo:', 'total := total + i'),
          logMessage: logMessageExpression('{noSuchVariable}'),
        },
      ],
      (text) => lines.push(text),
      (message) => failures.push(message),
    );

    expect(outcome.kind).toBe('completed');
    expect(lines).toEqual([]);
    // Said once, however many hits it was wrong for.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('noSuchVariable');
  });

  it('names which logpoint wrote each line when several are armed', async () => {
    fixture();
    const loopStep = stepPointAt('countTo:', 'total := total + i');
    const returnStep = stepPointAt('countTo:', '^ total');
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', loopStep, 0);
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', returnStep, 0);
    const methodExpr = compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0);
    const rules: BreakpointRule[] = [
      { methodExpr, stepPoint: loopStep, logMessage: logMessageExpression('loop {i}') },
      { methodExpr, stepPoint: returnStep, logMessage: logMessageExpression('done {total}') },
    ];

    const { err } = exec(
      `${TEST_CLASS} new countTo: 3`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    const process = BigInt(err.context);
    const seen: { text: string; step: number | undefined }[] = [];

    await applyBreakpointRules(session(), process, rules, (text, rule) =>
      seen.push({ text, step: rule?.stepPoint }),
    );

    expect(seen.map((l) => l.text)).toEqual(['loop 1', 'loop 2', 'loop 3', 'done 6']);
    expect(seen[0].step).toBe(loopStep);
    expect(seen[3].step).toBe(returnStep);
  });

  it('reports an error the code raises while being skipped', async () => {
    // The resume answers an error rather than a result here, which is what
    // separates a run that raised from one that finished.
    fixture();
    const process = haltAt('failAt:', 'total := total + i', `${TEST_CLASS} new failAt: 10`);

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('failAt:', 'total := total + i', 'i >= 9999'),
    ]);

    expect(outcome.kind).toBe('raised');
    if (outcome.kind !== 'raised') return;
    expect(outcome.description).toContain('deliberate');
    // And on the process the error was raised in, so the debugger opens there.
    expect(outcome.context).not.toBe(0n);
    release(outcome.context);
  });

  it('reports a condition that cannot be evaluated, instead of never stopping', async () => {
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 200`);

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('countTo:', 'total := total + i', 'noSuchVariable > 1'),
    ]);

    expect(outcome.kind).toBe('conditionFailed');
    if (outcome.kind !== 'conditionFailed') return;
    expect(outcome.message).toContain('noSuchVariable');
    release(process);
  });

  it('reports a condition that does not answer a Boolean', async () => {
    // `each` rather than `each > 3` would otherwise never equal true and the
    // run would silently go to completion — a breakpoint that quietly does
    // nothing, with nothing said about why.
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 200`);

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('countTo:', 'total := total + i', 'i'),
    ]);

    expect(outcome.kind).toBe('conditionFailed');
    if (outcome.kind !== 'conditionFailed') return;
    expect(outcome.message).toContain('not true or false');
    release(process);
  });

  it('stops at a breakpoint no condition claims', async () => {
    // The first thing the loop does on every stop is ask whether this step point
    // is one of the conditional ones. Nothing conditional at all is the ordinary
    // case, and it must cost one round trip and stop where it stopped.
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 200`);

    const outcome = await applyBreakpointRules(session(), process, [
      specFor('sumOf:', 'total := total + each', 'each > 1'),
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 0 });
    release(process);
  });

  it('degrades to stopping when a spec names a method that is gone', async () => {
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 200`);

    const outcome = await applyBreakpointRules(session(), process, [
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'noSuchSelector', 0),
        stepPoint: 1,
        condition: 'true',
      },
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 0 });
    release(process);
  });

  // ── Triggered breakpoints ──────────────────────────────────────────────
  //
  // A triggered breakpoint is disarmed until the breakpoint that arms it has
  // been reached. GemStone has no such notion, so the arming lives in an Array
  // the decider block closes over — which means these tests are the only place
  // that proves a *stateful* decider survives being performed once per hit, and
  // that the arm lands before anything downstream can be reached.

  /** Both loop step points of `countTo:`, armed in the gem, plus the process. */
  const haltInCountTo = (n: number): { loopStep: number; returnStep: number; process: bigint } => {
    const loopStep = stepPointAt('countTo:', 'total := total + i');
    const returnStep = stepPointAt('countTo:', '^ total');
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', loopStep, 0);
    queries.setBreakAtStepPoint(session(), TEST_CLASS, false, 'countTo:', returnStep, 0);
    const { err } = exec(
      `${TEST_CLASS} new countTo: ${n}`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    expect(err.number).toBe(6005);
    return { loopStep, returnStep, process: BigInt(err.context) };
  };

  it('passes over a triggered breakpoint until its trigger has been reached', async () => {
    // The loop breakpoint is reached first and on every iteration, but it waits
    // on `^ total`, which is reached only once at the end. So it must never stop
    // and the run must complete: the whole feature in one run.
    fixture();
    const { loopStep, returnStep, process } = haltInCountTo(20);
    const methodExpr = compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0);

    const outcome = await applyBreakpointRules(session(), process, [
      // 1: the loop, armed only by 2 — which it can never reach first.
      { methodExpr, stepPoint: loopStep, triggeredBy: 2 },
      // 2: the return, a logpoint so it arms without ending the run.
      { methodExpr, stepPoint: returnStep, logMessage: logMessageExpression('done') },
    ]);

    expect(outcome.kind).toBe('completed');
    // 20 loop hits passed over for being disarmed, plus the trigger's own hit:
    // `skipped` counts every resume, and a logpoint resumes too.
    expect(outcome.skipped).toBe(21);
  });

  it('stops at a triggered breakpoint once its trigger has been reached', async () => {
    // The mirror of the test above: with the trigger EARLIER in the run, the
    // triggered breakpoint must arm and then stop. `limit:` runs before the
    // loop, so the arm lands before the first loop hit.
    fixture();
    const live = session();
    queries.compileMethod(
      live,
      TEST_CLASS,
      false,
      'test',
      `armThenCount: n\n  | total |\n  self limit: n.\n  total := 0.\n` +
        `  1 to: n do: [:i |\n    total := total + i ].\n  ^ total`,
    );

    // The trigger is a send in the SAME method, ahead of the loop: a step point
    // whose ordering against the loop is plain from the source.
    const armStep = stepPointAt('armThenCount:', 'self limit: n');
    const loopStep = stepPointAt('armThenCount:', 'total := total + i');
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', armStep, 0);
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', loopStep, 0);

    const { err } = exec(
      `${TEST_CLASS} new armThenCount: 20`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    expect(err.number).toBe(6005);
    const process = BigInt(err.context);

    const outcome = await applyBreakpointRules(session(), process, [
      // 1: the trigger, a logpoint so it arms without ending the run itself.
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0),
        stepPoint: armStep,
        logMessage: logMessageExpression('armed'),
      },
      // 2: waits on 1, and stops the moment it is reached afterwards.
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0),
        stepPoint: loopStep,
        triggeredBy: 1,
      },
    ]);

    expect(outcome.kind).toBe('stopped');
    // One resume only — the trigger's own, which logged and carried on. The loop
    // then stopped on its FIRST hit, which is what says the arm had already
    // landed rather than arriving some iterations later.
    expect(outcome.skipped).toBe(1);
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(loopStep);
    release(process);
  });

  it('arms on the trigger even when the trigger goes on to stop the run', async () => {
    // The arm is recorded BEFORE the decision to stop, so a trigger that is an
    // ordinary stopping breakpoint still arms what waits on it. Proven by
    // resuming the same suspended process through a second pass of the loop:
    // the arm has to have survived the stop.
    fixture();
    const live = session();
    queries.compileMethod(
      live,
      TEST_CLASS,
      false,
      'test',
      `armThenCount: n\n  | total |\n  self limit: n.\n  total := 0.\n` +
        `  1 to: n do: [:i |\n    total := total + i ].\n  ^ total`,
    );
    // The trigger is a send in the SAME method, ahead of the loop: a step point
    // whose ordering against the loop is plain from the source.
    const armStep = stepPointAt('armThenCount:', 'self limit: n');
    const loopStep = stepPointAt('armThenCount:', 'total := total + i');
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', armStep, 0);
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', loopStep, 0);

    const { err } = exec(
      `${TEST_CLASS} new armThenCount: 20`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    const process = BigInt(err.context);

    const specs: BreakpointRule[] = [
      // 1: a plain stopping breakpoint that is also a trigger.
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0),
        stepPoint: armStep,
      },
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0),
        stepPoint: loopStep,
        triggeredBy: 1,
      },
    ];

    // First pass: the process is already parked on the trigger, so the decider
    // arms 2 and then stops at 1 as any plain breakpoint would.
    const first = await applyBreakpointRules(session(), process, specs);
    expect(first).toEqual({ kind: 'stopped', skipped: 0 });
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(armStep);
    release(process);
  });

  it('keeps a disarmed breakpoint from stopping while OTHER breakpoints still do', async () => {
    // A trigger must not disarm the rest of the run. The loop waits on something
    // never reached; `^ total` is plain and has to stop exactly as it would with
    // no triggers in play at all.
    fixture();
    const { loopStep, returnStep, process } = haltInCountTo(20);
    const methodExpr = compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0);

    const outcome = await applyBreakpointRules(session(), process, [
      // 1: waits on 3, which this run never reaches.
      { methodExpr, stepPoint: loopStep, triggeredBy: 3 },
      // 2: plain, and must still stop.
      { methodExpr, stepPoint: returnStep },
      // 3: a step point that is never reached in this run.
      { methodExpr: compiledMethodExpr(TEST_CLASS, false, 'limit:', 0), stepPoint: 1 },
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 20 });
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(returnStep);
    release(process);
  });

  it('honours a triggered breakpoint\u2019s own condition as well as its trigger', async () => {
    // Both gates, in the right order: armed first, then the condition. The
    // breakpoint is armed from the first hit but must still skip until `i >= 15`.
    fixture();
    const live = session();
    queries.compileMethod(
      live,
      TEST_CLASS,
      false,
      'test',
      `armThenCount: n\n  | total |\n  self limit: n.\n  total := 0.\n` +
        `  1 to: n do: [:i |\n    total := total + i ].\n  ^ total`,
    );
    // The trigger is a send in the SAME method, ahead of the loop: a step point
    // whose ordering against the loop is plain from the source.
    const armStep = stepPointAt('armThenCount:', 'self limit: n');
    const loopStep = stepPointAt('armThenCount:', 'total := total + i');
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', armStep, 0);
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', loopStep, 0);

    const { err } = exec(
      `${TEST_CLASS} new armThenCount: 20`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    const process = BigInt(err.context);

    const outcome = await applyBreakpointRules(session(), process, [
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0),
        stepPoint: armStep,
        logMessage: logMessageExpression('armed'),
      },
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0),
        stepPoint: loopStep,
        triggeredBy: 1,
        condition: 'i >= 15',
      },
    ]);

    expect(outcome.kind).toBe('stopped');
    // The trigger's own resume, then 14 loop hits passed over for `i >= 15`
    // being false. Both gates, in order: armed from the first hit, and still
    // skipped until the condition held.
    expect(outcome.skipped).toBe(15);
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(loopStep);
    // The value that proves it: stopped at i = 15 exactly, not at the first hit
    // after arming (which would mean the condition was ignored) and not later.
    expect(debugQueries.evaluateInFrame(session(), process, 'i', 1)).toBe('15');
    release(process);
  });

  it('never arms from a hit the disarmed breakpoint was itself passed over on', async () => {
    // A chain: 2 waits on 1, and 1 waits on something never reached. Passing
    // over 1 must NOT arm 2 — a breakpoint that was skipped was not "reached"
    // in the sense that matters, and treating it as one would make a chain
    // collapse the moment its first link was stepped past.
    fixture();
    const { loopStep, returnStep, process } = haltInCountTo(20);
    const methodExpr = compiledMethodExpr(TEST_CLASS, false, 'countTo:', 0);

    const outcome = await applyBreakpointRules(session(), process, [
      // 1: the loop, waiting on 3 which is never reached.
      { methodExpr, stepPoint: loopStep, triggeredBy: 3 },
      // 2: the return, waiting on 1 — which is only ever passed over.
      { methodExpr, stepPoint: returnStep, triggeredBy: 1 },
      { methodExpr: compiledMethodExpr(TEST_CLASS, false, 'limit:', 0), stepPoint: 1 },
    ]);

    // Nothing ever stops, so the run completes: 20 loop hits and the return.
    expect(outcome.kind).toBe('completed');
    expect(outcome.skipped).toBe(21);
  });

  it('arms every breakpoint waiting on the same trigger', async () => {
    // One trigger, two dependents — the decider sweeps its whole spec array on
    // an arm rather than stopping at the first match.
    fixture();
    const live = session();
    queries.compileMethod(
      live,
      TEST_CLASS,
      false,
      'test',
      `armThenCount: n\n  | total |\n  self limit: n.\n  total := 0.\n` +
        `  1 to: n do: [:i |\n    total := total + i ].\n  ^ total`,
    );
    // The trigger is a send in the SAME method, ahead of the loop: a step point
    // whose ordering against the loop is plain from the source.
    const armStep = stepPointAt('armThenCount:', 'self limit: n');
    const loopStep = stepPointAt('armThenCount:', 'total := total + i');
    const returnStep = stepPointAt('armThenCount:', '^ total');
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', armStep, 0);
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', loopStep, 0);
    queries.setBreakAtStepPoint(live, TEST_CLASS, false, 'armThenCount:', returnStep, 0);

    const { err } = exec(
      `${TEST_CLASS} new armThenCount: 20`,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
    );
    const process = BigInt(err.context);
    const method = compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0);

    const outcome = await applyBreakpointRules(session(), process, [
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'armThenCount:', 0),
        stepPoint: armStep,
        logMessage: logMessageExpression('armed'),
      },
      // Both wait on 1. The loop is reached first, so it is the one that stops —
      // which is only true if the single arm armed both.
      { methodExpr: method, stepPoint: loopStep, triggeredBy: 1 },
      { methodExpr: method, stepPoint: returnStep, triggeredBy: 1 },
    ]);

    // Only the trigger's own resume: the loop stopped on its first hit.
    expect(outcome).toEqual({ kind: 'stopped', skipped: 1 });
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(loopStep);
    release(process);
  });
});

/**
 * The seam the unit tests could not cover: the breakpoint manager building the
 * specs, and the gem answering them, over one live session.
 *
 * Both halves were tested apart — `breakpointRulesFor` against a mocked VS Code,
 * `applyBreakpointRules` against hand-written specs — and a condition that is
 * recorded but never reaches the gem, or reaches it under a step point the frame
 * does not report, looks exactly like a breakpoint with no condition at all: it
 * stops at the first hit and says nothing. Only running the two together catches
 * that.
 */
describe('the manager and the gem, together (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const TEST_CLASS = 'VsCodeBreakpointRuleTest';
  const SELECTOR = 'countTo:';

  /** A manager wired to the live session, over VS Code's real breakpoint list. */
  function makeManager() {
    const live = session();
    const sessionManager = {
      getSelectedSession: () => live,
      getSessions: () => [live],
      onDidChangeSelection: () => ({ dispose: () => {} }),
    } as unknown as SessionManager;
    return new BreakpointManager(sessionManager, new StepPointModel(sessionManager));
  }

  it('carries a gutter breakpoint’s condition all the way to the gem', async () => {
    const live = session();
    queries.compileClassDefinition(
      live,
      `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
    queries.compileMethod(
      live,
      TEST_CLASS,
      false,
      'test',
      `${SELECTOR} n\n  | total |\n  total := 0.\n  1 to: n do: [:i |\n    total := total + i ].\n  ^ total`,
    );

    const uri = buildMethodUri({
      kind: 'method',
      sessionId: live.id,
      dictName: 'UserGlobals',
      className: TEST_CLASS,
      isMeta: false,
      category: 'test',
      selector: SELECTOR,
      environmentId: 0,
    });

    // A gutter click: the line of the loop body, and no column — which means
    // "the leftmost step point on this line".
    const source = queries.getMethodSource(live, TEST_CLASS, false, SELECTOR, 0);
    const bodyLine = source.slice(0, source.indexOf('total := total + i')).split('\n').length - 1;
    debug.breakpoints = [
      new SourceBreakpoint(new Location(uri, new Position(bodyLine, 0)), true, 'i >= 150'),
    ];

    const manager = makeManager();
    const results = manager.applyToUri(live, uri);
    expect(results[0].verified).toBe(true);

    // The condition survived being applied…
    const applied = manager.appliedFor(uri);
    expect(applied).toHaveLength(1);
    expect(applied[0].condition).toBe('i >= 150');

    // …and comes back out as a spec naming the method the gem will report.
    const specs = manager.breakpointRulesFor(live);
    expect(specs).toEqual([
      {
        methodExpr: `(${TEST_CLASS} compiledMethodAt: #'${SELECTOR}' environmentId: 0)`,
        stepPoint: applied[0].stepPoint,
        condition: 'i >= 150',
        logMessage: undefined,
        // What a logpoint's output would be prefixed with.
        label: `${TEST_CLASS}>>${SELECTOR}`,
      },
    ]);

    // Now run it. The step point the spec names has to be the one the suspended
    // frame reports, or nothing matches and the breakpoint stops every time.
    const { err } = gci.GciTsExecute(
      handle,
      `${TEST_CLASS} new ${SELECTOR} 200`,
      gci.utf8ClassOop(handle),
      OOP_ILLEGAL,
      OOP_NIL,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
      0,
    );
    expect(err.number).toBe(6005);
    const process = BigInt(err.context);
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(specs[0].stepPoint);

    await expect(applyBreakpointRules(session(), process, specs)).resolves.toEqual({
      kind: 'stopped',
      skipped: 149,
    });

    try {
      debugQueries.clearStack(session(), process);
    } catch {
      /* already finished */
    }
    debug.breakpoints = [];
  });

  it('carries a trigger set on the manager all the way to the gem', async () => {
    // The whole seam for triggers, which no unit test can reach: two real VS
    // Code breakpoints, a trigger recorded on the manager, specs built from
    // them, and the gem honouring the arming. A trigger index that is right in
    // the manager but wrong by the time the decider indexes its array looks
    // exactly like no trigger at all — the breakpoint just stops early.
    const live = session();
    queries.compileClassDefinition(
      live,
      `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
    queries.compileMethod(
      live,
      TEST_CLASS,
      false,
      'test',
      `${SELECTOR} n\n  | total |\n  total := 0.\n  1 to: n do: [:i |\n` +
        `    total := total + i ].\n  ^ total`,
    );

    const uri = buildMethodUri({
      kind: 'method',
      sessionId: live.id,
      dictName: 'UserGlobals',
      className: TEST_CLASS,
      isMeta: false,
      category: 'test',
      selector: SELECTOR,
      environmentId: 0,
    });

    const source = queries.getMethodSource(live, TEST_CLASS, false, SELECTOR, 0);
    const lineOf = (needle: string): number =>
      source.slice(0, source.indexOf(needle)).split('\n').length - 1;

    // Two gutter clicks: the loop body, and the `^ total` that follows it.
    debug.breakpoints = [
      new SourceBreakpoint(new Location(uri, new Position(lineOf('total := total + i'), 0)), true),
      new SourceBreakpoint(new Location(uri, new Position(lineOf('^ total'), 0)), true),
    ];

    const manager = makeManager();
    manager.applyToUri(live, uri);
    const applied = manager.appliedFor(uri);
    expect(applied).toHaveLength(2);

    const loop = applied.find((a) => a.line === lineOf('total := total + i') + 1)!;
    const ret = applied.find((a) => a.line === lineOf('^ total') + 1)!;
    expect(loop.stepPoint).not.toBe(ret.stepPoint);

    // The loop waits for `^ total`, which the loop can never reach first.
    manager.setTrigger(uri, loop.stepPoint, { uri: uri.toString(), stepPoint: ret.stepPoint });

    const specs = manager.breakpointRulesFor(live);
    // Both ends earn a spec, even though neither carries a condition.
    expect(specs).toHaveLength(2);
    const loopSpec = specs.find((sp) => sp.stepPoint === loop.stepPoint)!;
    const retSpec = specs.find((sp) => sp.stepPoint === ret.stepPoint)!;
    expect(retSpec.triggeredBy).toBeUndefined();
    expect(specs[loopSpec.triggeredBy! - 1]).toBe(retSpec);

    const { err } = gci.GciTsExecute(
      handle,
      `${TEST_CLASS} new ${SELECTOR} 20`,
      gci.utf8ClassOop(handle),
      OOP_ILLEGAL,
      OOP_NIL,
      GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED,
      0,
    );
    expect(err.number).toBe(6005);
    const process = BigInt(err.context);
    // It stopped at the LOOP first, disarmed — the gem has no idea about
    // triggers, so this is exactly the stop the decider has to pass over.
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(loop.stepPoint);

    const outcome = await applyBreakpointRules(session(), process, specs);

    // Twenty disarmed loop hits passed over, then `^ total` stopped as the plain
    // breakpoint it is. The loop never stops, because its trigger only fires at
    // the very end of the run.
    expect(outcome).toEqual({ kind: 'stopped', skipped: 20 });
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(ret.stepPoint);

    try {
      debugQueries.clearStack(session(), process);
    } catch {
      /* already finished */
    }
    debug.breakpoints = [];
  });
});
