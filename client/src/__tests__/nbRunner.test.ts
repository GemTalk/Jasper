import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { runNbCall, pollNbResultReady, NbCancelledError, MIN_HARD_BREAK_GAP_MS } from '../nbRunner';
import { ActiveSession } from '../sessionManager';

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

/**
 * Fake session whose gci returns a scripted sequence of poll results. Each
 * pollNbResultReady consumes the next entry (1 = ready, 0 = pending, -1 = error).
 */
function makeSession(pollResults: { result: number; err?: unknown }[]): ActiveSession {
  let i = 0;
  const gci = {
    isAvailable: (name: string) => name === 'GciTsNbPoll',
    GciTsNbPoll: vi.fn(() => {
      const r = pollResults[Math.min(i, pollResults.length - 1)];
      i++;
      return { result: r.result, err: r.err ?? noErr };
    }),
    GciTsBreak: vi.fn(() => ({ result: 0, err: noErr })),
    GciTsSocket: vi.fn(() => ({ fd: 3, err: noErr })),
    // 0 = the session is there and idle-ish; -1 would mean it has gone away, which
    // the poll treats as "nobody is coming to answer this call".
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: noErr })),
    GciTsNbResult: vi.fn(() => ({ result: 0, err: noErr })),
    GciTsClearStack: vi.fn(() => ({ success: true, err: noErr })),
  };
  return { id: 1, handle: { h: 1 }, gci } as unknown as ActiveSession;
}

