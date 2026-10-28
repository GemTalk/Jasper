import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', async (orig) => ({ ...(await orig()), logInfo: vi.fn() }));

import * as vscode from 'vscode';
import { logInfo } from '../gciLog';
import {
  runNbCall,
  pollNbResultReady,
  NbCancelledError,
  NbSessionBusyError,
  ensureSessionFree,
  MIN_HARD_BREAK_GAP_MS,
  LATE_COLLECT_INTERVAL_MS,
  LATE_COLLECT_LIMIT_MS,
  whenSessionFree,
  forgetSession,
  stopCallsOn,
} from '../nbRunner';
import { OOP_ILLEGAL, OOP_NIL } from '../gciConstants';
import { fakeActiveSession } from './fakeActiveSession';

const noErr = { number: 0 } as const;

/**
 * Enough fake time for a deferred hard break to go out. The runner schedules it
 * exactly MIN_HARD_BREAK_GAP_MS after the soft one (fake timers freeze the clock,
 * so no real time has "already been waited"); the margin keeps these tests off
 * that boundary.
 */
const PAST_HARD_BREAK_GAP_MS = MIN_HARD_BREAK_GAP_MS + 100;

/**
 * Fake time that stops just short of the deferred hard break, so a test can
 * assert it is still being withheld before letting it through.
 */
const BEFORE_HARD_BREAK_GAP_MS = MIN_HARD_BREAK_GAP_MS - 50;

// The runner tracks an abandoned call per session id, and a call that outlives
// the drain's budget stays tracked, so each fake session gets an id of its own.
let nextSessionId = 1;

/**
 * Fake session, with its mock library and handle, whose gci returns a
 * scripted sequence of poll results. Each pollNbResultReady consumes the next
 * entry (1 = ready, 0 = pending, -1 = error).
 */
function makeSession(pollResults: { result: number; err?: unknown }[]) {
  let i = 0;
  const gci = {
    isAvailable: (name: string) => name === 'GciTsNbPoll',
    GciTsNbPoll: vi.fn(() => {
      const r = pollResults[Math.min(i, pollResults.length - 1)];
      i++;
      return { result: r.result, err: r.err ?? noErr };
    }),
    GciTsBreak: vi.fn((_session: unknown, _hard: boolean) => ({ result: 0, err: noErr })),
    GciTsSocket: vi.fn(() => ({ fd: 3, err: noErr })),
    // 0 = the session is there and idle-ish; -1 would mean it has gone away, which
    // the poll treats as "nobody is coming to answer this call".
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: noErr })),
    GciTsNbExecute: vi.fn(() => ({ success: true, err: noErr })),
    GciTsNbResult: vi.fn(() => ({ result: 0, err: noErr })),
    GciTsClearStack: vi.fn(() => ({ success: true, err: noErr })),
    logout: vi.fn(() => ({ sessionFreed: true })),
  };
  const handle = { h: 1 };
  return { session: fakeActiveSession({ id: nextSessionId++, handle, gci }), gci, handle };
}

describe('runNbCall', () => {
  it('rejects if the start call fails (no polling)', async () => {
    const { session } = makeSession([{ result: 1 }]);
    const onReady = vi.fn();
    await expect(
      runNbCall(
        session,
        () => ({ success: false, err: { number: 5, message: 'boom' } as never }),
        onReady,
      ),
    ).rejects.toThrow('boom');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('calls onReady and resolves with its value once the poll reports ready', async () => {
    const { session } = makeSession([{ result: 1 }]); // ready on first poll
    const result = await runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 'the-result',
    );
    expect(result).toBe('the-result');
  });

  it('rejects when polling reports an error (-1)', async () => {
    // Fake timers: the drain retries a poll error after the run has rejected, and
    // on real timers that retry would fire inside whichever test runs next.
    vi.useFakeTimers();
    try {
      const { session } = makeSession([{ result: -1, err: { number: 7, message: 'pollbad' } }]);
      await expect(
        runNbCall(
          session,
          () => ({ success: true, err: noErr as never }),
          () => 'unused',
        ),
      ).rejects.toThrow('pollbad');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps polling while pending, then resolves when ready', async () => {
    const { session, gci } = makeSession([{ result: 0 }, { result: 0 }, { result: 1 }]);
    const result = await runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 42,
    );
    expect(result).toBe(42);
    expect(gci.GciTsNbPoll).toHaveBeenCalledTimes(3);
  });

  it('propagates an error thrown by onReady (e.g. a fetch failure)', async () => {
    const { session } = makeSession([{ result: 1 }]);
    await expect(
      runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => {
          throw new Error('fetch failed');
        },
      ),
    ).rejects.toThrow('fetch failed');
  });
});

describe('pollNbResultReady', () => {
  it('uses GciTsNbPoll when available', () => {
    const { session, gci } = makeSession([{ result: 1 }]);
    expect(pollNbResultReady(session).result).toBe(1);
    expect(gci.GciTsNbPoll).toHaveBeenCalled();
  });

  it('falls back to the session socket when GciTsNbPoll is unavailable', () => {
    const gci = {
      isAvailable: () => false, // GciTsNbPoll absent (pre-3.7)
      GciTsSocket: vi.fn(() => ({ fd: -1, err: { number: 0 } })), // bad fd → -1
    };
    const session = fakeActiveSession({ id: 1, handle: { h: 1 }, gci });
    expect(pollNbResultReady(session).result).toBe(-1);
    expect(gci.GciTsSocket).toHaveBeenCalled();
  });
});

