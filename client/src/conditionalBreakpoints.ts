import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
  OOP_ILLEGAL,
  OOP_NIL,
} from './gciConstants';
import { escapeString } from './queries/util';
import { logError } from './gciLog';

/**
 * The rule a breakpoint carries: stop only when a condition holds, write a line
 * to the log and carry on, or both.
 *
 * **A condition cannot be applied before the stop.** A GemStone method
 * breakpoint always unwinds to the client as error 6005 with the suspended
 * `GsProcess` in `err.context`; a Smalltalk `on: Breakpoint do:` handler is
 * never entered, and neither `GsProcess>>debugActionBlock:` nor
 * `disableDebugging` suppresses it. By the time anyone can evaluate anything,
 * execution has already stopped and the client has already been told. So the
 * work here is deciding, after the fact, whether this particular stop is one the
 * developer asked for — and resuming when it is not.
 *
 * Each skipped hit therefore costs exactly **two** GCI round trips: one
 * `perform:` on a decider block that judges the stop in the suspended frame, and
 * one `GciTsContinueWith` that resumes. Everything the judgement needs — the
 * receiver, the frame's names and values, the symbol list, the
 * `evaluateInContext:` — happens inside that block rather than as the 15-20
 * separate calls it would take to assemble a frame's variables from here
 * (measured at 1.9-2.7 ms per skipped hit locally, and every one of them
 * scaling with network latency). Measured end to end at **~0.25 ms per skipped
 * hit** against a local stone: 900 skips in 215-256 ms.
 *
 * **Why not do the whole loop inside the gem.** `GsProcess>>_continue` resumes a
 * suspended process and returns control to its *Smalltalk* caller, which would
 * put the entire skip loop in one doit — measured at 198 skips in 12-29 ms
 * against 3.6.2, with the cost no longer scaling with hit count or latency at
 * all. It cannot be used: **3.7.x has no `_continue`**. What is left of that
 * primitive there (`_primContinue:`) is unreachable from a GCI-suspended process
 * — it answers "the Process nil to continue from is invalid" whatever it is
 * handed — and 3.7's in-process resume (`setStepOverBreaksAtLevel:breakpointLevel:`)
 * is documented for a *forked* debuggee that has installed its own `Breakpoint`
 * handler and yields to a debugger process, which a process suspended out of a
 * GCI execute has not. `GciTsContinueWith` is the one resume that behaves the
 * same on both releases, so the loop lives here and pays for the round trips.
 *
 * The developer's code is never touched either way: not wrapped, not recompiled,
 * its step points untouched. Nothing is written to the repository: the only
 * thing left behind is the decider block in the session's own temporaries, under
 * one key that each run overwrites, which is never committed and goes away with
 * the session — the same lifetime as the breakpoints it serves.
 */
export interface BreakpointRule {
  /**
   * Smalltalk expression resolving the compiled method the breakpoint is in —
   * `compiledMethodExpr`'s output. An expression rather than an OOP so no round
   * trip is spent resolving one, and so a method that has since been recompiled
   * or removed fails as "no such spec" instead of matching a stale OOP.
   */
  methodExpr: string;
  stepPoint: number;
  /**
   * The Smalltalk expression that has to answer true to stop here. Undefined on
   * a pure logpoint, which never stops and so has nothing to test.
   */
  condition?: string;
  /**
   * What to write to the log each time this breakpoint is reached (and its
   * condition holds), already compiled to a Smalltalk expression answering a
   * String — see `logMessageExpression`. Undefined on a plain breakpoint.
   *
   * A rule with one of these **never stops**: it logs and resumes, which is what
   * makes a logpoint a way of instrumenting a method without editing it.
   */
  logMessage?: string;
  /**
   * How to name this breakpoint's method in a log line — `Account>>deposit:`.
   *
   * Presentation only: the gem is handed `methodExpr`, and this exists so a
   * logpoint's output can say where each line came from without the client
   * spending a round trip to turn an expression back into a class and selector.
   */
  label?: string;
}

/** What came of running a suspended process past its false conditions. */
export type ConditionOutcome =
  /** Execution is suspended at a breakpoint that should stop: open the debugger. */
  | { kind: 'stopped'; skipped: number }
  /** No breakpoint wanted to stop, and the code ran to completion. */
  | { kind: 'completed'; resultOop: bigint; skipped: number }
  /** The developer's code raised while we were skipping past false conditions. */
  | { kind: 'raised'; description: string; context: bigint; skipped: number }
  /** A condition or a log message could not be evaluated. */
  | { kind: 'conditionFailed'; message: string; skipped: number };

