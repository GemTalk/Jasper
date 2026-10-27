import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import {
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
  OOP_ILLEGAL,
  OOP_NIL,
  toBigInt,
} from '../gciConstants';
import { gsStringLiteral as literal } from '../serverPlugin/installHelpers';
import { logError, logInfo } from '../gciLog';
import {
  cancelRunOn,
  EARLIEST_STOP_WAITING_MS,
  holdSessionUntilSettled,
  isRunning,
  NbCancelledError,
  sayStillRunning,
  STOP_WAITING_AFTER_MS,
  trackRun,
} from '../nbRunner';
import { continueThroughForwarderSends } from '../transcriptSink';
import { FRAME_SELF_SMALLTALK } from './debugQueries';
import type { StepResult } from './debugQueries';
import type { GciError } from '../gciLibrary';
import { appendLogpoint, showLogpointChannel } from './logpointChannel';
import { skipLiteral } from '../smalltalkScan';

/**
 * The rule a breakpoint carries: a condition, a trigger, a log message, or any
 * combination.
 *
 * **A condition cannot be applied before the stop.** A GemStone method
 * breakpoint always unwinds to the client as error 6005 with the suspended
 * `GsProcess` in `err.context`; an `on: Breakpoint do:` handler is never
 * entered, and neither `GsProcess>>debugActionBlock:` nor `disableDebugging`
 * suppresses it. So each stop is judged after the fact, and resumed when the
 * rules decline it.
 *
 * Each skipped hit costs three GCI round trips (judge, fetch the verdict,
 * resume), plus one to fetch a log line. The whole judgement runs inside the
 * decider block; assembling a frame's variables from here would take 15-20
 * calls, each one scaling with latency.
 *
 * **Why the loop is not inside the gem.** `GsProcess>>_continue` would let one
 * doit run the whole loop (198 skips in 12-29 ms on 3.6.2), but **3.7.x has no
 * `_continue`**. Its `_primContinue:` answers "the Process nil to continue from
 * is invalid" for a GCI-suspended process, and
 * `setStepOverBreaksAtLevel:breakpointLevel:` needs a forked debuggee with its
 * own `Breakpoint` handler. `GciTsContinueWith` is the one resume that behaves
 * the same on both releases.
 *
 * The debugger's Resume and Run to Cursor go through {@link resumeOnWorker};
 * steps are never filtered.
 */
export interface BreakpointRule {
  /**
   * Smalltalk expression resolving the breakpoint's compiled method
   * (`compiledMethodExpr`). An expression rather than an OOP, so a recompiled or
   * removed method matches nothing instead of a stale OOP.
   */
  methodExpr: string;
  stepPoint: number;
  /**
   * Has to answer true to stop. Undefined on a pure logpoint, or on a breakpoint
   * listed only because it is one end of a trigger.
   */
  condition?: string;
  /**
   * Already compiled by `logMessageExpression`. A rule with one **never stops**:
   * it logs and resumes.
   */
  logMessage?: string;
  /**
   * `Account>>deposit:`, for log lines only: it saves a round trip turning
   * `methodExpr` back into a name.
   */
  label?: string;
  /**
   * 1-based index, in this spec array, of the breakpoint that has to be reached
   * first. An index because the arming state is one Array parallel to the specs.
   *
   * A rule may name its **own** index, which keeps a breakpoint whose trigger was
   * disabled or removed disarmed: a breakpoint still waiting arms nothing,
   * itself included.
   */
  triggeredBy?: number;
}

/**
 * Where the rules on the armed breakpoints come from, narrowed so this module
 * does not depend on the breakpoint manager.
 */
export interface BreakpointRuleSource {
  breakpointRulesFor(session: ActiveSession): BreakpointRule[];
}

let ruleSource: BreakpointRuleSource | undefined;

/**
 * Name the source every run consults. `activate` registers the breakpoint
 * manager here, which is how the debugger's Resume reaches the same rules as the
 * run that opened it without depending on either.
 */
export function setBreakpointRuleSource(source: BreakpointRuleSource | undefined): void {
  ruleSource = source;
}

function rulesFor(session: ActiveSession): BreakpointRule[] {
  return ruleSource?.breakpointRulesFor(session) ?? [];
}

/**
 * Where a run ended up after its rules were applied. An outcome that leaves a
 * process suspended names it in `context`, for the debugger to open on.
 */
export type ConditionOutcome =
  | { kind: 'stopped'; context: bigint; skipped: number }
  /** Suspended at the hit the skip had reached. */
  | { kind: 'cancelled'; context: bigint; skipped: number }
  | { kind: 'completed'; resultOop: bigint; skipped: number }
  /**
   * Stopped for something other than a breakpoint while skipping: the code
   * raised, or a soft break (6003) arrived. `errorNumber` tells them apart.
   */
  | {
      kind: 'raised';
      description: string;
      errorNumber: number;
      context: bigint;
      skipped: number;
    }
  | { kind: 'conditionFailed'; message: string; context: bigint; skipped: number };

