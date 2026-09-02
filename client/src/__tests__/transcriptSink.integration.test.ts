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
import { runNbCall } from '../nbRunner';
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
      () => settleNbResult(session(), onTranscript),
      { suppressNotification: true },
    );
  }

  it('reinstalling into a session that already has a sink keeps the buffered output', () => {
    exec("Transcript nextPutAll: 'kept across reinstall'. 'ok'");

    expect(installTranscriptSink(session())).toBe(true);

    expect(drainTranscript(session())).toContain('kept across reinstall');
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
