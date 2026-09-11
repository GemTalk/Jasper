import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  BREAKPOINT_ERROR,
  BreakpointRule,
  DECISION,
  deciderSource,
  decodeDecision,
  applyBreakpointRules,
  logMessageExpression,
} from '../conditionalBreakpoints';
import { OOP_NIL } from '../gciConstants';
import type { ActiveSession } from '../sessionManager';

const spec = (over: Partial<BreakpointRule> = {}): BreakpointRule => ({
  methodExpr: '(Account compiledMethodAt: #deposit: environmentId: 0)',
  stepPoint: 7,
  condition: 'amount > 100',
  ...over,
});

describe('deciderSource', () => {
  it('compiles once and parks the block in the session temps', () => {
    // Compiled once and performed per hit: a doit is recompiled every time it
    // is executed, and this source is ~1.8 KB of it.
    const source = deciderSource([spec()]);
    expect(source).toContain("SessionTemps current at: #'JasperConditionalBreakpointDecider' put:");
    expect(source).toContain('decider := [:p |');
  });

  it('takes the suspended process as the block’s argument', () => {
    // No `_objectForOop:` per hit — the process is handed over as the object it
    // already is.
    expect(deciderSource([spec()])).toContain('fc := p _frameContentsAt: 1.');
  });

  it('never returns non-locally from the block', () => {
    // The home doit has finished by the time the block runs, so a `^` in it is
    // an error rather than an early exit.
    const body = deciderSource([spec()]);
    expect(body.slice(body.indexOf('decider := [:p |'))).not.toMatch(/\^/);
  });

  it('carries one spec per conditional breakpoint', () => {
    const source = deciderSource([
      spec({ stepPoint: 3, condition: 'i > 5' }),
      spec({ stepPoint: 9, condition: 'each isNil' }),
    ]);
    expect(source).toContain("with: 3 with: 'i > 5'");
    expect(source).toContain("with: 9 with: 'each isNil'");
  });

  it("doubles a quote in the developer's condition", () => {
    // Otherwise `name = 'ada'` would close the literal early and the doit would
    // fail to compile — reported as if the breakpoint itself were broken.
    expect(deciderSource([spec({ condition: "name = 'ada'" })])).toContain(
      "with: 'name = ''ada'''",
    );
  });

  it('survives a method that no longer exists', () => {
    // Recompiling or removing the method makes `compiledMethodAt:` raise. A spec
    // that cannot resolve must degrade to "no condition here" — which stops —
    // rather than taking the decision down.
    expect(deciderSource([spec()])).toContain(
      'specs add: (Array with: ([ (Account compiledMethodAt: #deposit: environmentId: 0) ] ' +
        'on: Error do: [:ex | nil ])',
    );
  });

  it('matches a block frame against its home method', () => {
    // A breakpoint inside a non-inlined block reports the block's own method,
    // while the breakpoint was set on the home method's step point.
    const source = deciderSource([spec()]);
    expect(source).toContain('frameMethod isMethodForBlock');
    expect(source).toContain('ifTrue: [ frameMethod homeMethod ]');
  });

  it('evaluates the condition against the home frame receiver', () => {
    // The stopped frame's receiver is the ExecBlock itself, so `self` and every
    // instance variable would otherwise fail to resolve (GemTalk/Jasper#561).
    const source = deciderSource([spec()]);
    expect(source).toContain('depth := p localStackDepth.');
    expect(source).toContain('(outer notNil and: [ (outer at: 1) == home ])');
    expect(source).toContain('rcvr := outer at: 10.');
  });

  it('stops at a step point no condition claims', () => {
    // An unconditional breakpoint, or a `halt`, reached while skipping.
    expect(deciderSource([spec()])).toContain(
      `spec isNil ifTrue: [ answerArray := Array with: ${DECISION.Stop} with: nil ]`,
    );
  });

  it('refuses a condition that does not answer a Boolean', () => {
    // Left alone, `each` (rather than `each > 3`) would never equal true and the
    // run would silently go to completion — a breakpoint that quietly does
    // nothing is the worst answer available.
    expect(deciderSource([spec()])).toContain('(answer == true or: [ answer == false ])');
  });

  it('sends no spec lines when nothing is conditional', () => {
    expect(deciderSource([])).toContain('specs := Array new.');
  });

  it('bakes in every conditional breakpoint, and judges each on its own', () => {
    // Several can be armed at once; the block picks whichever claims the step
    // point the process actually stopped at.
    const source = deciderSource([
      spec({
        methodExpr: '(Account compiledMethodAt: #a environmentId: 0)',
        stepPoint: 3,
        condition: 'x > 1',
      }),
      spec({
        methodExpr: '(Order compiledMethodAt: #b environmentId: 0)',
        stepPoint: 9,
        condition: 'y isNil',
      }),
    ]);
    expect(source).toContain("with: 3 with: 'x > 1'");
    expect(source).toContain("with: 9 with: 'y isNil'");
    // Each stop looks up whichever rule claims the step point it landed on —
    // and remembers which, so a log line can name its own logpoint.
    expect(source).toContain(
      '(idx = 0 and: [ (((specs at: k) at: 1) == home) and: [ ((specs at: k) at: 2) = sp ] ])',
    );
  });
});