/**
 * What the decider answers. SmallIntegers rather than Symbols, so reading the
 * answer back, once per hit, needs no round trip to fetch characters.
 */
export const DECISION = {
  Stop: 1,
  /** Resume: a false condition, or a trigger not yet reached. */
  Go: 2,
  Failed: 3,
  /** Log the answered text and resume. */
  Log: 4,
  /** Reported, then resumed: a typo in a message is no reason to stop the run. */
  LogFailed: 5,
} as const;

/** GemStone's "method breakpoint encountered". */
export const BREAKPOINT_ERROR = 6005;

/**
 * GemStone's "a soft break was received". Only ever the developer's Cancel, so
 * a skip it interrupts is a cancelled skip, not a failed one.
 */
export const SOFT_BREAK_ERROR = 6003;

/**
 * Resumed execution stays interpreted and debuggable, the same flags the
 * debugger's own Resume uses (see `debugQueries`): GemStone cannot step native
 * code, and dropping the debug flag would disarm every remaining breakpoint in
 * the run.
 */
export const CONTINUE_FLAGS = GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED;

/**
 * How many characters of a log line or a condition's error are read back. Cut
 * in the gem, by characters, so a long non-ASCII line is never split inside a
 * character, and marked with `...` so a cut line does not pass for a whole one.
 */
const MAX_MESSAGE_CHARS = 4096;

/** Room for `MAX_MESSAGE_CHARS` characters of UTF-8 and the cut marker. */
const MAX_MESSAGE_BYTES = MAX_MESSAGE_CHARS * 4 + 16;

/** How long a skip runs before it is worth telling the developer about. */
const PROGRESS_AFTER_MS = 1500;

/**
 * How long the loop may run before yielding a macrotask (and updating the
 * progress notification). A resume that arrives already resolved drains only
 * microtasks, so without this a loop of thousands of hits starves `setTimeout`:
 * no progress notification, no Cancel. Timed rather than every N hits, so the
 * cost stays proportional however long a hit takes.
 */
const YIELD_EVERY_MS = 25;