/**
 * What the per-stop doit answers, as SmallIntegers.
 *
 * Integers rather than Symbols so reading the answer back is an OOP-to-integer
 * decode rather than another round trip to fetch a symbol's characters — this
 * runs once per hit, so it is the one thing in the loop worth keeping cheap.
 */
export const DECISION = {
  /** Stop here: the condition held, or this step point has no condition. */
  Stop: 1,
  /** Skip: the condition answered false. */
  Go: 2,
  /** The condition could not be evaluated, so it cannot be honoured. */
  Failed: 3,
  /** Write the answered text to the log, then carry on. Never stops. */
  Log: 4,
  /**
   * The log message could not be evaluated. Reported, then carried on from —
   * a logpoint that cannot say anything is still a logpoint, and hijacking the
   * run into a debugger the developer did not ask for is the wrong answer to a
   * typo in a message.
   */
  LogFailed: 5,
} as const;

/** GemStone's "method breakpoint encountered". */
export const BREAKPOINT_ERROR = 6005;

/**
 * Resumed execution stays interpreted and debuggable, the same flags the
 * debugger's own Resume uses (see `debugQueries`): GemStone cannot step native
 * code, and dropping the debug flag would disarm every remaining breakpoint in
 * the run.
 */
const CONTINUE_FLAGS = GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED;

/** How much of a condition's error message is worth reading back. */
const MAX_MESSAGE = 4096;

/** How long a skip runs before it is worth telling the developer about. */
const PROGRESS_AFTER_MS = 1500;

/**
 * How long the loop may hold the event loop before yielding a macrotask.
 *
 * Resuming does not necessarily yield one: where the GCI binding has no koffi
 * `.async` the resume is a blocking call whose promise is already resolved, and
 * awaiting that drains only the *microtask* queue. A loop of thousands of hits
 * then starves `setTimeout` outright — the progress notification never appears,
 * cancellation never runs, and the editor sits still for the whole run with no
 * way out of it. Yielding on elapsed time rather than every N hits keeps the
 * cost proportional however fast or slow a hit turns out to be: about one
 * timer's minimum delay per 25 ms of work.
 */
const YIELD_EVERY_MS = 25;

/** Let pending timers — the progress notification, and its Cancel — run. */
function yieldToTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A Smalltalk string literal for `text`. */
function literal(text: string): string {
  return `'${escapeString(text)}'`;
}

/**
 * Compile a logpoint's message into one Smalltalk expression answering a String.
 *
 * The message is plain text with `{…}` placeholders, as VS Code writes them.
 * Text outside the braces is literal; what is inside is an expression evaluated
 * in the suspended frame, with the same names in scope a condition gets — the
 * method's arguments and temporaries, a block's own variables, `self`, instance
 * and class variables, and the symbol list.
 *
 * The whole message becomes **one** expression rather than one per placeholder,
 * so a message with six of them costs the same single evaluation and single
 * string fetch as a message with one.
 *
 * Each placeholder is wrapped in `printString`, so `{each}` is written rather
 * than `{each printString}`. GemStone has no `displayString`, so a String logs
 * with its quotes — `'demo'` rather than `demo` — which is at least unambiguous.
 *
 * An unclosed `{` is treated as literal text: a message is prose, and refusing
 * to log because a brace was left open would be worse than logging the brace.
 */
export function logMessageExpression(message: string): string {
  const parts: string[] = [];
  let rest = message;

  while (rest.length > 0) {
    const open = rest.indexOf('{');
    if (open === -1) break;
    const close = rest.indexOf('}', open + 1);
    if (close === -1) break; // unclosed — the remainder is literal

    if (open > 0) parts.push(literal(rest.slice(0, open)));
    const expression = rest.slice(open + 1, close).trim();
    // `{}` says nothing; treat it as the literal braces rather than compiling
    // an empty expression, which would not compile at all.
    if (expression === '') parts.push(literal('{}'));
    else parts.push(`(${expression}) printString`);
    rest = rest.slice(close + 1);
  }
  if (rest.length > 0) parts.push(literal(rest));

  // A message that is entirely literal, or empty, still has to answer a String.
  if (parts.length === 0) return literal('');
  return parts.join(', ');
}

/**
 * The key the compiled decider is parked under, in the session's temporaries.
 *
 * `SessionTemps` is per-session VM state, exactly like the breakpoints this
 * serves: it is never committed, is invisible to every other session, and goes
 * away at logout. One key, overwritten by each run, so a session accumulates at
 * most one of these however many times it is used.
 */
const DECIDER_KEY = 'JasperConditionalBreakpointDecider';

