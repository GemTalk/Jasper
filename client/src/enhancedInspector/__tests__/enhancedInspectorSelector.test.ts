import { describe, it, expect } from 'vitest';
import { isValidSelector } from '../queries/getEnhancedInspectorViewSpecs';

describe('isValidSelector', () => {
  describe('valid selectors', () => {
    it('accepts a unary selector', () => {
      expect(isValidSelector('size')).toBe(true);
    });

    it('accepts a unary selector with mixed case', () => {
      expect(isValidSelector('printString')).toBe(true);
    });

    it('accepts a single keyword selector', () => {
      expect(isValidSelector('gtItemsFor:')).toBe(true);
    });

    it('accepts a multi-keyword selector', () => {
      expect(isValidSelector('at:put:')).toBe(true);
    });

    it('accepts a single-character binary selector', () => {
      expect(isValidSelector('+')).toBe(true);
    });

    it('accepts a two-character binary selector', () => {
      expect(isValidSelector('<=')).toBe(true);
    });

    it('accepts a selector starting with underscore', () => {
      expect(isValidSelector('_objectForOop:')).toBe(true);
    });
  });

  describe('invalid selectors', () => {
    it('rejects an empty string', () => {
      expect(isValidSelector('')).toBe(false);
    });

    it('rejects a selector with a space inside a keyword', () => {
      expect(isValidSelector('gt Items For:')).toBe(false);
    });

    it('rejects a selector that starts with a digit', () => {
      expect(isValidSelector('1gtItemsFor:')).toBe(false);
    });

    it('rejects a selector containing an illegal character', () => {
      expect(isValidSelector('gtItems!For:')).toBe(false);
    });

    it('rejects a selector starting with $', () => {
      expect(isValidSelector('$foo')).toBe(false);
    });
  });
});
