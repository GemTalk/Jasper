// End-to-end tests for the Jade-style Transcript sink against a live stone:
// real class compilation, kernel `Transcript` writes reaching the sink,
// buffered drains, and live forwarding (2336 -> settleNbResult -> ContinueWith).
// Mocked-boundary coverage of the same module is in transcriptSink.test.ts;
// only what needs a real gem belongs here.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// An install failure is routed to gciLog, whose output channel here is the
// vscode mock's discarding `appendLine`. Console logging keeps failures
// diagnosable -- the install runs in `beforeEach` for every test below.
vi.mock('../gciLog', async (orig) => ({
  ...(await orig()),
  logError: vi.fn((...args: unknown[]) => console.error(...args)),
}));

import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';
import { GciLibrary } from '../gciLibrary';
import type { ActiveSession } from '../sessionManager';
import {
  installTranscriptSink,
  setTranscriptLive,
  drainTranscript,
  settleNbResult,
} from '../transcriptSink';
import { runNbCall, NbCancelledError } from '../nbRunner';
import { expectEventLoopToRemainResponsiveDuring } from './support/timers';
import { OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL } from '../gciConstants';

describe('transcript sink (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  /**
   * A real `ActiveSession` around the live `gci`/`handle`, rebuilt per call --
   * so it always carries the current handle, and a real `login`/`stoneVersion`
   * for any version-gated path the sink reaches.
   */
  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => gci.executeAndFetchString(handle, code);

  /**
   * The UTF-8 contents of `oop`, failing rather than silently handing back a
   * partial answer. A string too long for the buffer comes back truncated with
   * no error at all, so completeness is checked separately: `requiredSize`
   * counts the terminator, so a complete result fits in `BUFFER_BYTES`.
   */
  const fetchString = (oop: bigint): string => {
    const BUFFER_BYTES = 256;
    const { requiredSize, data, err } = gci.GciTsFetchUtf8(handle, oop, BUFFER_BYTES);
    expect(err.number).toBe(0);
    expect(requiredSize).toBeLessThanOrEqual(BigInt(BUFFER_BYTES));
    return data;
  };

  // The harness clears SessionTemps after every test, and the sink is
  // registered only there -- so it is installed per test, exactly as
  // sessionManager does per login, rather than once for the file.
  beforeEach(() => {
    expect(installTranscriptSink(session())).toBe(true);
  });

  // Counterpart to installing per test: the harness's teardown doits run on the
  // blocking execute path before it clears SessionTemps, and a live forwarder
  // send there has no continuable context (see transcriptSink.ts's module doc).
  afterEach(() => {
    setTranscriptLive(session(), false);
  });

  /**
   * Run `code` the way Execute It does: started non-blocking and settled
   * through the shared nb poll loop, with transcript forwarder sends (2336)
   * displayed as they arrive. The progress notification is suppressed --
   * there is no user here to offer a Cancel to.
   */
  function executeLive(code: string, onTranscript: (text: string) => void) {
    return runNbCall(
      session(),
      () => gci.GciTsNbExecute(handle, code, OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL, 0, 0),
      (signal) => settleNbResult(session(), onTranscript, signal),
      { suppressNotification: true },
    );
  }

  it('reinstalling into a session that already has a sink keeps the buffered output', () => {
    exec("Transcript nextPutAll: 'kept across reinstall'. 'ok'");

    expect(installTranscriptSink(session())).toBe(true);

    expect(drainTranscript(session())).toContain('kept across reinstall');
  });

  /**
   * Leave the session in the state a suspended Transcript writer leaves behind:
   * the per-session semaphore `TranscriptStreamPortable` takes around every
   * write is held and never signalled. From here every write in the session
   * raises 2366 rather than printing.
   */
  function poisonTranscriptMutex(): void {
    expect(
      exec(
        `| tmps |
tmps := SessionTemps current.
((tmps at: #TranscriptStream_SessionMutex otherwise: nil)
  ifNil: [tmps at: #TranscriptStream_SessionMutex put: Semaphore forMutualExclusion]) wait.
'held'`,
      ),
    ).toBe('held');
    expect(() => exec("Transcript nextPutAll: 'poisoned'. 'ok'")).toThrow(
      /rtErrSchedulerDeadlocked/,
    );
  }

  it('switching to live mode frees a Transcript mutex left held', () => {
    // The live switch-on is what every interactive execute runs first, so it is
    // the repair production actually reaches. Installing does NOT do this: at
    // login the key does not exist yet, which is why the reset is not there.
    poisonTranscriptMutex();

    // Switch live on (the repair) and straight back off: a blocking exec must
    // not run while live, since a forwarder send there has no continuable
    // context. What is under test is the mutex, not the mode.
    setTranscriptLive(session(), true);
    setTranscriptLive(session(), false);

    expect(exec("Transcript nextPutAll: 'recovered'. 'ok'")).toBe('ok');
    expect(drainTranscript(session())).toContain('recovered');
  });

  it('installing does not touch the mutex, because at login there is none to touch', () => {
    // Guards the rationale in setLiveCode's comment: if someone moves the reset
    // back into the install doit, it is dead code again and this goes red.
    poisonTranscriptMutex();

    expect(installTranscriptSink(session())).toBe(true);

    expect(() => exec("Transcript nextPutAll: 'still poisoned'. 'ok'")).toThrow(
      /rtErrSchedulerDeadlocked/,
    );
    setTranscriptLive(session(), true);
    setTranscriptLive(session(), false);
    expect(exec("Transcript nextPutAll: 'now fine'. 'ok'")).toBe('ok');
  });

  it('a throw inside the settle loop leaves later Transcript writes working', async () => {
    // The process being resumed is suspended inside TranscriptStreamPortable's
    // critical: block, holding the semaphore. Before settleNbResult cleared it,
    // a throw here killed the session's Transcript for good -- the shape of the
    // original #646 report.
    setTranscriptLive(session(), true);

    await expect(
      runNbCall(
        session(),
        () =>
          gci.GciTsNbExecute(
            handle,
            "Transcript nextPutAll: 'before the throw'. 'done'",
            OOP_CLASS_STRING,
            OOP_ILLEGAL,
            OOP_NIL,
            0,
            0,
          ),
        () =>
          settleNbResult(session(), () => {
            throw new Error('display blew up');
          }),
        { suppressNotification: true },
      ),
    ).rejects.toThrow('display blew up');

    setTranscriptLive(session(), false);
    expect(exec("Transcript nextPutAll: 'after the throw'. 'ok'")).toBe('ok');
    expect(drainTranscript(session())).toContain('after the throw');
  });

  it('resumes without blocking the extension host, so Cancel stays deliverable', async () => {
    // The end-to-end guard on #646, asserted by behaviour rather than by
    // inspecting the binding: run a live execute that writes, waits a second
    // inside the gem, then writes again, and require that the event loop kept
    // running throughout. It cannot, if the resume happened on the main thread
    // -- and a blocked main thread is a window that ignores the Cancel button
    // on the progress notification, because nothing can deliver the
    // GciTsBreak. `gci` here is the factory-built, production-wrapped library,
    // so this goes red for ANY future change that pushes resumes back onto the
    // main thread, not only for the proxy that did it the first time.
    //
    // Same 1s delay and 800ms floor as gciLibrary.test.ts's two responsiveness
    // tests: 20% headroom over a whole second, measured as elapsed time between
    // samples rather than a count of them, so a loaded machine still passes.
    setTranscriptLive(session(), true);
    const chunks: string[] = [];

    await expectEventLoopToRemainResponsiveDuring(100, 800, async () => {
      const { err } = await executeLive(
        "Transcript nextPutAll: 'before'. (Delay forSeconds: 1) wait. " +
          "Transcript nextPutAll: 'after'. 42",
        (text) => chunks.push(text),
      );
      expect(err.number).toBe(0);
    });

    expect(chunks).toEqual(['before', 'after']);
  });

  it('a hard break while output streams leaves the session and its Transcript usable', async () => {
    // Cancel pressed twice while the Transcript streams: the second press lands
    // while a koffi worker thread owns the session for GciTsContinueWith.
    // Polling the session from the main thread then kills the extension host
    // (measured on 3.6.2 and 3.7.5), and a process stopped holding the
    // Transcript semaphore fails every later write until it is cleared.
    //
    // Built so the hard break always lands in that worst place. The run first
    // writes, which puts it on the worker, and then holds the semaphore in a
    // loop of short waits. The soft break is resumed by a handler around both,
    // so the run is still inside when the hard break arrives: soft-break
    // delivery varies by an order of magnitude, and a run that stops at the
    // soft break never reaches the path under test. Short waits rather than
    // one long one, because on 3.6.2 resuming the break cuts a single Delay
    // short. Bounded, so a break that never arrives cannot hang the file.
    setTranscriptLive(session(), true);
    let wroteOnce: () => void = () => {};
    const onWorker = new Promise<void>((resolve) => {
      wroteOnce = resolve;
    });
    let cancel: (() => void) | undefined;
    const run = runNbCall(
      session(),
      () =>
        gci.GciTsNbExecute(
          handle,
          "[Transcript nextPutAll: 'streaming'. " +
            '(SessionTemps current at: #TranscriptStream_SessionMutex) ' +
            'critical: [200 timesRepeat: [(Delay forMilliseconds: 50) wait]]] ' +
            'on: Break do: [:e | e resume]. 42',
          OOP_CLASS_STRING,
          OOP_ILLEGAL,
          OOP_NIL,
          0,
          0,
        ),
      (signal) => settleNbResult(session(), () => wroteOnce(), signal),
      {
        suppressNotification: true,
        onStart: (c) => {
          cancel = c;
        },
      },
    );
    // Claimed now: it rejects inside a timer tick, before `expect` attaches.
    run.catch(() => {});
    try {
      await onWorker;
      cancel!();
      cancel!();

      await expect(run).rejects.toBeInstanceOf(NbCancelledError);

      // Live stays on: switching it on repairs a held semaphore by itself, and
      // would pass this with the break's process left uncleared.
      const chunks: string[] = [];
      const { result, err } = await executeLive("Transcript nextPutAll: 'after'. 6 * 7", (text) =>
        chunks.push(text),
      );
      expect(err.number).toBe(0);
      expect(chunks).toEqual(['after']);
      expect(gci.oopToInteger(handle, result)).toBe(42n);
    } finally {
      // Whatever failed above, nothing may still be running into the next
      // test: stop the run, and wait until the session is free again (a new
      // call waits for exactly that).
      cancel?.();
      cancel?.();
      await run.catch(() => {});
      await executeLive('nil', () => {}).catch(() => {});
    }
    // Far past the 5s default, because the worst case here is slow rather than
    // broken: the run's handler resumes the hard break, so the gem can carry on
    // to the end of its wait loop, and the worker's GciTsContinueWith only
    // returns then. The follow-up write waits for that worker by design. A
    // quiet machine settles the break in ~25ms and finishes the whole test in
    // ~325ms; a loaded CI runner has taken the full loop, which the default
    // killed mid-wait and left the session busy for the rest of the file.
  }, 30_000);

  it('a live write with no worker thread fails loudly and strands nothing', async () => {
    // Losing koffi's `.async` must be an error the user sees, not a window
    // that silently freezes. And the error
    // must not cost the session its Transcript: the write fails while the
    // process sits inside the critical: block, so settleNbResult has to clear
    // it. Live stays on across both writes, because switching it on is a
    // repair of its own and would hide a stranded semaphore.
    const bindings = gci as unknown as Record<string, unknown>;
    const realBinding = bindings._GciTsContinueWith as (...args: unknown[]) => unknown;
    setTranscriptLive(session(), true);

    bindings._GciTsContinueWith = (...args: unknown[]) => realBinding(...args);
    try {
      await expect(executeLive("Transcript nextPutAll: 'lost'. 6 * 7", () => {})).rejects.toThrow(
        TypeError,
      );
    } finally {
      bindings._GciTsContinueWith = realBinding;
    }

    const chunks: string[] = [];
    const { result, err } = await executeLive("Transcript nextPutAll: 'after'. 6 * 7", (text) =>
      chunks.push(text),
    );
    expect(err.number).toBe(0);
    expect(chunks).toEqual(['after']);
    expect(gci.oopToInteger(handle, result)).toBe(42n);
  });

  it('captures kernel Transcript writes and drains them in buffered mode', () => {
    const result = exec("Transcript nextPutAll: 'buffered hello'; tab: 1. 'ok'");

    expect(result).toBe('ok');
    expect(drainTranscript(session())).toContain('buffered hello');
    expect(drainTranscript(session())).toBe('');
  });

  it('suppresses the gem-log echo: show:/flush do not error against the sink', () => {
    // show: routes through nextPutAll: + endEntry (contents/reset + gciLogServer).
    // exec() throws on a server-side error, so "does not error" is implicit here.
    const result = exec("Transcript show: 'shown'; flush. 'ok'");

    expect(result).toBe('ok');
    expect(drainTranscript(session())).toContain("'shown'");
  });

  it('round-trips non-ASCII transcript output through the UTF-8 drain', () => {
    // Emitted Smalltalk must stay ASCII for the 3.6.x compiler -- the
    // non-ASCII character is built at runtime via codePoint:, never literal.
    exec("Transcript nextPutAll: 'caf', (Character codePoint: 233) asString. 'ok'");

    expect(drainTranscript(session())).toContain('café');
  });

  it('switching to live mode returns any buffered residue', () => {
    exec("Transcript nextPutAll: 'residue'. 'ok'");

    const residue = setTranscriptLive(session(), true);

    expect(residue).toContain('residue');
  });

  it('streams writes mid-execution in live mode and settles to the real result', async () => {
    setTranscriptLive(session(), true);
    const chunks: string[] = [];

    const { result, err } = await executeLive(
      "Transcript nextPutAll: 'first'. Transcript nextPutAll: 'second'. 6 * 7",
      (text) => chunks.push(text),
    );

    expect(err.number).toBe(0);
    expect(chunks).toEqual(['first', 'second']);
    expect(gci.oopToInteger(handle, result)).toBe(42n);
  });

  it('live forwarding bypasses user exception handlers', async () => {
    setTranscriptLive(session(), true);
    const chunks: string[] = [];

    const { result, err } = await executeLive(
      "[Transcript nextPutAll: 'inside handler'. 'no error'] on: AbstractException do: [:e | 'trapped']",
      (text) => chunks.push(text),
    );

    expect(err.number).toBe(0);
    expect(chunks).toEqual(['inside handler']);
    // The handler did NOT fire -- the block completed normally.
    expect(fetchString(result)).toBe('no error');
  });

  it('passes real errors through the settle loop and leaves the session usable', async () => {
    setTranscriptLive(session(), true);
    const chunks: string[] = [];

    const { err } = await executeLive("Transcript nextPutAll: 'before boom'. nil foo", (text) =>
      chunks.push(text),
    );

    expect(chunks).toEqual(['before boom']);
    expect(err.number).not.toBe(0);
    expect(err.message).toContain('foo');
    // koffi hands a uint64 back as a number whenever it fits, so the oop is
    // normalized before being compared against the bigint OOP constants --
    // production paths (codeExecutor.fetchResultOop) do the same, and without
    // it the nil guard never matches.
    const context = BigInt(err.context);
    if (context !== OOP_NIL && context !== 0n) {
      gci.GciTsClearStack(handle, context);
    }
    expect(gci.executeAndFetchInteger(handle, '3 + 4')).toBe(7n);
  });
});