/**
 * A doit that compiles the decision logic **once** and answers the block.
 *
 * Compiled once and then performed, rather than sent as a doit per hit, because
 * the source below is ~1.8 KB and GemStone compiles a doit every time it is
 * executed: measured against a live stone, a ~1.2 KB doit that does no work at
 * all costs 0.21 ms, while a `perform:` on an already-compiled block costs
 * 0.048 ms. At 900 skipped hits that is the difference between ~330 ms and
 * ~45 ms spent deciding, on top of the ~0.32 ms per hit the resume itself
 * costs and which no amount of cleverness here can avoid.
 *
 * The specs are baked in rather than passed per call: the armed conditional
 * breakpoints cannot change while a single run is being skipped, and a block
 * that closes over them needs no argument but the process.
 *
 * **Every stop is re-identified from its own frame.** A resume can land on a
 * *different* breakpoint — another condition, or none at all — so the block
 * looks up which spec, if any, claims the step point it actually stopped at. A
 * stop that matches none is an unconditional breakpoint (or a `halt`) and
 * answers Stop, which is what keeps a plain breakpoint working while a
 * conditional one is being skipped, and what lets several conditional
 * breakpoints be armed at once with each judged on its own condition.
 *
 * The receiver a condition is evaluated against comes from the breakpoint's
 * **home** frame, not the frame that stopped. For a breakpoint inside a
 * non-inlined block the stopped frame's receiver is the `ExecBlock` itself, so
 * `self` and every instance and class variable would fail to resolve — verified
 * against a live stone, and the same defect the debugger's eval bar has in a
 * block frame (GemTalk/Jasper#561). Walking down to the frame whose method is
 * the block's `homeMethod` recovers the real receiver. Names and values still
 * come from the stopped frame, which is where the block's own arguments and
 * temporaries live.
 *
 * Written without `^`: a non-local return from a block whose home doit has
 * already finished is an error, so each exit assigns `answerArray` and the
 * steps after it are guarded on its being nil.
 */
export function deciderSource(specs: BreakpointRule[]): string {
  const specLines = specs
    .map(
      (spec) =>
        `specs add: (Array with: ([ ${spec.methodExpr} ] on: Error do: [:ex | nil ]) ` +
        `with: ${spec.stepPoint} ` +
        `with: ${spec.condition === undefined ? 'nil' : literal(spec.condition)} ` +
        `with: ${spec.logMessage === undefined ? 'nil' : literal(spec.logMessage)}).`,
    )
    .join('\n');

  return `| specs decider |
specs := Array new.
${specLines}
decider := [:p | | answerArray fc frameMethod home sp spec idx rcvr found lvl depth names dict sl answer |
  answerArray := nil.
  idx := 0.
  fc := p _frameContentsAt: 1.
  fc isNil ifTrue: [ answerArray := Array with: ${DECISION.Stop} with: nil ].
  answerArray isNil ifTrue: [
    frameMethod := fc at: 1.
    home := frameMethod isMethodForBlock
              ifTrue: [ frameMethod homeMethod ]
              ifFalse: [ frameMethod ].
    sp := p _stepPointAt: 1.
    "The index, not just the spec: a log line has to name which logpoint wrote
     it, and this is the only place that knows which one matched."
    1 to: specs size do: [:k |
      (idx = 0 and: [ (((specs at: k) at: 1) == home) and: [ ((specs at: k) at: 2) = sp ] ])
        ifTrue: [ idx := k ] ].
    spec := idx = 0 ifTrue: [ nil ] ifFalse: [ specs at: idx ].
    spec isNil ifTrue: [ answerArray := Array with: ${DECISION.Stop} with: nil ] ].
  answerArray isNil ifTrue: [
    rcvr := fc at: 10.
    frameMethod isMethodForBlock ifTrue: [
      found := false.
      lvl := 2.
      depth := p localStackDepth.
      [ found not and: [ lvl <= depth ] ] whileTrue: [ | outer |
        outer := p _frameContentsAt: lvl.
        (outer notNil and: [ (outer at: 1) == home ]) ifTrue: [
          rcvr := outer at: 10.
          found := true ].
        lvl := lvl + 1 ] ].
    names := fc at: 9.
    dict := SymbolDictionary new.
    names ifNotNil: [
      1 to: names size do: [:k | | nm |
        nm := (names at: k) asString.
        (nm isEmpty or: [ (nm at: 1) == $. ]) ifFalse: [
          dict at: nm asSymbol put: (fc at: 10 + k) ] ] ].
    sl := (SymbolList with: dict), System myUserProfile symbolList.
    "A rule with no condition always applies; one with a condition has to answer
     true, and anything that is not a Boolean is a mistake worth reporting
     rather than a quiet 'no'."
    (spec at: 3) ifNotNil: [
      answer := [ (spec at: 3) evaluateInContext: rcvr symbolList: sl ]
                  on: Error
                  do: [:ex |
                    answerArray := Array with: ${DECISION.Failed}
                                         with: (ex messageText ifNil: [ ex class name asString ]).
                    nil ].
      answerArray isNil ifTrue: [
        (answer == true or: [ answer == false ])
          ifFalse: [
            answerArray := Array with: ${DECISION.Failed}
                                 with: ('the condition answered ',
                                        ([ answer printString ] on: Error do: [:ex | answer class name asString ]),
                                        ', not true or false') ]
          ifTrue: [ answer ifFalse: [ answerArray := Array with: ${DECISION.Go} with: nil ] ] ] ].
    "Here the rule applies: no condition, or one that held."
    answerArray isNil ifTrue: [
      (spec at: 4)
        ifNil: [ answerArray := Array with: ${DECISION.Stop} with: nil ]
        ifNotNil: [ | text |
          text := [ ((spec at: 4) evaluateInContext: rcvr symbolList: sl) ]
                    on: Error
                    do: [:ex |
                      answerArray := Array with: ${DECISION.LogFailed}
                                           with: (ex messageText ifNil: [ ex class name asString ]).
                      nil ].
          answerArray isNil ifTrue: [
            answerArray := Array with: ${DECISION.Log}
                                 with: ([ text asString ] on: Error do: [:ex | text printString ]) ] ] ] ].
  answerArray , (Array with: idx) ].
SessionTemps current at: #'${DECIDER_KEY}' put: decider.
decider`;
}

