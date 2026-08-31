// End-to-end tests for the Jade-style Transcript sink against a live stone:
// install at "login", kernel `Transcript` writes reaching the sink, buffered
// drains, and live forwarding (error 2336 → settleNbResult → ContinueWith).
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// transcriptSink logs through gciLog, which needs the vscode module — absent
// in the gci project. Console logging keeps failures diagnosable here.
vi.mock('../../gciLog', () => ({
  logInfo: vi.fn((...args: unknown[]) => console.log(...args)),
  logError: vi.fn((...args: unknown[]) => console.error(...args)),
}));

import { GciLibrary } from '../../gciLibrary';
import type { ActiveSession } from '../../sessionManager';
import {
  installTranscriptSink,
  setTranscriptLive,
  drainTranscript,
  settleNbResult,
} from '../../transcriptSink';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';
import { OOP_CLASS_STRING } from '../../gciConstants';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('transcript sink (live stone)', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: ActiveSession;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = {
      id: 99,
      gci,
      handle: login.session,
      login: { label: 'gci-test' },
      stoneVersion: '',
    } as unknown as ActiveSession;
    // Tests run in a shuffled order and share this session — the sink must
    // exist before any of them, exactly as it would after a real login.
    expect(installTranscriptSink(session)).toBe(true);
  });

  beforeEach(() => {
    // Tests share the session's sink: start each one buffered and empty so a
    // predecessor's leftovers can't bleed into its assertions.
    setTranscriptLive(session, false);
    drainTranscript(session);
  });

  afterAll(() => {
    if (session) gci.GciTsLogout(session.handle);
    gci.close();
  });

  function execute(code: string): { data: string; err: { number: number; message: string } } {
    const { data, err } = gci.GciTsExecuteFetchBytes(
      session.handle,
      code,
      -1,
      OOP_CLASS_STRING,
      OOP_ILLEGAL,
      OOP_NIL,
      4096,
    );
    return { data, err };
  }

  async function pollUntilReady(): Promise<void> {
    for (let i = 0; i < 400; i++) {
      const { result } = gci.GciTsNbPoll(session.handle, 25);
      if (result === 1) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('nb call never became ready');
  }

  it('reinstalling within the same session is a harmless no-op', () => {
    expect(installTranscriptSink(session)).toBe(true);
  });

  it('captures kernel Transcript writes and drains them in buffered mode', () => {
    const { err } = execute("Transcript nextPutAll: 'buffered hello'; tab: 1. 'ok'");
    expect(err.number).toBe(0);

    const drained = drainTranscript(session);

    expect(drained).toContain('buffered hello');
    // A second drain finds nothing — the buffer was cleared.
    expect(drainTranscript(session)).toBe('');
  });

  it('suppresses the gem-log echo: show:/flush do not error against the sink', () => {
    // show: routes through nextPutAll: + endEntry (contents/reset + gciLogServer).
    const { err } = execute("Transcript show: 'shown'; flush. 'ok'");

    expect(err.number).toBe(0);
    // show: printStrings its argument (kernel behavior), so quotes included.
    expect(drainTranscript(session)).toContain("'shown'");
  });

  it('round-trips non-ASCII transcript output through the UTF-8 drain', () => {
    const { err } = execute(
      "Transcript nextPutAll: 'caf', (Character codePoint: 233) asString. 'ok'",
    );
    expect(err.number).toBe(0);

    expect(drainTranscript(session)).toContain('café');
  });

  it('switching to live mode returns any buffered residue', () => {
    const { err } = execute("Transcript nextPutAll: 'residue'. 'ok'");
    expect(err.number).toBe(0);

    const residue = setTranscriptLive(session, true);

    expect(residue).toContain('residue');
    setTranscriptLive(session, false);
  });

  it('streams writes mid-execution in live mode and settles to the real result', async () => {
    setTranscriptLive(session, true);
    try {
      const start = gci.GciTsNbExecute(
        session.handle,
        "Transcript nextPutAll: 'first'. Transcript nextPutAll: 'second'. 6 * 7",
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(start.success).toBe(true);
      await pollUntilReady();

      const chunks: string[] = [];
      const { result, err } = await settleNbResult(session, (text) => chunks.push(text));

      expect(err.number).toBe(0);
      expect(chunks).toEqual(['first', 'second']);
      const { value } = gci.GciTsOopToI64(session.handle, result);
      expect(value).toBe(42n);
    } finally {
      setTranscriptLive(session, false);
    }
  });

  it('live forwarding bypasses user exception handlers', async () => {
    setTranscriptLive(session, true);
    try {
      const start = gci.GciTsNbExecute(
        session.handle,
        "[Transcript nextPutAll: 'inside handler'. 'no error'] on: AbstractException do: [:e | 'trapped']",
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(start.success).toBe(true);
      await pollUntilReady();

      const chunks: string[] = [];
      const { result, err } = await settleNbResult(session, (text) => chunks.push(text));

      expect(err.number).toBe(0);
      expect(chunks).toEqual(['inside handler']);
      // The handler did NOT fire — the block completed normally.
      const { data } = gci.GciTsFetchUtf8(session.handle, result, 256);
      expect(data).toBe('no error');
    } finally {
      setTranscriptLive(session, false);
    }
  });

  it('passes real errors through the settle loop untouched', async () => {
    setTranscriptLive(session, true);
    try {
      const start = gci.GciTsNbExecute(
        session.handle,
        "Transcript nextPutAll: 'before boom'. nil foo",
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(start.success).toBe(true);
      await pollUntilReady();

      const chunks: string[] = [];
      const { err } = await settleNbResult(session, (text) => chunks.push(text));

      expect(chunks).toEqual(['before boom']);
      expect(err.number).not.toBe(0);
      expect(err.message).toContain('foo');
      // Release the suspended process so later tests start clean.
      if (err.context && err.context !== OOP_NIL) {
        gci.GciTsClearStack(session.handle, err.context);
      }
    } finally {
      setTranscriptLive(session, false);
    }
  });

  it('the session remains healthy after live-mode use', () => {
    const { data, err } = execute('(3 + 4) printString');

    expect(err.number).toBe(0);
    expect(data).toBe('7');
  });
});
