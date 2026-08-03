import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Fetch/Store Named and Indexed OOPs', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  // Discover class OOPs at runtime
  let OOP_CLASS_STRING: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    OOP_CLASS_STRING = gci.resolveSymbol(session, 'String');
    console.log('Class OOPs - String:', OOP_CLASS_STRING.toString());
  });

  afterAll(() => {
    if (session) {
      gci.GciTsLogout(session);
    }
    gci.close();
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
