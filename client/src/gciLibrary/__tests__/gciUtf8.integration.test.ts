import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH } from '../../__tests__/gci/gciTestConfig';

describe('GCI session-free UTF-8 functions', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);

  afterAll(() => {
    gci.close();
  });

  describe('GciUtf8To8bit', () => {
    it('converts pure ASCII successfully', () => {
      const { success, result } = gci.GciUtf8To8bit('hello');
      expect(success).toBe(true);
      expect(result).toBe('hello');
    });

    it('converts Latin-1 characters (code points 0-255)', () => {
      // \xC3\xA9 is UTF-8 for U+00E9 (e-acute), which is within 0..255
      const { success } = gci.GciUtf8To8bit('\u00e9');
      expect(success).toBe(true);
    });

    it('fails for code points above 255', () => {
      // U+4E16 (Chinese character) is above 255
      const { success } = gci.GciUtf8To8bit('\u4e16');
      expect(success).toBe(false);
    });

    it('handles empty string', () => {
      const { success, result } = gci.GciUtf8To8bit('');
      expect(success).toBe(true);
      expect(result).toBe('');
    });
  });

  describe('GciNextUtf8Character', () => {
    it('parses a single ASCII character', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('A');
      expect(bytes).toBe(1);
      expect(codePoint).toBe(65);
    });

    it('parses a 2-byte UTF-8 character', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('\u00e9');
      expect(bytes).toBe(2);
      expect(codePoint).toBe(0x00e9);
    });

    it('parses a 3-byte UTF-8 character', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('\u4e16');
      expect(bytes).toBe(3);
      expect(codePoint).toBe(0x4e16);
    });

    it('parses a 4-byte UTF-8 character (emoji)', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('\u{1F600}');
      expect(bytes).toBe(4);
      expect(codePoint).toBe(0x1f600);
    });
  });
});
