import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import { GciError } from './gciLibrary';
import { pollReadable } from './socketPoll';
import { logInfo } from './gciLog';
import { OOP_NIL } from './gciConstants';

/**
 * Shared non-blocking GCI call runner.
 *
 * GemStone's blocking GCI calls (GciTsPerform / GciTsContinueWith) run
 * synchronously on the extension-host main thread, so a slow/looping/re-halting
 * server operation freezes the *entire* VS Code extension host — not just a
 * webview (see the Enhanced Debugger freeze, 2026-06-22). The non-blocking GCI
 * API (GciTsNb…) avoids that: start the call, then poll the session socket for
 * the result on a timer, yielding to the event loop between polls.
 *
 * This is the single implementation of that poll loop, shared by `codeExecutor`
 * (Execute/Display It, via `pollNbToCompletion`) and the debugger's step/trim
 * (via `runNbCall`) so the cancel/break/backoff/progress behaviour can't drift
 * between the two. It does NOT cover Resume: GemStone 3.7.x has no
 * GciTsNbContinue, so the debugger's Resume runs on a worker thread instead
 * (`resumeOnWorker` in debugger/conditionalBreakpoints).
 */

// Poll cadence: start tight (steps usually finish in a few ms), then back off so
// a genuinely long operation doesn't busy-spin.
const BACKOFF_INTERVALS = [10, 10, 20, 40, 80, 160, 320, 500];
const MAX_INTERVAL = 500;
// Only surface a progress UI once an operation is clearly slow, so the common
// fast step never flashes a notification.
const PROGRESS_THRESHOLD_MS = 2000;

/**
 * Thrown when the user stopped a non-blocking GemStone call and the runner gave up
 * waiting for it. The gem may still be finishing it; see {@link STOP_WAITING_AFTER_MS}.
 */
export class NbCancelledError extends Error {
  constructor(message = 'GemStone operation cancelled') {
    super(message);
    this.name = 'NbCancelledError';
  }
}

/**
 * Thrown instead of starting a call on a session that still has one running: a
 * stopped call the gem is still finishing, or a call still being polled. GemStone
 * would refuse the start anyway, with a message that names a GCI condition
 * rather than anything the user did.
 */
export class NbSessionBusyError extends Error {
  /** Whether the run in the way is one the user stopped, which Force Stop can end. */
  readonly stoppedRun: boolean;

  constructor(
    message = 'The stopped run is still finishing on the server, so this session cannot start ' +
      'another one yet. Try again in a moment, or use Force Stop.',
    stoppedRun = true,
  ) {
    super(message);
    this.name = 'NbSessionBusyError';
    this.stoppedRun = stoppedRun;
  }
}

/**
 * Whether a started non-blocking call's result is ready: 1 = ready, 0 = pending,
 * -1 = error. Uses GciTsNbPoll when available (3.7+); otherwise polls the session
 * socket directly (GciTsSocket + native poll), exactly as the GciTsNbResult docs
 * prescribe for older servers.
 */
export function pollNbResultReady(session: ActiveSession): { result: number; err: GciError } {
  if (session.isAvailable('GciTsNbPoll')) {
    // eslint-disable-next-line no-restricted-syntax -- guarded by isAvailable above; the else branch below is the 3.6.x path (GciTsSocket + a native poll)
    return session.GciTsNbPoll(0);
  }
  const { fd, err } = session.GciTsSocket();
  if (err.number !== 0 || fd < 0) {
    return { result: -1, err };
  }
  const ready = pollReadable(fd, 0);
  return {
    result: ready,
    err:
      ready === -1
        ? ({ number: -1, message: 'Failed to poll the GemStone session socket' } as GciError)
        : err,
  };
}

export interface NbRunOptions {
  /** Progress-notification title shown only if the call runs past ~2s. */
  title?: string;
  /**
   * Skip the ~2s notification toast entirely. The debugger uses this because its
   * in-panel busy overlay (with its own Cancel) already covers these ops — the
   * toast would be a redundant second cancel UI. Editor Execute/Display It leaves
   * this off, so it keeps the toast (it has no panel overlay to fall back on).
   */
  suppressNotification?: boolean;
  /**
   * Called once when polling begins, handed a `cancel` fn. Invoking it stops the
   * call exactly as the progress notification's Cancel does: a soft break, and the
   * runner stops waiting if the call is still going (see
   * {@link STOP_WAITING_AFTER_MS}). Lets a caller drive cancellation from its own UI
   * (e.g. the debugger's in-panel Cancel button) instead of only the notification
   * toast. The fn is a no-op once the call has settled.
   *
   * Also handed `stopRequested`, which answers whether a stop has been asked for
   * on this call by anyone, the notification's Cancel included: a caller whose
   * call answers a soft break as an ordinary result can tell it from a real one.
   */
  onStart?: (cancel: () => void, stopRequested: () => boolean) => void;
  /**
   * Whether the process this call stops is the call's own, to be thrown away
   * with it. True for anything that starts a fresh execution: abandoned inside
   * a Transcript write it holds the session's Transcript semaphore, and
   * clearing its stack is what gives the semaphore back
   * ([#646](https://github.com/GemTalk/Jasper/issues/646)).
   *
   * Off by default, because the two debugger ops that perform a message ON a
   * GsProcess — step and restart-frame's trim — stop the very process the panel
   * is showing. Clearing that unwinds the user's stack to nothing while the
   * panel still says "Step cancelled." and offers to step it again.
   */
  disposableProcess?: boolean;
  /**
   * Called once a call the runner stopped waiting for has been collected and the
   * session is idle again, before any call waiting on the session starts, and
   * before a disposable process is cleared. Execute It and notebook cells end
   * clientForwarder mode here: their own `finally` runs while the call is still
   * being collected, when GemStone refuses it (see transcriptSink.ts), and on
   * 3.7.5 a clean-up that writes to the Transcript while the mode is on stops at
   * that write. Not called if collection gives up. Anything it throws is logged.
   */
  onAbandonedCollected?: () => void;
}

