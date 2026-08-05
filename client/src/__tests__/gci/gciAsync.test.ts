import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Async Execution, Break, and Debugging', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  let OOP_CLASS_STRING: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    OOP_CLASS_STRING = gci.resolveSymbol(session, 'String');
  });

  afterAll(() => {
    if (session) {
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsSocket', () => {
    it('returns a valid file descriptor for the session', () => {
      const { fd, err } = gci.GciTsSocket(session);
      console.log('Socket - fd:', fd, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(fd).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GciTsCallInProgress', () => {
    it('returns 0 when no call is in progress', () => {
      const { result, err } = gci.GciTsCallInProgress(session);
      console.log('CallInProgress - result:', result, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(result).toBe(0);
    });
  });

  describe('GciTsBreak', () => {
    it('sends a soft break when no execution is in progress (no-op)', () => {
      const { success, err } = gci.GciTsBreak(session, false);
      console.log('Break(soft) - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);
    });

    it('sends a hard break when no execution is in progress (no-op)', () => {
      const { success, err } = gci.GciTsBreak(session, true);
      console.log('Break(hard) - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);
    });
  });

  describe('GciTsClearStack', () => {
    it('clears stack of a suspended process from an error', () => {
      // Trigger an error that leaves a suspended process
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
      console.log(
        'ClearStack - triggered error:',
        execErr.number,
        'context:',
        execErr.context.toString(),
      );

      // The context field holds the GsProcess OOP of the suspended process
      if (execErr.context !== OOP_NIL && execErr.context !== 0n) {
        const { success, err } = gci.GciTsClearStack(session, execErr.context);
        console.log('ClearStack - success:', success, 'err.number:', err.number);
        expect(err.number).toBe(0);
        expect(success).toBe(true);
      }
    });

    it('returns error for OOP_NIL (not a valid GsProcess)', () => {
      const { success, err } = gci.GciTsClearStack(session, OOP_NIL);
      console.log('ClearStack(nil) - success:', success, 'err.number:', err.number);
      expect(err.number).not.toBe(0);
      expect(success).toBe(false);
    });
  });

  describe('GciTsGemTrace', () => {
    it('returns previous trace level and sets new level', () => {
      // Get current level (should be 0)
      const { previousLevel: prev0, err: err0 } = gci.GciTsGemTrace(session, 0);
      console.log('GemTrace(0) - previousLevel:', prev0, 'err.number:', err0.number);
      expect(err0.number).toBe(0);

      // Enable trace level 1
      const { previousLevel: prev1, err: err1 } = gci.GciTsGemTrace(session, 1);
      console.log('GemTrace(1) - previousLevel:', prev1, 'err.number:', err1.number);
      expect(err1.number).toBe(0);
      expect(prev1).toBe(0);

      // Disable back to 0
      const { previousLevel: prev2, err: err2 } = gci.GciTsGemTrace(session, 0);
      console.log('GemTrace(0 again) - previousLevel:', prev2, 'err.number:', err2.number);
      expect(err2.number).toBe(0);
      expect(prev2).toBe(1);
    });
  });

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
      console.log('NbExecute - success:', success, 'err.number:', startErr.number);
      expect(startErr.number).toBe(0);
      expect(success).toBe(true);

      // Poll until result is ready (with timeout)
      const { result: pollResult } = gci.GciTsNbPoll(session, 5000);
      console.log('NbPoll - result:', pollResult);
      expect(pollResult).toBe(1);

      // Get the result
      const { result, err } = gci.GciTsNbResult(session);
      console.log('NbResult - result:', result.toString(16), 'err.number:', err.number);
      expect(err.number).toBe(0);

      const { success: ok, value } = gci.GciTsOopToI64(session, result);
      expect(ok).toBe(true);
      expect(value).toBe(7n);
    });

    it('executes a string expression non-blocking and fetches result', () => {
      const { success } = gci.GciTsNbExecute(
        session,
        "'hello' reversed",
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(success).toBe(true);

      const { result: pollResult } = gci.GciTsNbPoll(session, 5000);
      expect(pollResult).toBe(1);

      const { result, err } = gci.GciTsNbResult(session);
      expect(err.number).toBe(0);

      const fetched = gci.GciTsFetchUtf8(session, result, 1024);
      expect(fetched.data).toBe('olleh');
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
      console.log('NbPerform(size) - success:', success, 'err.number:', startErr.number);
      expect(startErr.number).toBe(0);
      expect(success).toBe(true);

      const { result: pollResult } = gci.GciTsNbPoll(session, 5000);
      expect(pollResult).toBe(1);

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

      const { result: pollResult } = gci.GciTsNbPoll(session, 5000);
      expect(pollResult).toBe(1);

      const { result, err } = gci.GciTsNbResult(session);
      expect(err.number).toBe(0);

      // Verify the result is a 2-element array with 10 and 20
      const size = gci.GciTsFetchSize(session, result);
      expect(size.result).toBe(2n);

      const fetched = gci.GciTsFetchOops(session, result, 1n, 2);
      const vals = fetched.oops.map((o) => gci.GciTsOopToI64(session, o).value);
      expect(vals).toEqual([10n, 20n]);
    });
  });

  describe('GciTsNbPoll', () => {
    it('returns 0 with timeout when no NB call is pending', () => {
      // No NB call in progress — poll should return an error or 0
      const { result, err } = gci.GciTsNbPoll(session, 0);
      console.log('NbPoll(no call) - result:', result, 'err.number:', err.number);
      // -1 means error (no NB call in progress)
      expect(result).toBe(-1);
      expect(err.number).not.toBe(0);
    });
  });
});
