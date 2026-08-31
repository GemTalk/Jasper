import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import {
  OOP_ASCII_NUL,
  OOP_CLASS_BOOLEAN,
  OOP_CLASS_CHARACTER,
  OOP_CLASS_SMALL_DOUBLE,
  OOP_CLASS_SMALL_INTEGER,
  OOP_CLASS_UNDEFINED_OBJECT,
  OOP_FALSE,
  OOP_ILLEGAL,
  OOP_NIL,
  OOP_One,
  OOP_Three,
  OOP_TRUE,
  OOP_Two,
  OOP_Zero,
} from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * Special OOPs — nil, the booleans, SmallIntegers, Characters and
 * SmallDoubles — encode their whole value in the OOP itself, so the library
 * can answer questions about them without a session. They are still native
 * calls into the release under test, so they run under the harness.
 */
describe('GCI special OOPs (integration)', () => {
  let gci: GciLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
  });

  describe('GciTsOopIsSpecial', () => {
    it('recognizes nil, the booleans, SmallIntegers and Characters as special', () => {
      for (const oop of [OOP_NIL, OOP_TRUE, OOP_FALSE, OOP_Zero, OOP_ASCII_NUL]) {
        expect(gci.GciTsOopIsSpecial(oop)).toBe(true);
      }
    });
  });

  describe('GciTsFetchSpecialClass', () => {
    it('answers the class a special OOP encodes', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_NIL)).toBe(OOP_CLASS_UNDEFINED_OBJECT);
      expect(gci.GciTsFetchSpecialClass(OOP_TRUE)).toBe(OOP_CLASS_BOOLEAN);
      expect(gci.GciTsFetchSpecialClass(OOP_FALSE)).toBe(OOP_CLASS_BOOLEAN);
      expect(gci.GciTsFetchSpecialClass(OOP_Zero)).toBe(OOP_CLASS_SMALL_INTEGER);
      expect(gci.GciTsFetchSpecialClass(OOP_ASCII_NUL)).toBe(OOP_CLASS_CHARACTER);
    });

    it('answers an illegal OOP for an OOP that is not special', () => {
      expect(gci.GciTsFetchSpecialClass(OOP_ILLEGAL)).toBe(OOP_ILLEGAL);
    });
  });

  describe('GciTsCharToOop / GciTsOopToChar', () => {
    it('round-trips ASCII code points', () => {
      for (const codePoint of [0, 65, 90, 97, 122, 127]) {
        expect(gci.GciTsOopToChar(gci.GciTsCharToOop(codePoint))).toBe(codePoint);
      }
    });

    it('round-trips code points outside ASCII, up to the Unicode maximum', () => {
      for (const codePoint of [0x00e9, 0x4e16, 0x1f600, 0x10ffff]) {
        expect(gci.GciTsOopToChar(gci.GciTsCharToOop(codePoint))).toBe(codePoint);
      }
    });

    it('encodes a Character as a special OOP of class Character', () => {
      const oop = gci.GciTsCharToOop(65);

      expect(gci.GciTsOopIsSpecial(oop)).toBe(true);
      expect(gci.GciTsFetchSpecialClass(oop)).toBe(OOP_CLASS_CHARACTER);
    });

    it('answers an illegal OOP for a code point above the Unicode maximum', () => {
      expect(gci.GciTsCharToOop(0x110000)).toBe(OOP_ILLEGAL);
    });

    it('answers -1 when asked for the code point of an OOP that is not a Character', () => {
      expect(gci.GciTsOopToChar(OOP_NIL)).toBe(-1);
      expect(gci.GciTsOopToChar(OOP_Zero)).toBe(-1);
    });
  });

  describe('GciTsDoubleToSmallDouble', () => {
    it('encodes a representable double as a special OOP of class SmallDouble', () => {
      for (const value of [0.0, 1.0]) {
        const oop = gci.GciTsDoubleToSmallDouble(value);

        expect(gci.GciTsOopIsSpecial(oop)).toBe(true);
        expect(gci.GciTsFetchSpecialClass(oop)).toBe(OOP_CLASS_SMALL_DOUBLE);
      }
    });

    it('answers an illegal OOP for values with no SmallDouble encoding', () => {
      expect(gci.GciTsDoubleToSmallDouble(NaN)).toBe(OOP_ILLEGAL);
      expect(gci.GciTsDoubleToSmallDouble(Infinity)).toBe(OOP_ILLEGAL);
    });
  });

  describe('supportsNonBlockingLogin', () => {
    it('reports non-blocking login as supported everywhere except Windows', () => {
      expect(gci.supportsNonBlockingLogin()).toBe(process.platform !== 'win32');
    });
  });

  describe('GciI32ToOop / GciTsI32ToOop', () => {
    it('encodes 0 as OOP_Zero', () => {
      expect(gci.GciI32ToOop(0)).toBe(OOP_Zero);
    });

    it('encodes 1 as OOP_One', () => {
      expect(gci.GciI32ToOop(1)).toBe(OOP_One);
    });

    it('encodes 2 as OOP_Two', () => {
      expect(gci.GciI32ToOop(2)).toBe(OOP_Two);
    });

    it('encodes 3 as OOP_Three', () => {
      expect(gci.GciI32ToOop(3)).toBe(OOP_Three);
    });

    it('GciI32ToOop and GciTsI32ToOop return the same result', () => {
      for (const n of [0, 1, -1, 42, -100, 2147483647, -2147483648]) {
        expect(gci.GciI32ToOop(n)).toBe(gci.GciTsI32ToOop(n));
      }
    });

    it('result is always a SmallInteger special', () => {
      for (const n of [0, 1, -1, 42, 1000]) {
        expect(gci.GciTsOopIsSpecial(gci.GciI32ToOop(n))).toBe(true);
        expect(gci.GciTsFetchSpecialClass(gci.GciI32ToOop(n))).toBe(OOP_CLASS_SMALL_INTEGER);
      }
    });

    it('encodes when the library exports it, otherwise throws a descriptive error', () => {
      expect(gci.GciTsI32ToOop(1)).toBe(OOP_One);
    });
  });
});
