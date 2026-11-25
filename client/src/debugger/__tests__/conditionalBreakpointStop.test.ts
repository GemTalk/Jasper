import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', async (orig) => ({
  ...(await orig()),
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

import * as vscode from 'vscode';
import {
  EARLIEST_STOP_WAITING_MS,
  NOTICE_GRACE_MS,
  NbCancelledError,
  STOP_WAITING_AFTER_MS,
  runNbCall,
  setStillRunningHandler,
  stopCallsOn,
  stoppedRunHolds,
  whenSessionFree,
} from '../../nbRunner';
import {
  DECISION,
  applyBreakpointRules,
  type BreakpointRule,
  type RuleRunOptions,
} from '../conditionalBreakpoints';
import { OOP_NIL } from '../../gciConstants';
import { fakeActiveSession } from '../../__tests__/fakeActiveSession';

const noErr = { number: 0 } as const;
const PROCESS = 5000n;
const DECIDER = 7000n;

/** Past any stop-waiting delay, however long the call has run. */
const PAST_STOP_WAITING_MS = Math.max(EARLIEST_STOP_WAITING_MS, STOP_WAITING_AFTER_MS);

type Answer = { result: bigint; err: { number: number; context?: bigint; message?: string } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let nextSessionId = 50_000;

/**
 * A session halted at a breakpoint, whose worker calls (the decider's perform and
 * the resume) each wait until the test answers them.
 */
function haltedSession() {
  const resumes: Array<ReturnType<typeof deferred<Answer>>> = [];
  const judgements: Array<ReturnType<typeof deferred<Answer>>> = [];
  let decision: number = DECISION.Go;
  const gci = {
    isAvailable: () => false,
    GciTsBreak: vi.fn((_handle: unknown, _hard: boolean) => ({ result: 0, err: noErr })),
    GciTsExecute: vi.fn(() => ({ result: DECIDER, err: noErr })),
    GciTsPerformAsync: vi.fn(() => {
      const d = deferred<Answer>();
      judgements.push(d);
      return d.promise;
    }),
    GciTsContinueWithAsync: vi.fn(() => {
      const d = deferred<Answer>();
      resumes.push(d);
      return d.promise;
    }),
    // The decider's answer: decision, message, rule; oopToInteger reads them back as is.
    GciTsFetchOops: vi.fn(() => ({ oops: [BigInt(decision), OOP_NIL, 1n], err: noErr })),
    GciTsFetchChars: vi.fn(() => ({ data: 'logged', err: noErr })),
    oopToInteger: (_h: unknown, oop: bigint) => oop,
    utf8ClassOop: () => 1n,
    GciTsClearStackAsync: vi.fn(async () => ({ success: true, err: noErr })),
    GciTsReleaseObjs: vi.fn(() => ({ success: true, err: noErr })),
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: noErr })),
    logout: vi.fn(() => ({ sessionFreed: true })),
  };
  const session = fakeActiveSession({ id: nextSessionId++, handle: { h: 1 }, gci });
  return {
    session,
    gci,
    resumes,
    judgements,
    decide: (d: number) => (decision = d),
    softBreaks: () => gci.GciTsBreak.mock.calls.length,
  };
}

/** Run the rules on `session` with a captured Cancel and `stopRequested`. */
function skip(
  session: ReturnType<typeof haltedSession>['session'],
  options: RuleRunOptions & { rules?: BreakpointRule[] } = {},
) {
  let cancel: (() => void) | undefined;
  let stopRequested: (() => boolean) | undefined;
  const { rules = [], ...rest } = options;
  const outcome = applyBreakpointRules(session, PROCESS, rules, {
    suppressNotification: true,
    onStart: (c, s) => {
      cancel = c;
      stopRequested = s;
    },
    ...rest,
  });
  outcome.catch(() => {});
  return { outcome, cancel: () => cancel!(), stopRequested: () => stopRequested!() };
}

/** Settles `p` into a label without throwing, to check it has not settled yet. */
function watch(p: Promise<unknown>) {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending';
  p.then(
    () => (state = 'resolved'),
    () => (state = 'rejected'),
  );
  return () => state;
}

