import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { isBinarySelector, isValidSelector } from '../util';

/** The characters in the server lexer's `SELECTOR_CHARS`, read from its source. */
function serverSelectorChars(): string[] {
  const lexer = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', '..', 'server', 'src', 'lexer', 'lexer.ts'),
    'utf8',
  );
  const set = lexer.match(/const SELECTOR_CHARS = new Set\(\[([\s\S]*?)\]\)/);
  if (!set) throw new Error('SELECTOR_CHARS not found in server/src/lexer/lexer.ts');
  return [...set[1].matchAll(/'(\\.|[^'\\])'/g)].map((m) => m[1].replace(/^\\/, ''));
}

describe('binary selector characters', () => {
  const serverChars = serverSelectorChars();

  it('reads the whole set from the server lexer', () => {
    expect(serverChars).toContain('\\');
    expect(serverChars.length).toBeGreaterThan(10);
  });

  it('accepts every character the server lexer does, and no other symbol', () => {
    const symbols = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'];
    const accepted = symbols.filter((ch) => isBinarySelector(ch));
    expect(accepted.sort()).toEqual([...serverChars].sort());
  });
});

/**
 * The guard both inspectors' queries put a selector through before
 * interpolating it into a doit as `#'...'`. It lives in queries/util.ts because
 * it is one rule against selector injection, and a rule patched in one of two
 * copies is patched in neither.
 */
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

    it.each(['\\', '\\\\', '==>', '->>', '<=>', '!=', '==!'])(
      'accepts the binary selector %s',
      (selector) => {
        expect(isValidSelector(selector)).toBe(true);
      },
    );
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

    // Every caller puts the selector inside `#'...'`; none of these may get through.
    it.each(["=='", '= =', '==.', 'a+', '+a'])('rejects the binary-looking %s', (selector) => {
      expect(isValidSelector(selector)).toBe(false);
    });
  });
});