describe('runNbCall — cancellation', () => {
  // Drive the progress/cancel path: override withProgress to capture the
  // cancellation handler the loop registers, and use fake timers to cross the
  // ~2s progress threshold without real waiting.
  it('first cancel soft-breaks + reports progress; second hard-breaks + rejects NbCancelledError', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci, handle } = makeSession([{ result: 0 }]); // always pending → loop keeps polling
      const reportSpy = vi.fn();
      let cancelHandler: (() => void) | undefined;
      vi.mocked(vscode.window.withProgress).mockImplementation((_opts: unknown, task: unknown) => {
        const token = {
          onCancellationRequested: (cb: () => void) => {
            cancelHandler = cb;
            return { dispose() {} };
          },
        };
        return (task as (p: unknown, t: unknown) => Promise<unknown>)({ report: reportSpy }, token);
      });

      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unused',
      );
      // The hard break is deferred now, so this rejects inside a timer tick — a whole
      // turn before `expect(p).rejects` would attach a handler, which Node reports as
      // an unhandled rejection. Claim it here; the assertions below still hold.
      p.catch(() => {});
      // Advance past PROGRESS_THRESHOLD_MS (2000) so the progress block runs and
      // registers the cancellation handler.
      await vi.advanceTimersByTimeAsync(3000);
      expect(cancelHandler).toBeTypeOf('function');

      cancelHandler!(); // first cancel → soft break + acknowledgement
      expect(gci.GciTsBreak).toHaveBeenCalledWith(handle, false);
      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/break/i) }),
      );

      cancelHandler!(); // second cancel → hard break, once the safety gap has passed

      // The withholding itself, not just its eventual effect: a hard break sent
      // on the heels of the soft one faults the client process, and an assertion
      // that only looks *past* the gap passes just as happily if the deferral is
      // dropped and the break goes out at once.
      await vi.advanceTimersByTimeAsync(BEFORE_HARD_BREAK_GAP_MS);
      expect(gci.GciTsBreak).not.toHaveBeenCalledWith(handle, true);

      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      expect(gci.GciTsBreak).toHaveBeenCalledWith(handle, true);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

      await vi.advanceTimersByTimeAsync(3000); // let the drain finish
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
      vi.mocked(vscode.window.withProgress).mockReset();
    }
  });

  // The in-panel Cancel button drives cancellation through opts.onStart, which
  // works even before the ~2s notification would appear (no toast involved).
  it('hands out an external cancel via onStart that soft- then hard-breaks', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci, handle } = makeSession([{ result: 0 }]); // always pending → never settles on its own
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unused',
        {
          onStart: (c) => {
            cancel = c;
          },
        },
      );
      // The hard break is deferred now, so this rejects inside a timer tick — a whole
      // turn before `expect(p).rejects` would attach a handler, which Node reports as
      // an unhandled rejection. Claim it here; the assertions below still hold.
      p.catch(() => {});

      expect(cancel).toBeTypeOf('function');

      cancel!(); // first → soft break
      expect(gci.GciTsBreak).toHaveBeenCalledWith(handle, false);

      cancel!(); // second → hard break, sent once the safety gap has passed

      // Withheld until the gap has elapsed — checked on this path too, because
      // the external canceller is wired separately from the notification's.
      await vi.advanceTimersByTimeAsync(BEFORE_HARD_BREAK_GAP_MS);
      expect(gci.GciTsBreak).not.toHaveBeenCalledWith(handle, true);

      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      expect(gci.GciTsBreak).toHaveBeenCalledWith(handle, true);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

      // Let the background drain finish; tearing the timers down mid-drain would
      // leave the session marked as still draining for every later call.
      await vi.advanceTimersByTimeAsync(3000);
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });

  // The gap is measured with a monotonic clock, so a wall clock that moves
  // underneath the gesture must not change the scheduling decision. Only the
  // forward direction is dangerous: it makes the gap look already served and
  // sends the hard break on the heels of the soft one, which faults the client.
  it('withholds the hard break for the full gap even if the wall clock jumps forward', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci, handle } = makeSession([{ result: 0 }]); // always pending → never settles on its own
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unused',
        {
          suppressNotification: true,
          onStart: (c) => {
            cancel = c;
          },
        },
      );
      // The hard break is deferred now, so this rejects inside a timer tick — a whole
      // turn before `expect(p).rejects` would attach a handler, which Node reports as
      // an unhandled rejection. Claim it here; the assertions below still hold.
      p.catch(() => {});

      cancel!(); // first → soft break
      expect(gci.GciTsBreak).toHaveBeenCalledWith(handle, false);

      // An NTP step or a resumed VM: the wall clock lurches a minute ahead while
      // no real time passes at all. setSystemTime moves the faked Date and
      // leaves performance.now where it was, which is precisely that shape.
      vi.setSystemTime(Date.now() + 60_000);

      cancel!(); // second → hard break, still owed the full gap of *real* time

      await vi.advanceTimersByTimeAsync(BEFORE_HARD_BREAK_GAP_MS);
      expect(gci.GciTsBreak).not.toHaveBeenCalledWith(handle, true);

      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      expect(gci.GciTsBreak).toHaveBeenCalledWith(handle, true);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

      await vi.advanceTimersByTimeAsync(3000); // let the drain finish
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runNbCall — notification suppression', () => {
  it('does NOT show the 2s notification when suppressNotification is set', async () => {
    vi.useFakeTimers();
    vi.mocked(vscode.window.withProgress).mockClear();
    try {
      const { session } = makeSession([{ result: 0 }]); // pending forever
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'x',
        { suppressNotification: true },
      );
      p.catch(() => {}); // we abandon the call; swallow the (never-fired) rejection

      await vi.advanceTimersByTimeAsync(3000); // well past the 2s threshold

      expect(vscode.window.withProgress).not.toHaveBeenCalled();
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
      vi.mocked(vscode.window.withProgress).mockReset();
    }
  });

  it('shows the 2s notification when suppressNotification is not set', async () => {
    vi.useFakeTimers();
    vi.mocked(vscode.window.withProgress).mockImplementation(() => new Promise<never>(() => {}));
    try {
      const { session } = makeSession([{ result: 0 }]);
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'x',
        { title: 'GemStone: working…' },
      );
      p.catch(() => {});

      await vi.advanceTimersByTimeAsync(3000);

      expect(vscode.window.withProgress).toHaveBeenCalled();
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
      vi.mocked(vscode.window.withProgress).mockReset();
    }
  });

  it('shows the notification for a slow onReady, not only for slow polling', async () => {
    // The threshold used to be counted inside the poll loop, and that loop stops
    // the moment the call first reports ready. A Transcript write makes the call
    // ready within milliseconds and then streams output from inside onReady for
    // as long as the user's code runs, so such a run got no notification however
    // long it lasted -- and the Cancel on this notification is the only way to
    // stop a run (#646). Ready at once, onReady never settles.
    vi.useFakeTimers();
    vi.mocked(vscode.window.withProgress).mockImplementation(() => new Promise<never>(() => {}));
    try {
      const { session } = makeSession([{ result: 1 }]);
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => new Promise<string>(() => {}),
        { title: 'GemStone: working…' },
      );
      p.catch(() => {});

      await vi.advanceTimersByTimeAsync(3000);

      expect(vscode.window.withProgress).toHaveBeenCalled();
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
      vi.mocked(vscode.window.withProgress).mockReset();
    }
  });

  it('never shows the notification for a call that finished before the threshold', async () => {
    // The other half of moving to a wall-clock timer: it is armed at the start of
    // every call, so it has to be disarmed when the call settles or a fast
    // operation would flash a notification seconds after it was done.
    vi.useFakeTimers();
    vi.mocked(vscode.window.withProgress).mockImplementation(() => new Promise<never>(() => {}));
    try {
      const { session } = makeSession([{ result: 1 }]);
      await runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'done quickly',
        { title: 'GemStone: working…' },
      );

      await vi.advanceTimersByTimeAsync(3000);

      expect(vscode.window.withProgress).not.toHaveBeenCalled();
      vi.clearAllTimers();
    } finally {
      vi.useRealTimers();
      vi.mocked(vscode.window.withProgress).mockReset();
    }
  });
});

