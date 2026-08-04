import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH } from './gciTestConfig';
import { OOP_One, OOP_Two, OOP_Three, OOP_Zero, OOP_CLASS_SMALL_INTEGER } from '../../gciConstants';

// The rest of this file's session-free special-OOP coverage now lives in
// `gciLibrary/__tests__/gciSpecials.integration.test.ts`. GciI32ToOop and
// GciTsI32ToOop stay here because they are optional symbols, absent from the
// oldest libraries in the release matrix, so they need a per-symbol
// availability gate before they can join the default suite.
describe('GCI session-free OOP functions', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);

  afterAll(() => {
    gci.close();
  });

  describe('GciI32ToOop / GciTsI32ToOop', () => {
    // These are optional symbols (absent in libraries older than the one under
    // test); skip the round-trip assertions when the loaded library omits them.
    const hasI32ToOop = gci.isAvailable('GciI32ToOop') && gci.isAvailable('GciTsI32ToOop');
    const itIfPresent = hasI32ToOop ? it : it.skip;

    itIfPresent('encodes 0 as OOP_Zero', () => {
      expect(gci.GciI32ToOop(0)).toBe(OOP_Zero);
    });

    itIfPresent('encodes 1 as OOP_One', () => {
      expect(gci.GciI32ToOop(1)).toBe(OOP_One);
    });

    itIfPresent('encodes 2 as OOP_Two', () => {
      expect(gci.GciI32ToOop(2)).toBe(OOP_Two);
    });

    itIfPresent('encodes 3 as OOP_Three', () => {
      expect(gci.GciI32ToOop(3)).toBe(OOP_Three);
    });

    itIfPresent('GciI32ToOop and GciTsI32ToOop return the same result', () => {
      for (const n of [0, 1, -1, 42, -100, 2147483647, -2147483648]) {
        expect(gci.GciI32ToOop(n)).toBe(gci.GciTsI32ToOop(n));
      }
    });

    itIfPresent('result is always a SmallInteger special', () => {
      for (const n of [0, 1, -1, 42, 1000]) {
        expect(gci.GciTsOopIsSpecial(gci.GciI32ToOop(n))).toBe(true);
        expect(gci.GciTsFetchSpecialClass(gci.GciI32ToOop(n))).toBe(OOP_CLASS_SMALL_INTEGER);
      }
    });

    it('encodes when the library exports it, otherwise throws a descriptive error', () => {
      if (gci.isAvailable('GciTsI32ToOop')) {
        expect(gci.GciTsI32ToOop(1)).toBe(OOP_One);
      } else {
        expect(() => gci.GciTsI32ToOop(1)).toThrow(/not available in this GCI library/);
      }
    });
  });
});
