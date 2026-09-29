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
 * Whether a started non-blocking call's result is ready: 1 = ready, 0 = pending,
 * -1 = error. Uses GciTsNbPoll when available (3.7+); otherwise polls the session
 * socket directly (GciTsSocket + native poll), exactly as the GciTsNbResult docs
 * prescribe for older servers.
 */
export function pollNbResultReady(session: ActiveSession): { result: number; err: GciError } {
  if (session.gci.isAvailable('GciTsNbPoll')) {
    // eslint-disable-next-line no-restricted-syntax -- guarded by isAvailable above; the else branch below is the 3.6.x path (GciTsSocket + a native poll)
    return session.gci.GciTsNbPoll(session.handle, 0);
  }
  const { fd, err } = session.gci.GciTsSocket(session.handle);
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
   */
  onStart?: (cancel: () => void) => void;
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

/** How long to keep collecting the result of a hard-broken call, and how often. */
const DRAIN_ATTEMPTS = 40;
const DRAIN_INTERVAL_MS = 50;

/**
 * Sessions still busy with a call we gave up on: its result is still being
 * collected ({@link drainAbandonedCall}), or its `onReady` is still resuming it
 * on a worker thread ({@link awaitAbandonedRead}). The next call on that
 * session waits for it: either takes as long as the gem takes to notice the
 * break, and a run started in the meantime would be refused outright — which,
 * from the user's side, is pressing stop and then having the next run do nothing.
 *
 * Keyed by session id, not by the ActiveSession object: callers build those
 * freely and two of them can stand for the same logged-in session, which is the
 * thing that actually has one call outstanding at a time.
 */
const draining = new Map<number, Promise<void>>();

/**
 * Collect and discard the result of a call we gave up on, so the session goes
 * back to idle.
 *
 * A hard break stops the gem but does not, by itself, end the GCI call: until
 * something reads its result the session reports a call in progress and refuses
 * the next one. The result itself is thrown away. Gives up after a bounded
 * number of attempts rather than polling a session that is never going to
 * answer.
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
  // Giving up leaves the session refusing every call until logout, with
  // nothing to show why, so say so.
  const giveUp = (reason: string): void =>
    logInfo(
      `[Session ${session.id}] Gave up collecting a cancelled call after ` +
        `${Date.now() - startedAt}ms (${reason}); the session stays busy until it is collected.`,
    );
  const done = new Promise<void>((resolve) => {
    const attempt = (n: number): void => {
      try {
        const { result, err } = pollNbResultReady(session);
        if (result === 1) {
          const { err } = session.gci.GciTsNbResult(session.handle);
          if (disposableProcess) clearStoppedProcess(session, err?.context);
          runCollectedHook(session, onCollected);
          resolve();
          return;
        }
        if (result === -1 || n >= DRAIN_ATTEMPTS) {
          giveUp(
            result === -1
              ? `poll error ${err?.number ?? ''} ${err?.message ?? ''}`.trim()
              : `no result after ${n + 1} polls`,
          );
          resolve();
          return;
        }
      } catch (e) {
        giveUp(e instanceof Error ? e.message : String(e));
        resolve();
        return;
      }
      setTimeout(() => attempt(n + 1), DRAIN_INTERVAL_MS);
    };
    attempt(0);
  }).finally(() => {
    draining.delete(session.id);
  });

  draining.set(session.id, done);
  return done;
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
    session.gci.GciTsClearStack(session.handle, gsProcess);
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
  return new Promise<T>((resolve, reject) => {
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

    const finishProgress = (): void => {
      if (progressResolve) {
        progressResolve();
        progressResolve = null;
      }
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      finishProgress();
      fn();
    };

    // Lets the notification's Cancel report progress text; null until/unless the
    // ~2s notification is showing (an external cancel can fire before then).
    let progressReport: ((value: { message?: string }) => void) | null = null;

    // Soft-then-hard break, shared by the notification's Cancel and any external
    // canceller handed out via opts.onStart. First call asks the gem to stop at a
    // safe point; a second interrupts now and gives up on the call.
    const sendHardBreak = (): void => {
      if (settled) return;
      // Before the break, not after: a worker thread answers it within a
      // millisecond, and onReady must already see the run as abandoned then.
      abandoned.abort();
      const { success, err } = session.gci.GciTsBreak(session.handle, true);
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
    };

    const requestCancel = (): void => {
      if (settled) {
        logInfo(`[Session ${session.id}] Break requested, but the call had already settled.`);
        return;
      }
      if (!softBreakSent) {
        // Logged because a break that the gem ignores is indistinguishable, from
        // the outside, from a break that was never sent — and the difference is
        // the whole diagnosis when a stop button appears to do nothing.
        const { success, err } = session.gci.GciTsBreak(session.handle, false);
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
    };
    if (opts.onStart) opts.onStart(requestCancel);

    const doPoll = (): void => {
      if (settled) return;
      const { result: pollResult, err: pollErr } = pollNbResultReady(session);

      if (pollResult === 1) {
        // Don't settle until onReady's (possibly async) work finishes — a
        // transcript-forwarding settle loop may keep the server running well
        // past this first ready signal, and Cancel must stay live throughout.
        let ready: T | Promise<T>;
        try {
          ready = onReady(abandoned.signal);
        } catch (e) {
          settle(() => reject(e));
          return;
        }
        reading = Promise.resolve(ready);
        reading.then(
          (value) => settle(() => resolve(value)),
          (e) => settle(() => reject(e)),
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
      // A logout (or a lost connection) while a call is outstanding leaves the poll
      // reporting "not ready" forever: the progress notification would sit there
      // claiming work is in flight, and whatever awaited this promise would never
      // hear back. GciTsCallInProgress answers -1 for a session that is gone.
      const { result: alive, err: aliveErr } = session.gci.GciTsCallInProgress(session.handle);
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
    };

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
}

/**
 * Start a non-blocking GemStone call and poll it to completion.
 *
 * @param start issues the `GciTsNb…` call; returns `{ success, err }`. A failed
 *              start rejects without polling.
 * @param onReady see {@link pollNbToCompletion}.
 */
export function runNbCall<T>(
  session: ActiveSession,
  start: () => { success: boolean; err: GciError },
  onReady: (signal: AbortSignal) => T | Promise<T>,
  opts: NbRunOptions = {},
): Promise<T> {
  // A call we gave up on may still be being collected. Starting now would be
  // refused as "an operation is in progress" — so wait for the session to be free
  // rather than failing a run whose only crime is following a stop.
  //
  // Only ever deferred when there IS something to wait for: the call (and with it
  // opts.onStart, which hands out the canceller) still begins synchronously in the
  // ordinary case, so a stop pressed the moment a run starts still has something
  // to press.
  // GciTsCallInProgress is no help here: it can answer "idle" while the abandoned
  // Nb result is still uncollected, and it is that result the next GciTsNbExecute
  // refuses over ("session has a GciTsNb operation in progress"). Only the drain
  // itself knows when the session is really free, so wait on it. Bounded by
  // DRAIN_ATTEMPTS (or ABANDONED_READ_WAIT_MS), so it always resolves.
  const pending = draining.get(session.id);
  if (pending) return pending.then(() => beginNbCall(session, start, onReady, opts));
  return beginNbCall(session, start, onReady, opts);
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
