import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { GciLibrary } from '../gciLibrary';
import * as queries from '../browserQueries';
import * as debugQueries from '../debugQueries';
import { compiledMethodExpr } from '../queries/util';
import { ConditionSpec, skipUntilConditionMet } from '../conditionalBreakpoints';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
  OOP_ILLEGAL,
  OOP_NIL,
} from '../gciConstants';
import type { ActiveSession } from '../sessionManager';
import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';

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

  const specFor = (selector: string, needle: string, condition: string): ConditionSpec => ({
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

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
      specFor('sumOf:', 'total := total + each', 'each >= 9999'),
    ]);

    expect(outcome.kind).toBe('stopped');
    expect(debugQueries.getStepPoint(session(), process, 1)).toBe(returnStepPoint);
    release(process);
  });

  it('reports an error the code raises while being skipped', async () => {
    // The resume answers an error rather than a result here, which is what
    // separates a run that raised from one that finished.
    fixture();
    const process = haltAt('failAt:', 'total := total + i', `${TEST_CLASS} new failAt: 10`);

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
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

    const outcome = await skipUntilConditionMet(session(), process, [
      specFor('sumOf:', 'total := total + each', 'each > 1'),
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 0 });
    release(process);
  });

  it('degrades to stopping when a spec names a method that is gone', async () => {
    fixture();
    const process = haltAt('countTo:', 'total := total + i', `${TEST_CLASS} new countTo: 200`);

    const outcome = await skipUntilConditionMet(session(), process, [
      {
        methodExpr: compiledMethodExpr(TEST_CLASS, false, 'noSuchSelector', 0),
        stepPoint: 1,
        condition: 'true',
      },
    ]);

    expect(outcome).toEqual({ kind: 'stopped', skipped: 0 });
    release(process);
  });
});
