import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Priority 5: NSC, PerformFetchOops, FetchGbjInfo, NewStringFromUtf16', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  let OOP_CLASS_STRING: bigint;
  let OOP_CLASS_ARRAY: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    OOP_CLASS_STRING = gci.resolveSymbol(session, 'String');
    OOP_CLASS_ARRAY = gci.resolveSymbol(session, 'Array');
  });

  afterAll(() => {
    if (session) {
      gci.GciTsAbort(session);
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsAddOopsToNsc / GciTsRemoveOopsFromNsc', () => {
    it('adds OOPs to an IdentityBag and removes them', () => {
      // Create an IdentityBag
      const { result: bagOop, err: bagErr } = gci.GciTsExecute(
        session,
        'IdentityBag new',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(bagErr.number).toBe(0);
      expect(bagOop).not.toBe(OOP_ILLEGAL);

      // Create some objects to add
      const str1 = gci.GciTsNewString(session, 'nsc-test-1');
      const str2 = gci.GciTsNewString(session, 'nsc-test-2');
      expect(str1.result).not.toBe(OOP_ILLEGAL);
      expect(str2.result).not.toBe(OOP_ILLEGAL);

      // Add to NSC
      const { success: addOk, err: addErr } = gci.GciTsAddOopsToNsc(session, bagOop, [
        str1.result,
        str2.result,
      ]);
      console.log('AddOopsToNsc - success:', addOk, 'err.number:', addErr.number);
      expect(addErr.number).toBe(0);
      expect(addOk).toBe(true);

      // Verify size is 2
      const { result: sizeOop } = gci.GciTsPerform(session, bagOop, OOP_ILLEGAL, 'size', [], 0, 0);
      expect(gci.GciTsOopToI64(session, sizeOop).value).toBe(2n);

      // Remove from NSC
      const { result: removeResult, err: removeErr } = gci.GciTsRemoveOopsFromNsc(session, bagOop, [
        str1.result,
        str2.result,
      ]);
      console.log('RemoveOopsFromNsc - result:', removeResult, 'err.number:', removeErr.number);
      expect(removeErr.number).toBe(0);
      expect(removeResult).toBe(1); // 1 = all elements were present

      // Verify size is 0
      const { result: sizeOop2 } = gci.GciTsPerform(session, bagOop, OOP_ILLEGAL, 'size', [], 0, 0);
      expect(gci.GciTsOopToI64(session, sizeOop2).value).toBe(0n);
    });

    it('returns 0 when removing OOPs not present in the NSC', () => {
      const { result: bagOop } = gci.GciTsExecute(
        session,
        'IdentityBag new',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      const str = gci.GciTsNewString(session, 'not-in-bag');

      const { result, err } = gci.GciTsRemoveOopsFromNsc(session, bagOop, [str.result]);
      console.log('RemoveOopsFromNsc(not present) - result:', result, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(result).toBe(0); // 0 = not all elements were present
    });
  });

  describe('GciTsPerformFetchOops', () => {
    it('fetches instVars of the result of a perform', () => {
      // Create an Array with known elements: Array with: 10 with: 20 with: 30
      const oop10 = gci.GciTsI64ToOop(session, 10n).result;
      const oop20 = gci.GciTsI64ToOop(session, 20n).result;
      const oop30 = gci.GciTsI64ToOop(session, 30n).result;

      // Use PerformFetchOops to send with:with:with: and get the elements back
      const { result, oops, err } = gci.GciTsPerformFetchOops(
        session,
        OOP_CLASS_ARRAY,
        'with:with:with:',
        [oop10, oop20, oop30],
        10,
      );
      console.log(
        'PerformFetchOops - result:',
        result,
        'oops:',
        oops.map((o) => o.toString(16)),
      );
      expect(err.number).toBe(0);
      expect(result).toBe(3);
      expect(oops).toHaveLength(3);

      const vals = oops.map((o) => gci.GciTsOopToI64(session, o).value);
      expect(vals).toEqual([10n, 20n, 30n]);
    });

    it('fetches with maxResultSize smaller than actual size', () => {
      const oop1 = gci.GciTsI64ToOop(session, 1n).result;
      const oop2 = gci.GciTsI64ToOop(session, 2n).result;
      const oop3 = gci.GciTsI64ToOop(session, 3n).result;

      // Only request 2 OOPs max
      const { result, oops, err } = gci.GciTsPerformFetchOops(
        session,
        OOP_CLASS_ARRAY,
        'with:with:with:',
        [oop1, oop2, oop3],
        2,
      );
      console.log(
        'PerformFetchOops(limited) - result:',
        result,
        'oops:',
        oops.map((o) => o.toString(16)),
      );
      expect(err.number).toBe(0);
      expect(result).toBe(2);
      expect(oops).toHaveLength(2);
    });
  });

  describe('GciTsFetchGbjInfo', () => {
    it('fetches info for a String object', () => {
      const strOop = gci.GciTsNewString(session, 'hello gbjInfo');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { result, info, data, err } = gci.GciTsFetchGbjInfo(
        session,
        strOop.result,
        false,
        1024,
      );
      console.log(
        'FetchGbjInfo(String) - result:',
        result.toString(),
        'info.objClass:',
        info.objClass.toString(16),
        'info.objSize:',
        info.objSize.toString(),
        'info.extraBits:',
        info.extraBits.toString(16),
        'info.bytesReturned:',
        info.bytesReturned.toString(),
      );
      expect(err.number).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0n);
      expect(info.objClass).toBe(OOP_CLASS_STRING);
      expect(info.objSize).toBe(13n); // 'hello gbjInfo' is 13 bytes
      // bytesReturned should match the string length
      expect(info.bytesReturned).toBe(13n);
      // data buffer should contain the string bytes
      const str = data.subarray(0, Number(info.bytesReturned)).toString('utf8');
      expect(str).toBe('hello gbjInfo');
    });

    it('fetches info for an Array object', () => {
      const { result: arrOop } = gci.GciTsExecute(
        session,
        'Array new: 5',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(arrOop).not.toBe(OOP_ILLEGAL);

      const { result, info, err } = gci.GciTsFetchGbjInfo(session, arrOop, false, 1024);
      console.log(
        'FetchGbjInfo(Array) - result:',
        result.toString(),
        'info.objClass:',
        info.objClass.toString(16),
        'info.objSize:',
        info.objSize.toString(),
        'info._bits:',
        info._bits.toString(2),
      );
      expect(err.number).toBe(0);
      expect(result).toBeGreaterThanOrEqual(0n);
      expect(info.objClass).toBe(OOP_CLASS_ARRAY);
      expect(info.objSize).toBe(5n); // 5 slots
    });

    it('returns -2 for a non-existent object', () => {
      const bogusOop = 0xffffffffn;
      const { result, err } = gci.GciTsFetchGbjInfo(session, bogusOop, false, 64);
      console.log('FetchGbjInfo(bogus) - result:', result.toString(), 'err.number:', err.number);
      // result should be -2 (object does not exist) or -1 (error)
      expect(result).toBeLessThan(0n);
    });
  });

  describe('GciTsNewStringFromUtf16', () => {
    it('creates a String from UTF-16 code units (ASCII text)', () => {
      // 'Hello' as UTF-16 code units
      const utf16 = [0x48, 0x65, 0x6c, 0x6c, 0x6f]; // H e l l o
      const { result, err } = gci.GciTsNewStringFromUtf16(session, utf16, 0);
      console.log(
        'NewStringFromUtf16(Hello) - result:',
        result.toString(16),
        'err.number:',
        err.number,
      );
      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);

      // Fetch back and verify
      const fetched = gci.GciTsFetchUtf8(session, result, 1024);
      expect(fetched.data).toBe('Hello');
    });

    it('creates a String from UTF-16 with non-ASCII characters', () => {
      // 'café' as UTF-16: c=0x63, a=0x61, f=0x66, é=0xE9
      const utf16 = [0x63, 0x61, 0x66, 0xe9];
      const { result, err } = gci.GciTsNewStringFromUtf16(session, utf16, 0);
      console.log(
        'NewStringFromUtf16(café) - result:',
        result.toString(16),
        'err.number:',
        err.number,
      );
      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUtf8(session, result, 1024);
      expect(fetched.data).toBe('café');
    });

    it('creates a Unicode string with unicodeKind=1', () => {
      const utf16 = [0x48, 0x65, 0x6c, 0x6c, 0x6f];
      const { result, err } = gci.GciTsNewStringFromUtf16(session, utf16, 1);
      console.log(
        'NewStringFromUtf16(unicode) - result:',
        result.toString(16),
        'err.number:',
        err.number,
      );
      expect(err.number).toBe(0);
      expect(result).not.toBe(OOP_ILLEGAL);

      // Verify the class is Unicode7 (not String)
      const classOop = gci.GciTsFetchClass(session, result);
      const unicode7Oop = gci.resolveSymbol(session, 'Unicode7');
      expect(classOop.result).toBe(unicode7Oop);

      const fetched = gci.GciTsFetchUtf8(session, result, 1024);
      expect(fetched.data).toBe('Hello');
    });
  });
});