describe('after a hard break', () => {
  it('collects the abandoned result, so the session is usable again', async () => {
    // A hard break stops the gem but does not end the GCI call: until the result
    // is taken, the session reports a call in progress and refuses the next one —
    // which reads as the NEXT run silently doing nothing.
    vi.useFakeTimers();
    try {
      // Never ready on its own, so only the break can settle this call.
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unreachable',
        {
          suppressNotification: true,
          onStart: (c) => {
            cancel = c;
          },
        },
      );
      // The hard break is deferred now, so this rejects inside a timer tick — a whole
      // turn before `expect(p).rejects` would attach a handler, which Node reports as
      // an unhandled rejection. Claim it here; the assertions below still hold.
      p.catch(() => {});

      cancel!(); // soft
      cancel!(); // hard — sent once the safety gap has passed
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);
      expect(gci.GciTsNbResult).not.toHaveBeenCalled();

      // The drain polls in the background until the abandoned result is ready.
      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(500);
      expect(gci.GciTsNbResult).toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('clears the process the break stopped when the caller declared it disposable', async () => {
    // A process hard-broken inside a Transcript write still holds the session's
    // Transcript semaphore, and every later write fails until it is cleared --
    // measured on 3.6.2 and 3.7.5. Nobody else will clear it: the caller has
    // already been handed NbCancelledError.
    vi.useFakeTimers();
    try {
      const { session, gci, handle } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      (gci.GciTsNbResult as ReturnType<typeof vi.fn>).mockReturnValue({
        result: 1n,
        err: { number: 6004, context: 0x4242n },
      });
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unreachable',
        {
          suppressNotification: true,
          disposableProcess: true,
          onStart: (c) => {
            cancel = c;
          },
        },
      );
      p.catch(() => {});
      cancel!();
      cancel!();
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(500);

      expect(gci.GciTsClearStack).toHaveBeenCalledWith(handle, 0x4242n);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('leaves the stopped process alone when the caller did not declare it disposable', async () => {
    // What a debugger step is: the message is performed ON the process the panel
    // is showing, so the process a break stops is the user's stack, not the
    // call's own litter. Clearing it would unwind that stack to nothing while
    // the panel still says "Step cancelled." and offers to step again. Same
    // drain, same break -- only the caller's declaration differs.
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      (gci.GciTsNbResult as ReturnType<typeof vi.fn>).mockReturnValue({
        result: 1n,
        err: { number: 6004, context: 0x4242n },
      });
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unreachable',
        {
          suppressNotification: true,
          onStart: (c) => {
            cancel = c;
          },
        },
      );
      p.catch(() => {});
      cancel!();
      cancel!();
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(500);

      // Still drained -- the session has to go back to idle either way, or the
      // next step is refused as "an operation is in progress".
      expect(gci.GciTsNbResult).toHaveBeenCalled();
      expect(gci.GciTsClearStack).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('runs onAbandonedCollected once the abandoned result is collected, not before', async () => {
    // Execute It ends clientForwarder mode here: its own `finally` ran while
    // the call was still being collected, and GemStone refused it.
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      const collected = vi.fn(() => {
        expect(gci.GciTsNbResult).toHaveBeenCalled();
      });
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unreachable',
        {
          suppressNotification: true,
          onStart: (c) => {
            cancel = c;
          },
          onAbandonedCollected: collected,
        },
      );
      p.catch(() => {});
      cancel!();
      cancel!();
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);
      expect(collected).not.toHaveBeenCalled();

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(500);
      expect(collected).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not run onAbandonedCollected while the stopped call is uncollected', async () => {
    // The session is still busy (or gone): an end call there would only be refused.
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({
        result: 0,
        err: noErr,
      });
      const collected = vi.fn();
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unreachable',
        {
          suppressNotification: true,
          onStart: (c) => {
            cancel = c;
          },
          onAbandonedCollected: collected,
        },
      );
      p.catch(() => {});
      cancel!();
      cancel!();
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(collected).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops polling in the background for a session that never answers', async () => {
    // Better a bounded background poll than one that outlives the window.
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({
        result: 0,
        err: noErr,
      });
      let cancel: (() => void) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unreachable',
        {
          suppressNotification: true,
          onStart: (c) => {
            cancel = c;
          },
        },
      );
      // The hard break is deferred now, so this rejects inside a timer tick — a whole
      // turn before `expect(p).rejects` would attach a handler, which Node reports as
      // an unhandled rejection. Claim it here; the assertions below still hold.
      p.catch(() => {});
      cancel!();
      cancel!();
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

      await vi.advanceTimersByTimeAsync(LATE_COLLECT_LIMIT_MS + 60_000);

      expect(gci.GciTsNbResult).not.toHaveBeenCalled();
      // Silently stopping leaves a session that refuses every call with no
      // trace of why.
      expect(vi.mocked(logInfo)).toHaveBeenCalledWith(
        expect.stringContaining('Stopped polling for a cancelled call'),
      );
      const pollsAfterStopping = (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect((gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        pollsAfterStopping,
      );
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

/**
 * Start a run on `session` and stop it with a soft then a hard break, answering
 * once the run has rejected. `poll` stays pending throughout, so the stopped call
 * is still uncollected when this returns.
 */
async function stopRun(
  session: ReturnType<typeof makeSession>['session'],
  opts: { disposableProcess?: boolean; onAbandonedCollected?: () => void } = {},
): Promise<void> {
  let cancel: (() => void) | undefined;
  const p = runNbCall(
    session,
    () => session.GciTsNbExecute('nil', OOP_ILLEGAL, OOP_ILLEGAL, OOP_NIL, 0, 0),
    () => 'unreachable',
    {
      suppressNotification: true,
      onStart: (c) => {
        cancel = c;
      },
      ...opts,
    },
  );
  p.catch(() => {});
  cancel!();
  cancel!();
  await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
  await expect(p).rejects.toBeInstanceOf(NbCancelledError);
}

/** Fake time past the drain's own budget (40 polls, 50ms apart). */
const PAST_DRAIN_BUDGET_MS = 3000;

describe('a stopped call the gem takes longer than the drain budget to finish', () => {
  // The gem goes on working after a break until it reaches a point where it can
  // stop: a slow ensure: block, a slow tearDown, or just a loaded machine. Until
  // its result is collected, GemStone refuses every call on the session.

  it('is collected once the gem answers, so the session is usable again', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);
      expect(gci.GciTsNbResult).not.toHaveBeenCalled();

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(1000);
      expect(gci.GciTsNbResult).toHaveBeenCalledTimes(1);

      // Nothing left to collect: the next run starts at once.
      const start = vi.fn(() => ({ success: true, err: noErr as never }));
      await expect(
        runNbCall(session, start, () => 'next', { suppressNotification: true }),
      ).resolves.toBe('next');
      expect(start).toHaveBeenCalledTimes(1);
      expect(gci.GciTsNbResult).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('refuses a new run with a message that says why, without starting it', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      const start = vi.fn(() => ({ success: true, err: noErr as never }));
      const next = runNbCall(session, start, () => 'never', { suppressNotification: true });

      await expect(next).rejects.toBeInstanceOf(NbSessionBusyError);
      await expect(next).rejects.toThrow(/still finishing/);
      expect(start).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('collects the result when the next run starts, if it is ready by then', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      // Ready, but the background poll has not been round to see it yet.
      poll.mockReturnValue({ result: 1, err: noErr });
      const order: string[] = [];
      vi.mocked(gci.GciTsNbResult).mockImplementation(() => {
        order.push('collect');
        return { result: 0, err: noErr };
      });
      const run = runNbCall(
        session,
        () => {
          order.push('start');
          return { success: true, err: noErr as never };
        },
        () => 'next',
        { suppressNotification: true },
      );

      await expect(run).resolves.toBe('next');
      expect(order.slice(0, 2)).toEqual(['collect', 'start']);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('finishes the stopped call the same way a prompt collection does', async () => {
    // Clearing the process gives back the Transcript semaphore it may hold, and
    // onAbandonedCollected is where Execute It ends clientForwarder mode.
    vi.useFakeTimers();
    try {
      const { session, gci, handle } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      vi.mocked(gci.GciTsNbResult).mockReturnValue({
        result: 1n,
        err: { number: 6004, context: 0x4242n },
      } as never);
      const collected = vi.fn();
      await stopRun(session, { disposableProcess: true, onAbandonedCollected: collected });
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);
      expect(collected).not.toHaveBeenCalled();

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(1000);

      expect(gci.GciTsClearStack).toHaveBeenCalledWith(handle, 0x4242n);
      expect(collected).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('still collects on demand after the background poll has stopped', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(LATE_COLLECT_LIMIT_MS + 60_000);

      poll.mockReturnValue({ result: 1, err: noErr });
      await expect(
        runNbCall(
          session,
          () => ({ success: true, err: noErr as never }),
          () => 'next',
          { suppressNotification: true },
        ),
      ).resolves.toBe('next');
      expect(gci.GciTsNbResult).toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('is collected when the calls on its session are stopped, without waiting for the next poll', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);
      poll.mockReturnValue({ result: 1, err: noErr });

      await stopCallsOn(session);

      expect(gci.GciTsNbResult).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops polling once the session is logged out', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      session.logout();
      const pollsAtLogout = poll.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(poll.mock.calls.length).toBe(pollsAtLogout);
      // A logged-out session says so, not that it is still busy.
      await expect(
        runNbCall(
          session,
          () => session.GciTsNbExecute('3 + 4', 0n, 0n, 0n, 0, 0),
          () => 'never',
          { suppressNotification: true },
        ),
      ).rejects.toThrow('The GemStone session is logged out.');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('a session whose stopped call is still being drained', () => {
  // The drain's 2s after a hard break: the stopped call is still on the session,
  // and a call from the main thread is refused, or, while a worker owns the
  // session, can kill the process.

  /** Hard-break a call, and stop short of the drain's budget. */
  async function hardBreakAndStayInTheDrain(session: ReturnType<typeof makeSession>['session']) {
    let cancel: (() => void) | undefined;
    const p = runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 'x',
      {
        suppressNotification: true,
        onStart: (c) => {
          cancel = c;
        },
      },
    );
    p.catch(() => {});
    cancel!();
    cancel!();
    await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
    await expect(p).rejects.toBeInstanceOf(NbCancelledError);
  }

  it('refuses a call that cannot wait, with a message that says why', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({ result: 0, err: noErr });
      await hardBreakAndStayInTheDrain(session);

      expect(() => ensureSessionFree(session)).toThrow(/still finishing/);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('holds a call that can wait until the drain is over', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await hardBreakAndStayInTheDrain(session);
      const start = vi.fn(() => 'started');
      const wait = whenSessionFree(session, start);
      expect(start).not.toHaveBeenCalled();

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(100);

      await expect(wait).resolves.toBe('started');
      expect(gci.GciTsNbResult).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('neither holds up nor is released by a call on another session', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({ result: 0, err: noErr });
      const other = makeSession([{ result: 1 }]).session;
      await hardBreakAndStayInTheDrain(session);
      const start = vi.fn(() => 'started');

      const answer = whenSessionFree(other, start);
      const run = runNbCall(
        other,
        () => ({ success: true, err: noErr as never }),
        () => 'done',
        {
          suppressNotification: true,
        },
      );
      await vi.advanceTimersByTimeAsync(100);

      expect(answer).toBe('started');
      await expect(run).resolves.toBe('done');
      expect(() => ensureSessionFree(session)).toThrow(/still finishing/);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('starts a call at once, before answering, when there is nothing to wait for', () => {
    const { session } = makeSession([{ result: 0 }]);
    const start = vi.fn(() => 'started');

    const answer = whenSessionFree(session, start);

    expect(answer).toBe('started');
  });

  it('frees the session within the drain when its polls keep failing', async () => {
    // A broken connection, say: not a gem still finishing, so nothing should be
    // held up for the drain's whole budget, nor refused as busy.
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await hardBreakAndStayInTheDrain(session);
      poll.mockReturnValue({ result: -1, err: { number: 9, message: 'poll err' } });

      await vi.advanceTimersByTimeAsync(500);

      expect(() => ensureSessionFree(session)).not.toThrow();
      const pollsAfterGivingUp = poll.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(poll.mock.calls.length).toBe(pollsAfterGivingUp);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops polling once the session is forgotten', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await hardBreakAndStayInTheDrain(session);

      forgetSession(session.id);
      const pollsAtLogout = poll.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(poll.mock.calls.length).toBe(pollsAtLogout);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('starts only one of two runs waiting on the same drain', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await hardBreakAndStayInTheDrain(session);
      const starts = vi.fn(() => ({ success: true, err: noErr as never }));
      const first = runNbCall(session, starts, () => 'first', { suppressNotification: true });
      const second = runNbCall(session, starts, () => 'second', { suppressNotification: true });
      first.catch(() => {});
      second.catch(() => {});

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(100);

      await expect(second).rejects.toThrow(/still in progress/);
      await expect(first).resolves.toBe('first');
      expect(starts).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('a stopped call whose collection hits a poll error', () => {
  it('goes on collecting after one error, so the session is not left refusing every call', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);
      poll.mockReturnValueOnce({ result: -1, err: { number: 9, message: 'poll err' } });
      await vi.advanceTimersByTimeAsync(LATE_COLLECT_INTERVAL_MS);

      expect(() => ensureSessionFree(session)).toThrow(/still finishing/);

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(LATE_COLLECT_INTERVAL_MS);
      expect(gci.GciTsNbResult).toHaveBeenCalledTimes(1);
      expect(() => ensureSessionFree(session)).not.toThrow();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('gives up, and says so, after several errors in a row', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);
      vi.mocked(logInfo).mockClear();

      poll.mockReturnValue({ result: -1, err: { number: 9, message: 'poll err' } });
      await vi.advanceTimersByTimeAsync(5 * LATE_COLLECT_INTERVAL_MS);
      const pollsAfterGivingUp = poll.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * LATE_COLLECT_INTERVAL_MS);

      expect(poll.mock.calls.length).toBe(pollsAfterGivingUp);
      expect(vi.mocked(logInfo).mock.calls.flat().join('\n')).toMatch(/Gave up collecting/);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops calling the session busy once it gives up while draining', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);

      poll.mockReturnValue({ result: -1, err: { number: 9, message: 'poll err' } });
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      expect(gci.GciTsNbResult).not.toHaveBeenCalled();
      expect(session.isBusy()).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops calling the session busy once it gives up collecting in the background', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      poll.mockReturnValue({ result: -1, err: { number: 9, message: 'poll err' } });
      await vi.advanceTimersByTimeAsync(5 * LATE_COLLECT_INTERVAL_MS);

      expect(gci.GciTsNbResult).not.toHaveBeenCalled();
      expect(session.isBusy()).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('forgetSession', () => {
  it('stops polling for a logged-out session, and leaves nothing behind for its id', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      forgetSession(session.id);
      const pollsAtLogout = poll.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * LATE_COLLECT_INTERVAL_MS);

      expect(poll.mock.calls.length).toBe(pollsAtLogout);
      expect(() => ensureSessionFree(session)).not.toThrow();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe("onStart's stopRequested", () => {
  it('answers whether a stop has been asked for on the call, from whichever control', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({ result: 0, err: noErr });
      let cancel: (() => void) | undefined;
      let stopRequested: (() => boolean) | undefined;
      const p = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'x',
        {
          suppressNotification: true,
          onStart: (c, requested) => {
            cancel = c;
            stopRequested = requested;
          },
        },
      );
      p.catch(() => {});
      expect(stopRequested!()).toBe(false);

      cancel!();

      expect(stopRequested!()).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('ensureSessionFree', () => {
  // For callers that start a call without runNbCall (Execute It, notebook cells)
  // and must check before their own first GCI call.

  it('does nothing on a session with no call on it', () => {
    const { session, gci } = makeSession([{ result: 0 }]);
    expect(() => ensureSessionFree(session)).not.toThrow();
    expect(gci.GciTsNbPoll).not.toHaveBeenCalled();
  });

  it('throws NbSessionBusyError while the stopped call is still finishing', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      expect(() => ensureSessionFree(session)).toThrow(NbSessionBusyError);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('refuses while another call is still running, and says it is in progress', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      const running = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'done',
        {
          suppressNotification: true,
        },
      );

      expect(() => ensureSessionFree(session)).toThrow(/still in progress/);

      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(running).resolves.toBe('done');
      expect(() => ensureSessionFree(session)).not.toThrow();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('says a call stopped with a soft break is still finishing, while the gem goes on with it', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      (gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({ result: 0, err: noErr });
      let cancel: (() => void) | undefined;
      const running = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'done',
        {
          suppressNotification: true,
          onStart: (c) => {
            cancel = c;
          },
        },
      );
      running.catch(() => {});
      cancel!();

      const next = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'next',
      );

      await expect(next).rejects.toBeInstanceOf(NbSessionBusyError);
      await expect(next).rejects.toThrow(/still finishing/);
      expect(gci.GciTsBreak).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('collects a stopped call whose result is ready, and then lets the caller go ahead', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = makeSession([{ result: 0 }]);
      const poll = gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      await stopRun(session);
      await vi.advanceTimersByTimeAsync(PAST_DRAIN_BUDGET_MS);

      poll.mockReturnValue({ result: 1, err: noErr });
      expect(() => ensureSessionFree(session)).not.toThrow();
      expect(gci.GciTsNbResult).toHaveBeenCalledTimes(1);
      expect(() => ensureSessionFree(session)).not.toThrow();
      expect(gci.GciTsNbResult).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('a hard break while the result is being read', () => {
  // By the time onReady runs, the non-blocking call has been collected, and a
  // Transcript-writing run may have handed the session to a koffi worker
  // thread for GciTsContinueWith. Polling it from the main thread then kills
  // the process outright -- GciTsNbPoll on 3.7.5, GciTsNbResult on 3.6.2, both
  // measured against live stones -- so after a hard break the runner may send
  // the break and nothing else until onReady's work is done.

  // The calls that must never overlap a worker thread's call on the session.
  const MAIN_THREAD_ONLY_CALLS = ['GciTsNbPoll', 'GciTsSocket', 'GciTsNbResult'];
  const gciCallCount = (gci: object, name: string) =>
    (gci as unknown as Record<string, ReturnType<typeof vi.fn>>)[name].mock.calls.length;

  /** A run whose onReady is still working when both cancels land. */
  async function hardBreakDuringOnReady(onAbandonedCollected?: () => void) {
    const { session, gci, handle } = makeSession([{ result: 1 }]);
    let finishOnReady: () => void = () => {};
    let signal: AbortSignal | undefined;
    let cancel: (() => void) | undefined;
    let callsWhenReadBegan: number[] = [];
    const run = runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      (s) => {
        signal = s;
        callsWhenReadBegan = MAIN_THREAD_ONLY_CALLS.map((name) => gciCallCount(gci, name));
        return new Promise<string>((resolve) => {
          finishOnReady = () => resolve('discarded');
        });
      },
      {
        suppressNotification: true,
        onStart: (c) => {
          cancel = c;
        },
        onAbandonedCollected,
      },
    );
    // Claimed now: the hard break rejects inside a timer tick, a turn before
    // `expect(run).rejects` would attach a handler.
    run.catch(() => {});
    cancel!();
    cancel!();
    await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
    return { session, gci, handle, run, finishOnReady, signal: () => signal, callsWhenReadBegan };
  }

  it('touches the session with nothing but the break until the read finishes', async () => {
    vi.useFakeTimers();
    try {
      const { run, finishOnReady, callsWhenReadBegan, gci, handle } =
        await hardBreakDuringOnReady();

      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(MAIN_THREAD_ONLY_CALLS.map((name) => gciCallCount(gci, name))).toEqual(
        callsWhenReadBegan,
      );
      expect(gci.GciTsBreak).toHaveBeenCalledWith(handle, true);
      finishOnReady();
    } finally {
      // Run out, not cleared: the session's hold must lift, or every later
      // test in this file waits on it.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('runs onAbandonedCollected once the read finishes, not before', async () => {
    vi.useFakeTimers();
    try {
      const collected = vi.fn();
      const { run, finishOnReady } = await hardBreakDuringOnReady(collected);
      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
      await vi.advanceTimersByTimeAsync(100);
      expect(collected).not.toHaveBeenCalled();

      finishOnReady();
      await vi.advanceTimersByTimeAsync(0);

      expect(collected).toHaveBeenCalledTimes(1);
    } finally {
      // Run out, not cleared: the session's hold must lift, or every later
      // test in this file waits on it.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('tells the read that its run was abandoned', async () => {
    vi.useFakeTimers();
    try {
      const { signal, finishOnReady } = await hardBreakDuringOnReady();

      expect(signal()?.aborted).toBe(true);
      finishOnReady();
    } finally {
      // Run out, not cleared: the session's hold must lift, or every later
      // test in this file waits on it.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('holds the next call on the session until the read finishes', async () => {
    vi.useFakeTimers();
    try {
      const { session, finishOnReady } = await hardBreakDuringOnReady();
      const start = vi.fn(() => ({ success: true, err: noErr as never }));

      const next = runNbCall(session, start, () => 'next', { suppressNotification: true });
      await vi.advanceTimersByTimeAsync(100);
      const startedWhileReading = start.mock.calls.length;
      finishOnReady();

      await expect(next).resolves.toBe('next');
      expect(startedWhileReading).toBe(0);
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      // Run out, not cleared: the session's hold must lift, or every later
      // test in this file waits on it.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('waits out a worker that is slow to hand the session back, not only a fast one', async () => {
    // A hard-broken GciTsContinueWith normally returns within milliseconds, but
    // a loaded machine has taken seconds. Starting the next call before the
    // worker is done gets it refused by GemStone -- "session has call in
    // progress by another C thread" -- which reads as the run after a stop
    // failing for no reason at all. Seen on a CI runner against the drain's
    // 2s budget, which this wait used to borrow.
    vi.useFakeTimers();
    try {
      const { session, finishOnReady } = await hardBreakDuringOnReady();
      const start = vi.fn(() => ({ success: true, err: noErr as never }));

      const next = runNbCall(session, start, () => 'next', { suppressNotification: true });
      await vi.advanceTimersByTimeAsync(10_000);
      const startedWhileReading = start.mock.calls.length;
      finishOnReady();

      await expect(next).resolves.toBe('next');
      expect(startedWhileReading).toBe(0);
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      // Run out, not cleared: the session's hold must lift, or every later
      // test in this file waits on it.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('stops holding the session for a read that never finishes, and leaves no timer behind', async () => {
    // A worker that never comes back means a session that is gone anyway, and
    // GemStone refuses a new call cleanly while one is still in progress on
    // another thread. So the wait is bounded, rather than a promise that
    // outlives the window.
    vi.useFakeTimers();
    try {
      const { session } = await hardBreakDuringOnReady();
      const start = vi.fn(() => ({ success: true, err: noErr as never }));

      const next = runNbCall(session, start, () => 'next', { suppressNotification: true });
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(next).resolves.toBe('next');
      expect(start).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      // Run out, not cleared: the session's hold must lift, or every later
      // test in this file waits on it.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind once the read finishes', async () => {
    vi.useFakeTimers();
    try {
      const { run, finishOnReady } = await hardBreakDuringOnReady();
      await expect(run).rejects.toBeInstanceOf(NbCancelledError);

      finishOnReady();
      await vi.advanceTimersByTimeAsync(0);

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      // Run out, not cleared: the session's hold must lift, or every later
      // test in this file waits on it.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });
});

describe('a session that goes away mid-call', () => {
  it('settles instead of polling forever', async () => {
    // A logout (or a lost connection) while a call is outstanding used to leave the
    // poll reporting "not ready" for good: the progress notification sat there
    // claiming work was in flight and the awaiting caller never heard back.
    const { session, gci } = makeSession([{ result: 0 }, { result: 0 }]);
    (gci.GciTsCallInProgress as ReturnType<typeof vi.fn>).mockReturnValue({
      result: -1,
      err: { number: 4100, message: 'session not logged in' },
    });

    await expect(
      runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'never',
        { suppressNotification: true },
      ),
    ).rejects.toThrow(/session not logged in/);
  });

  it('settles when the session is logged out while the call is outstanding', async () => {
    const { session } = makeSession([{ result: 0 }]);
    const run = runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 'never',
      { suppressNotification: true },
    );

    session.logout();

    await expect(run).rejects.toThrow('The GemStone session is logged out.');
  });

  it('rejects rather than throws when the session is already logged out', async () => {
    const { session } = makeSession([]);
    session.logout();

    const run = () =>
      runNbCall(
        session,
        () => session.GciTsNbExecute('3 + 4', 0n, 0n, 0n, 0, 0),
        () => 'never',
        { suppressNotification: true },
      );

    await expect(run()).rejects.toThrow('The GemStone session is logged out.');
  });

  it('settles a cancel that arrives after the session was logged out', async () => {
    const { session } = makeSession([{ result: 0 }]);
    let cancel: (() => void) | undefined;
    const run = runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 'never',
      { suppressNotification: true, onStart: (c) => (cancel = c) },
    );
    session.logout();

    cancel!();

    await expect(run).rejects.toThrow('The GemStone session is logged out.');
  });

  it('settles a hard break that goes out after the session was logged out', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession([{ result: 0 }]);
      let cancel: (() => void) | undefined;
      const run = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'never',
        { suppressNotification: true, onStart: (c) => (cancel = c) },
      );
      const outcome = run.then(
        () => 'resolved',
        (e: Error) => e.message,
      );
      cancel!();
      cancel!();
      session.logout();

      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);

      expect(await outcome).toBe('The GemStone session is logged out.');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe('stopping the calls on a session', () => {
  const newSession = () => makeSession([{ result: 0 }]);

  /** A run that never answers on its own, so only a break can settle it. */
  function pendingRun(session: ReturnType<typeof makeSession>['session']) {
    const run = runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 'unreachable',
      { suppressNotification: true },
    );
    // Claimed now: the hard break rejects inside a timer tick.
    run.catch(() => {});
    return run;
  }

  it('sends a soft break, then a hard one once the safe gap has passed', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci, handle } = newSession();
      const run = pendingRun(session);

      void stopCallsOn(session);
      await vi.advanceTimersByTimeAsync(BEFORE_HARD_BREAK_GAP_MS);
      const breaksBeforeGap = gci.GciTsBreak.mock.calls.map(([, hard]) => hard);
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS - BEFORE_HARD_BREAK_GAP_MS);

      expect(breaksBeforeGap).toEqual([false]);
      expect(gci.GciTsBreak.mock.calls.map(([h, hard]) => [h === handle, hard])).toEqual([
        [true, false],
        [true, true],
      ]);
      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('resolves only once the stopped call has been collected', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = newSession();
      void pendingRun(session);
      let stopped = false;

      void stopCallsOn(session).then(() => (stopped = true));
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      const stoppedBeforeCollection = stopped;
      gci.GciTsNbPoll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(500);

      expect(stoppedBeforeCollection).toBe(false);
      expect(gci.GciTsNbResult).toHaveBeenCalled();
      expect(stopped).toBe(true);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('sends no hard break to a run the soft break settles', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = newSession();
      const run = pendingRun(session);
      gci.GciTsBreak.mockImplementationOnce(() => {
        gci.GciTsNbPoll.mockReturnValue({ result: 1, err: noErr });
        return { result: 0, err: noErr };
      });

      const stop = stopCallsOn(session);
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await stop;

      expect(gci.GciTsBreak.mock.calls.map(([, hard]) => hard)).toEqual([false]);
      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('reports a run whose answer is an error as cancelled', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = newSession();
      const run = runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => {
          throw new Error('a Break occurred (error 6003), A soft break was received.');
        },
        { suppressNotification: true },
      );
      run.catch(() => {});
      gci.GciTsBreak.mockImplementationOnce(() => {
        gci.GciTsNbPoll.mockReturnValue({ result: 1, err: noErr });
        return { result: 0, err: noErr };
      });

      const stop = stopCallsOn(session);
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await stop;

      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  /** A run whose answer to the soft break is a Break error carrying a live process. */
  function runAnsweringBreak(
    session: ReturnType<typeof makeSession>['session'],
    gci: ReturnType<typeof makeSession>['gci'],
    disposableProcess: boolean,
  ) {
    const run = runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () =>
        Promise.reject(
          Object.assign(new Error('a Break occurred (error 6003)'), { context: 0x4242n }),
        ),
      { suppressNotification: true, disposableProcess },
    );
    run.catch(() => {});
    gci.GciTsBreak.mockImplementationOnce(() => {
      gci.GciTsNbPoll.mockReturnValue({ result: 1, err: noErr });
      return { result: 0, err: noErr };
    });
    return run;
  }

  it('clears the process a disposable run was suspended in by the soft break', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci, handle } = newSession();
      void runAnsweringBreak(session, gci, true);

      const stop = stopCallsOn(session);
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await stop;

      expect(gci.GciTsClearStack).toHaveBeenCalledWith(handle, 0x4242n);
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('leaves the process alone when the run did not declare it disposable', async () => {
    vi.useFakeTimers();
    try {
      const { session, gci } = newSession();
      void runAnsweringBreak(session, gci, false);

      const stop = stopCallsOn(session);
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      await stop;

      expect(gci.GciTsClearStack).not.toHaveBeenCalled();
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('leaves the runs on other sessions alone', async () => {
    vi.useFakeTimers();
    try {
      const { session } = newSession();
      const other = newSession();
      void pendingRun(session);
      const otherRun = pendingRun(other.session);

      void stopCallsOn(session);
      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      other.gci.GciTsNbPoll.mockReturnValue({ result: 1, err: noErr });
      // Past the longest poll interval, so its next poll finds the result.
      await vi.advanceTimersByTimeAsync(1000);

      expect(other.gci.GciTsBreak).not.toHaveBeenCalled();
      await expect(otherRun).resolves.toBe('unreachable');
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
    }
  });

  it('resolves at once on a session with no calls running', async () => {
    const { session, gci } = newSession();

    await stopCallsOn(session);

    expect(gci.GciTsBreak).not.toHaveBeenCalled();
  });
});