/**
 * How long a soft break gets before the runner stops waiting for the call, so one
 * press of any stop control gives the user back the editor. A gem answers a soft
 * break within ~20ms unless the code it runs resumes the Break, or it is busy in
 * an operation that answers breaks only when it ends (`markForCollection`, say);
 * the call is then collected in the background, and the session says it is still
 * finishing.
 *
 * Never a hard break. Sent after a soft break, a hard break arrives as another
 * soft one, so it stops nothing the soft break didn't; and where it does land as a
 * hard break, no handler can catch it, which skips the code's own cleanup
 * (measured on 3.6.2 and 3.7.5).
 *
 * The soft break is sent again as the runner stops waiting, and a few times more
 * while the call is collected in the background: one that reaches the gem before
 * it has started the call is lost (see {@link resendSoftBreak}).
 *
 * Never earlier than {@link EARLIEST_STOP_WAITING_MS} into the call either: a break
 * sent in a call's first ~2s does not land until ~2s in, so measuring only from
 * the soft break would give up before it had a chance.
 *
 * Exported so the tests step by them instead of repeating them.
 */
export const STOP_WAITING_AFTER_MS = 1500;
export const EARLIEST_STOP_WAITING_MS = 2500;

let stillRunningHandler: ((session: ActiveSession) => void) | undefined;
let runInProgressHandler: ((session: ActiveSession) => void) | undefined;
let stoppedRunCollectedHandler: ((session: ActiveSession) => void) | undefined;

/**
 * Say what to do when a call the user stopped keeps the session busy: when the
 * runner stops waiting for it, and each time it refuses a new call. Not called for
 * {@link stopCallsOn}'s stops: their caller is already logging out.
 */
export function setStillRunningHandler(handler: typeof stillRunningHandler): void {
  stillRunningHandler = handler;
}

/** Say what to do when a run nobody has stopped refuses a new call on its session. */
export function setRunInProgressHandler(handler: typeof runInProgressHandler): void {
  runInProgressHandler = handler;
}