/** Let pending timers — the progress notification, and its Cancel — run. */
function yieldToTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The developer's `text` as a Smalltalk expression answering a Unicode string,
 * for the decider's source, which has to stay ASCII.
 *
 * Non-ASCII text is spelled out as code points: as a literal, `name = 'café'`
 * broke the 3.6.x compiler on the WHOLE decider ("ComStrmSetCursor: new cursor
 * out of range"), failing every rule in the session. A Unicode string either
 * way, so `evaluateInContext:` compiles it exactly as a workspace would.
 */
function developerText(text: string): string {
  const codePoints = [...text].map((c) => c.codePointAt(0) as number);
  if (codePoints.every((cp) => cp < 128)) return literal(text);
  return (
    `((String withAll: (#(${codePoints.join(' ')}) collect: [:c | Character codePoint: c])) ` +
    `asUnicodeString)`
  );
}

/**
 * Where the `}` that closes the placeholder opened at `open` is, or -1.
 *
 * Read the way Smalltalk reads it, because a placeholder is Smalltalk: a brace
 * array (`{a. b}`) nests, and a `}` inside a string literal, a comment or a
 * character literal (`$}`) closes nothing.
 */
function closingBrace(message: string, open: number): number {
  let depth = 0;
  for (let i = open + 1; i < message.length;) {
    const quoted = skipLiteral(message, i);
    if (quoted) {
      i = quoted.end;
      continue;
    }
    if (message[i] === '{') depth += 1;
    else if (message[i] === '}') {
      if (depth === 0) return i;
      depth -= 1;
    }
    i += 1;
  }
  return -1;
}

/**
 * Compile a logpoint's message into one Smalltalk expression answering a String.
 *
 * Each `{…}` placeholder is one expression, evaluated in the suspended frame with
 * the names a condition sees; the rest is literal. One expression for the whole
 * message, so six placeholders cost one evaluation and one fetch. Placeholders
 * are sent `printString`; GemStone has no `displayString`, so a String logs with
 * its quotes. An unclosed `{` is logged as text rather than refusing to log.
 */
export function logMessageExpression(message: string): string {
  const parts: string[] = [];
  let rest = message;

  while (rest.length > 0) {
    const open = rest.indexOf('{');
    if (open === -1) break;
    const close = closingBrace(rest, open);
    if (close === -1) break; // unclosed — the remainder is literal

    if (open > 0) parts.push(literal(rest.slice(0, open)));
    const expression = rest.slice(open + 1, close).trim();
    // An empty expression would not compile; log the braces.
    if (expression === '') parts.push(literal('{}'));
    else parts.push(`(${expression}) printString`);
    rest = rest.slice(close + 1);
  }
  if (rest.length > 0) parts.push(literal(rest));

  if (parts.length === 0) return literal('');
  return parts.join(', ');
}

/**
 * Where the session's runs are parked in `SessionTemps`: an identity dictionary
 * from each run's process to its entry. `SessionTemps` is never committed, is
 * invisible to other sessions and goes at logout, like the breakpoints, and it
 * keeps the decider alive between `perform:`s (a GCI result is not otherwise
 * pinned). Keyed by process so a run paused in the debugger keeps its arming
 * while another run in the session stops.
 */
const DECIDER_KEY = 'JasperBreakpointRuns';

/**
 * A doit that compiles one run's decision logic and answers the block.
 *
 * Compiled once and performed per hit because GemStone compiles a doit on every
 * execution: measured, a ~1.2 KB doit doing nothing costs 0.21 ms, a `perform:`
 * on a compiled block 0.048 ms. The developer's condition and message are still
 * compiled per hit, by `evaluateInContext:`, since their method is never touched.
 *
 * Each spec's method is resolved by evaluating its expression inside an error
 * guard: a removed class then costs only its own rule (that breakpoint simply
 * stops), where a bare class name here would fail to compile the whole decider.
 *
 * **Every stop is re-identified from its own frame.** A resume can land on a
 * different breakpoint, so the block looks up the spec claiming the step point
 * it actually stopped at. None means a plain breakpoint or a `halt`: Stop.
 *
 * **Triggers are an Array of flags parallel to the specs.** A waiting breakpoint
 * is skipped like a false condition until its trigger is reached. Arming is one
 * `at:put:` in the gem, in execution order, so it cannot land after what it arms.
 *
 * **The flags last for the run.** Each run's process, specs and flags are one
 * entry under {@link DECIDER_KEY}. A Resume rebuilds the decider from the
 * current rules (one may have been edited while stopped), and a breakpoint still
 * waiting on the same trigger keeps its flag. Ended runs are dropped by the next
 * install rather than by each of the debugger's ways to end one.
 *
 * `self` and the names a condition sees are the debugger's: `self` per
 * {@link FRAME_SELF_SMALLTALK} (a block's captured receiver, else the home
 * activation's), names from the home method overlaid with the block's own.
 *
 * Written without `^`: a non-local return from a block whose home doit has
 * finished is an error, so each exit assigns `answerArray` and later steps are
 * guarded on it being nil. Kept ASCII, comments included: the 3.6 compiler fails
 * on anything else.
 */
export function deciderSource(specs: BreakpointRule[], processOop: bigint): string {
  const specLines = specs
    .map(
      (spec) =>
        `specs add: (Array with: ([ ${developerText(spec.methodExpr)} evaluate ] on: Error do: [:ex | nil ]) ` +
        `with: ${spec.stepPoint} ` +
        `with: ${spec.condition === undefined ? 'nil' : developerText(spec.condition)} ` +
        `with: ${spec.logMessage === undefined ? 'nil' : developerText(spec.logMessage)} ` +
        // Fifth slot: the trigger's index, 0 for armed from the start.
        // `Array with:` takes five on both 3.6.2 and 3.7.
        `with: ${spec.triggeredBy ?? 0}).`,
    )
    .join('\n');

  return `| proc specs armed runs old oldSpecs entry decider homeFrameOf frameSelfOf |
proc := Object _objectForOop: ${processOop}.
${FRAME_SELF_SMALLTALK}
specs := Array new.
${specLines}
armed := specs collect: [:s | (s at: 5) = 0].
"Carry over this process's flags: the same step point, waiting on the same
 step point, keeps its arming."
runs := SessionTemps current at: #'${DECIDER_KEY}' otherwise: nil.
runs isNil ifTrue: [
  runs := IdentityKeyValueDictionary new.
  SessionTemps current at: #'${DECIDER_KEY}' put: runs ].
"A run that has ended will never be resumed: terminated, or finished, which
 leaves a process with no top frame (its status still reads debug)."
(runs keys select: [:k |
  [ k _isTerminated or: [ (k _frameContentsAt: 1) isNil ] ] on: Error do: [:ex | true ] ])
  do: [:k | runs removeKey: k ].
old := runs at: proc otherwise: nil.
old notNil ifTrue: [
  oldSpecs := old at: 3.
  1 to: specs size do: [:k | | s t |
    s := specs at: k.
    ((s at: 5) > 0 and: [ (s at: 1) notNil ]) ifTrue: [
      t := specs at: (s at: 5).
      1 to: oldSpecs size do: [:j | | os ot |
        os := oldSpecs at: j.
        (((os at: 1) == (s at: 1) and: [ (os at: 2) = (s at: 2) ]) and: [ (os at: 5) > 0 ]) ifTrue: [
          ot := oldSpecs at: (os at: 5).
          ((ot at: 1) == (t at: 1) and: [ (ot at: 2) = (t at: 2) ])
            ifTrue: [ armed at: k put: ((old at: 4) at: j) ] ] ] ] ] ].
entry := Array with: proc with: nil with: specs with: armed.
decider := [:p | | answerArray fc frameMethod home sp spec idx rcvr fetch depth hArr dict bind sl answer |
  "The run can move to another process; its entry moves with it."
  (entry at: 1) == p ifFalse: [
    runs removeKey: (entry at: 1) otherwise: nil.
    entry at: 1 put: p.
    runs at: p put: entry ].
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
    1 to: specs size do: [:k |
      (idx = 0 and: [ (((specs at: k) at: 1) == home) and: [ ((specs at: k) at: 2) = sp ] ])
        ifTrue: [ idx := k ] ].
    spec := idx = 0 ifTrue: [ nil ] ifFalse: [ specs at: idx ].
    spec isNil ifTrue: [ answerArray := Array with: ${DECISION.Stop} with: nil ].
    "Still waiting on its trigger: skipped, and arms nothing."
    (answerArray isNil and: [ (armed at: idx) not ])
      ifTrue: [ answerArray := Array with: ${DECISION.Go} with: nil ] ].
  answerArray isNil ifTrue: [
    fetch := [:j | [ p _frameContentsAt: j ] on: Error do: [:e | nil ] ].
    depth := p localStackDepth.
    rcvr := (frameSelfOf value: fetch value: 1 value: fc value: depth)
              ifNil: [ (fc at: 7) isNil ifTrue: [ fc at: 10 ] ifFalse: [ nil ] ].
    hArr := homeFrameOf value: fetch value: 1 value: fc value: depth.
    dict := SymbolDictionary new.
    bind := [:a | (a at: 9) ifNotNil: [:names |
      1 to: names size do: [:k | | nm |
        nm := (names at: k) asString.
        ((nm isEmpty or: [ (nm at: 1) == $. ]) or: [ (10 + k) > a size ])
          ifFalse: [ dict at: nm asSymbol put: (a at: 10 + k) ] ] ] ].
    hArr ifNotNil: [:h | bind value: h ].
    bind value: fc.
    sl := (SymbolList with: dict), System myUserProfile symbolList.
    "A non-Boolean answer is reported, not read as false."
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
    "Reached: arm what waits on it before deciding about this stop, so a
     trigger that stops the run has already armed its dependents."
    answerArray isNil ifTrue: [
      1 to: specs size do: [:k |
        (((specs at: k) at: 5) = idx) ifTrue: [ armed at: k put: true ] ] ].
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
  "Cut by characters, then sent as UTF-8, which is how the client decodes it."
  (answerArray at: 2) ifNotNil: [:m | | t |
    t := m.
    t size > ${MAX_MESSAGE_CHARS} ifTrue: [ t := (t copyFrom: 1 to: ${MAX_MESSAGE_CHARS}), '...' ].
    answerArray at: 2 put: t encodeAsUTF8 ].
  answerArray , (Array with: idx) ].
entry at: 2 put: decider.
runs at: proc put: entry.
decider`;
}

/** One stop's verdict, as the loop reads it. */
export type Decision =
  | { kind: 'stop' }
  | { kind: 'go' }
  /** `rule` is the index into the rules the decider was built with, 1-based. */
  | { kind: 'log'; text: string; rule: number }
  | { kind: 'logFailed'; message: string; rule: number }
  | { kind: 'failed'; message: string };

/**
 * Read the decider's `{ decision. message. rule index }` back.
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

/** A GCI call of ours that failed, keeping GemStone's error number. */
class DeciderError extends Error {
  constructor(
    message: string,
    readonly errorNumber: number,
  ) {
    super(message);
  }
}

/**
 * Release a process one of our own calls left suspended. The decider runs in a
 * process of its own, never the developer's, so whatever stopped it — a break or
 * an error — leaves nothing anyone will resume.
 */
function releaseProcess(session: ActiveSession, context: number | bigint | undefined): void {
  if (context === undefined) return;
  const process = toBigInt(context);
  if (process === 0n || process === OOP_NIL) return;
  try {
    session.GciTsClearStack(process);
  } catch (e) {
    logError(session.id, `Could not release a stopped process: ${errorText(e)}`);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Compile this run's decider and answer the block. One doit per run or Resume. */
function installDecider(session: ActiveSession, specs: BreakpointRule[], process: bigint): bigint {
  const { result, err } = session.GciTsExecute(
    deciderSource(specs, process),
    session.utf8ClassOop(),
    OOP_ILLEGAL,
    OOP_NIL,
    0, // debug OFF: the decider must not break on the breakpoints it is judging
    0,
  );
  if (err.number !== 0) {
    releaseProcess(session, err.context);
    throw new DeciderError(err.message || `GemStone error ${err.number}`, err.number);
  }
  return result;
}

/**
 * Ask the compiled decider what to do about the stop `process` is parked at.
 *
 * A `perform:` rather than a doit, so the decider itself is not recompiled per
 * hit, and on a worker thread, because what it evaluates is the developer's: a
 * condition that loops or crawls must leave VS Code responsive, and a soft
 * break from Cancel must be able to reach it.
 */
async function decideWith(
  session: ActiveSession,
  decider: bigint,
  process: bigint,
): Promise<Decision> {
  const { result: arrayOop, err } = await session.GciTsPerformAsync(
    decider,
    OOP_ILLEGAL,
    'value:',
    [process],
    0,
    0,
  );
  if (err.number !== 0) {
    releaseProcess(session, err.context);
    throw new DeciderError(err.message || `GemStone error ${err.number}`, err.number);
  }

  // Three slots in one fetch: the decision, its message, and which rule matched.
  const { oops, err: fetchErr } = session.GciTsFetchOops(arrayOop, 1n, 3);
  if (fetchErr.number !== 0) {
    throw new DeciderError(
      fetchErr.message || `GemStone error ${fetchErr.number}`,
      fetchErr.number,
    );
  }
  const decision = Number(session.oopToInteger(oops[0]));
  const rule = Number(session.oopToInteger(oops[2]));

  let message = '';
  const carriesText =
    decision === DECISION.Failed || decision === DECISION.Log || decision === DECISION.LogFailed;
  if (carriesText && oops[1] !== OOP_NIL) {
    const fetched = session.GciTsFetchChars(oops[1], 1n, MAX_MESSAGE_BYTES);
    if (fetched.err.number === 0) message = fetched.data;
    else logError(session.id, fetched.err.message || `GCI error ${fetched.err.number}`);
  }
  return decodeDecision(decision, message, rule);
}

/** What a caller can hand the skip loop. */
export interface RuleRunOptions {
  onLog?: (text: string, rule: BreakpointRule | undefined) => void;
  /** Called once per rule: a broken message is broken on every hit. */
  onLogFailure?: (message: string, rule: BreakpointRule | undefined) => void;
  /**
   * Transcript text the resumed run wrote. In clientForwarder mode each write
   * stops the run as error 2336 and has to be shown and resumed, exactly as
   * `settleNbResult` does before the first breakpoint; without this the text is
   * dropped but the run still carries on.
   */
  onTranscript?: (text: string) => void;
  /**
   * Aborted when the runner the loop is part of stops waiting: the caller has
   * already given up on the run, so the loop releases the process and stops.
   */
  signal?: AbortSignal;
  /**
   * Hands a caller with its own Cancel (the debugger's busy overlay) the loop's
   * cancel, and `stopRequested`, shaped like the non-blocking runner's.
   */
  onStart?: (cancel: () => void, stopRequested: () => boolean) => void;
  /** Skip the loop's own progress notification; see `onStart`. */
  suppressNotification?: boolean;
  /**
   * Resume before judging anything: the process is parked at a halt or a step,
   * not at a breakpoint the rules have to judge.
   */
  resumeFirst?: boolean;
  /**
   * Where the run ended up, once a call the loop gave up on has finished after
   * all (a Force Stop, say), and the session is free again.
   */
  onGivenUpSettled?: (result: StepResult) => void;
}

/**
 * Resume `processOop` past every stop its rules decline, and answer where it
 * ended up.
 *
 * The resume and the judgement run the developer's code, so both go to a worker
 * thread: a long skip or a slow condition leaves VS Code responsive. Cancel
 * stops it as the non-blocking runner's Cancel does. Inside a run the runner
 * polls (Execute It), it is that run's Cancel. Otherwise it sends a soft break if
 * a call is running (a break in the resumed code comes back as a `raised` 6003)
 * and stops at the hit reached; a call that ignores the break is given up on
 * after STOP_WAITING_AFTER_MS, rejecting with `NbCancelledError` while the
 * session is held until the gem lets go, and the user is offered Force Stop.
 */
export async function applyBreakpointRules(
  session: ActiveSession,
  processOop: bigint,
  specs: BreakpointRule[],
  options: RuleRunOptions = {},
): Promise<ConditionOutcome> {
  const { onLog, onLogFailure, onTranscript, signal } = options;
  let decider: bigint | undefined;
  let resumeNext = options.resumeFirst === true;
  let process = processOop;
  let skipped = 0;
  let logged = 0;
  const reportedBadLog = new Set<number>();
  let lastYield = Date.now();
  let cancelled = false;
  let calling = false;
  let report: (() => void) | undefined;
  let closeProgress: (() => void) | undefined;

  const startedAt = performance.now();
  // The call a worker thread is running, if any, and how to give up on it.
  let inFlight: Promise<unknown> | undefined;
  let inFlightIsResume = false;
  let giveUp: ((e: Error) => void) | undefined;
  let stopWaitingTimer: ReturnType<typeof setTimeout> | undefined;
  const enclosingRun = isRunning(session);

  /** Answers whether there was a call to stop waiting for. */
  const stopWaiting = (): boolean => {
    if (!inFlight || !giveUp) return false;
    logInfo(`[Session ${session.id}] Stopped waiting for the breakpoint rules' call.`);
    holdSessionUntilSettled(session, inFlight);
    const { onGivenUpSettled } = options;
    if (onGivenUpSettled) {
      // A judgement given up on leaves the run where it was, at this hit.
      const parked: StepResult = {
        completed: false,
        errorMessage: 'Method breakpoint encountered',
        errorContext: process,
        errorNumber: BREAKPOINT_ERROR,
      };
      const resuming = inFlightIsResume;
      void inFlight
        .then(
          (value) => (resuming ? stepResultOf(value as { result: bigint; err: GciError }) : parked),
          () => parked,
        )
        // A turn later, once the hold has let go of the session.
        .then((result) => setTimeout(() => onGivenUpSettled(result), 0));
    }
    giveUp(new NbCancelledError());
    return true;
  };
  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    if (enclosingRun) {
      cancelRunOn(session);
      return;
    }
    if (!calling) return;
    try {
      session.GciTsBreak(false);
    } catch (e) {
      logError(session.id, `Could not send a soft break: ${errorText(e)}`);
    }
    stopWaitingTimer = setTimeout(
      () => {
        if (stopWaiting()) sayStillRunning(session);
      },
      Math.max(STOP_WAITING_AFTER_MS, EARLIEST_STOP_WAITING_MS - (performance.now() - startedAt)),
    );
  };
  options.onStart?.(cancel, () => cancelled);
  const untrack = enclosingRun
    ? undefined
    : trackRun(session, {
        stopRequested: () => cancelled,
        cancel,
        // A logout: stop waiting at once, without the notice.
        stop: async () => {
          cancel();
          clearTimeout(stopWaitingTimer);
          const work = inFlight;
          stopWaiting();
          await work?.catch(() => {});
        },
      });

  /** `work` on a worker thread, which Cancel can stop waiting for. */
  const onWorker = async <T>(work: Promise<T>, isResume = false): Promise<T> => {
    inFlight = work;
    inFlightIsResume = isResume;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          giveUp = reject;
        }),
      ]);
    } finally {
      inFlight = undefined;
      giveUp = undefined;
    }
  };

  // The runner has already rejected the run, so nobody else will release what
  // it stopped.
  const abandon = (): never => {
    releaseProcess(session, process);
    throw new NbCancelledError();
  };

  // Inside a run, that run's own notification and Cancel stand for the loop.
  const progressTimer =
    options.suppressNotification || enclosingRun
      ? undefined
      : setTimeout(() => {
          void vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'GemStone: applying breakpoint rules',
              cancellable: true,
            },
            (progress, token) =>
              new Promise<void>((resolve) => {
                closeProgress = resolve;
                report = () =>
                  progress.report({
                    message:
                      logged > 0
                        ? `${skipped - logged} skipped, ${logged} logged`
                        : `${skipped} skipped`,
                  });
                report();
                token.onCancellationRequested(cancel);
              }),
          );
        }, PROGRESS_AFTER_MS);

  try {
    for (;;) {
      if (signal?.aborted) abandon();
      // Not judged once stopped: the condition is the developer's code too.
      if (cancelled) return { kind: 'cancelled', context: process, skipped };
      let decision: Decision;
      const judged = !resumeNext;
      if (resumeNext) {
        resumeNext = false;
        decision = { kind: 'go' };
      } else if (specs.length === 0) {
        return { kind: 'stopped', context: process, skipped };
      } else {
        calling = true;
        try {
          decider ??= installDecider(session, specs, process);
          decision = await onWorker(decideWith(session, decider, process));
        } catch (e) {
          if (e instanceof NbCancelledError) throw e;
          if (signal?.aborted) abandon();
          // A soft break that landed in the judgement stopped only the decider's
          // own process; the run is still suspended at this hit.
          if (cancelled || (e instanceof DeciderError && e.errorNumber === SOFT_BREAK_ERROR)) {
            return { kind: 'cancelled', context: process, skipped };
          }
          throw e;
        } finally {
          calling = false;
        }
      }

      if (decision.kind === 'stop') return { kind: 'stopped', context: process, skipped };
      if (decision.kind === 'failed') {
        return { kind: 'conditionFailed', message: decision.message, context: process, skipped };
      }
      if (decision.kind === 'log') {
        onLog?.(decision.text, specs[decision.rule - 1]);
      }
      if (decision.kind === 'logFailed' && !reportedBadLog.has(decision.rule)) {
        reportedBadLog.add(decision.rule);
        onLogFailure?.(decision.message, specs[decision.rule - 1]);
      }
      if (signal?.aborted) abandon();
      if (cancelled) return { kind: 'cancelled', context: process, skipped };

      let resumed: { result: bigint; err: GciError };
      calling = true;
      try {
        resumed = await onWorker(
          (async () =>
            await continueThroughForwarderSends(
              session,
              await session.GciTsContinueWithAsync(
                process,
                // Resume as-is rather than forcing the top of stack to nil — see
                // `continueExecution` in debugQueries for why that distinction matters.
                OOP_ILLEGAL,
                null,
                CONTINUE_FLAGS,
              ),
              (text) => onTranscript?.(text),
              CONTINUE_FLAGS,
              signal,
            ))(),
          true,
        );
      } finally {
        calling = false;
      }
      // Whatever the break stopped has been released by the forwarder loop.
      if (signal?.aborted) throw new NbCancelledError();
      if (judged) skipped += 1;
      if (decision.kind === 'log' || decision.kind === 'logFailed') logged += 1;

      if (Date.now() - lastYield >= YIELD_EVERY_MS) {
        report?.();
        await yieldToTimers();
        lastYield = Date.now();
      }

      const { result, err } = resumed;
      if (err.number === 0) return { kind: 'completed', resultOop: result, skipped };
      const next = toBigInt(err.context ?? 0n);
      if (err.number !== BREAKPOINT_ERROR) {
        return {
          kind: 'raised',
          description: err.message || `GemStone error ${err.number}`,
          errorNumber: err.number,
          context: next,
          skipped,
        };
      }
      if (next !== 0n && next !== OOP_NIL) process = next;
    }
  } finally {
    clearTimeout(progressTimer);
    clearTimeout(stopWaitingTimer);
    untrack?.();
    closeProgress?.();
  }
}

