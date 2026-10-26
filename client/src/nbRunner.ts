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
 * GciTsNbContinue, so a non-blocking Resume needs a worker thread (tracked).
 */

// Poll cadence: start tight (steps usually finish in a few ms), then back off so
// a genuinely long operation doesn't busy-spin.
const BACKOFF_INTERVALS = [10, 10, 20, 40, 80, 160, 320, 500];
const MAX_INTERVAL = 500;
// Only surface a progress UI once an operation is clearly slow, so the common
// fast step never flashes a notification.
const PROGRESS_THRESHOLD_MS = 2000;

/** Thrown when the user cancels (hard-breaks) a non-blocking GemStone call. */
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
  constructor(
    message = 'The stopped run is still finishing on the server, so this session cannot start ' +
      'another one yet. Try again in a moment, or log out to abandon it.',
  ) {
    super(message);
    this.name = 'NbSessionBusyError';
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
   * Called once when polling begins, handed a `cancel` fn. Invoking it requests
   * a break — soft on the first call, hard on the second — exactly the escalation
   * the progress notification's Cancel does. Lets a caller drive cancellation
   * from its own UI (e.g. the debugger's in-panel Cancel button) instead of only
   * the notification toast. The fn is a no-op once the call has settled.
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
   * Called once a hard-broken call has been collected and the session is idle
   * again, before any call waiting on the session starts. Execute It and
   * notebook cells end clientForwarder mode here: their own `finally` runs
   * while the call is still being collected, when GemStone refuses it, and a
   * hard break does not always stop the process the mode belongs to — it stops
   * whichever process was running, which may be a fork (see transcriptSink.ts).
   * Not called if collection gives up. Anything it throws is logged.
   */
  onAbandonedCollected?: () => void;
}

/**
 * The least time that may pass between a soft break and the hard break that
 * follows it. Sending both back-to-back crashes the client process outright — a
 * native fault in the GCI library, not an error that can be caught — so a second
 * cancel arriving too soon is deferred rather than obeyed. Found by an
 * integration test that pressed both at once and took the worker down with it.
 *
 * Exported so the tests wait out the real gap instead of a magic number that has
 * to be remembered if this one ever changes.
 */
export const MIN_HARD_BREAK_GAP_MS = 300;

/**
 * How long the next call waits for a hard-broken call's result to be collected,
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
const live = new Map<number, { stopRequested: () => boolean; stop: () => Promise<unknown> }>();

/**
 * Stop the call in flight on `session`, if any, and wait until the session is
 * free.
 *
 * The call gets the same soft-then-hard break its Cancel would send, and a
 * call abandoned by the hard break is then waited out the way the next call on
 * the session waits for it. Both waits are bounded, so this always resolves; a
 * session still busy past them refuses its next call cleanly rather than
 * crashing.
 *
 * A call stopped here rejects with `NbCancelledError`, however it ended. The
 * gem usually answers the soft break before the hard one goes out, and that
 * answer is GemStone's Break error with a live context, which a caller would
 * offer to debug on a session that is about to go.
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
 * A hard break stops the gem but does not, by itself, end the GCI call: until
 * something reads its result the session reports a call in progress and refuses
 * the next one. The result itself is thrown away. The promise settles once the
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
        if (disposableProcess) clearStoppedProcess(session, err?.context);
        runCollectedHook(session, onCollected);
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
  if (draining.has(session.id)) throw new NbSessionBusyError();
  const running = live.get(session.id);
  if (running) {
    throw running.stopRequested()
      ? new NbSessionBusyError()
      : new NbSessionBusyError(
          'Another run is still in progress on this session. Wait for it to finish, or stop ' +
            'it, before starting another.',
        );
  }
  const pending = uncollected.get(session.id);
  if (pending && !pending.collect()) throw new NbSessionBusyError();
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
  if (!draining.has(session.id)) {
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
 * moment `onReady`'s promise settles, which after a hard break is usually
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
 * Hold the session for an `onReady` whose run was hard-broken, until that
 * `onReady` finishes.
 *
 * There is nothing left to drain: `onReady` has already read the non-blocking
 * result. But it may be resuming the run on a koffi worker thread (the
 * Transcript settle loop does), and while it is, any poll of the session from
 * the main thread kills the process — GciTsNbPoll on 3.7.5, GciTsNbResult on
 * 3.6.2, both measured. So nothing here touches the session; `onReady`'s own
 * promise is the only signal that it is free, and clearing whatever the break
 * stopped is left to `onReady`, which is told of the break through its signal.
 *
 * Bounded, so a worker that never returns cannot hold the session forever.
 * Past the bound a new call is refused cleanly by GemStone itself ("call in
 * progress by another C thread"), never crashed.
 */
function awaitAbandonedRead(
  session: ActiveSession,
  read: Promise<unknown>,
  onCollected?: () => void,
): void {
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
}

/** Run a caller's `onAbandonedCollected`; the caller is long gone, so only log a throw. */
function runCollectedHook(session: ActiveSession, hook: (() => void) | undefined): void {
  if (!hook) return;
  try {
    hook();
  } catch (e) {
    logInfo(
      `[Session ${session.id}] Cleanup after a cancelled run failed: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * Best-effort GciTsClearStack of the process an abandoned call stopped in.
 * The caller is already on its way out with NbCancelledError, so a failure
 * here is logged, never thrown.
 */
function clearStoppedProcess(session: ActiveSession, context: unknown): void {
  if (context === undefined || context === null) return;
  const gsProcess = BigInt(context as bigint | number);
  if (gsProcess === OOP_NIL || gsProcess === 0n) return;
  try {
    session.GciTsClearStack(gsProcess);
  } catch (e) {
    logInfo(
      `[Session ${session.id}] Could not clear a cancelled run's process: ` +
        (e instanceof Error ? e.message : String(e)),
    );
  }
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
 *                promise does — so the progress notification and its
 *                soft/hard-break Cancel keep working for the whole run,
 *                including the part of it spent inside `onReady`. Its `signal`
 *                aborts on a hard break: the run has been rejected by then, so
 *                an async `onReady` that is still working owns the cleanup of
 *                whatever the break stopped. The session stays held for the
 *                next call until `onReady` finishes (see
 *                {@link awaitAbandonedRead}).
 *
 * If the call outlives `PROGRESS_THRESHOLD_MS` — measured from the start of the
 * call, not from the start of `onReady`, and in real time rather than in poll
 * intervals — a cancellable progress notification appears: the first cancel sends a soft break and updates the
 * notification so the user can see it registered; a second sends a hard break
 * and rejects with `NbCancelledError`. A second cancel that lands within
 * `MIN_HARD_BREAK_GAP_MS` of the soft break isn't obeyed immediately — the hard
 * break is deferred until that gap has elapsed, because sending both back-to-back
 * crashes the client. If the gem services the soft break while the hard one is
 * still deferred, the call settles first and the hard break is dropped: the run
 * then reports whatever the gem answered (a `Break` error, typically) instead of
 * rejecting. How fast the gem gets to a soft break varies by an order of
 * magnitude, so both endings are normal and a caller cannot pick which it gets.
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
    let softBreakAt = 0;
    let hardBreakScheduled = false;
    let progressResolve: (() => void) | null = null;
    const abandoned = new AbortController();
    // onReady's work, once it has begun: from then on the non-blocking result
    // is already read and the session may belong to a worker thread.
    let reading: Promise<T> | null = null;
    let stopped = false;
    const liveEntry = {
      stopRequested: (): boolean => softBreakSent,
      // Twice, like pressing Cancel twice: a soft break, then a hard one once
      // MIN_HARD_BREAK_GAP_MS has passed. A run the first press already settled
      // (a hard break after an earlier Cancel) needs no second one.
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
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (live.get(session.id) === liveEntry) live.delete(session.id);
      if (stopped) fn = () => reject(new NbCancelledError());
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
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

    // Soft-then-hard break, shared by the notification's Cancel and any external
    // canceller handed out via opts.onStart. First call asks the gem to stop at a
    // safe point; a second interrupts now and gives up on the call.
    const sendHardBreak = settleOnThrow(() => {
      if (settled) return;
      // Before the break, not after: a worker thread answers it within a
      // millisecond, and onReady must already see the run as abandoned then.
      abandoned.abort();
      const { success, err } = session.GciTsBreak(true);
      logInfo(
        `[Session ${session.id}] Hard break sent: success=${success}` +
          (err?.number ? ` err=${err.number} ${err.message ?? ''}` : ''),
      );
      if (reading) {
        // Nothing to drain, and the session must not be touched — see
        // awaitAbandonedRead.
        awaitAbandonedRead(session, reading, opts.onAbandonedCollected);
      } else {
        // A hard break abandons the call, but the session still counts it as in
        // progress until its (aborted) result is collected. Drain it, or the very
        // next call on this session is refused with "session is busy" — which reads
        // as the next run silently doing nothing.
        void drainAbandonedCall(
          session,
          opts.disposableProcess === true,
          opts.onAbandonedCollected,
        );
      }
      settle(() => reject(new NbCancelledError()));
    });

    const requestCancel = settleOnThrow(() => {
      if (settled) {
        logInfo(`[Session ${session.id}] Break requested, but the call had already settled.`);
        return;
      }
      if (!softBreakSent) {
        // Logged because a break that the gem ignores is indistinguishable, from
        // the outside, from a break that was never sent — and the difference is
        // the whole diagnosis when a stop button appears to do nothing.
        const { success, err } = session.GciTsBreak(false);
        logInfo(
          `[Session ${session.id}] Soft break sent: success=${success}` +
            (err?.number ? ` err=${err.number} ${err.message ?? ''}` : ''),
        );
        softBreakSent = true;
        // performance.now, not Date.now: this asks how much time has *elapsed*,
        // and the wall clock answers a different question that anything on the
        // system can change underneath us. An NTP step or a VM resume that
        // shoves it forward between here and the second press would make the
        // gap below look already served and send the hard break back-to-back —
        // the exact native fault MIN_HARD_BREAK_GAP_MS exists to prevent.
        softBreakAt = performance.now();
        progressReport?.({ message: 'Soft break sent — waiting for the gem to stop…' });
      } else {
        if (hardBreakScheduled) return;
        const waited = performance.now() - softBreakAt;
        if (waited >= MIN_HARD_BREAK_GAP_MS) {
          sendHardBreak();
          return;
        }
        // Too soon after the soft break to be safe — see MIN_HARD_BREAK_GAP_MS.
        hardBreakScheduled = true;
        setTimeout(sendHardBreak, MIN_HARD_BREAK_GAP_MS - waited);
      }
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
            // debug or clear it.
            if (stopped && !settled && opts.disposableProcess === true) {
              clearStoppedProcess(session, (e as { context?: unknown } | null)?.context);
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
        // drain belongs here as much as on the hard-break path.
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
