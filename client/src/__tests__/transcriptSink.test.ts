import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

import {
  TRANSCRIPT_SINK_INSTALL_CODE,
  CLIENT_FORWARDER_SEND_ERR,
  TRANSCRIPT_CLIENT_OBJECT,
  installTranscriptSink,
  setTranscriptLive,
  drainTranscript,
  isForwarderSendError,
  decodeTranscriptForwarderSend,
  settleNbResult,
} from '../transcriptSink';
import type { ActiveSession } from '../sessionManager';
import type { GciError } from '../gciLibrary';
import { GciLibraryError } from '../gciLibraryError';

const OOP_ILLEGAL = 0x01n;

// A GciError for a forwarder send carrying `selector` applied to `text`.
// Oop values are arbitrary handles the mock gci resolves.
function forwarderError(overrides: Partial<GciError> = {}): GciError {
  return {
    number: CLIENT_FORWARDER_SEND_ERR,
    context: 0x999n,
    argCount: 4,
    args: [0x10n, 0x11n, 0x12n, 0x13n], // receiver, clientObject, selector, argArray
    category: 0n,
    exceptionObj: 0n,
    fatal: 0,
    message: 'clientForwarderSend',
    reason: '',
    ...overrides,
  };
}

function makeGci(overrides: Record<string, unknown> = {}) {
  return {
    // args[1] (0x11n) → clientObject 2; args[2] (0x12n) → #nextPutAll:;
    // args[3] (0x13n) → the argument Array whose first element is the text.
    GciTsOopToI64: vi.fn(() => ({
      success: true,
      value: BigInt(TRANSCRIPT_CLIENT_OBJECT),
      err: { number: 0 },
    })),
    GciTsFetchUtf8: vi.fn((_h: unknown, oop: bigint) =>
      oop === 0x12n
        ? { data: 'nextPutAll:', err: { number: 0 } }
        : { data: 'hello world', err: { number: 0 } },
    ),
    GciTsFetchOops: vi.fn(() => ({ result: 1, oops: [0x77n], err: { number: 0 } })),
    executeAndFetchString: vi.fn(() => ''),
    GciTsNbResult: vi.fn(() => ({ result: 42n, err: { number: 0, context: 0n } })),
    GciTsContinueWithAsync: vi.fn(async () => ({ result: 42n, err: { number: 0, context: 0n } })),
    ...overrides,
  };
}

function makeSession(gci = makeGci()): ActiveSession {
  return {
    id: 1,
    gci: gci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' },
    stoneVersion: '3.7.5',
  } as unknown as ActiveSession;
}

