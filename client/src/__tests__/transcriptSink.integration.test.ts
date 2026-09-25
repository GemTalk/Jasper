// End-to-end tests for the Jade-style Transcript sink against a live stone:
// real class compilation, kernel `Transcript` writes reaching the sink,
// buffered drains, and clientForwarder mode (2336 -> settleNbResult ->
// ContinueWith) scoped to the process it was started for.
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
  startClientForwarderMode,
  endClientForwarderMode,
  drainTranscript,
  settleNbResult,
} from '../transcriptSink';
import { runNbCall, NbCancelledError, MIN_HARD_BREAK_GAP_MS } from '../nbRunner';
import { expectEventLoopToRemainResponsiveDuring } from './support/timers';
import {
  OOP_CLASS_STRING,
  OOP_CLASS_UTF8,
  OOP_ILLEGAL,
  OOP_NIL,
  GCI_PERFORM_FLAG_ENABLE_DEBUG,
  GCI_PERFORM_FLAG_INTERPRETED,
} from '../gciConstants';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The flags Execute It runs with (codeExecutor.ts); cells and these tests' default run with 0. */
const EXECUTE_IT_FLAGS = GCI_PERFORM_FLAG_ENABLE_DEBUG | GCI_PERFORM_FLAG_INTERPRETED;

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
  // blocking execute path before it clears SessionTemps, and a forwarder send
  // there has no continuable context (see transcriptSink.ts's module doc).
  afterEach(() => {
    endClientForwarderMode(session());
  });

  /**
   * Run `code` the way Execute It does: clientForwarder mode started for it,
   * then started non-blocking (as UTF-8, like production) and settled through
   * the shared nb poll loop,
   * with transcript forwarder sends (2336) displayed as they arrive. The
   * progress notification is suppressed -- there is no user here to offer a
   * Cancel to.
   *
   * Deliberately does NOT end the mode afterwards, as production's `finally`
   * does: the scoping tests below prove the mode ends with its process, and
   * `afterEach` tidies up for the rest.
   */
  function executeForwarding(
    code: string,
    onTranscript: (text: string) => void,
    opts: { flags?: number; onStart?: (cancel: () => void) => void } = {},
  ) {
    startClientForwarderMode(session(), code);
    return runNbCall(
      session(),
      () =>
        gci.GciTsNbExecute(handle, code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, opts.flags ?? 0, 0),
      (signal) => settleNbResult(session(), onTranscript, signal),
      { suppressNotification: true, disposableProcess: true, onStart: opts.onStart },
    );
  }

  /**
   * Blocking calls, each yielding for `waitMs` in the gem and answering its own
   * number. A 2336 surfacing inside one fails it, and leaves its process parked
   * to hand its answer to the next call that yields -- so a single stray
   * forwarder send shows up here as a THREW followed by answers off by one.
   */
  function blockingSeries(count: number, waitMs: number): string[] {
    const out: string[] = [];
    for (let i = 1; i <= count; i++) {
      try {
        out.push(exec(`(Delay forMilliseconds: ${waitMs}) wait. '${i}'`));
      } catch (e) {
        out.push(`THREW ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out;
  }

  const numbered = (count: number): string[] =>
    Array.from({ length: count }, (_, k) => String(k + 1));

  /** Wait until an abandoned call has been collected: a new nb call waits for exactly that. */
  const sessionFree = () =>
    runNbCall(
      session(),
      () => gci.GciTsNbExecute(handle, 'nil', OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL, 0, 0),
      (signal) => settleNbResult(session(), () => {}, signal),
      { suppressNotification: true },
    );

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

  it('starting clientForwarder mode frees a Transcript mutex left held', () => {
    // The start is what every interactive execute runs first, so it is the
    // repair production actually reaches. Installing does NOT do this: at
    // login the key does not exist yet, which is why the reset is not there.
    poisonTranscriptMutex();

    // Start the mode (the repair) and end it: what is under test is the
    // mutex, not the mode.
    startClientForwarderMode(session(), 'nil');
    endClientForwarderMode(session());

    expect(exec("Transcript nextPutAll: 'recovered'. 'ok'")).toBe('ok');
    expect(drainTranscript(session())).toContain('recovered');
  });

  it('installing does not touch the mutex, because at login there is none to touch', () => {
    // Guards the rationale in startClientForwarderModeCode's comment: if someone moves the reset
    // back into the install doit, it is dead code again and this goes red.
    poisonTranscriptMutex();

    expect(installTranscriptSink(session())).toBe(true);

    expect(() => exec("Transcript nextPutAll: 'still poisoned'. 'ok'")).toThrow(
      /rtErrSchedulerDeadlocked/,
    );
    startClientForwarderMode(session(), 'nil');
    endClientForwarderMode(session());
    expect(exec("Transcript nextPutAll: 'now fine'. 'ok'")).toBe('ok');
  });

  it('a throw inside the settle loop leaves later Transcript writes working', async () => {
    // The process being resumed is suspended inside TranscriptStreamPortable's
    // critical: block, holding the semaphore. Before settleNbResult cleared it,
    // a throw here killed the session's Transcript for good -- the shape of the
    // original #646 report.
    const code = "Transcript nextPutAll: 'before the throw'. 'done'";
    startClientForwarderMode(session(), code);

    await expect(
      runNbCall(
        session(),
        () => gci.GciTsNbExecute(handle, code, OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL, 0, 0),
        () =>
          settleNbResult(session(), () => {
            throw new Error('display blew up');
          }),
        { suppressNotification: true },
      ),
    ).rejects.toThrow('display blew up');

    endClientForwarderMode(session());
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
    const chunks: string[] = [];

    await expectEventLoopToRemainResponsiveDuring(100, 800, async () => {
      const { err } = await executeForwarding(
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
    let wroteOnce: () => void = () => {};
    const onWorker = new Promise<void>((resolve) => {
      wroteOnce = resolve;
    });
    let cancel: (() => void) | undefined;
    const run = executeForwarding(
      "[Transcript nextPutAll: 'streaming'. " +
        '(SessionTemps current at: #TranscriptStream_SessionMutex) ' +
        'critical: [200 timesRepeat: [(Delay forMilliseconds: 50) wait]]] ' +
        'on: Break do: [:e | e resume]. 42',
      () => wroteOnce(),
      {
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

      // A blocking write, not another forwarded execute: starting the mode
      // repairs a held semaphore by itself, and would pass this with the
      // break's process left uncleared.
      await sessionFree();
      expect(exec("Transcript nextPutAll: 'after'. 'ok'")).toBe('ok');
      expect(drainTranscript(session())).toContain('after');
    } finally {
      // Whatever failed above, nothing may still be running into the next
      // test: stop the run, and wait until the session is free again (a new
      // call waits for exactly that).
      cancel?.();
      cancel?.();
      await run.catch(() => {});
      await sessionFree().catch(() => {});
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
    // it. Checked with a blocking write, because starting the mode for another
    // execute is a repair of its own and would hide a stranded semaphore.
    const bindings = gci as unknown as Record<string, unknown>;
    const realBinding = bindings._GciTsContinueWith as (...args: unknown[]) => unknown;

    bindings._GciTsContinueWith = (...args: unknown[]) => realBinding(...args);
    try {
      await expect(
        executeForwarding("Transcript nextPutAll: 'lost'. 6 * 7", () => {}),
      ).rejects.toThrow(TypeError);
    } finally {
      bindings._GciTsContinueWith = realBinding;
    }

    expect(exec("Transcript nextPutAll: 'after'. 'ok'")).toBe('ok');
    expect(drainTranscript(session())).toContain('after');
  });

  it('buffers kernel Transcript writes outside clientForwarder mode and drains them', () => {
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

  it('starting clientForwarder mode returns any buffered residue', () => {
    exec("Transcript nextPutAll: 'residue'. 'ok'");

    const residue = startClientForwarderMode(session(), 'nil');

    expect(residue).toContain('residue');
  });

  it('streams writes mid-execution in clientForwarder mode and settles to the real result', async () => {
    const chunks: string[] = [];

    const { result, err } = await executeForwarding(
      "Transcript nextPutAll: 'first'. Transcript nextPutAll: 'second'. 6 * 7",
      (text) => chunks.push(text),
    );

    expect(err.number).toBe(0);
    expect(chunks).toEqual(['first', 'second']);
    expect(gci.oopToInteger(handle, result)).toBe(42n);
  });

  it('clientForwarder mode bypasses user exception handlers', async () => {
    const chunks: string[] = [];

    const { result, err } = await executeForwarding(
      "[Transcript nextPutAll: 'inside handler'. 'no error'] on: AbstractException do: [:e | 'trapped']",
      (text) => chunks.push(text),
    );

    expect(err.number).toBe(0);
    expect(chunks).toEqual(['inside handler']);
    // The handler did NOT fire -- the block completed normally.
    expect(fetchString(result)).toBe('no error');
  });

  it('passes real errors through the settle loop and leaves the session usable', async () => {
    const chunks: string[] = [];

    const { err } = await executeForwarding(
      "Transcript nextPutAll: 'before boom'. nil foo",
      (text) => chunks.push(text),
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

  // clientForwarder mode belongs to the process it was started for, not the
  // session (#665). None of these end the mode the way production's `finally`
  // does, except where a test says so: each proves the mode ends with its
  // process. What they observe is behaviour -- whether a write reaches the
  // settle loop or the buffer, and whether blocking calls keep their own
  // answers -- never the sink's own state.
  describe('clientForwarder mode is scoped to its process', () => {
    it.each([
      ['Execute It', EXECUTE_IT_FLAGS],
      ['a notebook cell', 0],
    ])(
      'forwards the process’s own writes and its forks’ writes while it runs (%s flags)',
      async (_label, flags) => {
        const chunks: string[] = [];

        const { result, err } = await executeForwarding(
          "[Transcript nextPutAll: 'from the fork'] fork. (Delay forMilliseconds: 50) wait. " +
            "Transcript nextPutAll: 'from the process'. 42",
          (text) => chunks.push(text),
          { flags },
        );

        expect(err.number).toBe(0);
        expect(chunks).toEqual(['from the fork', 'from the process']);
        expect(gci.oopToInteger(handle, result)).toBe(42n);
        expect(drainTranscript(session())).toBe('');
      },
    );

    it('recognises its process when the source has non-ASCII characters', async () => {
      // The sink compares the source it was given with the one the process
      // runs; both arrive as UTF-8, and one side decoding to a String and the
      // other to a Unicode string must not stop the match.
      const chunks: string[] = [];

      const { err } = await executeForwarding(
        "Transcript nextPutAll: 'caf\u00e9 \u2603'. 1",
        (text) => chunks.push(text),
        { flags: EXECUTE_IT_FLAGS },
      );

      expect(err.number).toBe(0);
      expect(chunks).toEqual(['caf\u00e9 \u2603']);
    });

    it('buffers a fork that outlives its process, and later blocking calls keep their answers', async () => {
      const { err } = await executeForwarding(
        "[(Delay forMilliseconds: 400) wait. Transcript nextPutAll: 'orphan'] fork. 'started'",
        () => {},
        { flags: EXECUTE_IT_FLAGS },
      );
      expect(err.number).toBe(0);

      // The fork writes during one of these. Forwarded, that call would fail
      // and the ones after it would each answer the one before.
      expect(blockingSeries(6, 150)).toEqual(numbered(6));
      expect(drainTranscript(session())).toBe('orphan');
    });

    it.each([
      ['wrote', "Transcript nextPutAll: 'forwarded'. 1"],
      ['never wrote', '1'],
    ])(
      'buffers a later blocking call’s own write once the process (which %s) has completed',
      async (_label, code) => {
        const { err } = await executeForwarding(code, () => {}, { flags: EXECUTE_IT_FLAGS });
        expect(err.number).toBe(0);

        expect(exec("Transcript nextPutAll: 'blocking one'. 'ok'")).toBe('ok');
        // A forwarded write would also have left the Transcript lock held, so
        // this one would raise 2366.
        expect(exec("Transcript nextPutAll: ' blocking two'. 'ok'")).toBe('ok');
        expect(drainTranscript(session())).toBe('blocking one blocking two');
      },
    );

    it.each([
      ['wrote', "Transcript nextPutAll: 'streaming'. "],
      ['never wrote', ''],
    ])(
      'a hard break ends the mode with the cleared process, with no end call (process %s)',
      async (_label, ownWrite) => {
        // Survives the soft break, so the second Cancel is a hard break, and
        // leaves a fork behind that writes after the break. No end call:
        // production's is refused at this point (the aborted call is still
        // being collected), and nothing may depend on it.
        const chunks: string[] = [];
        let cancel: (() => void) | undefined;
        const run = executeForwarding(
          "[(Delay forMilliseconds: 1500) wait. Transcript nextPutAll: 'late fork'] fork. " +
            ownWrite +
            '[200 timesRepeat: [(Delay forMilliseconds: 50) wait]] on: Break do: [:e | e resume]. 42',
          (text) => chunks.push(text),
          { flags: EXECUTE_IT_FLAGS, onStart: (c) => (cancel = c) },
        );
        run.catch(() => {});
        try {
          await sleep(300);
          cancel!();
          await sleep(MIN_HARD_BREAK_GAP_MS + 50);
          cancel!();
          await expect(run).rejects.toBeInstanceOf(NbCancelledError);
          await sessionFree();

          // The fork writes during one of these, well after the break.
          expect(blockingSeries(12, 150)).toEqual(numbered(12));
          expect(drainTranscript(session())).toBe('late fork');
          expect(exec("Transcript nextPutAll: 'own write'. 'ok'")).toBe('ok');
          expect(drainTranscript(session())).toBe('own write');
          expect(chunks).toEqual(ownWrite ? ['streaming'] : []);
        } finally {
          cancel?.();
          cancel?.();
          await run.catch(() => {});
          await sessionFree().catch(() => {});
        }
      },
      30_000,
    );

    it('an older process running the same source cannot claim the mode', async () => {
      // Re-running the same code starts the mode for the same source while the
      // earlier, soft-broken process still reads as waiting. Resumed from the
      // debugger, that old process must not be taken for the new one: its
      // serial predates the start.
      const code =
        "20 timesRepeat: [(Delay forMilliseconds: 50) wait]. Transcript nextPutAll: 'old'. 42";
      let cancel: (() => void) | undefined;
      const run = executeForwarding(code, () => {}, {
        flags: EXECUTE_IT_FLAGS,
        onStart: (c) => (cancel = c),
      });
      await sleep(200);
      cancel!();
      const { err } = await run;
      expect(err.number).not.toBe(0);
      endClientForwarderMode(session());

      startClientForwarderMode(session(), code);
      const resumed = gci.GciTsContinueWith(handle, BigInt(err.context), OOP_ILLEGAL, null, 0);

      expect(resumed.err.number).toBe(0);
      expect(gci.oopToInteger(handle, resumed.result)).toBe(42n);
      expect(drainTranscript(session())).toBe('old');
    });

    it('buffers the write, rather than failing it, when the ownership check itself raises', async () => {
      // Fault injection: an owner that is not a process makes the running
      // check raise. A Transcript write must never fail because of the sink's
      // own check.
      const code = "Transcript nextPutAll: 'still written'. 42";
      startClientForwarderMode(session(), code);
      exec("(SessionTemps current at: #JasperTranscriptSink) instVarAt: 3 put: Object new. 'ok'");
      const chunks: string[] = [];

      const { result, err } = await runNbCall(
        session(),
        () => gci.GciTsNbExecute(handle, code, OOP_CLASS_UTF8, OOP_ILLEGAL, OOP_NIL, 0, 0),
        (signal) => settleNbResult(session(), (text) => chunks.push(text), signal),
        { suppressNotification: true },
      );

      expect(err.number).toBe(0);
      expect(gci.oopToInteger(handle, result)).toBe(42n);
      expect(chunks).toEqual([]);
      expect(drainTranscript(session())).toBe('still written');
    });

    it.each([
      ['halted', "self halt. Transcript nextPutAll: 'resumed'. 42", false],
      [
        'soft-broken',
        "20 timesRepeat: [(Delay forMilliseconds: 50) wait]. Transcript nextPutAll: 'resumed'. 42",
        true,
      ],
    ])(
      'a %s process resumed after the end call writes to the buffer',
      async (_label, code, softBreak) => {
        // Both leave the process suspended with its stack for the debugger, so
        // by the sink's own test it is still running. The end call
        // (production's `finally`, which can run here because the session is
        // idle) is what stops forwarding. The debugger resumes and steps on
        // paths that cannot take a 2336.
        let cancel: (() => void) | undefined;
        const run = executeForwarding(code, () => {}, {
          flags: EXECUTE_IT_FLAGS,
          onStart: (c) => (cancel = c),
        });
        if (softBreak) {
          await sleep(200);
          cancel!();
        }
        const { err } = await run;
        expect(err.number).not.toBe(0);
        endClientForwarderMode(session());

        const resumed = gci.GciTsContinueWith(handle, BigInt(err.context), OOP_ILLEGAL, null, 0);

        expect(resumed.err.number).toBe(0);
        expect(gci.oopToInteger(handle, resumed.result)).toBe(42n);
        expect(drainTranscript(session())).toBe('resumed');
      },
    );
  });
});