/** A log line's prefix, `Account>>deposit: @4`; the method expression if unlabelled. */
function describeRule(rule: BreakpointRule): string {
  return `${rule.label ?? rule.methodExpr} @${rule.stepPoint}`;
}

/** How a stop at a breakpoint resolved once its rules had been applied. */
export type BreakpointStop =
  | { kind: 'completed'; resultOop: bigint }
  /** `cancelled` lets a caller (a SUnit run) report a Cancel as one. */
  | {
      kind: 'stopped';
      message: string;
      context: bigint;
      errorNumber: number;
      cancelled?: boolean;
    };

/**
 * Apply the rules to the breakpoint `context` is stopped at, and say where the
 * run ended up. With no rules, returns before any GCI call.
 *
 * Throws `NbCancelledError` when the run is given up on, and a plain Error when there is
 * nothing left to debug: the session logged out, or the run stopped with no
 * process to open a debugger on.
 */
export async function resolveBreakpointStop(
  session: ActiveSession,
  context: bigint,
  message: string,
  options: Omit<RuleRunOptions, 'onLog' | 'onLogFailure'> = {},
): Promise<BreakpointStop> {
  const stopHere = {
    kind: 'stopped' as const,
    message,
    context,
    errorNumber: BREAKPOINT_ERROR,
  };
  const specs = rulesFor(session);
  // Logged even with no rules: otherwise a stop no rule judged looks the same as
  // one whose condition held.
  if (!options.resumeFirst)
    logInfo(
      `[Session ${session.id}] breakpoint at a stop: ${specs.length} breakpoint rule(s) armed` +
        specs
          .map(
            (s) =>
              `\n  ${s.methodExpr} @${s.stepPoint}` +
              (s.condition === undefined ? '' : ` if ${s.condition}`) +
              (s.logMessage === undefined ? '' : ' (logpoint)'),
          )
          .join(''),
    );
  if (specs.length === 0 && !options.resumeFirst) return stopHere;

  let outcome: ConditionOutcome;
  try {
    // Revealed on the first line only: per line, it would fight for focus.
    let revealed = false;
    const reveal = (): void => {
      if (revealed) return;
      revealed = true;
      showLogpointChannel();
    };
    outcome = await applyBreakpointRules(session, context, specs, {
      ...options,
      onLog: (text, rule) => {
        appendLogpoint(rule === undefined ? `session ${session.id}` : describeRule(rule), text);
        reveal();
      },
      onLogFailure: (failure, rule) => {
        appendLogpoint(
          rule === undefined ? `session ${session.id}` : describeRule(rule),
          `!! the log message could not be evaluated: ${failure}`,
        );
        reveal();
        vscode.window.showWarningMessage(
          `A logpoint's message could not be evaluated: ${failure}. Execution carried on; ` +
            'see the GemStone Logpoints panel in Output.',
        );
      },
    });
  } catch (e: unknown) {
    // A cancel unwinds the run as it does anywhere else.
    if (e instanceof NbCancelledError) throw e;
    if (session.isLoggedOut()) throw new Error('The GemStone session is logged out.', { cause: e });
    // Otherwise stop anyway: a breakpoint that stops wrongly is a nuisance, one
    // that silently does not is a bug hunt.
    const detail = errorText(e);
    logError(session.id, `breakpoint rules could not be evaluated: ${detail}`);
    vscode.window.showWarningMessage(
      `Could not evaluate the breakpoint rules (${detail}) — stopping at the breakpoint.`,
    );
    return stopHere;
  }

  logInfo(
    `[Session ${session.id}] breakpoint rules: ${outcome.kind} after ${outcome.skipped} skipped hit(s)`,
  );

  switch (outcome.kind) {
    case 'completed':
      return { kind: 'completed', resultOop: outcome.resultOop };
    case 'raised':
      if (outcome.context === 0n || outcome.context === OOP_NIL) {
        throw new Error(outcome.description);
      }
      return {
        kind: 'stopped',
        message: outcome.description,
        context: outcome.context,
        errorNumber: outcome.errorNumber,
      };
    case 'cancelled':
      return {
        ...stopHere,
        message: `${message} (cancelled while applying breakpoint rules)`,
        context: outcome.context,
        cancelled: true,
      };
    case 'conditionFailed':
      // Said out loud, or the stop looks unexplained.
      vscode.window.showWarningMessage(
        `Breakpoint condition could not be evaluated: ${outcome.message} — ` +
          'stopping at the breakpoint.',
      );
      return {
        ...stopHere,
        message: `${message} (condition: ${outcome.message})`,
        context: outcome.context,
      };
    default:
      return { ...stopHere, context: outcome.context };
  }
}

