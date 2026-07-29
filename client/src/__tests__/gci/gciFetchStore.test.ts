import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Fetch/Store Bytes and OOPs', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  // Discover class OOPs at runtime
  let OOP_CLASS_ARRAY: bigint;
  let OOP_CLASS_STRING: bigint;
  let OOP_CLASS_BYTE_ARRAY: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    OOP_CLASS_ARRAY = gci.resolveSymbol(session, 'Array');
    OOP_CLASS_STRING = gci.resolveSymbol(session, 'String');
    OOP_CLASS_BYTE_ARRAY = gci.resolveSymbol(session, 'ByteArray');
    console.log(
      'Class OOPs - Array:',
      OOP_CLASS_ARRAY.toString(),
      'String:',
      OOP_CLASS_STRING.toString(),
      'ByteArray:',
      OOP_CLASS_BYTE_ARRAY.toString(),
    );
  });

  afterAll(() => {
    if (session) {
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsFetchBytes', () => {
    it('fetches bytes from a String', () => {
      const strOop = gci.GciTsNewString(session, 'Hello GCI');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { bytesReturned, data, err } = gci.GciTsFetchBytes(session, strOop.result, 1n, 9);
      console.log(
        'FetchBytes - bytesReturned:',
        bytesReturned.toString(),
        'data:',
        data.toString('utf8', 0, Number(bytesReturned)),
      );
      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(9n);
      expect(data.toString('utf8', 0, 9)).toBe('Hello GCI');
    });

    it('fetches a subset of bytes with startIndex', () => {
      const strOop = gci.GciTsNewString(session, 'abcdefghij');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      // Fetch 3 bytes starting at index 4 (Smalltalk 1-based: 'd', 'e', 'f')
      const { bytesReturned, data, err } = gci.GciTsFetchBytes(session, strOop.result, 4n, 3);
      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(3n);
      expect(data.toString('utf8', 0, 3)).toBe('def');
    });

    it('fetches bytes from a ByteArray', () => {
      const bytes = Buffer.from([0x01, 0x02, 0xff, 0x00, 0xab]);
      const baOop = gci.GciTsNewByteArray(session, bytes);
      expect(baOop.result).not.toBe(OOP_ILLEGAL);

      const { bytesReturned, data, err } = gci.GciTsFetchBytes(session, baOop.result, 1n, 5);
      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(5n);
      expect(data[0]).toBe(0x01);
      expect(data[1]).toBe(0x02);
      expect(data[2]).toBe(0xff);
      expect(data[3]).toBe(0x00);
      expect(data[4]).toBe(0xab);
    });
  });

  describe('GciTsFetchChars', () => {
    it('fetches a String as a null-terminated C string', () => {
      const strOop = gci.GciTsNewString(session, 'GemStone');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { bytesReturned, data, err } = gci.GciTsFetchChars(session, strOop.result, 1n, 1024);
      console.log('FetchChars - bytesReturned:', bytesReturned.toString(), 'data:', data);
      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(8n);
      expect(data).toBe('GemStone');
    });

    it('truncates when maxSize is smaller than the string', () => {
      const strOop = gci.GciTsNewString(session, 'Hello World');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      // maxSize=6 means at most 5 bytes fetched + null terminator
      const { bytesReturned, data, err } = gci.GciTsFetchChars(session, strOop.result, 1n, 6);
      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(5n);
      expect(data).toBe('Hello');
    });
  });

  describe('GciTsFetchUtf8Bytes', () => {
    it('fetches UTF-8 bytes from a String', () => {
      const strOop = gci.GciTsNewString(session, 'hello');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const { bytesReturned, data, err } = gci.GciTsFetchUtf8Bytes(
        session,
        strOop.result,
        1n,
        1024,
      );
      console.log('FetchUtf8Bytes - bytesReturned:', bytesReturned.toString());
      expect(err.number).toBe(0);
      expect(bytesReturned).toBe(5n);
      expect(data.toString('utf8', 0, 5)).toBe('hello');
    });
  });

  describe('GciTsStoreBytes', () => {
    it('stores bytes into a String', () => {
      const strOop = gci.GciTsNewString(session, 'aaaaa');
      expect(strOop.result).not.toBe(OOP_ILLEGAL);

      const newBytes = Buffer.from('XYZ', 'utf8');
      const { success, err } = gci.GciTsStoreBytes(
        session,
        strOop.result,
        2n,
        newBytes,
        OOP_CLASS_STRING,
      );
      console.log('StoreBytes - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);

      // Verify: should now be 'aXYZa'
      const fetched = gci.GciTsFetchChars(session, strOop.result, 1n, 1024);
      expect(fetched.data).toBe('aXYZa');
    });

    it('stores bytes into a ByteArray', () => {
      const bytes = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const baOop = gci.GciTsNewByteArray(session, bytes);
      expect(baOop.result).not.toBe(OOP_ILLEGAL);

      const newBytes = Buffer.from([0xde, 0xad]);
      const { success, err } = gci.GciTsStoreBytes(
        session,
        baOop.result,
        2n,
        newBytes,
        OOP_CLASS_BYTE_ARRAY,
      );
      expect(err.number).toBe(0);
      expect(success).toBe(true);

      // Verify: should now be [0x00, 0xDE, 0xAD, 0x00]
      const fetched = gci.GciTsFetchBytes(session, baOop.result, 1n, 4);
      expect(fetched.data[0]).toBe(0x00);
      expect(fetched.data[1]).toBe(0xde);
      expect(fetched.data[2]).toBe(0xad);
      expect(fetched.data[3]).toBe(0x00);
    });
  });

  describe('GciTsFetchOops', () => {
    it('fetches all elements of an Array', () => {
      // Create Array with 3 elements: execute "Array with: 10 with: 20 with: 30"
      const { result: arrOop, err: execErr } = gci.GciTsExecute(
        session,
        'Array with: 10 with: 20 with: 30',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(execErr.number).toBe(0);

      const { result, oops, err } = gci.GciTsFetchOops(session, arrOop, 1n, 3);
      console.log('FetchOops - result:', result, 'oops count:', oops.length);
      expect(err.number).toBe(0);
      expect(result).toBe(3);
      expect(oops).toHaveLength(3);

      // Verify the OOP values are SmallIntegers 10, 20, 30
      const val1 = gci.GciTsOopToI64(session, oops[0]);
      const val2 = gci.GciTsOopToI64(session, oops[1]);
      const val3 = gci.GciTsOopToI64(session, oops[2]);
      expect(val1.value).toBe(10n);
      expect(val2.value).toBe(20n);
      expect(val3.value).toBe(30n);
    });

    it('fetches a subset with startIndex', () => {
      const { result: arrOop } = gci.GciTsExecute(
        session,
        '#(100 200 300 400 500)',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );

      // Fetch 2 elements starting at index 3 (Smalltalk 1-based: 300, 400)
      const { result, oops, err } = gci.GciTsFetchOops(session, arrOop, 3n, 2);
      expect(err.number).toBe(0);
      expect(result).toBe(2);

      const val1 = gci.GciTsOopToI64(session, oops[0]);
      const val2 = gci.GciTsOopToI64(session, oops[1]);
      expect(val1.value).toBe(300n);
      expect(val2.value).toBe(400n);
    });
  });

  describe('GciTsFetchNamedOops', () => {
    it('fetches named inst vars from an Association', () => {
      // Association has named instVars: key, value
      const { result: assocOop, err: execErr } = gci.GciTsExecute(
        session,
        'Association new key: #myKey value: 42',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );
      expect(execErr.number).toBe(0);

      const { result, oops, err } = gci.GciTsFetchNamedOops(session, assocOop, 1n, 2);
      console.log(
        'FetchNamedOops - result:',
        result,
        'oops:',
        oops.map((o) => o.toString()),
      );
      expect(err.number).toBe(0);
      expect(result).toBe(2);

      // First named instVar is 'key' (#myKey), second is 'value' (42)
      const val = gci.GciTsOopToI64(session, oops[1]);
      expect(val.value).toBe(42n);
    });
  });

  describe('GciTsFetchVaryingOops', () => {
    it('fetches varying elements from an Array', () => {
      const { result: arrOop } = gci.GciTsExecute(
        session,
        '#(7 8 9)',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );

      const { result, oops, err } = gci.GciTsFetchVaryingOops(session, arrOop, 1n, 3);
      console.log('FetchVaryingOops - result:', result);
      expect(err.number).toBe(0);
      expect(result).toBe(3);

      const vals = oops.map((o) => gci.GciTsOopToI64(session, o).value);
      expect(vals).toEqual([7n, 8n, 9n]);
    });
  });

  describe('GciTsStoreOops', () => {
    it('stores OOPs into an Array', () => {
      // Create Array new: 3
      const { result: arrOop } = gci.GciTsExecute(
        session,
        'Array new: 3',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );

      // Store SmallIntegers 100, 200, 300
      const oop100 = gci.GciTsI64ToOop(session, 100n).result;
      const oop200 = gci.GciTsI64ToOop(session, 200n).result;
      const oop300 = gci.GciTsI64ToOop(session, 300n).result;

      const { success, err } = gci.GciTsStoreOops(session, arrOop, 1n, [oop100, oop200, oop300]);
      console.log('StoreOops - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);

      // Verify
      const fetched = gci.GciTsFetchOops(session, arrOop, 1n, 3);
      const vals = fetched.oops.map((o) => gci.GciTsOopToI64(session, o).value);
      expect(vals).toEqual([100n, 200n, 300n]);
    });
  });

  describe('GciTsStoreNamedOops', () => {
    it('stores into named inst vars of an Association', () => {
      const { result: assocOop } = gci.GciTsExecute(
        session,
        'Association new',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );

      const keyOop = gci.GciTsNewSymbol(session, 'testKey').result;
      const valOop = gci.GciTsI64ToOop(session, 77n).result;

      const { success, err } = gci.GciTsStoreNamedOops(session, assocOop, 1n, [keyOop, valOop]);
      console.log('StoreNamedOops - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);

      // Verify via perform
      const { data: keyData } = gci.GciTsPerformFetchBytes(session, assocOop, 'key', [], 1024);
      expect(keyData).toBe('testKey');

      const valResult = gci.GciTsPerform(session, assocOop, OOP_ILLEGAL, 'value', [], 0, 0);
      const valInt = gci.GciTsOopToI64(session, valResult.result);
      expect(valInt.value).toBe(77n);
    });
  });

  describe('GciTsStoreIdxOops', () => {
    it('stores into varying (indexed) slots of an Array', () => {
      const { result: arrOop } = gci.GciTsExecute(
        session,
        'Array new: 4',
        OOP_CLASS_STRING,
        OOP_ILLEGAL,
        OOP_NIL,
        0,
        0,
      );

      const oop10 = gci.GciTsI64ToOop(session, 10n).result;
      const oop20 = gci.GciTsI64ToOop(session, 20n).result;

      // Store at varying index 2 and 3
      const { success, err } = gci.GciTsStoreIdxOops(session, arrOop, 2n, [oop10, oop20]);
      console.log('StoreIdxOops - success:', success, 'err.number:', err.number);
      expect(err.number).toBe(0);
      expect(success).toBe(true);

      // Verify: slot 1=nil, 2=10, 3=20, 4=nil
      const fetched = gci.GciTsFetchVaryingOops(session, arrOop, 1n, 4);
      expect(fetched.oops[0]).toBe(OOP_NIL);
      expect(gci.GciTsOopToI64(session, fetched.oops[1]).value).toBe(10n);
      expect(gci.GciTsOopToI64(session, fetched.oops[2]).value).toBe(20n);
      expect(fetched.oops[3]).toBe(OOP_NIL);
    });
  });
});