describe('logMessageExpression', () => {
  it('compiles a message with no placeholders to a literal', () => {
    expect(logMessageExpression('reached here')).toBe("'reached here'");
  });

  it('evaluates a placeholder and prints it', () => {
    // `{each}` rather than `{each printString}` — the ceremony is ours to add.
    expect(logMessageExpression('hit {each}')).toBe("'hit ', (each) printString");
  });

  it('joins several placeholders into ONE expression', () => {
    // Six placeholders must cost the same single evaluation and single fetch as
    // one, or a message becomes more expensive than the breakpoint it is on.
    expect(logMessageExpression('{a} and {b}')).toBe("(a) printString, ' and ', (b) printString");
  });

  it('takes any expression, not just a variable name', () => {
    expect(logMessageExpression('{self orders size}')).toBe('(self orders size) printString');
  });

  it('doubles a quote in the literal text', () => {
    expect(logMessageExpression("it's here")).toBe("'it''s here'");
  });

  it('leaves an unclosed brace as literal text', () => {
    // A message is prose. Refusing to log because a brace was left open would
    // be worse than logging the brace.
    expect(logMessageExpression('a { b')).toBe("'a { b'");
  });

  it('treats an empty placeholder as literal braces', () => {
    // An empty expression would not compile at all.
    expect(logMessageExpression('x{}y')).toBe("'x', '{}', 'y'");
  });

  it('still answers a String for an empty message', () => {
    expect(logMessageExpression('')).toBe("''");
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

  it('reads a log line, and which rule wrote it', () => {
    expect(decodeDecision(DECISION.Log, 'hit 7', 2)).toEqual({
      kind: 'log',
      text: 'hit 7',
      rule: 2,
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
  const performed: { receiver: bigint; selector: string }[] = [];
  const continues: { process: bigint; flags: number }[] = [];
  const gci = {
    utf8ClassOop: () => 74n,
    // One execute per run: compiling the decider. Everything after is a perform.
    GciTsExecute: (_h: unknown, code: string) => {
      executed.push(code);
      return { result: 400n, err: { number: 0, message: '' } };
    },
    GciTsPerform: (_h: unknown, receiver: bigint, _c: bigint, selector: string) => {
      performed.push({ receiver, selector });
      return { result: 500n, err: { number: 0, message: '' } };
    },
    GciTsFetchOops: () => {
      const decision = decisions[Math.min(decisionIndex, decisions.length - 1)];
      decisionIndex += 1;
      return {
        // decision, message, matched-rule index
        oops: [1000n + BigInt(decision), message === '' ? OOP_NIL : 77n, 1001n],
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
    performed,
    continues,
  };
}

const hitsBreakpoint = (process: bigint) => ({
  err: { number: BREAKPOINT_ERROR, message: 'Method breakpoint encountered.', context: process },
});

describe('applyBreakpointRules', () => {
  it('stops without resuming when the condition holds at the first hit', async () => {
    const { session, continues } = stubSession([DECISION.Stop], []);

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'stopped',
      skipped: 0,
    });
    expect(continues).toHaveLength(0);
  });

  it('compiles the decider with debug flags off', async () => {
    // It must not break on the very breakpoints it is judging.
    const { session } = stubSession([DECISION.Stop], []);
    const execute = vi.spyOn(
      session.gci as unknown as { GciTsExecute: (...args: unknown[]) => unknown },
      'GciTsExecute',
    );

    await applyBreakpointRules(session, 7n, [spec()]);

    expect(execute.mock.calls[0][5]).toBe(0);
  });

  it('compiles once and then performs, however many hits it judges', async () => {
    // The whole point of the compile-once shape: a doit is recompiled on every
    // execution, and this one is ~1.8 KB.
    const { session, executed, performed } = stubSession(
      [DECISION.Go, DECISION.Go, DECISION.Go, DECISION.Stop],
      [hitsBreakpoint(8n), hitsBreakpoint(9n), hitsBreakpoint(10n)],
    );

    await applyBreakpointRules(session, 7n, [spec()]);

    expect(executed).toHaveLength(1);
    expect(performed).toHaveLength(4);
    expect(performed.every((p) => p.selector === 'value:')).toBe(true);
    // …on the block the compile answered.
    expect(performed.every((p) => p.receiver === 400n)).toBe(true);
  });

  it('resumes past a false condition and stops at the next hit that holds', async () => {
    const { session, continues } = stubSession(
      [DECISION.Go, DECISION.Go, DECISION.Stop],
      [hitsBreakpoint(8n), hitsBreakpoint(9n)],
    );

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
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

    await applyBreakpointRules(session, 7n, [spec()]);

    expect(continues[0].flags & 1).toBe(1); // ENABLE_DEBUG
    expect(continues[0].flags & 0x20).toBe(0x20); // INTERPRETED
  });

  it('answers a completed run with its result', async () => {
    const { session } = stubSession([DECISION.Go], [{ result: 4242n, err: { number: 0 } }]);

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
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

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'raised',
      description: 'doesNotUnderstand: #foo',
      context: 91n,
      skipped: 1,
    });
  });

  it('lets timers run during a long skip, so it stays interruptible', async () => {
    // The resume does not necessarily yield a macrotask — where the binding has
    // no koffi `.async` its promise is already resolved, and awaiting that
    // drains only the microtask queue. Without a yield of its own the loop
    // starves setTimeout, so the progress notification never appears and there
    // is nothing to cancel with.
    const decisions: number[] = Array.from({ length: 400 }, () => DECISION.Go);
    decisions.push(DECISION.Stop);
    const { session } = stubSession(decisions, [hitsBreakpoint(8n)]);

    // A stubbed hit is far faster than a real one (~0.25 ms against a stone), so
    // drive the clock rather than the wall: one millisecond per call is what the
    // loop is deciding against.
    let clock = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1));

    let timerRan = false;
    setTimeout(() => {
      timerRan = true;
    }, 0);

    try {
      await applyBreakpointRules(session, 7n, [spec()]);
    } finally {
      now.mockRestore();
    }

    expect(timerRan).toBe(true);
  });

  it('writes a logpoint line and carries on rather than stopping', async () => {
    // The whole point of a logpoint: it never stops, so the run reaches its end
    // and the developer gets a line per hit instead of a debugger.
    const { session } = stubSession(
      [DECISION.Log, DECISION.Log, DECISION.Log],
      [hitsBreakpoint(8n), hitsBreakpoint(9n), { result: 42n, err: { number: 0 } }],
      'hit 7',
    );
    const lines: string[] = [];

    const outcome = await applyBreakpointRules(
      session,
      7n,
      [spec({ logMessage: "'hit ', (each) printString" })],
      (text) => lines.push(text),
    );

    expect(outcome).toEqual({ kind: 'completed', resultOop: 42n, skipped: 3 });
    expect(lines).toEqual(['hit 7', 'hit 7', 'hit 7']);
  });

  it('tells the sink which rule wrote the line', async () => {
    // With several logpoints armed, a line has to be attributable to one.
    const { session } = stubSession([DECISION.Log], [{ result: 1n, err: { number: 0 } }], 'x');
    const rules = [spec({ logMessage: "'x'" })];
    const seen: (BreakpointRule | undefined)[] = [];

    await applyBreakpointRules(session, 7n, rules, (_text, rule) => seen.push(rule));

    expect(seen).toEqual([rules[0]]);
  });

  it('carries on past a logpoint whose message will not evaluate', async () => {
    // Stopping there would drop the developer into a debugger they did not ask
    // for, over a typo in a message, and take the run down with it.
    const { session } = stubSession(
      [DECISION.LogFailed, DECISION.LogFailed, DECISION.LogFailed],
      [hitsBreakpoint(8n), hitsBreakpoint(9n), { result: 42n, err: { number: 0 } }],
      'undefined symbol  i',
    );
    const failures: string[] = [];

    const outcome = await applyBreakpointRules(
      session,
      7n,
      [spec({ logMessage: '(i) printString' })],
      undefined,
      (message) => failures.push(message),
    );

    expect(outcome).toEqual({ kind: 'completed', resultOop: 42n, skipped: 3 });
    // Reported ONCE, not once per hit: the message is wrong for every hit, and a
    // thousand identical complaints would bury the run's real output.
    expect(failures).toEqual(['undefined symbol  i']);
  });

  it('answers a condition that could not be evaluated', async () => {
    const { session, continues } = stubSession([DECISION.Failed], [], 'undefined symbol  nope');

    await expect(applyBreakpointRules(session, 7n, [spec()])).resolves.toEqual({
      kind: 'conditionFailed',
      message: 'undefined symbol  nope',
      skipped: 0,
    });
    // And it does not resume: the developer wrote a condition that cannot be
    // applied, so running on past the breakpoint would honour nothing.
    expect(continues).toHaveLength(0);
  });
});