/** A resume's GCI answer as the debugger reads it. */
function stepResultOf({ result, err }: { result: bigint; err: GciError }): StepResult {
  if (err.number === 0) return { completed: true, resultOop: result };
  return {
    completed: false,
    errorMessage: err.message || `GemStone error ${err.number}`,
    errorContext: toBigInt(err.context ?? 0n),
    errorNumber: err.number,
  };
}

/**
 * The debugger's Resume and Run to Cursor: resume `process` on a worker thread,
 * on past every stop its breakpoint rules decline, so VS Code stays responsive
 * and Cancel and Force Stop work as for any other run.
 */
export async function resumeOnWorker(
  session: ActiveSession,
  process: bigint,
  options: Omit<RuleRunOptions, 'onLog' | 'onLogFailure' | 'resumeFirst'> = {},
): Promise<StepResult> {
  const stop = await resolveBreakpointStop(session, process, 'Method breakpoint encountered', {
    ...options,
    resumeFirst: true,
  });
  if (stop.kind === 'completed') return { completed: true, resultOop: stop.resultOop };
  return {
    completed: false,
    // Cancel can land before the process has moved, so the breakpoint wording may not hold.
    errorMessage: stop.cancelled ? 'Stopped by Cancel.' : stop.message,
    errorContext: stop.context,
    errorNumber: stop.errorNumber,
  };
}

