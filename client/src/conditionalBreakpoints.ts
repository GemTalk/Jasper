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
 * A breakpoint that only stops when its condition holds.
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
 * Each skipped hit therefore costs exactly **two** GCI round trips: one doit
 * that evaluates the condition in the suspended frame, and one
 * `GciTsContinueWith` that resumes. Everything the evaluation needs — the
 * receiver, the frame's names and values, the symbol list, the `evaluateInContext:`
 * — happens inside that one doit rather than as the 15-20 separate calls it
 * would take to assemble a frame's variables from here (measured at 1.9-2.7 ms
 * per skipped hit locally, and every one of them scaling with network latency).
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
 * its step points untouched. Nothing is installed in the stone and there is
 * nothing to clean up.
 */
export interface ConditionSpec {
  /**
   * Smalltalk expression resolving the compiled method the breakpoint is in —
   * `compiledMethodExpr`'s output. An expression rather than an OOP so no round
   * trip is spent resolving one, and so a method that has since been recompiled
   * or removed fails as "no such spec" instead of matching a stale OOP.
   */
  methodExpr: string;
  stepPoint: number;
  /** The Smalltalk expression the developer typed into VS Code. */
  condition: string;
}

/** What came of running a suspended process past its false conditions. */
export type ConditionOutcome =
  /** Execution is suspended at a breakpoint that should stop: open the debugger. */
  | { kind: 'stopped'; skipped: number }
  /** No breakpoint wanted to stop, and the code ran to completion. */
  | { kind: 'completed'; resultOop: bigint; skipped: number }
  /** The developer's code raised while we were skipping past false conditions. */
  | { kind: 'raised'; description: string; context: bigint; skipped: number }
  /** The condition itself could not be evaluated, or did not answer a Boolean. */
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
  /** The condition could not be evaluated, or did not answer a Boolean. */
  Failed: 3,
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

/** A Smalltalk string literal for `text`. */
function literal(text: string): string {
  return `'${escapeString(text)}'`;
}

/**
 * The doit that decides one stop: `{ decision. message }`.
 *
 * The stop is identified from the frame itself rather than assumed to be the one
 * we started at, because a resume can land on a *different* breakpoint — one
 * with another condition, or none at all. A stop matching no spec is an
 * unconditional breakpoint (or a `halt`) and answers Stop, which is what keeps a
 * plain breakpoint working while a conditional one is being skipped.
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
 */
export function decisionSource(processOop: bigint, specs: ConditionSpec[]): string {
  const specLines = specs
    .map(
      (spec) =>
        `specs add: (Array with: ([ ${spec.methodExpr} ] on: Error do: [:ex | nil ]) ` +
        `with: ${spec.stepPoint} with: ${literal(spec.condition)}).`,
    )
    .join('\n');

  return `| p specs fc frameMethod home sp spec rcvr found lvl depth names dict sl answer |
p := Object _objectForOop: ${processOop}.
specs := Array new.
${specLines}
fc := p _frameContentsAt: 1.
fc isNil ifTrue: [ ^ Array with: ${DECISION.Stop} with: nil ].
frameMethod := fc at: 1.
home := frameMethod isMethodForBlock
          ifTrue: [ frameMethod homeMethod ]
          ifFalse: [ frameMethod ].
sp := p _stepPointAt: 1.
spec := specs detect: [:e | ((e at: 1) == home) and: [ (e at: 2) = sp ]] ifNone: [ nil ].
spec isNil ifTrue: [ ^ Array with: ${DECISION.Stop} with: nil ].
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
answer := [ (spec at: 3) evaluateInContext: rcvr symbolList: sl ]
            on: Error
            do: [:ex | ^ Array with: ${DECISION.Failed}
                             with: (ex messageText ifNil: [ ex class name asString ]) ].
(answer == true or: [ answer == false ]) ifFalse: [
  ^ Array with: ${DECISION.Failed}
         with: ('the condition answered ',
                ([ answer printString ] on: Error do: [:ex | answer class name asString ]),
                ', not true or false') ].
^ Array with: (answer ifTrue: [ ${DECISION.Stop} ] ifFalse: [ ${DECISION.Go} ]) with: nil`;
}

/** One stop's verdict, as the loop reads it. */
export type Decision = { kind: 'stop' } | { kind: 'go' } | { kind: 'failed'; message: string };

/**
 * Read the doit's `{ decision. message }` back.
 *
 * An unrecognised decision is read as a stop: the process really is suspended at
 * a breakpoint, so opening the debugger on it is both true and the reading that
 * loses nothing.
 */
export function decodeDecision(decision: number, message: string): Decision {
  switch (decision) {
    case DECISION.Go:
      return { kind: 'go' };
    case DECISION.Failed:
      return { kind: 'failed', message };
    default:
      return { kind: 'stop' };
  }
}

/** Ask the gem whether the stop `processOop` is parked at should stop. */
function decide(session: ActiveSession, processOop: bigint, specs: ConditionSpec[]): Decision {
  const { result: arrayOop, err } = session.gci.GciTsExecute(
    session.handle,
    decisionSource(processOop, specs),
    session.gci.utf8ClassOop(session.handle),
    OOP_ILLEGAL,
    OOP_NIL,
    0, // debug OFF: the decision must not break on the breakpoints it is judging
    0,
  );
  if (err.number !== 0) throw new Error(err.message || `GemStone error ${err.number}`);

  const { oops, err: fetchErr } = session.gci.GciTsFetchOops(session.handle, arrayOop, 1n, 2);
  if (fetchErr.number !== 0) {
    throw new Error(fetchErr.message || `GemStone error ${fetchErr.number}`);
  }
  const decision = Number(session.gci.oopToInteger(session.handle, oops[0]));

  let message = '';
  if (decision === DECISION.Failed && oops[1] !== OOP_NIL) {
    const fetched = session.gci.GciTsFetchChars(session.handle, oops[1], 1n, MAX_MESSAGE);
    if (fetched.err.number === 0) message = fetched.data;
    else logError(session.id, fetched.err.message || `GCI error ${fetched.err.number}`);
  }
  return decodeDecision(decision, message);
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
export async function skipUntilConditionMet(
  session: ActiveSession,
  processOop: bigint,
  specs: ConditionSpec[],
): Promise<ConditionOutcome> {
  let process = processOop;
  let skipped = 0;
  let cancelled = false;
  let report: ((skipped: number) => void) | undefined;
  let closeProgress: (() => void) | undefined;

  const progressTimer = setTimeout(() => {
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'GemStone: skipping breakpoints whose condition is false',
        cancellable: true,
      },
      (progress, token) =>
        new Promise<void>((resolve) => {
          closeProgress = resolve;
          report = (n) => progress.report({ message: `${n} hits skipped` });
          report(skipped);
          token.onCancellationRequested(() => {
            cancelled = true;
          });
        }),
    );
  }, PROGRESS_AFTER_MS);

  try {
    for (;;) {
      const decision = decide(session, process, specs);
      if (decision.kind === 'stop') return { kind: 'stopped', skipped };
      if (decision.kind === 'failed') {
        return { kind: 'conditionFailed', message: decision.message, skipped };
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
      report?.(skipped);

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