/** Tell the user, through the {@link setRunInProgressHandler} handler, that a run holds the session. */
export function sayRunInProgress(session: ActiveSession): void {
  try {
    runInProgressHandler?.(session);
  } catch (e) {
    logInfo(
      `[Session ${session.id}] Could not say a run is in progress: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * Stop the run on `session` as its own Cancel would. Answers false when there is
 * no run being polled to stop.
 */
export function cancelRunOn(session: ActiveSession): boolean {
  const running = live.get(session.id);
  running?.cancel();
  return running !== undefined;
}

/** Say what to do once a call the runner stopped waiting for is collected. */
export function setStoppedRunCollectedHandler(handler: typeof stoppedRunCollectedHandler): void {
  stoppedRunCollectedHandler = handler;
}

/** Tell the user, through the {@link setStillRunningHandler} handler, that a stopped run holds the session. */
export function sayStillRunning(session: ActiveSession): void {
  try {
    stillRunningHandler?.(session);
  } catch (e) {
    logInfo(
      `[Session ${session.id}] Could not say the stopped run is still running: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * How long the next call waits for a stopped call's result to be collected,
 * and how often it is polled meanwhile: 2s, which a gem that stops at once
 * answers well within.
 */
const DRAIN_ATTEMPTS = 40;
const DRAIN_INTERVAL_MS = 50;

/**
 * How often, and for how long, a stopped call that outlives the drain is still
 * polled for in the background. A gem can go on working long after a break —
 * through a slow ensure: block or tearDown, or on a loaded machine — and the
 * session refuses every call until the result is collected, so collecting it is
 * what frees the session. Bounded, so a gem that never answers is not polled for
 * the life of the window; past the bound, the next run still collects it (see
 * {@link ensureSessionFree}).
 *
 * Exported so the tests can step by them instead of repeating them.
 */
export const LATE_COLLECT_INTERVAL_MS = 500;
export const LATE_COLLECT_LIMIT_MS = 5 * 60_000;

/**
 * How many poll errors in a row it takes to give up on collecting a stopped
 * call. One can be transient, and giving up leaves the session refusing every
 * call until logout.
 */
const COLLECT_FAILURES_TO_GIVE_UP = 3;

/**
 * While a stopped call is collected in the background, its soft break is sent
 * again every this many polls (2s), at most {@link LATE_BREAKS} times.
 */
const LATE_BREAK_EVERY_TICKS = 4;
const LATE_BREAKS = 5;

/**
 * Sessions still busy with a call we gave up on: its result is still being
 * collected ({@link drainAbandonedCall}), or its `onReady` is still resuming it
 * on a worker thread ({@link awaitAbandonedRead}). The next call on that
 * session waits for it ({@link whenSessionFree}): either takes as long as the gem
 * takes to notice the break, and a run started in the meantime would be refused
 * outright — which, from the user's side, is pressing stop and then having the
 * next run do nothing. While a worker may own the session, a call from the main
 * thread can also kill the process; see {@link awaitAbandonedRead}.
 *
 * Keyed by session id, not by the ActiveSession object: callers build those
 * freely and two of them can stand for the same logged-in session, which is the
 * thing that actually has one call outstanding at a time. The id names that
 * logged-in session alone: transient logins get ids of their own too.
 */
const draining = new Map<number, Promise<void>>();

/**
 * Sessions whose stopped call outlived the drain and is not collected yet, keyed
 * like {@link draining}. `collect` tries to collect the call now, answering
 * whether the session has nothing left to wait for; `forget` stops polling for it.
 */
const uncollected = new Map<number, { collect: () => boolean; forget: () => void }>();

/** What one attempt to collect a stopped call found. */
type CollectState = 'collected' | 'pending' | 'failed' | 'gone';

/**
 * Sessions with a call still being polled ({@link pollNbToCompletion}), keyed
 * like {@link draining}. `stopRequested` answers whether the user has asked that
 * call to stop: a soft break the gem handles can leave it running for a long
 * while yet, through a tearDown or an ensure: block. `stop` sends the call the
 * escalation that stops it, answering the call's own promise.
 */
const live = new Map<number, TrackedRun>();

/**
 * Stop the call in flight on `session`, if any, and wait until the session is
 * free.
 *
 * The call gets the soft break its Cancel sends, and the runner stops waiting
 * for it at once; the call is then waited out the way the next call on the
 * session waits for it. Both waits are bounded, so this always resolves; a
 * session still busy past them refuses its next call cleanly rather than
 * crashing.
 *
 * A call stopped here rejects with `NbCancelledError`, however it ended. The
 * gem's own answer to the soft break is a Break error with a live context,
 * which a caller would offer to debug on a session that is about to go.
 */
export async function stopCallsOn(session: ActiveSession): Promise<void> {
  await live
    .get(session.id)
    ?.stop()
    .catch(() => {});
  await draining.get(session.id);
  uncollected.get(session.id)?.collect();
}

/**
 * Collect and discard the result of a call we gave up on, so the session goes
 * back to idle.
 *
 * Giving up on a call does not end it: until something reads its result the
 * session reports a call in progress and refuses the next one. The result itself is thrown away. The promise settles once the
 * result is collected, or after the drain's 2s budget, so the next call waits
 * no longer than that. A result that is not in by then is collected later, in
 * the background or by the next call (see {@link collectLate}).
 *
 * The process the result names is cleared only when the caller declared it
 * disposable (see `NbRunOptions.disposableProcess`): clearing is what releases
 * the Transcript semaphore a suspended writer holds, and is destructive to a
 * process the user is debugging. This code cannot tell the two apart — the
 * caller that chose the receiver can.
 *
 * Only for a call whose result has not been read yet. Once `onReady` has read
 * it, see {@link awaitAbandonedRead}.
 */
function drainAbandonedCall(
  session: ActiveSession,
  disposableProcess: boolean,
  onCollected?: () => void,
): Promise<void> {
  const existing = draining.get(session.id);
  if (existing) return existing;

  const startedAt = Date.now();
  // A poll error can be transient, so it is retried like a pending poll (see
  // COLLECT_FAILURES_TO_GIVE_UP); a throw means the session is gone (logged
  // out), and there is nothing left to collect.
  const tryCollect = (): { state: CollectState; reason?: string } => {
    try {
      const { result, err } = pollNbResultReady(session);
      if (result === 1) {
        const { err } = session.GciTsNbResult();
        if (disposableProcess) {
          runHook(session, onCollected);
          void clearInBackground(session, err?.context);
        } else {
          runCollectedHook(session, onCollected);
        }
        return { state: 'collected' };
      }
      if (result === -1) {
        return {
          state: 'failed',
          reason: `poll error ${err?.number ?? ''} ${err?.message ?? ''}`.trim(),
        };
      }
      return { state: 'pending' };
    } catch (e) {
      return { state: 'gone', reason: e instanceof Error ? e.message : String(e) };
    }
  };
  let failuresInARow = 0;
  const done: Promise<void> = new Promise<void>((resolve) => {
    const attempt = (n: number): void => {
      // Forgotten on logout (forgetSession): stop, rather than poll a session
      // nobody is keeping any more.
      if (n > 0 && draining.get(session.id) !== done) {
        resolve();
        return;
      }
      const { state, reason } = tryCollect();
      if (state === 'collected' || state === 'gone') {
        resolve();
        return;
      }
      failuresInARow = state === 'failed' ? failuresInARow + 1 : 0;
      if (failuresInARow >= COLLECT_FAILURES_TO_GIVE_UP) {
        // Persistent, not transient (a broken connection, say): hold nobody up
        // with a session that will never answer, and don't call it busy.
        session.forgetUncollectedCall();
        logInfo(
          `[Session ${session.id}] Gave up collecting a cancelled call after ` +
            `${Date.now() - startedAt}ms (${reason ?? state}).`,
        );
        resolve();
        return;
      }
      if (n >= DRAIN_ATTEMPTS) {
        collectLate(session, tryCollect, startedAt);
        resolve();
        return;
      }
      setTimeout(() => attempt(n + 1), DRAIN_INTERVAL_MS);
    };
    attempt(0);
  }).finally(() => {
    if (draining.get(session.id) === done) draining.delete(session.id);
  });

  draining.set(session.id, done);
  return done;
}

/**
 * Go on collecting a stopped call the drain's budget ran out on: in the
 * background, so the session frees itself — for Execute It, a blocking query or
 * an Explorer refresh as much as for the next run — once the gem answers, and on
 * demand, through {@link uncollected}, so the next call need not wait for the
 * next poll.
 */
function collectLate(
  session: ActiveSession,
  tryCollect: () => { state: CollectState; reason?: string },
  startedAt: number,
): void {
  logInfo(
    `[Session ${session.id}] A cancelled call is still running on the server after ` +
      `${Date.now() - startedAt}ms; collecting it in the background. ` +
      'The session refuses new calls until it finishes.',
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failuresInARow = 0;
  const forget = (): void => {
    clearTimeout(timer);
    if (uncollected.get(session.id) === entry) uncollected.delete(session.id);
  };
  const settled = (): boolean => {
    const { state, reason } = tryCollect();
    if (state === 'pending') {
      failuresInARow = 0;
      return false;
    }
    if (state === 'failed' && ++failuresInARow < COLLECT_FAILURES_TO_GIVE_UP) return false;
    forget();
    if (state === 'collected') {
      logInfo(
        `[Session ${session.id}] Collected a cancelled call after ` +
          `${Date.now() - startedAt}ms; the session is free again.`,
      );
    } else {
      // Nothing left to wait for: the caller's own call reports the session as
      // it is. Said, because a session left busy has nothing else to show why.
      // A gone session is logged out, which already ends its busy count.
      if (state === 'failed') session.forgetUncollectedCall();
      logInfo(
        `[Session ${session.id}] Gave up collecting a cancelled call after ` +
          `${Date.now() - startedAt}ms (${reason ?? state}).`,
      );
    }
    return true;
  };
  const entry = { collect: settled, forget };
  const tick = (n: number): void => {
    if (settled()) return;
    // The stop's soft breaks may all have reached the gem before it started the
    // call (see resendSoftBreak): two quick presses send both at once. By now it
    // has started.
    if (n % LATE_BREAK_EVERY_TICKS === 0 && n / LATE_BREAK_EVERY_TICKS <= LATE_BREAKS) {
      resendSoftBreak(session);
    }
    if (n * LATE_COLLECT_INTERVAL_MS >= LATE_COLLECT_LIMIT_MS) {
      logInfo(
        `[Session ${session.id}] Stopped polling for a cancelled call after ` +
          `${Date.now() - startedAt}ms; the next run on this session collects it if it has finished.`,
      );
      return;
    }
    timer = setTimeout(() => tick(n + 1), LATE_COLLECT_INTERVAL_MS);
  };
  uncollected.set(session.id, entry);
  timer = setTimeout(() => tick(1), LATE_COLLECT_INTERVAL_MS);
}

/**
 * Make sure the session has no call left on it before starting another: collect
 * a stopped call whose result is in, or throw {@link NbSessionBusyError} while
 * the gem is still finishing one, while one is still being drained, or while
 * another call is still being polled. For a caller that cannot wait; one that
 * can uses {@link whenSessionFree}, which waits out the drain first.
 */
export function ensureSessionFree(session: ActiveSession): void {
  const running = live.get(session.id);
  if (running && !running.stopRequested()) {
    sayRunInProgress(session);
    throw new NbSessionBusyError(
      'Another run is still in progress on this session. Wait for it to finish, or stop ' +
        'it, before starting another.',
      false,
    );
  }
  if (stoppedRunHolds(session)) {
    sayStillRunning(session);
    throw new NbSessionBusyError();
  }
}

/**
 * Whether a run the user stopped still holds the session, collecting it first if
 * its result is in.
 */
export function stoppedRunHolds(session: ActiveSession): boolean {
  return live.get(session.id)?.stopRequested() === true || abandonedRunHolds(session);
}

/** Like {@link stoppedRunHolds}, for a run the runner has already stopped waiting for. */
export function abandonedRunHolds(session: ActiveSession): boolean {
  if (draining.has(session.id)) return true;
  const pending = uncollected.get(session.id);
  if (pending !== undefined && !pending.collect()) return true;
  // Collecting the call may just have started clearing its process.
  return draining.has(session.id);
}

/**
 * Start a call once the session is free: `start` runs as soon as nothing is
 * left on the session ({@link ensureSessionFree}), after waiting out a stopped
 * call still being drained. Throws or rejects with {@link NbSessionBusyError}
 * otherwise. Every caller that starts a call goes through this, before its first
 * GCI call, since anything that call runs first would be refused too, or, while a
 * worker owns the session, could kill the process.
 *
 * The check and `start` run in one synchronous step, and `start` must claim the
 * session before it returns (a {@link pollNbToCompletion} does). Two callers can
 * wait on the same drain, and only a check made right before the start sees the
 * other's call. With nothing to wait for, `start` runs before this returns, so a
 * call with nothing before it still begins in the same tick (see
 * {@link runNbCall}). The wait is bounded by the drain's own budget, or by
 * ABANDONED_READ_WAIT_MS.
 */
export function whenSessionFree<T>(
  session: ActiveSession,
  start: () => T,
): T | Promise<Awaited<T>> {
  // Clean-up takes as long as the user's ensure: blocks do, too long to wait out
  // without a word: refused with the notice instead.
  if (!draining.has(session.id) || clearHolds(session)) {
    ensureSessionFree(session);
    return start();
  }
  return (async (): Promise<Awaited<T>> => {
    for (let pending = draining.get(session.id); pending; pending = draining.get(session.id)) {
      await pending;
    }
    ensureSessionFree(session);
    return await start();
  })();
}

/** Whether a call is still being polled on the session. */
export function isRunning(session: ActiveSession): boolean {
  return live.has(session.id);
}

/** What {@link trackRun} needs to stop a run, shaped like the runner's own. */
export interface TrackedRun {
  stopRequested: () => boolean;
  /** What the run's own Cancel does. */
  cancel: () => void;
  /** Stop it and stop waiting at once, for a logout; settles when it has. */
  stop: () => Promise<unknown>;
}

/**
 * Count a run the runner is not polling (one resumed on a worker thread) as the
 * session's run, so other calls are refused with a way to stop it. Answers the
 * function that stops counting it, or undefined when the session already has a
 * run: the one this is part of, whose stop covers it.
 */
export function trackRun(session: ActiveSession, run: TrackedRun): (() => void) | undefined {
  if (live.has(session.id)) return undefined;
  live.set(session.id, run);
  return () => {
    if (live.get(session.id) === run) live.delete(session.id);
  };
}

/**
 * Hold the session for `work` its caller has stopped waiting for, until it
 * settles: the way the runner holds it for a call it gave up on (see
 * awaitAbandonedRead), so the next call waits or is refused instead of reaching
 * a session a worker thread still owns.
 */
export function holdSessionUntilSettled(
  session: ActiveSession,
  work: Promise<unknown>,
  onSettled?: () => void,
): Promise<void> {
  return awaitAbandonedRead(session, work, onSettled);
}

/**
 * Forget everything kept for a session that has logged out: its id may come back
 * for another login.
 */
export function forgetSession(sessionId: number): void {
  uncollected.get(sessionId)?.forget();
  draining.delete(sessionId);
  live.delete(sessionId);
}

/**
 * How long the next call on a session waits for an abandoned `onReady` to
 * finish. Only a backstop for one that never finishes at all: the wait ends the
 * moment `onReady`'s promise settles, which after a soft break is usually
 * within milliseconds, so a generous bound costs nothing in the ordinary case.
 *
 * Generous because the alternative to waiting is worse than waiting. Give up
 * while a koffi worker still owns the session and the call we start next is
 * refused by GemStone outright — the user presses stop, and their next run
 * fails with "session has call in progress by another C thread". This was the
 * drain's own budget (2s) until a loaded CI runner took over that to hand a
 * session back where a quiet machine takes 25ms. The drain bounds a different
 * thing — polling a gem that may never answer — so it keeps its own number.
 */
const ABANDONED_READ_WAIT_MS = 30_000;

/**
 * Hold the session for an `onReady` whose run the runner stopped waiting for,
 * until that `onReady` finishes.
 *
 * There is nothing left to drain: `onReady` has already read the non-blocking
 * result. But it may be resuming the run on a koffi worker thread (the
 * Transcript settle loop does), and while it is, any poll of the session from
 * the main thread kills the process — GciTsNbPoll on 3.7.5, GciTsNbResult on
 * 3.6.2, both measured. So nothing here touches the session; `onReady`'s own
 * promise is the only signal that it is free, and clearing whatever the break
 * stopped is left to `onReady`, which is told the run was given up on through its
 * signal.
 *
 * Bounded, so a worker that never returns cannot hold the session forever.
 * Past the bound a new call is refused cleanly by GemStone itself ("call in
 * progress by another C thread"), never crashed.
 */
function awaitAbandonedRead(
  session: ActiveSession,
  read: Promise<unknown>,
  onCollected?: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done: Promise<void> = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logInfo(
        `[Session ${session.id}] Stopped waiting for a cancelled run to hand the session back.`,
      );
      resolve();
    }, ABANDONED_READ_WAIT_MS);
    const collected = (): void => {
      runCollectedHook(session, onCollected);
      resolve();
    };
    read.then(collected, collected);
  }).finally(() => {
    clearTimeout(timer);
    if (draining.get(session.id) === done) draining.delete(session.id);
  });
  draining.set(session.id, done);
  return done;
}

