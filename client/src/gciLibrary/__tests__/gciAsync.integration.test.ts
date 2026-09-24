import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_CLASS_STRING, OOP_ILLEGAL, OOP_NIL } from '../../gciConstants';
import { useIntegrationTest, type GciTestContext } from '../../__tests__/useIntegrationTest';
import { requireGciCapability } from './requireGciCapability';

describe('GCI async execution, break, and debugging (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;
  let withTransientSession: GciTestContext['withTransientSession'];

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
    withTransientSession = testContext.withTransientSession;
  });

  describe('GciTsSocket', () => {
    it('returns a valid file descriptor for the session', () => {
      const { fd, err } = gci.GciTsSocket(session);
      expect(err.number).toBe(0);
      expect(fd).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GciTsCallInProgress', () => {
    it('returns 0 when no call is in progress', () => {
      const { result, err } = gci.GciTsCallInProgress(session);
      expect(err.number).toBe(0);
      expect(result).toBe(0);
    });
  });

  describe('GciTsBreak', () => {
    it('sends a soft break when no execution is in progress (no-op)', () => {
      const { success, err } = gci.GciTsBreak(session, false);
      expect(err.number).toBe(0);
      expect(success).toBe(true);
    });

    it('sends a hard break when no execution is in progress (no-op)', () => {
      const { success, err } = gci.GciTsBreak(session, true);
      expect(err.number).toBe(0);
      expect(success).toBe(true);
    });
  });

  describe('GciTsClearStack', () => {
    it('clears stack of a suspended process from an error', () => {
      const { err: execErr } = gci.GciTsExecute(
        session,
        '1 / 0',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(execErr.number).not.toBe(0);

      // The context field holds the GsProcess OOP of the suspended process
      expect(execErr.context).not.toBe(OOP_NIL);
      expect(execErr.context).not.toBe(0n);

      const { success, err } = gci.GciTsClearStack(session, execErr.context);
      expect(err.number).toBe(0);
      expect(success).toBe(true);
    });

    it('returns error for OOP_NIL (not a valid GsProcess)', () => {
      const { success, err } = gci.GciTsClearStack(session, OOP_NIL);
      expect(err.number).not.toBe(0);
      expect(success).toBe(false);
    });
  });

  describe('GciTsGemTrace', () => {
    it('returns previous trace level and sets new level', () => {
      withTransientSession((transientSession) => {
        const { err: err0 } = gci.GciTsGemTrace(transientSession, 0);
        expect(err0.number).toBe(0);

        const { previousLevel: prev1, err: err1 } = gci.GciTsGemTrace(transientSession, 1);
        expect(err1.number).toBe(0);
        expect(prev1).toBe(0);

        const { previousLevel: prev2, err: err2 } = gci.GciTsGemTrace(transientSession, 0);
        expect(err2.number).toBe(0);
        expect(prev2).toBe(1);
      });
    });
  });

  // GciTsNbResult blocks on the session socket until the result arrives, so
  // these don't need GciTsNbPoll (3.7.0+) to wait and run on every version.
  describe('GciTsNbExecute + GciTsNbResult', () => {
    it('executes "3 + 4" non-blocking and retrieves result', () => {
      const { success, err: startErr } = gci.GciTsNbExecute(
        session,
        '3 + 4',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(startErr.number).toBe(0);
      expect(success).toBe(true);

      const { result, err } = gci.GciTsNbResult(session);
      expect(err.number).toBe(0);

      const { success: ok, value } = gci.GciTsOopToI64(session, result);
      expect(ok).toBe(true);
      expect(value).toBe(7n);
    });

    it('executes a string expression non-blocking and fetches result', () => {
      const { success } = gci.GciTsNbExecute(
        session,
        "'hello' asUppercase",
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(success).toBe(true);

      const { result, err } = gci.GciTsNbResult(session);
      expect(err.number).toBe(0);

      const fetched = gci.GciTsFetchUtf8(session, result, 1024);
      expect(fetched.data).toBe('HELLO');
    });
  });

  describe('GciTsNbPerform + GciTsNbResult', () => {
    it('sends size to a String non-blocking', () => {
      const strOop = gci.GciTsNewString(session, 'GemStone');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { success, err: startErr } = gci.GciTsNbPerform(
        session,
        strOop.result,
        OOP_ILLEGAL,
        'size',
        [],
        0,
        0,
      );
      expect(startErr.number).toBe(0);
      expect(success).toBe(true);

      const { result, err } = gci.GciTsNbResult(session);
      expect(err.number).toBe(0);

      const { value } = gci.GciTsOopToI64(session, result);
      expect(value).toBe(8n);
    });

    it('sends with: with: to Array non-blocking', () => {
      const oop10 = gci.GciTsI64ToOop(session, 10n).result;
      const oop20 = gci.GciTsI64ToOop(session, 20n).result;
      const OOP_CLASS_ARRAY = gci.resolveSymbol(session, 'Array');

      const { success } = gci.GciTsNbPerform(
        session,
        OOP_CLASS_ARRAY,
        OOP_ILLEGAL,
        'with:with:',
        [oop10, oop20],
        0,
        0,
      );
      expect(success).toBe(true);

      const { result, err } = gci.GciTsNbResult(session);
      expect(err.number).toBe(0);

      const size = gci.GciTsFetchSize(session, result);
      expect(size.result).toBe(2n);

      const fetched = gci.GciTsFetchOops(session, result, 1n, 2);
      const vals = fetched.oops.map((o) => gci.GciTsOopToI64(session, o).value);
      expect(vals).toEqual([10n, 20n]);
    });
  });

  describe('GciTsNbPoll', () => {
    it('answers -1 when no NB call is pending', (ctx) => {
      requireGciCapability('GciTsNbPoll', ctx, gci);

      const { result, err } = gci.GciTsNbPoll(session, 0);
      expect(result).toBe(-1);
      expect(err.number).not.toBe(0);
    });

    it('answers 1 once an NbExecute result is ready', (ctx) => {
      requireGciCapability('GciTsNbPoll', ctx, gci);

      const { success } = gci.GciTsNbExecute(
        session,
        '3 + 4',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(success).toBe(true);

      const { result: pollResult } = gci.GciTsNbPoll(session, 5000);
      expect(pollResult).toBe(1);

      // Drain the pending result so the session isn't left mid-call.
      const { err } = gci.GciTsNbResult(session);
      expect(err.number).toBe(0);
    });
  });
});
