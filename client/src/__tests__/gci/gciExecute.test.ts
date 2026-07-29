import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GciTsExecute / GciTsPerform', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  // Discover class OOPs at runtime
  let OOP_CLASS_ARRAY: bigint;
  let OOP_CLASS_STRING: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    OOP_CLASS_ARRAY = gci.resolveSymbol(session, 'Array');
    OOP_CLASS_STRING = gci.resolveSymbol(session, 'String');
    console.log(
      'Class OOPs - Array:',
      OOP_CLASS_ARRAY.toString(),
      'String:',
      OOP_CLASS_STRING.toString(),
    );
  });

  afterAll(() => {
    if (session) {
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsExecute', () => {
    it('executes "Array new: 4" and returns an Array', () => {
      const { result, err } = gci.GciTsExecute(
        session,
        'Array new: 4',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      console.log(
        'Execute("Array new: 4") - result:',
        result.toString(16),
        'err.number:',
        err.number,
      );
      expect(result).not.toBe(OOP_ILLEGAL);
      expect(err.number).toBe(0);

      // Verify the result is an Array of size 4
      const cls = gci.GciTsFetchClass(session, result);
      expect(cls.result).toBe(OOP_CLASS_ARRAY);

      const size = gci.GciTsFetchSize(session, result);
      expect(size.result).toBe(4n);
    });

    it('executes "3 + 4" and returns SmallInteger 7', () => {
      const { result, err } = gci.GciTsExecute(
        session,
        '3 + 4',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, result);
      expect(success).toBe(true);
      expect(value).toBe(7n);
    });

    it('returns an error for invalid Smalltalk', () => {
      const { result, err } = gci.GciTsExecute(
        session,
        '!!! invalid syntax !!!',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      console.log('Execute(invalid) - err.number:', err.number, 'err.message:', err.message);
      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).not.toBe(0);
    });
  });

  describe('GciTsExecute_', () => {
    it('executes with explicit source size', () => {
      const source = 'Array new: 3';
      const { result, err } = gci.GciTsExecute_(
        session,
        source,
        -1,
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);

      const size = gci.GciTsFetchSize(session, result);
      expect(size.result).toBe(3n);
    });
  });

  describe('GciTsExecuteFetchBytes', () => {
    it('executes and fetches the result as bytes', () => {
      const source = "'hello world' copy";
      const { bytesReturned, data, err } = gci.GciTsExecuteFetchBytes(
        session,
        source,
        -1,
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        1024,
      );
      console.log('ExecuteFetchBytes - bytesReturned:', bytesReturned, 'data:', data);
      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(11);
      expect(data).toBe('hello world');
    });

    it('executes a numeric-to-string conversion', () => {
      const source = '(3 + 4) printString';
      const { data, err } = gci.GciTsExecuteFetchBytes(
        session,
        source,
        -1,
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        1024,
      );
      expect(err.number).toBe(0);
      expect(data).toBe('7');
    });
  });

  describe('GciTsPerform', () => {
    it('sends new: to Array with SmallInteger arg', () => {
      const argOop = gci.GciTsI64ToOop(session, 5n);
      expect(argOop.err.number).toBe(0);

      const { result, err } = gci.GciTsPerform(
        session,
        OOP_CLASS_ARRAY,
        OOP_ILLEGAL,
        'new:',
        [argOop.result],
        0,
        0,
      );
      console.log(
        'Perform(Array new: 5) - result:',
        result.toString(16),
        'err.number:',
        err.number,
      );
      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);

      const cls = gci.GciTsFetchClass(session, result);
      expect(cls.result).toBe(OOP_CLASS_ARRAY);

      const size = gci.GciTsFetchSize(session, result);
      expect(size.result).toBe(5n);
    });

    it('sends size to a String', () => {
      const strOop = gci.GciTsNewString(session, 'hello');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { result, err } = gci.GciTsPerform(
        session,
        strOop.result,
        OOP_ILLEGAL,
        'size',
        [],
        0,
        0,
      );
      expect(err.number).toBe(0);

      const { success, value } = gci.GciTsOopToI64(session, result);
      expect(success).toBe(true);
      expect(value).toBe(5n);
    });

    it('sends reversed to a String', () => {
      const strOop = gci.GciTsNewString(session, 'abcdef');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { result, err } = gci.GciTsPerform(
        session,
        strOop.result,
        OOP_ILLEGAL,
        'reversed',
        [],
        0,
        0,
      );
      expect(err.number).toBe(0);

      const fetched = gci.GciTsFetchUtf8(session, result, 1024);
      expect(fetched.data).toBe('fedcba');
    });

    it('returns an error for an unknown selector', () => {
      const strOop = gci.GciTsNewString(session, 'test');
      const { result, err } = gci.GciTsPerform(
        session,
        strOop.result,
        OOP_ILLEGAL,
        'noSuchSelector99',
        [],
        0,
        0,
      );
      console.log('Perform(unknown) - err.number:', err.number, 'err.message:', err.message);
      expect(result).toBe(OOP_ILLEGAL);
      expect(err.number).not.toBe(0);
    });
  });

  describe('GciTsPerformFetchBytes', () => {
    it('sends printString to a SmallInteger', () => {
      const intOop = gci.GciTsI64ToOop(session, 42n);
      expect(intOop.err.number).toBe(0);

      const { data, err } = gci.GciTsPerformFetchBytes(
        session,
        intOop.result,
        'printString',
        [],
        1024,
      );
      console.log('PerformFetchBytes(42 printString) - data:', data);
      expect(err.number).toBe(0);
      expect(data).toBe('42');
    });

    it('sends reversed to a String and fetches bytes', () => {
      const strOop = gci.GciTsNewString(session, 'GemStone');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { data, err } = gci.GciTsPerformFetchBytes(
        session,
        strOop.result,
        'reversed',
        [],
        1024,
      );
      expect(err.number).toBe(0);
      expect(data).toBe('enotSmeG');
    });

    it('sends , (comma) to concatenate two strings', () => {
      const strOop = gci.GciTsNewString(session, 'Hello');
      const argOop = gci.GciTsNewString(session, ' World');

      const { data, err } = gci.GciTsPerformFetchBytes(
        session,
        strOop.result,
        ',',
        [argOop.result],
        1024,
      );
      expect(err.number).toBe(0);
      expect(data).toBe('Hello World');
    });
  });
});