describe('stopping a run that skips conditional breakpoints', () => {
  const told = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    told.mockReset();
    setStillRunningHandler(told);
  });

  afterEach(() => {
    setStillRunningHandler(undefined);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('sends one soft break at the first press, and gives up only once the wait is over', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });
    const state = watch(outcome);

    cancel();
    expect(h.gci.GciTsBreak).toHaveBeenCalledWith(expect.anything(), false);
    expect(h.softBreaks()).toBe(1);
    // A press at the start waits out the call's early window, not just STOP_WAITING_AFTER_MS.
    await vi.advanceTimersByTimeAsync(EARLIEST_STOP_WAITING_MS - 100);
    expect(state()).toBe('pending');

    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS);

    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);
    // Sent again as it gives up, for a break that reached the gem too early.
    expect(h.softBreaks()).toBe(2);
    expect(h.gci.GciTsBreak.mock.calls.every(([, hard]) => hard === false)).toBe(true);
  });

  it('says the stopped run is still running, once, after the grace period', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });

    cancel();
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS);
    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);
    expect(told).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NOTICE_GRACE_MS);

    expect(told).toHaveBeenCalledTimes(1);
    expect(told).toHaveBeenCalledWith(h.session);
  });

  it('stops waiting at once at a second press, and says so after the grace period', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });

    cancel();
    cancel();

    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);
    expect(h.softBreaks()).toBe(2);
    await vi.advanceTimersByTimeAsync(NOTICE_GRACE_MS);
    expect(told).toHaveBeenCalledTimes(1);
    // The first press's timer is gone: nothing more is sent or said.
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS);
    expect(h.softBreaks()).toBe(2);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('keeps the answer the gem gave the soft break, rather than stopping waiting', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });
    cancel();
    await vi.advanceTimersByTimeAsync(100);

    h.resumes[0].resolve({ result: OOP_NIL, err: { number: 6003, context: 9000n } });
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS + NOTICE_GRACE_MS);

    await expect(outcome).resolves.toMatchObject({ kind: 'raised', errorNumber: 6003 });
    expect(h.softBreaks()).toBe(1);
    expect(told).not.toHaveBeenCalled();
  });

  it('says nothing when the given-up call lets go within the grace period', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });
    cancel();
    cancel();
    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);

    h.resumes[0].resolve({ result: OOP_NIL, err: { number: 6003, context: 9000n } });
    await vi.advanceTimersByTimeAsync(NOTICE_GRACE_MS);

    expect(told).not.toHaveBeenCalled();
  });

  it('makes the next call wait for the given-up call, rather than be refused', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });
    cancel();
    cancel();
    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);
    const start = vi.fn(() => 'started');

    const next = whenSessionFree(h.session, start);

    expect(start).not.toHaveBeenCalled();
    h.resumes[0].resolve({ result: 1n, err: noErr });
    await expect(next).resolves.toBe('started');
    expect(stoppedRunHolds(h.session)).toBe(false);
  });

  it('does nothing at a press after the run has ended', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });
    h.resumes[0].resolve({ result: 1n, err: noErr });
    await expect(outcome).resolves.toMatchObject({ kind: 'completed' });

    expect(() => cancel()).not.toThrow();
    cancel();
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS + NOTICE_GRACE_MS);

    expect(h.softBreaks()).toBe(0);
    expect(told).not.toHaveBeenCalled();
  });

  it('still gives up after the wait when the soft break cannot be sent', async () => {
    const h = haltedSession();
    h.gci.GciTsBreak.mockImplementationOnce(() => {
      throw new Error('no break');
    });
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });

    cancel();
    const state = watch(outcome);
    await vi.advanceTimersByTimeAsync(0);
    expect(state()).toBe('pending');
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS);

    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);
  });

  it('lets a logout stop waiting at once, without the notice', async () => {
    const h = haltedSession();
    const { outcome } = skip(h.session, { resumeFirst: true });

    const stopping = stopCallsOn(h.session);

    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);
    expect(h.gci.GciTsBreak.mock.calls.every(([, hard]) => hard === false)).toBe(true);
    expect(stoppedRunHolds(h.session)).toBe(true);
    h.resumes[0].resolve({ result: 1n, err: noErr });
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS + NOTICE_GRACE_MS);
    expect(told).not.toHaveBeenCalled();
  });

  it('lets a logout after the first press stop waiting at once, without the notice', async () => {
    const h = haltedSession();
    const { outcome, cancel } = skip(h.session, { resumeFirst: true });
    cancel();

    void stopCallsOn(h.session);

    await expect(outcome).rejects.toBeInstanceOf(NbCancelledError);
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS + NOTICE_GRACE_MS);
    expect(told).not.toHaveBeenCalled();
  });

  it("hands its Cancel to the run it is part of, as Execute It's is", async () => {
    const h = haltedSession();
    let polls = 0;
    Object.assign(h.gci, {
      isAvailable: (name: string) => name === 'GciTsNbPoll',
      GciTsNbPoll: vi.fn(() => ({ result: polls++ === 0 ? 1 : 0, err: noErr })),
      GciTsNbResult: vi.fn(() => ({ result: 0n, err: noErr })),
      GciTsSocket: vi.fn(() => ({ fd: 3, err: noErr })),
    });
    let cancelRules: (() => void) | undefined;
    const run = runNbCall(
      h.session,
      () => ({ success: true, err: noErr as never }),
      (signal) =>
        applyBreakpointRules(h.session, PROCESS, [], {
          signal,
          resumeFirst: true,
          suppressNotification: true,
          onStart: (c) => (cancelRules = c),
        }),
      { suppressNotification: true },
    );
    run.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(h.resumes).toHaveLength(1);

    cancelRules!();

    // Only the enclosing run's stop shows "Stopping…".
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('Stopping…'),
      expect.anything(),
    );
    expect(h.softBreaks()).toBe(1);
    await vi.advanceTimersByTimeAsync(PAST_STOP_WAITING_MS);
    await expect(run).rejects.toBeInstanceOf(NbCancelledError);
  });
});
