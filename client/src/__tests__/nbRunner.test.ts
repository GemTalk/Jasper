import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { runNbCall, pollNbResultReady, NbCancelledError } from '../nbRunner';
import { ActiveSession } from '../sessionManager';

const noErr = { number: 0 } as const;

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
      // Advance past PROGRESS_THRESHOLD_MS (2000) so the progress block runs and
      // registers the cancellation handler.
      await vi.advanceTimersByTimeAsync(3000);
      expect(cancelHandler).toBeTypeOf('function');

      cancelHandler!(); // first cancel → soft break + acknowledgement
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, false);
      expect(reportSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/break/i) }),
      );

      cancelHandler!(); // second cancel → hard break + reject
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, true);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

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

      expect(cancel).toBeTypeOf('function');

      cancel!(); // first → soft break
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, false);

      cancel!(); // second → hard break + reject
      expect(session.gci.GciTsBreak).toHaveBeenCalledWith(session.handle, true);
      await expect(p).rejects.toBeInstanceOf(NbCancelledError);

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