/**
 * Whether a blocking Resume's `result` (the dormant DAP debugger's) needs
 * {@link honourRulesAfterResume}, so it keeps its synchronous path for every
 * other stop.
 */
export function resumeNeedsRules(session: ActiveSession, result: StepResult): boolean {
  if (result.completed || result.errorNumber !== BREAKPOINT_ERROR) return false;
  const context = toBigInt(result.errorContext ?? 0n);
  if (context === 0n || context === OOP_NIL) return false;
  return rulesFor(session).length > 0;
}

/**
 * Carry the dormant DAP debugger's blocking Resume past every stop its rules
 * decline, as the run's first stop was, so a trigger armed before the debugger
 * opened is still armed. Not for steps: a step goes where it was told. The
 * GemStone Debugger uses {@link resumeOnWorker}.
 */
export async function honourRulesAfterResume(
  session: ActiveSession,
  result: StepResult,
  options: Omit<RuleRunOptions, 'onLog' | 'onLogFailure'> = {},
): Promise<StepResult> {
  if (!resumeNeedsRules(session, result)) return result;
  const stop = await resolveBreakpointStop(
    session,
    toBigInt(result.errorContext ?? 0n),
    result.errorMessage ?? 'Method breakpoint encountered',
    options,
  );
  if (stop.kind === 'completed') return { completed: true, resultOop: stop.resultOop };
  return {
    completed: false,
    errorMessage: stop.message,
    errorContext: stop.context,
    errorNumber: stop.errorNumber,
  };
}
