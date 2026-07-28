import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() + 'n' : value;
}

const OOP_ILLEGAL = 0x01n;
const OOP_NIL = 0x14n;

describe('GCI Object Creation and Inquiry', () => {
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

    // Create an Array via GciTsNewObj
    // We need the Array class OOP - discover it via GciTsFetchClass on an existing array
    // Instead, we'll use a well-known technique: resolve 'Array' symbol and use it
    // For now, just log what we find
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

  describe('GciTsNewString and GciTsFetchUtf8', () => {
    it('creates a String and fetches it back', () => {
      const text = 'Hello, GemStone!';
      const { result: oop, err } = gci.GciTsNewString(session, text);
      console.log('NewString - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUtf8(session, oop, 1024);
      console.log('FetchUtf8 - data:', fetched.data, 'bytesReturned:', fetched.bytesReturned);
      expect(fetched.data).toBe(text);
    });

    it('creates a String with explicit size via NewString_', () => {
      const text = 'Hello\0World';
      const buf = Buffer.from(text, 'utf8');
      const { result: oop } = gci.GciTsNewString_(session, text, buf.length);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const size = gci.GciTsFetchSize(session, oop);
      expect(size.result).toBe(BigInt(buf.length));
    });
  });

  describe('GciTsNewSymbol', () => {
    it('creates a Symbol and verifies its class', () => {
      const { result: oop, err } = gci.GciTsNewSymbol(session, 'testSymbol');
      console.log('NewSymbol - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const cls = gci.GciTsFetchClass(session, oop);
      expect(cls.result).toBe(OOP_CLASS_SYMBOL);
    });

    it('returns the same OOP for the same symbol name', () => {
      const a = gci.GciTsNewSymbol(session, 'sameSymbol');
      const b = gci.GciTsNewSymbol(session, 'sameSymbol');
      expect(a.result).toBe(b.result);
    });
  });

  describe('GciTsNewByteArray', () => {
    it('creates a ByteArray and verifies class and size', () => {
      const data = Buffer.from([0x01, 0x02, 0x03, 0xff]);
      const { result: oop, err } = gci.GciTsNewByteArray(session, data);
      console.log('NewByteArray - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const cls = gci.GciTsFetchClass(session, oop);
      expect(cls.result).toBe(OOP_CLASS_BYTE_ARRAY);

      const size = gci.GciTsFetchVaryingSize(session, oop);
      expect(size.result).toBe(4n);
    });
  });

  describe('GciTsNewObj', () => {
    it('creates an empty instance of a class', () => {
      const { result: oop, err } = gci.GciTsNewObj(session, OOP_CLASS_BYTE_ARRAY);
      console.log('NewObj(ByteArray) - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const cls = gci.GciTsFetchClass(session, oop);
      expect(cls.result).toBe(OOP_CLASS_BYTE_ARRAY);

      const size = gci.GciTsFetchVaryingSize(session, oop);
      expect(size.result).toBe(0n);
    });
  });

  describe('GciTsNewUtf8String and GciTsNewUtf8String_', () => {
    it('creates a Utf8 string (no conversion)', () => {
      const text = 'café';
      const { result: oop, err } = gci.GciTsNewUtf8String(session, text, false);
      console.log('NewUtf8String(no convert) - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUtf8(session, oop, 1024);
      expect(fetched.data).toBe(text);
    });

    it('creates a Unicode string (with conversion)', () => {
      const text = 'café';
      const { result: oop, err } = gci.GciTsNewUtf8String(session, text, true);
      console.log('NewUtf8String(convert) - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUtf8(session, oop, 1024);
      expect(fetched.data).toBe(text);
    });

    it('creates a Utf8 string with explicit size via NewUtf8String_', () => {
      const text = 'hello';
      const nBytes = Buffer.byteLength(text, 'utf8');
      const { result: oop } = gci.GciTsNewUtf8String_(session, text, nBytes, false);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUtf8(session, oop, 1024);
      expect(fetched.data).toBe(text);
    });
  });

  describe('GciTsNewUnicodeString and GciTsNewUnicodeString_', () => {
    it('creates a UnicodeString from UTF-16 data (null-terminated)', () => {
      const text = 'Hi!';
      // Build null-terminated UTF-16LE buffer
      const utf16 = Buffer.alloc((text.length + 1) * 2);
      for (let i = 0; i < text.length; i++) {
        utf16.writeUInt16LE(text.charCodeAt(i), i * 2);
      }
      utf16.writeUInt16LE(0, text.length * 2); // null terminator

      const { result: oop, err } = gci.GciTsNewUnicodeString(session, utf16);
      console.log('NewUnicodeString - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUtf8(session, oop, 1024);
      expect(fetched.data).toBe(text);
    });

    it('creates a UnicodeString from UTF-16 data with explicit size', () => {
      const text = 'Test';
      const numShorts = text.length;
      const utf16 = Buffer.alloc(numShorts * 2);
      for (let i = 0; i < text.length; i++) {
        utf16.writeUInt16LE(text.charCodeAt(i), i * 2);
      }

      const { result: oop, err } = gci.GciTsNewUnicodeString_(session, utf16, numShorts);
      console.log('NewUnicodeString_ - oop:', oop.toString(16), 'err.number:', err.number);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const fetched = gci.GciTsFetchUtf8(session, oop, 1024);
      expect(fetched.data).toBe(text);
    });
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

  describe('GciTsFetchObjInfo', () => {
    it('returns object info for a String', () => {
      const text = 'info test';
      const { result: oop } = gci.GciTsNewString(session, text);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const { result, info } = gci.GciTsFetchObjInfo(session, oop, false, 1024);
      console.log(
        'FetchObjInfo - result:',
        result,
        'info:',
        JSON.stringify(info, bigIntReplacer, 2),
      );
      expect(result).toBeGreaterThanOrEqual(0n);
      expect(info.objId).toBe(oop);
      expect(info.objClass).toBe(OOP_CLASS_STRING);
    });
  });

  describe('GciTsFetchSize and GciTsFetchVaryingSize', () => {
    it('returns correct sizes for a String', () => {
      const text = 'size test';
      const { result: oop } = gci.GciTsNewString(session, text);
      expect(oop).not.toBe(OOP_ILLEGAL);

      const totalSize = gci.GciTsFetchSize(session, oop);
      const varyingSize = gci.GciTsFetchVaryingSize(session, oop);
      console.log('FetchSize:', totalSize.result, 'FetchVaryingSize:', varyingSize.result);

      expect(totalSize.result).toBe(BigInt(text.length));
      expect(varyingSize.result).toBe(BigInt(text.length));
    });
  });

  describe('GciTsFetchClass', () => {
    it('returns the class of a String', () => {
      const { result: oop } = gci.GciTsNewString(session, 'class test');
      const cls = gci.GciTsFetchClass(session, oop);
      expect(cls.result).toBe(OOP_CLASS_STRING);
    });

    it('returns the class of OOP_NIL (UndefinedObject)', () => {
      const cls = gci.GciTsFetchClass(session, OOP_NIL);
      // GciTsFetchClass on a special should return OOP_ILLEGAL or the special class
      console.log('FetchClass(nil) - result:', cls.result.toString());
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

  describe('GciTsObjExists', () => {
    it('returns true for an existing object', () => {
      const { result: oop } = gci.GciTsNewString(session, 'exists test');
      expect(gci.GciTsObjExists(session, oop)).toBe(true);
    });

    it('returns true for OOP_NIL', () => {
      expect(gci.GciTsObjExists(session, OOP_NIL)).toBe(true);
    });

    it('returns false for OOP_ILLEGAL', () => {
      expect(gci.GciTsObjExists(session, OOP_ILLEGAL)).toBe(false);
    });
  });
});
