import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Object Inquiry', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  let session: unknown;

  // Class OOPs discovered at runtime
  let OOP_CLASS_STRING: bigint;
  let OOP_CLASS_SYMBOL: bigint;
  let OOP_CLASS_BYTE_ARRAY: bigint;

  beforeAll(() => {
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = login.session;

    // Discover class OOPs by creating instances and fetching their class
    const str = gci.GciTsNewString(session, 'probe');
    OOP_CLASS_STRING = gci.GciTsFetchClass(session, str.result).result;

    const sym = gci.GciTsNewSymbol(session, 'probe');
    OOP_CLASS_SYMBOL = gci.GciTsFetchClass(session, sym.result).result;

    const ba = gci.GciTsNewByteArray(session, Buffer.from([1]));
    OOP_CLASS_BYTE_ARRAY = gci.GciTsFetchClass(session, ba.result).result;

    console.log('Discovered class OOPs:');
    console.log('  String:', OOP_CLASS_STRING.toString());
    console.log('  Symbol:', OOP_CLASS_SYMBOL.toString());
    console.log('  ByteArray:', OOP_CLASS_BYTE_ARRAY.toString());
  });

  afterAll(() => {
    if (session) {
      gci.GciTsLogout(session);
    }
    gci.close();
  });

  describe('GciTsFetchUnicode', () => {
    it('fetches a String as UTF-16', () => {
      const text = 'hello';
      const { result: oop } = gci.GciTsNewString(session, text);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUnicode(session, oop, 256);
      console.log(
        'FetchUnicode - bytesReturned:',
        fetched.bytesReturned,
        'requiredSize:',
        fetched.requiredSize,
      );
      expect(fetched.bytesReturned).toBeGreaterThan(0n);

      // Decode UTF-16LE from the buffer
      const numShorts = Number(fetched.bytesReturned);
      const decoded = fetched.data.toString('utf16le', 0, numShorts * 2);
      expect(decoded).toBe(text);
    });
  });

  describe('GciTsIsKindOf', () => {
    it('String isKindOf String → true', () => {
      const { result: strOop } = gci.GciTsNewString(session, 'kind test');
      const { result } = gci.GciTsIsKindOf(session, strOop, OOP_CLASS_STRING);
      expect(result).toBe(1);
    });

    it('String isKindOf ByteArray → false', () => {
      const { result: strOop } = gci.GciTsNewString(session, 'kind test 2');
      const { result } = gci.GciTsIsKindOf(session, strOop, OOP_CLASS_BYTE_ARRAY);
      expect(result).toBe(0);
    });
  });

  describe('GciTsIsSubclassOf', () => {
    it('Symbol isSubclassOf String → true', () => {
      const { result } = gci.GciTsIsSubclassOf(session, OOP_CLASS_SYMBOL, OOP_CLASS_STRING);
      console.log('Symbol isSubclassOf String:', result);
      expect(result).toBe(1);
    });

    it('String isSubclassOf Symbol → false', () => {
      const { result } = gci.GciTsIsSubclassOf(session, OOP_CLASS_STRING, OOP_CLASS_SYMBOL);
      expect(result).toBe(0);
    });
  });

  describe('GciTsIsKindOfClass', () => {
    it('String instance isKindOfClass String → true', () => {
      const { result: strOop } = gci.GciTsNewString(session, 'kindOfClass test');
      const { result } = gci.GciTsIsKindOfClass(session, strOop, OOP_CLASS_STRING);
      expect(result).toBe(1);
    });
  });

  describe('GciTsIsSubclassOfClass', () => {
    it('Symbol isSubclassOfClass String → true', () => {
      const { result } = gci.GciTsIsSubclassOfClass(session, OOP_CLASS_SYMBOL, OOP_CLASS_STRING);
      expect(result).toBe(1);
    });
  });

  describe('GciTsResolveSymbolObj', () => {
    it('resolves a Symbol OOP for "Array" to the Array class', () => {
      const { result: symOop } = gci.GciTsNewSymbol(session, 'Array');
      expect(symOop).not.toBe(OOP_ILLEGAL);

      const { result, err } = gci.GciTsResolveSymbolObj(session, symOop, OOP_NIL);
      console.log(
        'ResolveSymbolObj(Array) - result:',
        result.toString(),
        'err.number:',
        err.number,
      );
      expect(result).not.toBe(OOP_ILLEGAL);

      // Should match what ResolveSymbol returns
      const expected = gci.resolveSymbol(session, 'Array');
      expect(result).toBe(expected);
    });
  });
});