describe('runNbCall', () => {
  it('rejects if the start call fails (no polling)', async () => {
    const session = makeSession([{ result: 1 }]);
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
    const session = makeSession([{ result: 1 }]); // ready on first poll
    const result = await runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 'the-result',
    );
    expect(result).toBe('the-result');
  });

  it('rejects when polling reports an error (-1)', async () => {
    const session = makeSession([{ result: -1, err: { number: 7, message: 'pollbad' } }]);
    await expect(
      runNbCall(
        session,
        () => ({ success: true, err: noErr as never }),
        () => 'unused',
      ),
    ).rejects.toThrow('pollbad');
  });

  it('keeps polling while pending, then resolves when ready', async () => {
    const session = makeSession([{ result: 0 }, { result: 0 }, { result: 1 }]);
    const result = await runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      () => 42,
    );
    expect(result).toBe(42);
    expect(session.gci.GciTsNbPoll).toHaveBeenCalledTimes(3);
  });

  it('propagates an error thrown by onReady (e.g. a fetch failure)', async () => {
    const session = makeSession([{ result: 1 }]);
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
    const session = makeSession([{ result: 1 }]);
    expect(pollNbResultReady(session).result).toBe(1);
    expect(session.gci.GciTsNbPoll).toHaveBeenCalled();
  });

  it('falls back to the session socket when GciTsNbPoll is unavailable', () => {
    const gci = {
      isAvailable: () => false, // GciTsNbPoll absent (pre-3.7)
      GciTsSocket: vi.fn(() => ({ fd: -1, err: { number: 0 } })), // bad fd → -1
    };
    const session = { id: 1, handle: { h: 1 }, gci } as unknown as ActiveSession;
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
      const session = makeSession([{ result: 0 }]); // always pending → loop keeps polling
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
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, false);
      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/break/i) }),
      );

      cancelHandler!(); // second cancel → hard break, once the safety gap has passed

      // The withholding itself, not just its eventual effect: a hard break sent
      // on the heels of the soft one faults the client process, and an assertion
      // that only looks *past* the gap passes just as happily if the deferral is
      // dropped and the break goes out at once.
      await vi.advanceTimersByTimeAsync(BEFORE_HARD_BREAK_GAP_MS);
      expect(session.gci.GciTsBreak).not.toHaveBeenCalledWith(session.handle, true);

      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, true);
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
      const session = makeSession([{ result: 0 }]); // always pending → never settles on its own
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
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, false);

      cancel!(); // second → hard break, sent once the safety gap has passed

      // Withheld until the gap has elapsed — checked on this path too, because
      // the external canceller is wired separately from the notification's.
      await vi.advanceTimersByTimeAsync(BEFORE_HARD_BREAK_GAP_MS);
      expect(session.gci.GciTsBreak).not.toHaveBeenCalledWith(session.handle, true);

      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, true);
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
      const session = makeSession([{ result: 0 }]); // always pending → never settles on its own
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
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, false);

      // An NTP step or a resumed VM: the wall clock lurches a minute ahead while
      // no real time passes at all. setSystemTime moves the faked Date and
      // leaves performance.now where it was, which is precisely that shape.
      vi.setSystemTime(Date.now() + 60_000);

      cancel!(); // second → hard break, still owed the full gap of *real* time

      await vi.advanceTimersByTimeAsync(BEFORE_HARD_BREAK_GAP_MS);
      expect(session.gci.GciTsBreak).not.toHaveBeenCalledWith(session.handle, true);

      await vi.advanceTimersByTimeAsync(PAST_HARD_BREAK_GAP_MS);
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, true);
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
      const session = makeSession([{ result: 0 }]); // pending forever
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
      const session = makeSession([{ result: 0 }]);
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
      const session = makeSession([{ result: 1 }]);
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
      const session = makeSession([{ result: 1 }]);
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
      const session = makeSession([{ result: 0 }]);
      const poll = session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
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
      expect(session.gci.GciTsNbResult).not.toHaveBeenCalled();

      // The drain polls in the background until the abandoned result is ready.
      poll.mockReturnValue({ result: 1, err: noErr });
      await vi.advanceTimersByTimeAsync(500);
      expect(session.gci.GciTsNbResult).toHaveBeenCalled();
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
      const session = makeSession([{ result: 0 }]);
      const poll = session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      (session.gci.GciTsNbResult as ReturnType<typeof vi.fn>).mockReturnValue({
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

      expect(session.gci.GciTsClearStack).toHaveBeenCalledWith(session.handle, 0x4242n);
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
      const session = makeSession([{ result: 0 }]);
      const poll = session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      (session.gci.GciTsNbResult as ReturnType<typeof vi.fn>).mockReturnValue({
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
      expect(session.gci.GciTsNbResult).toHaveBeenCalled();
      expect(session.gci.GciTsClearStack).not.toHaveBeenCalled();
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
      const session = makeSession([{ result: 0 }]);
      const poll = session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>;
      poll.mockReturnValue({ result: 0, err: noErr });
      const collected = vi.fn(() => {
        expect(session.gci.GciTsNbResult).toHaveBeenCalled();
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

  it('does not run onAbandonedCollected when draining gives up', async () => {
    // The session is still busy (or gone): an end call there would only be refused.
    vi.useFakeTimers();
    try {
      const session = makeSession([{ result: 0 }]);
      (session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({
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

  it('gives up draining a session that never answers', async () => {
    // Better a bounded background poll than one that outlives the window.
    vi.useFakeTimers();
    try {
      const session = makeSession([{ result: 0 }]);
      (session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mockReturnValue({
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

      await vi.advanceTimersByTimeAsync(60_000);

      expect(session.gci.GciTsNbResult).not.toHaveBeenCalled();
      const pollsAfterGivingUp = (session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mock.calls
        .length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect((session.gci.GciTsNbPoll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        pollsAfterGivingUp,
      );
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
  const gciCallCount = (session: ActiveSession, name: string) =>
    (session.gci as unknown as Record<string, ReturnType<typeof vi.fn>>)[name].mock.calls.length;

  /** A run whose onReady is still working when both cancels land. */
  async function hardBreakDuringOnReady(onAbandonedCollected?: () => void) {
    const session = makeSession([{ result: 1 }]);
    let finishOnReady: () => void = () => {};
    let signal: AbortSignal | undefined;
    let cancel: (() => void) | undefined;
    let callsWhenReadBegan: number[] = [];
    const run = runNbCall(
      session,
      () => ({ success: true, err: noErr as never }),
      (s) => {
        signal = s;
        callsWhenReadBegan = MAIN_THREAD_ONLY_CALLS.map((name) => gciCallCount(session, name));
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
    return { session, run, finishOnReady, signal: () => signal, callsWhenReadBegan };
  }

  it('touches the session with nothing but the break until the read finishes', async () => {
    vi.useFakeTimers();
    try {
      const { session, run, finishOnReady, callsWhenReadBegan } = await hardBreakDuringOnReady();

      await expect(run).rejects.toBeInstanceOf(NbCancelledError);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(MAIN_THREAD_ONLY_CALLS.map((name) => gciCallCount(session, name))).toEqual(
        callsWhenReadBegan,
      );
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, true);
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
    const session = makeSession([{ result: 0 }, { result: 0 }]);
    (session.gci.GciTsCallInProgress as ReturnType<typeof vi.fn>).mockReturnValue({
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
});
