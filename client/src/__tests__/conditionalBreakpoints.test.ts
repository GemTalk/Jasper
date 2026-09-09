import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  BREAKPOINT_ERROR,
  ConditionSpec,
  DECISION,
  decisionSource,
  decodeDecision,
  skipUntilConditionMet,
} from '../conditionalBreakpoints';
import { OOP_NIL } from '../gciConstants';
import type { ActiveSession } from '../sessionManager';

const spec = (over: Partial<ConditionSpec> = {}): ConditionSpec => ({
  methodExpr: '(Account compiledMethodAt: #deposit: environmentId: 0)',
  stepPoint: 7,
  condition: 'amount > 100',
  ...over,
});

describe('decisionSource', () => {
  it('reads the stop from the suspended process by oop', () => {
    expect(decisionSource(29451009n, [spec()])).toContain('p := Object _objectForOop: 29451009.');
  });

  it('carries one spec per conditional breakpoint', () => {
    const source = decisionSource(1n, [
      spec({ stepPoint: 3, condition: 'i > 5' }),
      spec({ stepPoint: 9, condition: 'each isNil' }),
    ]);
    expect(source).toContain("with: 3 with: 'i > 5'");
    expect(source).toContain("with: 9 with: 'each isNil'");
  });

  it("doubles a quote in the developer's condition", () => {
    // Otherwise `name = 'ada'` would close the literal early and the doit would
    // fail to compile — reported as if the breakpoint itself were broken.
    expect(decisionSource(1n, [spec({ condition: "name = 'ada'" })])).toContain(
      "with: 'name = ''ada'''",
    );
  });

  it('survives a method that no longer exists', () => {
    // Recompiling or removing the method makes `compiledMethodAt:` raise. A spec
    // that cannot resolve must degrade to "no condition here" — which stops —
    // rather than taking the decision down.
    expect(decisionSource(1n, [spec()])).toContain(
      'specs add: (Array with: ([ (Account compiledMethodAt: #deposit: environmentId: 0) ] ' +
        'on: Error do: [:ex | nil ])',
    );
  });

  it('matches a block frame against its home method', () => {
    // A breakpoint inside a non-inlined block reports the block's own method,
    // while the breakpoint was set on the home method's step point.
    const source = decisionSource(1n, [spec()]);
    expect(source).toContain('frameMethod isMethodForBlock');
    expect(source).toContain('ifTrue: [ frameMethod homeMethod ]');
  });

  it('evaluates the condition against the home frame receiver', () => {
    // The stopped frame's receiver is the ExecBlock itself, so `self` and every
    // instance variable would otherwise fail to resolve (GemTalk/Jasper#561).
    const source = decisionSource(1n, [spec()]);
    expect(source).toContain('depth := p localStackDepth.');
    expect(source).toContain('(outer notNil and: [ (outer at: 1) == home ])');
    expect(source).toContain('rcvr := outer at: 10.');
  });

  it('stops at a step point no condition claims', () => {
    // An unconditional breakpoint, or a `halt`, reached while skipping.
    expect(decisionSource(1n, [spec()])).toContain(
      `spec isNil ifTrue: [ ^ Array with: ${DECISION.Stop} with: nil ]`,
    );
  });

  it('refuses a condition that does not answer a Boolean', () => {
    // Left alone, `each` (rather than `each > 3`) would never equal true and the
    // run would silently go to completion — a breakpoint that quietly does
    // nothing is the worst answer available.
    expect(decisionSource(1n, [spec()])).toContain('(answer == true or: [ answer == false ])');
  });

  it('sends no spec lines when nothing is conditional', () => {
    expect(decisionSource(1n, [])).toContain('specs := Array new.');
  });
});

describe('decodeDecision', () => {
  it('reads a skip', () => {
    expect(decodeDecision(DECISION.Go, '')).toEqual({ kind: 'go' });
  });

  it('reads a stop', () => {
    expect(decodeDecision(DECISION.Stop, '')).toEqual({ kind: 'stop' });
  });

  it('reads a failure as its message', () => {
    expect(decodeDecision(DECISION.Failed, 'undefined symbol nope')).toEqual({
      kind: 'failed',
      message: 'undefined symbol nope',
    });
  });

  it('treats an unknown decision as a stop', () => {
    // The process really is suspended at a breakpoint, so opening the debugger
    // on it is both true and the reading that loses nothing.
    expect(decodeDecision(77, '')).toEqual({ kind: 'stop' });
  });
});

/**
 * A GCI stub that answers a scripted sequence of decisions, and a scripted
 * sequence of resume outcomes.
 *
 * Decisions are decoded through `oopToInteger`, so the oops only have to be
 * distinguishable — what they decode to is what each test is about.
 */
