import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The session-free UTF-8 helpers the GCI library exposes for converting
 * between its own encodings client-side. They need no session, but they are
 * still native calls into the real library, so they run under the harness.
 */
describe('GCI session-free UTF-8 conversions (integration)', () => {
  let gci: GciLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
  });

  describe('GciUtf8To8bit', () => {
    it('converts ASCII text unchanged', () => {
      const { success, result } = gci.GciUtf8To8bit('hello');

      expect(success).toBe(true);
      expect(result).toBe('hello');
    });

    it('converts a character inside the 8-bit range', () => {
      // U+00E9 (e-acute) is within 0..255, so it has an 8-bit representation.
      const { success } = gci.GciUtf8To8bit('é');

      expect(success).toBe(true);
    });

    it('fails for a character above the 8-bit range', () => {
      // U+4E16 needs more than one byte, so no 8-bit representation exists.
      const { success } = gci.GciUtf8To8bit('世');

      expect(success).toBe(false);
    });

    it('converts an empty string', () => {
      const { success, result } = gci.GciUtf8To8bit('');

      expect(success).toBe(true);
      expect(result).toBe('');
    });
  });

  describe('GciNextUtf8Character', () => {
    it('decodes a one-byte character', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('A');

      expect(bytes).toBe(1);
      expect(codePoint).toBe(65);
    });

    it('decodes a two-byte character', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('é');

      expect(bytes).toBe(2);
      expect(codePoint).toBe(0x00e9);
    });

    it('decodes a three-byte character', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('世');

      expect(bytes).toBe(3);
      expect(codePoint).toBe(0x4e16);
    });

    it('decodes a four-byte character', () => {
      const { bytes, codePoint } = gci.GciNextUtf8Character('\u{1F600}');

      expect(bytes).toBe(4);
      expect(codePoint).toBe(0x1f600);
    });
  });
});