/**
 * Run a caller's `onAbandonedCollected`, then the {@link setStoppedRunCollectedHandler}
 * handler; the caller is long gone, so only log a throw.
 */
function runCollectedHook(session: ActiveSession, hook: (() => void) | undefined): void {
  runHook(session, hook);
  if (stoppedRunCollectedHandler) runHook(session, () => stoppedRunCollectedHandler?.(session));
}

/** Run one clean-up hook of a cancelled run's, logging a throw. */
function runHook(session: ActiveSession, hook: (() => void) | undefined): void {
  try {
    hook?.();
  } catch (e) {
    logInfo(
      `[Session ${session.id}] Cleanup after a cancelled run failed: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}

/** Sessions a {@link clearInBackground} is still clearing a process on. */
const clearing = new Set<number>();

/** Whether the session is held by a stopped run's clean-up rather than by a run. */
export function clearHolds(session: ActiveSession): boolean {
  return clearing.has(session.id);
}

/**
 * Send a stop's soft break again, for a call that is still going when the runner
 * stops waiting, and now and then while it is collected in the background
 * (see collectLate). A soft break that reaches the gem before it has started the call
 * is lost, and the call runs on (measured on 3.6.8 and 3.7.5, with the gem held
 * back while the call and the break were sent); a soft break the gem already has
 * is harmless to repeat, since repeated ones never escalate. Best-effort: logged,
 * never thrown.
 */
export function resendSoftBreak(session: ActiveSession): void {
  try {
    const { success, err } = session.GciTsBreak(false);
    logInfo(
      `[Session ${session.id}] Soft break sent again: success=${success}` +
        (err?.number ? ` err=${err.number} ${err.message ?? ''}` : ''),
    );
  } catch (e) {
    logInfo(
      `[Session ${session.id}] Could not send the soft break again: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}

/** Whether a GCI error's `context` names a process. */
function isProcess(context: unknown): context is bigint | number {
  if (typeof context !== 'bigint' && typeof context !== 'number') return false;
  const oop = BigInt(context);
  return oop !== OOP_NIL && oop !== 0n;
}

/**
 * Clear a stopped run's paused process on a worker thread. Clearing runs the
 * process's `ensure:` blocks inside the call, so on the main thread a slow one
 * froze VS Code, for good if it never ended. Until it is done the session is
 * held as for a stopped run: the next call waits or is refused with the Force
 * Stop notice, and clean-up that hangs takes the same way out as a run that
 * ignores the stop. `then` runs once the
 * session is free. Best-effort: a failure is logged, never thrown.
 */
export function clearInBackground(
  session: ActiveSession,
  context: unknown,
  then?: () => void,
): Promise<void> {
  if (!isProcess(context)) {
    runCollectedHook(session, then);
    return Promise.resolve();
  }
  const gsProcess = BigInt(context);
  const failed = (why: string): void =>
    logInfo(`[Session ${session.id}] Could not clear a stopped run's process: ${why}`);
  clearing.add(session.id);
  // Never rejects: whatever goes wrong is logged, and the session let go.
  const cleared = (async (): Promise<void> => {
    try {
      const { err } = await session.GciTsClearStackAsync(gsProcess);
      if (err.number !== 0) failed(err.message || `GemStone error ${err.number}`);
    } catch (e) {
      failed(e instanceof Error ? e.message : String(e));
    } finally {
      clearing.delete(session.id);
    }
  })();
  return awaitAbandonedRead(session, cleared, then);
}

/**
 * Poll an ALREADY-STARTED non-blocking GemStone call to completion without
 * blocking the extension host.
 *
 * @param onReady reads the result once polling reports it's ready (typically
 *                `GciTsNbResult`) and returns the caller's value; may throw to
 *                signal failure. May be async: when it returns a promise (e.g.
 *                the transcript-forwarding settle loop, which chains async
 *                GciTsContinueWith calls), the run only settles when that
 *                promise does — so the progress notification and its Cancel
 *                keep working for the whole run, including the part of it
 *                spent inside `onReady`. Its `signal` aborts when the runner
 *                stops waiting: the run has been rejected by then, so an async
 *                `onReady` that is still working owns the cleanup of whatever
 *                the break stopped. The session stays held for the
 *                next call until `onReady` finishes (see
 *                {@link awaitAbandonedRead}).
 *
 * If the call outlives `PROGRESS_THRESHOLD_MS` — measured from the start of the
 * call, not from the start of `onReady`, and in real time rather than in poll
 * intervals — a cancellable progress notification appears. One cancel, from it or
 * from `onStart`'s canceller, is enough: it sends a soft break, and if the call
 * is still going after {@link STOP_WAITING_AFTER_MS} the runner stops waiting and
 * rejects with `NbCancelledError`. A second cancel stops waiting at once. If the
 * gem answers the soft break first, the run reports whatever it answered (a
 * `Break` error, typically) instead of rejecting. How fast the gem gets to a soft
 * break varies, so both endings are normal and a caller cannot pick which it gets.
 */
export function pollNbToCompletion<T>(
  session: ActiveSession,
  onReady: (signal: AbortSignal) => T | Promise<T>,
  opts: NbRunOptions = {},
): Promise<T> {
  const run = new Promise<T>((resolve, reject) => {
    let settled = false;
    let pollIndex = 0;
    let progressShown = false;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    let softBreakSent = false;
    let stopWaitingTimer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = performance.now();
    let progressResolve: (() => void) | null = null;
    const abandoned = new AbortController();
    // onReady's work, once it has begun: from then on the non-blocking result
    // is already read and the session may belong to a worker thread.
    let reading: Promise<T> | null = null;
    let stopped = false;
    const liveEntry = {
      stopRequested: (): boolean => softBreakSent,
      // What the run's own Cancel does.
      cancel: (): void => requestCancel(),
      // Twice, like pressing Cancel twice: a soft break, then stop waiting. A run
      // the first press already settled needs no second one.
      stop: (): Promise<T> => {
        stopped = true;
        requestCancel();
        if (!settled) requestCancel();
        return run;
      },
    };
    live.set(session.id, liveEntry);

    const finishProgress = (): void => {
      if (progressResolve) {
        progressResolve();
        progressResolve = null;
      }
    };
    // Ends the "Stopping…" status-bar message the first cancel shows.
    let stoppingDone: (() => void) | null = null;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      stoppingDone?.();
      if (live.get(session.id) === liveEntry) live.delete(session.id);
      if (stopped) fn = () => reject(new NbCancelledError());
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      if (stopWaitingTimer) {
        clearTimeout(stopWaitingTimer);
        stopWaitingTimer = null;
      }
      finishProgress();
      fn();
    };
    // Every session call throws once the session is logged out, and the
    // callbacks below run from timers and cancel callbacks, where an escaped
    // throw would leave the run unsettled for good. Each one goes through this.
    const settleOnThrow = (callback: () => void) => (): void => {
      try {
        callback();
      } catch (e) {
        settle(() => reject(e));
      }
    };

    // Lets the notification's Cancel report progress text; null until/unless the
    // ~2s notification is showing (an external cancel can fire before then).
    let progressReport: ((value: { message?: string }) => void) | null = null;

    // Shared by the notification's Cancel and any external canceller handed out via
    // opts.onStart. The first call asks the gem to stop at a safe point; the runner
    // stops waiting if the call is still going later, or at a second call.
    const stopWaiting = settleOnThrow(() => {
      if (settled) return;
      resendSoftBreak(session);
      abandoned.abort();
      logInfo(
        `[Session ${session.id}] Stopped waiting for the call; the gem may still be finishing it.`,
      );
      if (reading) {
        // Nothing to drain, and the session must not be touched — see
        // awaitAbandonedRead.
        void awaitAbandonedRead(session, reading, opts.onAbandonedCollected);
      } else {
        // The session counts the call as in progress until its result is collected.
        // Drain it, or the very next call on this session is refused with "session
        // is busy" — which reads as the next run silently doing nothing.
        void drainAbandonedCall(
          session,
          opts.disposableProcess === true,
          opts.onAbandonedCollected,
        );
      }
      settle(() => reject(new NbCancelledError()));
      if (!stopped) sayStillRunning(session);
    });

    const requestCancel = settleOnThrow(() => {
      if (settled) {
        logInfo(`[Session ${session.id}] Break requested, but the call had already settled.`);
        return;
      }
      if (softBreakSent) {
        stopWaiting();
        return;
      }
      // Logged because a break that the gem ignores is indistinguishable, from
      // the outside, from a break that was never sent — and the difference is
      // the whole diagnosis when a stop button appears to do nothing.
      const { success, err } = session.GciTsBreak(false);
      logInfo(
        `[Session ${session.id}] Soft break sent: success=${success}` +
          (err?.number ? ` err=${err.number} ${err.message ?? ''}` : ''),
      );
      softBreakSent = true;
      progressReport?.({ message: 'Soft break sent — waiting for the gem to stop…' });
      // Best-effort: a failure here must not keep the stop-waiting timer below unset.
      if (!stopped) {
        try {
          vscode.window.setStatusBarMessage(
            '$(loading~spin) Stopping…',
            new Promise<void>((done) => (stoppingDone = done)),
          );
        } catch (e) {
          logInfo(`[Session ${session.id}] Could not show "Stopping…": ${String(e)}`);
        }
      }
      // performance.now, not Date.now: this asks how much time has elapsed, which
      // the wall clock can't answer once anything on the system moves it.
      const waitFor = Math.max(
        STOP_WAITING_AFTER_MS,
        EARLIEST_STOP_WAITING_MS - (performance.now() - startedAt),
      );
      stopWaitingTimer = setTimeout(() => {
        stopWaitingTimer = null;
        stopWaiting();
      }, waitFor);
    });
    if (opts.onStart) opts.onStart(requestCancel, () => softBreakSent);

    const doPoll = settleOnThrow(() => {
      if (settled) return;
      const { result: pollResult, err: pollErr } = pollNbResultReady(session);

      if (pollResult === 1) {
        // Don't settle until onReady's (possibly async) work finishes — a
        // transcript-forwarding settle loop may keep the server running well
        // past this first ready signal, and Cancel must stay live throughout.
        reading = Promise.resolve(onReady(abandoned.signal));
        reading.then(
          (value) => settle(() => resolve(value)),
          (e) => {
            // The gem answering a stop's soft break hands back a live process,
            // which settle swaps for NbCancelledError, so no caller is left to
            // debug or clear it. The clear holds the session past the caller's
            // own clean-up, which `onAbandonedCollected` does first instead.
            const context = (e as { context?: unknown } | null)?.context;
            if (stopped && !settled && opts.disposableProcess === true && isProcess(context)) {
              runHook(session, opts.onAbandonedCollected);
              void clearInBackground(session, context);
            }
            settle(() => reject(e));
          },
        );
        return;
      }
      if (pollResult === -1) {
        // Abandoning the call without collecting its result leaves the session
        // reporting a call in progress, and every later call on it refused. A
        // break that the gem turns into a poll error takes this path, so the
        // drain belongs here as much as on the stop-waiting path.
        void drainAbandonedCall(
          session,
          opts.disposableProcess === true,
          opts.onAbandonedCollected,
        );
        settle(() => reject(new Error(pollErr.message || `GemStone poll error ${pollErr.number}`)));
        return;
      }

      // The call has not answered — but check the session is still there to answer.
      // A lost connection while a call is outstanding leaves the poll reporting
      // "not ready" forever: the progress notification would sit there claiming
      // work is in flight, and whatever awaited this promise would never hear
      // back. GciTsCallInProgress answers -1 for a session that is gone. (A logout
      // never reaches here: the poll throws first and `settleOnThrow` settles.)
      const { result: alive, err: aliveErr } = session.GciTsCallInProgress();
      if (alive === -1) {
        settle(() =>
          reject(
            new Error(
              aliveErr?.message || 'The GemStone session ended while this call was still running.',
            ),
          ),
        );
        return;
      }

      const interval =
        pollIndex < BACKOFF_INTERVALS.length ? BACKOFF_INTERVALS[pollIndex] : MAX_INTERVAL;
      pollIndex++;

      setTimeout(doPoll, interval);
    });

    // On a wall-clock timer from the start of the call, NOT from inside the poll
    // loop above. The loop stops the moment the call first reports ready and
    // hands over to `onReady`, so a run whose `onReady` does the waiting used to
    // get no notification at all however long it ran — and the Cancel on this
    // notification is the only way to stop a run, so such a run could not be
    // stopped. A Transcript write is exactly that shape: the first forwarder
    // send makes the call ready within milliseconds, then the settle loop
    // streams output for as long as the user's code runs
    // ([#646](https://github.com/GemTalk/Jasper/issues/646)). A timer also
    // measures real elapsed time: the old accounting summed the poll intervals
    // it INTENDED to wait, so under load its "2 seconds" ran long.
    if (!opts.suppressNotification) {
      progressTimer = setTimeout(() => {
        progressTimer = null;
        if (settled || progressShown) return;
        progressShown = true;
        void vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: opts.title ?? 'GemStone: working…',
            cancellable: true,
          },
          (progress, token) => {
            progressReport = (value) => progress.report(value);
            token.onCancellationRequested(requestCancel);
            return new Promise<void>((res) => {
              progressResolve = res;
            });
          },
        );
      }, PROGRESS_THRESHOLD_MS);
    }

    doPoll();
  });
  return run;
}