function stubSession(
  decisions: number[],
  resumes: { result?: bigint; err: { number: number; message?: string; context?: bigint } }[],
  message = '',
) {
  let decisionIndex = 0;
  let resumeIndex = 0;
  const executed: string[] = [];
  const continues: { process: bigint; flags: number }[] = [];
  const gci = {
    utf8ClassOop: () => 74n,
    GciTsExecute: (_h: unknown, code: string) => {
      executed.push(code);
      return { result: 500n + BigInt(decisionIndex), err: { number: 0, message: '' } };
    },
    GciTsFetchOops: () => {
      const decision = decisions[Math.min(decisionIndex, decisions.length - 1)];
      decisionIndex += 1;
      return {
        oops: [1000n + BigInt(decision), message === '' ? OOP_NIL : 77n],
        err: { number: 0, message: '' },
      };
    },
    GciTsFetchChars: () => ({ data: message, err: { number: 0, message: '' } }),
    oopToInteger: (_h: unknown, oop: bigint) => Number(oop - 1000n),
    GciTsContinueWithAsync: (
      _h: unknown,
      process: bigint,
      _tos: bigint,
      _e: unknown,
      flags: number,
    ) => {
      continues.push({ process, flags });
      const next = resumes[Math.min(resumeIndex, resumes.length - 1)];
      resumeIndex += 1;
      return Promise.resolve({
        result: next.result ?? 0n,
        err: { context: 0n, message: '', ...next.err },
      });
    },
  };
  return {
    session: { id: 1, gci, handle: {} } as unknown as ActiveSession,
    executed,
    continues,
  };
}

const hitsBreakpoint = (process: bigint) => ({
  err: { number: BREAKPOINT_ERROR, message: 'Method breakpoint encountered.', context: process },
});

describe('skipUntilConditionMet', () => {
  it('stops without resuming when the condition holds at the first hit', async () => {
    const { session, continues } = stubSession([DECISION.Stop], []);

    await expect(skipUntilConditionMet(session, 7n, [spec()])).resolves.toEqual({
      kind: 'stopped',
      skipped: 0,
    });
    expect(continues).toHaveLength(0);
  });

  it('judges the decision with debug flags off', async () => {
    // The decision doit must not break on the very breakpoints it is judging.
    const { session } = stubSession([DECISION.Stop], []);
    const execute = vi.spyOn(
      session.gci as unknown as { GciTsExecute: (...args: unknown[]) => unknown },
      'GciTsExecute',
    );

    await skipUntilConditionMet(session, 7n, [spec()]);

    expect(execute.mock.calls[0][5]).toBe(0);
  });

  it('resumes past a false condition and stops at the next hit that holds', async () => {
    const { session, continues } = stubSession(
      [DECISION.Go, DECISION.Go, DECISION.Stop],
      [hitsBreakpoint(8n), hitsBreakpoint(9n)],
    );

    await expect(skipUntilConditionMet(session, 7n, [spec()])).resolves.toEqual({
      kind: 'stopped',
      skipped: 2,
    });
    // And each resume follows the process the previous stop reported, rather
    // than the one we started from.
    expect(continues.map((c) => c.process)).toEqual([7n, 8n]);
  });

  it('keeps the resumed run debuggable and interpreted', async () => {
    // Dropping the debug flag would disarm every remaining breakpoint in the
    // run; dropping interpreted would make the stop unsteppable.
    const { session, continues } = stubSession([DECISION.Go, DECISION.Stop], [hitsBreakpoint(8n)]);

    await skipUntilConditionMet(session, 7n, [spec()]);

    expect(continues[0].flags & 1).toBe(1); // ENABLE_DEBUG
    expect(continues[0].flags & 0x20).toBe(0x20); // INTERPRETED
  });

  it('answers a completed run with its result', async () => {
    const { session } = stubSession([DECISION.Go], [{ result: 4242n, err: { number: 0 } }]);

    await expect(skipUntilConditionMet(session, 7n, [spec()])).resolves.toEqual({
      kind: 'completed',
      resultOop: 4242n,
      skipped: 1,
    });
  });

  it('answers an error raised while skipping, on the process it was raised in', async () => {
    const { session } = stubSession(
      [DECISION.Go],
      [{ err: { number: 2010, message: 'doesNotUnderstand: #foo', context: 91n } }],
    );

    await expect(skipUntilConditionMet(session, 7n, [spec()])).resolves.toEqual({
      kind: 'raised',
      description: 'doesNotUnderstand: #foo',
      context: 91n,
      skipped: 1,
    });
  });

  it('answers a condition that could not be evaluated', async () => {
    const { session, continues } = stubSession([DECISION.Failed], [], 'undefined symbol  nope');

    await expect(skipUntilConditionMet(session, 7n, [spec()])).resolves.toEqual({
      kind: 'conditionFailed',
      message: 'undefined symbol  nope',
      skipped: 0,
    });
    // And it does not resume: the developer wrote a condition that cannot be
    // applied, so running on past the breakpoint would honour nothing.
    expect(continues).toHaveLength(0);
  });
});
