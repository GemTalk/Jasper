import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import {
  OOP_CLASS_STRING,
  OOP_CLASS_UNDEFINED_OBJECT,
  OOP_CLASS_UTF8,
  OOP_ILLEGAL,
  OOP_NIL,
} from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The GCI's object-creation and object-inquiry calls: making Strings, Symbols,
 * ByteArrays and bare instances in the stone, then asking about their class,
 * size, class membership and identity. Objects created here are never
 * committed — the harness aborts each test's transaction.
 */
describe('GCI object creation and inquiry (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
  });

  const classOop = (name: string): bigint => gci.resolveSymbol(session, name);

  describe('GciTsNewString / GciTsFetchUtf8', () => {
    it('round-trips text through a new String', () => {
      const text = 'Hello, GemStone!';

      const { result: oop } = gci.GciTsNewString(session, text);

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchUtf8(session, oop, 1024).data).toBe(text);
    });

    it('takes an explicit size so embedded nulls survive', () => {
      const text = 'Hello\0World';
      const byteLength = Buffer.byteLength(text, 'utf8');

      const { result: oop } = gci.GciTsNewString_(session, text, byteLength);

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchSize(session, oop).result).toBe(BigInt(byteLength));
    });
  });

  describe('GciTsNewSymbol', () => {
    it('creates an instance of Symbol', () => {
      const { result: oop } = gci.GciTsNewSymbol(session, 'testSymbol');

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchClass(session, oop).result).toBe(classOop('Symbol'));
    });

    it('interns symbols, so the same name yields the same object', () => {
      const first = gci.GciTsNewSymbol(session, 'sameSymbol');
      const second = gci.GciTsNewSymbol(session, 'sameSymbol');

      expect(first.result).toBe(second.result);
    });
  });

  describe('GciTsNewByteArray', () => {
    it('creates a ByteArray sized to the bytes it was given', () => {
      const { result: oop } = gci.GciTsNewByteArray(session, Buffer.from([0x01, 0x02, 0x03, 0xff]));

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchClass(session, oop).result).toBe(classOop('ByteArray'));
      expect(gci.GciTsFetchVaryingSize(session, oop).result).toBe(4n);
    });
  });

  describe('GciTsNewObj', () => {
    it('creates an empty instance of the given class', () => {
      const { result: oop } = gci.GciTsNewObj(session, classOop('ByteArray'));

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchClass(session, oop).result).toBe(classOop('ByteArray'));
      expect(gci.GciTsFetchVaryingSize(session, oop).result).toBe(0n);
    });
  });

  describe('GciTsNewUtf8String / GciTsNewUtf8String_', () => {
    it('stores UTF-8 bytes verbatim in a Utf8 when asked not to convert', () => {
      const text = 'café';

      const { result: oop } = gci.GciTsNewUtf8String(session, text, false);

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchClass(session, oop).result).toBe(OOP_CLASS_UTF8);
      expect(gci.GciTsFetchUtf8(session, oop, 1024).data).toBe(text);
    });

    it('converts to a Unicode string when asked to', () => {
      // Text outside ASCII, so the conversion has to widen it — a Unicode16
      // rather than the Utf8 the unconverted case above answers.
      const text = 'café';

      const { result: oop } = gci.GciTsNewUtf8String(session, text, true);

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchClass(session, oop).result).toBe(classOop('Unicode16'));
      expect(gci.GciTsFetchUtf8(session, oop, 1024).data).toBe(text);
    });

    it('takes an explicit byte count instead of a null terminator', () => {
      const text = 'hello';

      const { result: oop } = gci.GciTsNewUtf8String_(
        session,
        text,
        Buffer.byteLength(text, 'utf8'),
        false,
      );

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchUtf8(session, oop, 1024).data).toBe(text);
    });
  });

  describe('GciTsNewUnicodeString / GciTsNewUnicodeString_', () => {
    /** `text` as UTF-16LE code units, optionally null-terminated. */
    const utf16Of = (text: string, nullTerminated: boolean): Buffer => {
      const buffer = Buffer.alloc((text.length + (nullTerminated ? 1 : 0)) * 2);
      for (let i = 0; i < text.length; i++) {
        buffer.writeUInt16LE(text.charCodeAt(i), i * 2);
      }
      return buffer;
    };

    it('creates a string from null-terminated UTF-16 data', () => {
      const text = 'Hi!';

      const { result: oop } = gci.GciTsNewUnicodeString(session, utf16Of(text, true));

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchUtf8(session, oop, 1024).data).toBe(text);
    });

    it('creates a string from UTF-16 data of a given length', () => {
      const text = 'Test';

      const { result: oop } = gci.GciTsNewUnicodeString_(
        session,
        utf16Of(text, false),
        text.length,
      );

      expect(oop).not.toBe(OOP_ILLEGAL);
      expect(gci.GciTsFetchUtf8(session, oop, 1024).data).toBe(text);
    });
  });

  describe('GciTsFetchObjInfo', () => {
    it('reports the identity and class of an object in one call', () => {
      const { result: oop } = gci.GciTsNewString(session, 'info test');

      const { result, info } = gci.GciTsFetchObjInfo(session, oop, false, 1024);

      expect(result).toBeGreaterThanOrEqual(0n);
      expect(info.objId).toBe(oop);
      expect(info.objClass).toBe(OOP_CLASS_STRING);
    });
  });

  describe('GciTsFetchSize / GciTsFetchVaryingSize', () => {
    it('reports both sizes of an object with no named instance variables', () => {
      const text = 'size test';
      const { result: oop } = gci.GciTsNewString(session, text);

      expect(gci.GciTsFetchSize(session, oop).result).toBe(BigInt(text.length));
      expect(gci.GciTsFetchVaryingSize(session, oop).result).toBe(BigInt(text.length));
    });
  });

  describe('GciTsFetchClass', () => {
    it('returns the class of an object', () => {
      const { result: oop } = gci.GciTsNewString(session, 'class test');

      expect(gci.GciTsFetchClass(session, oop).result).toBe(OOP_CLASS_STRING);
    });

    it('returns the class a special OOP encodes', () => {
      expect(gci.GciTsFetchClass(session, OOP_NIL).result).toBe(OOP_CLASS_UNDEFINED_OBJECT);
    });
  });

  describe('GciTsFetchUnicode', () => {
    it('fetches a String as UTF-16 code units', () => {
      const text = 'hello';
      const { result: oop } = gci.GciTsNewString(session, text);

      const { bytesReturned, data } = gci.GciTsFetchUnicode(session, oop, 256);

      // The call counts 16-bit code units, so the decoded range is twice that.
      expect(bytesReturned).toBe(BigInt(text.length));
      expect(data.toString('utf16le', 0, Number(bytesReturned) * 2)).toBe(text);
    });
  });

  describe('GciTsIsKindOf / GciTsIsKindOfClass', () => {
    it('reports an object as a kind of its own class', () => {
      const { result: oop } = gci.GciTsNewString(session, 'kind test');

      expect(gci.GciTsIsKindOf(session, oop, OOP_CLASS_STRING).result).toBe(1);
      expect(gci.GciTsIsKindOfClass(session, oop, OOP_CLASS_STRING).result).toBe(1);
    });

    it('reports an object as not a kind of an unrelated class', () => {
      const { result: oop } = gci.GciTsNewString(session, 'kind test');

      expect(gci.GciTsIsKindOf(session, oop, classOop('ByteArray')).result).toBe(0);
    });
  });

  describe('GciTsIsSubclassOf / GciTsIsSubclassOfClass', () => {
    it('reports a class as a subclass of its superclass', () => {
      expect(gci.GciTsIsSubclassOf(session, classOop('Symbol'), OOP_CLASS_STRING).result).toBe(1);
      expect(gci.GciTsIsSubclassOfClass(session, classOop('Symbol'), OOP_CLASS_STRING).result).toBe(
        1,
      );
    });

    it('reports a class as not a subclass of its own subclass', () => {
      expect(gci.GciTsIsSubclassOf(session, OOP_CLASS_STRING, classOop('Symbol')).result).toBe(0);
    });
  });

  describe('GciTsResolveSymbolObj', () => {
    it('resolves a Symbol object to what the name is bound to', () => {
      const { result: symbol } = gci.GciTsNewSymbol(session, 'Array');

      const { result, err } = gci.GciTsResolveSymbolObj(session, symbol, OOP_NIL);

      expect(err.number).toBe(0);
      expect(result).toBe(classOop('Array'));
    });
  });

  describe('GciTsObjExists', () => {
    it('reports a newly created object as existing', () => {
      const { result: oop } = gci.GciTsNewString(session, 'exists test');

      expect(gci.GciTsObjExists(session, oop)).toBe(true);
    });

    it('reports nil as existing', () => {
      expect(gci.GciTsObjExists(session, OOP_NIL)).toBe(true);
    });

    it('reports an illegal OOP as not existing', () => {
      expect(gci.GciTsObjExists(session, OOP_ILLEGAL)).toBe(false);
    });
  });
});