/** One stop's verdict, as the loop reads it. */
export type Decision =
  | { kind: 'stop' }
  | { kind: 'go' }
  /** `rule` is the index into the rules the decider was built with, 1-based. */
  | { kind: 'log'; text: string; rule: number }
  /** A logpoint whose message would not evaluate. Reported, never stopped at. */
  | { kind: 'logFailed'; message: string; rule: number }
  | { kind: 'failed'; message: string };

/**
 * Read the doit's `{ decision. message }` back.
 *
 * An unrecognised decision is read as a stop: the process really is suspended at
 * a breakpoint, so opening the debugger on it is both true and the reading that
 * loses nothing.
 */
export function decodeDecision(decision: number, message: string, rule = 0): Decision {
  switch (decision) {
    case DECISION.Go:
      return { kind: 'go' };
    case DECISION.Log:
      return { kind: 'log', text: message, rule };
    case DECISION.LogFailed:
      return { kind: 'logFailed', message, rule };
    case DECISION.Failed:
      return { kind: 'failed', message };
    default:
      return { kind: 'stop' };
  }
}

/**
 * Compile the decider for `specs` and answer the block.
 *
 * One doit per run of skipping, however many hits it goes on to judge.
 */
function installDecider(session: ActiveSession, specs: BreakpointRule[]): bigint {
  const { result, err } = session.gci.GciTsExecute(
    session.handle,
    deciderSource(specs),
    session.gci.utf8ClassOop(session.handle),
    OOP_ILLEGAL,
    OOP_NIL,
    0, // debug OFF: the decider must not break on the breakpoints it is judging
    0,
  );
  if (err.number !== 0) throw new Error(err.message || `GemStone error ${err.number}`);
  return result;
}

/**
 * Ask the compiled decider what to do about the stop `process` is parked at.
 *
 * A `perform:` rather than a doit, so nothing is compiled per hit — see
 * `deciderSource`. The process is handed over as the object it is, so the block
 * needs no oop lookup either.
 */
function decideWith(session: ActiveSession, decider: bigint, process: bigint): Decision {
  const { result: arrayOop, err } = session.gci.GciTsPerform(
    session.handle,
    decider,
    OOP_ILLEGAL,
    'value:',
    [process],
    0,
    0,
  );
  if (err.number !== 0) throw new Error(err.message || `GemStone error ${err.number}`);

  // Three slots in one fetch: the decision, its message, and which rule matched.
  const { oops, err: fetchErr } = session.gci.GciTsFetchOops(session.handle, arrayOop, 1n, 3);
  if (fetchErr.number !== 0) {
    throw new Error(fetchErr.message || `GemStone error ${fetchErr.number}`);
  }
  const decision = Number(session.gci.oopToInteger(session.handle, oops[0]));
  const rule =
    oops[2] === undefined ? 0 : Number(session.gci.oopToInteger(session.handle, oops[2]));

  let message = '';
  const carriesText =
    decision === DECISION.Failed || decision === DECISION.Log || decision === DECISION.LogFailed;
  if (carriesText && oops[1] !== OOP_NIL) {
    const fetched = session.gci.GciTsFetchChars(session.handle, oops[1], 1n, MAX_MESSAGE);
    if (fetched.err.number === 0) message = fetched.data;
    else logError(session.id, fetched.err.message || `GCI error ${fetched.err.number}`);
  }
  return decodeDecision(decision, message, rule);
}

