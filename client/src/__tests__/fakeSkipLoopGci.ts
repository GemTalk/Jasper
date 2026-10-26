import { vi } from 'vitest';
import { BREAKPOINT_ERROR } from '../debugger/conditionalBreakpoints';
import { CLIENT_FORWARDER_SEND_ERR } from '../transcriptSink';
import { OOP_NIL } from '../gciConstants';

/** What one resume of the suspended process comes back with. */
export type ScriptedResume = {
  result?: bigint;
  err: { number: number; message?: string; context?: bigint; args?: bigint[]; argCount?: number };
};

/** The text a scripted Transcript write carries. */
export const TRANSCRIPT_TEXT = 'written while skipping';

export const hitsBreakpoint = (process: bigint): ScriptedResume => ({
  err: { number: BREAKPOINT_ERROR, message: 'Method breakpoint encountered.', context: process },
});

/** A Transcript write in clientForwarder mode, from `process`. */
export const writesToTranscript = (process: bigint): ScriptedResume => ({
  err: {
    number: CLIENT_FORWARDER_SEND_ERR,
    context: process,
    args: [0x10n, 0x11n, 0x12n, 0x13n],
    argCount: 4,
  },
});

/**
 * The GCI calls the breakpoint skip loop makes, answering a scripted sequence of
 * decisions and of resume outcomes; the last of each repeats.
 *
 * A decision travels as oop `1000 + n` and comes back through `oopToInteger`.
 * Oops 0x12 and 0x13 are a Transcript write's selector and argument Array.
 */
export function fakeSkipLoopGci(
  decisions: number[],
  resumes: ScriptedResume[],
  message = '',
  hooks: {
    /** Runs inside the Nth resume (0-based), while it is "in flight". */
    duringResume?: (n: number) => void;
    /** Replaces the decider's answer, for a judgement that fails. */
    perform?: () => { result: bigint; err: { number: number; message?: string; context?: bigint } };
  } = {},
) {
  let decisionIndex = 0;
  let resumeIndex = 0;
  return {
    // One execute per run compiles the decider; every hit after is a perform.
    GciTsExecute: vi.fn((_h: unknown, _code: string) => ({
      result: 400n,
      err: { number: 0, message: '' },
    })),
    GciTsPerformAsync: vi.fn((_h: unknown, _receiver: bigint, _c: bigint, _selector: string) =>
      Promise.resolve(hooks.perform?.() ?? { result: 500n, err: { number: 0, message: '' } }),
    ),
    GciTsFetchOops: vi.fn((_h: unknown, oop: bigint) => {
      if (oop === 0x13n) return { result: 1, oops: [0x77n], err: { number: 0 } };
      const decision = decisions[Math.min(decisionIndex, decisions.length - 1)];
      decisionIndex += 1;
      return {
        // decision, message, matched-rule index
        oops: [1000n + BigInt(decision), message === '' ? OOP_NIL : 77n, 1001n],
        err: { number: 0, message: '' },
      };
    }),
    GciTsFetchChars: vi.fn(() => ({ data: message, err: { number: 0, message: '' } })),
    oopToInteger: vi.fn((_h: unknown, oop: bigint) => Number(oop - 1000n)),
    // A Transcript write's receiver: client object 2.
    GciTsOopToI64: vi.fn(() => ({ success: true, value: 2n, err: { number: 0 } })),
    GciTsFetchUtf8: vi.fn((_h: unknown, oop: bigint) => ({
      data: oop === 0x12n ? 'nextPutAll:' : TRANSCRIPT_TEXT,
      err: { number: 0 },
    })),
    GciTsClearStack: vi.fn((_h: unknown, _process: bigint) => ({
      success: true,
      err: { number: 0 },
    })),
    GciTsBreak: vi.fn((_h: unknown, _hard: boolean) => ({ success: true, err: { number: 0 } })),
    GciTsObjExists: vi.fn(() => true),
    GciTsContinueWithAsync: vi.fn(
      (_h: unknown, _process: bigint, _tos: bigint, _e: unknown, _flags: number) => {
        const next = resumes[Math.min(resumeIndex, resumes.length - 1)];
        hooks.duringResume?.(resumeIndex);
        resumeIndex += 1;
        return Promise.resolve({
          result: next.result ?? 0n,
          err: { context: 0n, message: '', ...next.err },
        });
      },
    ),
  };
}