describe('transcriptSink', () => {
  describe('install code', () => {
    it('replaces the kernel session stream and registers the sink under its own key', () => {
      expect(TRANSCRIPT_SINK_INSTALL_CODE).toContain(
        'tmps at: #TranscriptStream_SessionStream put: sink',
      );
      expect(TRANSCRIPT_SINK_INSTALL_CODE).toContain('tmps at: #JasperTranscriptSink put: sink');
    });

    it('never commits — the sink lives only in SessionTemps', () => {
      expect(TRANSCRIPT_SINK_INSTALL_CODE).not.toContain('commit');
    });

    it('signals through a ClientForwarder with the Transcript client-object id', () => {
      expect(TRANSCRIPT_SINK_INSTALL_CODE).toContain(
        `ClientForwarder new clientObject: ${TRANSCRIPT_CLIENT_OBJECT}`,
      );
    });

    it('implements the four messages the kernel Transcript delegates to its stream', () => {
      for (const method of ['nextPutAll:', 'nextPut:', 'contents', 'reset']) {
        expect(TRANSCRIPT_SINK_INSTALL_CODE).toContain(`'${method.split(':')[0]}`);
      }
    });

    it('is idempotent within a session', () => {
      expect(TRANSCRIPT_SINK_INSTALL_CODE).toContain(
        '(tmps at: #JasperTranscriptSink otherwise: nil) ifNotNil:',
      );
    });
  });

  describe('installTranscriptSink', () => {
    it('reports success when the install doit runs cleanly', () => {
      const gci = makeGci({
        executeAndFetchString: vi.fn(() => 'installed'),
      });

      expect(installTranscriptSink(makeSession(gci))).toBe(true);
    });

    it('is non-fatal when the server rejects the install', () => {
      const gci = makeGci({
        executeAndFetchString: vi.fn(() => {
          throw GciLibraryError.withMessage('nope');
        }),
      });

      expect(installTranscriptSink(makeSession(gci))).toBe(false);
    });

    it('is non-fatal when the GCI call throws', () => {
      const gci = makeGci({
        executeAndFetchString: vi.fn(() => {
          throw new Error('socket closed');
        }),
      });

      expect(installTranscriptSink(makeSession(gci))).toBe(false);
    });
  });

  describe('setTranscriptLive / drainTranscript', () => {
    it('returns the text drained during a mode switch', () => {
      const gci = makeGci({
        executeAndFetchString: vi.fn(() => 'buffered output'),
      });

      expect(setTranscriptLive(makeSession(gci), true)).toBe('buffered output');
    });

    it('sends the requested mode to the sink', () => {
      const gci = makeGci();
      const session = makeSession(gci);

      setTranscriptLive(session, true);
      setTranscriptLive(session, false);

      const codes = (gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[1] as string,
      );
      expect(codes[0]).toContain('jasperLive: true');
      expect(codes[1]).toContain('jasperLive: false');
    });

    it('drains via the sink and returns empty when nothing is buffered', () => {
      const gci = makeGci();

      expect(drainTranscript(makeSession(gci))).toBe('');
      const code = (gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as string;
      expect(code).toContain('jasperDrain');
    });

    it('returns empty (not an exception) when the sink call fails', () => {
      const gci = makeGci({
        executeAndFetchString: vi.fn(() => {
          throw GciLibraryError.withMessage('busy');
        }),
      });

      expect(drainTranscript(makeSession(gci))).toBe('');
    });
  });

  describe('decodeTranscriptForwarderSend', () => {
    it('decodes the written text from a transcript forwarder send', () => {
      const session = makeSession();

      const text = decodeTranscriptForwarderSend(session, forwarderError());

      expect(text).toBe('hello world');
    });

    it('rejects a forwarder send for a different client object', () => {
      const gci = makeGci({
        GciTsOopToI64: vi.fn(() => ({ success: true, value: 1n, err: { number: 0 } })),
      });

      expect(decodeTranscriptForwarderSend(makeSession(gci), forwarderError())).toBeNull();
    });

    it('rejects a forwarder send with a different selector', () => {
      const gci = makeGci({
        GciTsFetchUtf8: vi.fn(() => ({ data: 'show:', err: { number: 0 } })),
      });

      expect(decodeTranscriptForwarderSend(makeSession(gci), forwarderError())).toBeNull();
    });

    it('rejects a non-forwarder error', () => {
      const session = makeSession();

      const err = forwarderError({ number: 2010 });

      expect(decodeTranscriptForwarderSend(session, err)).toBeNull();
    });
  });

  describe('isForwarderSendError', () => {
    it('matches only error 2336', () => {
      expect(isForwarderSendError(forwarderError())).toBe(true);
      expect(isForwarderSendError(forwarderError({ number: 2010 }))).toBe(false);
    });
  });

  describe('settleNbResult', () => {
    it('passes a clean result straight through', async () => {
      const session = makeSession();
      const onTranscript = vi.fn();

      const { result, err } = await settleNbResult(session, onTranscript);

      expect(result).toBe(42n);
      expect(err.number).toBe(0);
      expect(onTranscript).not.toHaveBeenCalled();
    });

    it('displays each transcript send and resumes until the real result arrives', async () => {
      const gci = makeGci({
        GciTsNbResult: vi.fn(() => ({ result: OOP_ILLEGAL, err: forwarderError() })),
        GciTsContinueWithAsync: vi
          .fn()
          .mockResolvedValueOnce({ result: OOP_ILLEGAL, err: forwarderError() })
          .mockResolvedValueOnce({ result: 42n, err: { number: 0, context: 0n } }),
      });
      const session = makeSession(gci);
      const onTranscript = vi.fn();

      const { result, err } = await settleNbResult(session, onTranscript);

      expect(result).toBe(42n);
      expect(err.number).toBe(0);
      expect(onTranscript).toHaveBeenCalledTimes(2);
      expect(onTranscript).toHaveBeenCalledWith('hello world');
      expect(gci.GciTsContinueWithAsync).toHaveBeenCalledTimes(2);
      // Resumes the suspended GsProcess from the error's context.
      expect((gci.GciTsContinueWithAsync as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(
        0x999n,
      );
    });

    it('still resumes a foreign forwarder send without displaying it', async () => {
      const gci = makeGci({
        // clientObject decodes to something other than the Transcript id.
        GciTsOopToI64: vi.fn(() => ({ success: true, value: 7n, err: { number: 0 } })),
        GciTsNbResult: vi.fn(() => ({ result: OOP_ILLEGAL, err: forwarderError() })),
        GciTsContinueWithAsync: vi.fn(async () => ({
          result: 42n,
          err: { number: 0, context: 0n },
        })),
      });
      const onTranscript = vi.fn();

      const { result } = await settleNbResult(makeSession(gci), onTranscript);

      expect(result).toBe(42n);
      expect(onTranscript).not.toHaveBeenCalled();
      expect(gci.GciTsContinueWithAsync).toHaveBeenCalledTimes(1);
    });

    it('returns other errors untouched for the caller to handle', async () => {
      const haltErr = { number: 2010, context: 0x555n, message: 'halt', args: [], argCount: 0 };
      const gci = makeGci({
        GciTsNbResult: vi.fn(() => ({ result: OOP_ILLEGAL, err: haltErr })),
      });
      const onTranscript = vi.fn();

      const { err } = await settleNbResult(makeSession(gci), onTranscript);

      expect(err.number).toBe(2010);
      expect(err.context).toBe(0x555n);
      expect(gci.GciTsContinueWithAsync).not.toHaveBeenCalled();
    });
  });
});