/**
 * Resume `processOop` past every breakpoint whose condition is false, and answer
 * where it ended up.
 *
 * The resume runs on a worker thread (`GciTsContinueWithAsync`), so a condition
 * that is never true over a long-running loop leaves VS Code responsive instead
 * of freezing the extension host for the length of the run. Past
 * `PROGRESS_AFTER_MS` a cancellable notification appears; cancelling stops at
 * whatever hit the run has reached, which is a real place to be — the process is
 * suspended at a breakpoint either way.
 */
export async function applyBreakpointRules(
  session: ActiveSession,
  processOop: bigint,
  specs: BreakpointRule[],
  onLog?: (text: string, rule: BreakpointRule | undefined) => void,
  /**
   * A logpoint whose message would not evaluate, reported **once per rule** —
   * the message is wrong for every hit, and a thousand identical complaints
   * would bury the run's real output.
   */
  onLogFailure?: (message: string, rule: BreakpointRule | undefined) => void,
): Promise<ConditionOutcome> {
  const decider = installDecider(session, specs);
  let process = processOop;
  let skipped = 0;
  let logged = 0;
  const reportedBadLog = new Set<number>();
  let lastYield = Date.now();
  let cancelled = false;
  let report: (() => void) | undefined;
  let closeProgress: (() => void) | undefined;

  const progressTimer = setTimeout(() => {
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'GemStone: applying breakpoint conditions',
        cancellable: true,
      },
      (progress, token) =>
        new Promise<void>((resolve) => {
          closeProgress = resolve;
          report = () =>
            progress.report({
              message: logged > 0 ? `${skipped} skipped, ${logged} logged` : `${skipped} skipped`,
            });
          report();
          token.onCancellationRequested(() => {
            cancelled = true;
          });
        }),
    );
  }, PROGRESS_AFTER_MS);

  try {
    for (;;) {
      const decision = decideWith(session, decider, process);
      if (decision.kind === 'stop') return { kind: 'stopped', skipped };
      if (decision.kind === 'failed') {
        return { kind: 'conditionFailed', message: decision.message, skipped };
      }
      // A logpoint writes its line and carries on. It never stops, which is the
      // whole point: it instruments a method without editing it.
      if (decision.kind === 'log') {
        onLog?.(decision.text, specs[decision.rule - 1]);
        logged += 1;
      }
      // …and a logpoint whose message is broken carries on too. Stopping would
      // drop the developer into a debugger they did not ask for, over a typo in
      // a message, and take the run with it.
      if (decision.kind === 'logFailed' && !reportedBadLog.has(decision.rule)) {
        reportedBadLog.add(decision.rule);
        onLogFailure?.(decision.message, specs[decision.rule - 1]);
      }
      // Asked to stop: this hit is as good a place as any, and the process is
      // suspended at a real breakpoint.
      if (cancelled) return { kind: 'stopped', skipped };

      const { result, err } = await session.gci.GciTsContinueWithAsync(
        session.handle,
        process,
        // Resume as-is rather than forcing the top of stack to nil — see
        // `continueExecution` in debugQueries for why that distinction matters.
        OOP_ILLEGAL,
        null,
        CONTINUE_FLAGS,
      );
      skipped += 1;
      report?.();

      if (Date.now() - lastYield >= YIELD_EVERY_MS) {
        await yieldToTimers();
        lastYield = Date.now();
      }

      if (err.number === 0) return { kind: 'completed', resultOop: result, skipped };
      if (err.number !== BREAKPOINT_ERROR) {
        // The developer's own code raised, or execution stopped for some other
        // reason. Either way that is the thing worth showing.
        return {
          kind: 'raised',
          description: err.message || `GemStone error ${err.number}`,
          context: toBigInt(err.context),
          skipped,
        };
      }
      const next = toBigInt(err.context);
      if (next !== 0n && next !== OOP_NIL) process = next;
    }
  } finally {
    clearTimeout(progressTimer);
    closeProgress?.();
  }
}

/** koffi hands back a uint64 as a Number when it fits; normalise to bigint. */
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}