/**
 * Start a non-blocking GemStone call and poll it to completion.
 *
 * @param start issues the `GciTsNb…` call; returns `{ success, err }`. A failed
 *              start rejects without polling.
 * @param onReady see {@link pollNbToCompletion}.
 */
export async function runNbCall<T>(
  session: ActiveSession,
  start: () => { success: boolean; err: GciError },
  onReady: (signal: AbortSignal) => T | Promise<T>,
  opts: NbRunOptions = {},
): Promise<T> {
  // A call we gave up on may still be being collected; starting now would be
  // refused as "an operation is in progress". whenSessionFree waits for it, and
  // only ever defers when there IS something to wait for: the call (and with it
  // opts.onStart, which hands out the canceller) still begins synchronously in
  // the ordinary case, so a stop pressed the moment a run starts still has
  // something to press. GciTsCallInProgress is no help here: it can answer
  // "idle" while the abandoned Nb result is still uncollected.
  return await whenSessionFree(session, () => beginNbCall(session, start, onReady, opts));
}

function beginNbCall<T>(
  session: ActiveSession,
  start: () => { success: boolean; err: GciError },
  onReady: (signal: AbortSignal) => T | Promise<T>,
  opts: NbRunOptions,
): Promise<T> {
  const { success, err } = start();
  if (!success) {
    return Promise.reject(new Error(err.message || `GemStone error ${err.number}`));
  }
  return pollNbToCompletion(session, onReady, opts);
}
