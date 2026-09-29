import { describe, it, expect } from 'vitest';
import { dictionaryArgExpr } from '../util';

/**
 * Every dictionary-scoped engine call formats its dictionary the same way, through this one
 * function.
 *
 * The scope is what keeps a refactoring on the class the user picked rather than on whichever
 * class of that name the symbol list reaches first (#396). It used to be formatted inline in
 * four query files, and each copy could lose the argument or its escaping without a test going
 * red — the callers' own assertions are substring checks that do not mention `inDictionary:`.
 */
describe('dictionaryArgExpr', () => {
  it('sends a SymbolList index bare, as an Integer the engine can index with', () => {
    // Coerced to a String it became '10', which matches no dictionary NAME, and the scoped
    // lookup silently fell back to the first match it exists to replace.
    expect(dictionaryArgExpr(1)).toBe('1');
    expect(dictionaryArgExpr(10)).toBe('10');
  });

  it('quotes a dictionary name', () => {
    expect(dictionaryArgExpr('DictionaryB')).toBe("'DictionaryB'");
  });

  it('escapes a quote rather than letting it close the literal', () => {
    expect(dictionaryArgExpr("Di'ct")).toBe("'Di''ct'");
  });

  it('answers nil only when there is genuinely no dictionary', () => {
    expect(dictionaryArgExpr(undefined)).toBe('nil');
  });

  it('does not treat 0 as "no dictionary"', () => {
    // A falsy check here would turn index 0 into nil. It is not a valid 1-based index, but it
    // must reach the engine as one so the engine declines, rather than quietly resolving by
    // first match.
    expect(dictionaryArgExpr(0)).toBe('0');
  });

  it('keeps an empty name quoted rather than dropping the scope', () => {
    expect(dictionaryArgExpr('')).toBe("''");
  });
});

describe('a number that is not an index', () => {
  /**
   * `String(NaN)` is `NaN` and `String(Infinity)` is `Infinity`; neither is a Smalltalk literal,
   * so the whole doit failed to compile and the user got a compile error in place of their
   * refactoring. `1.5` compiled and then indexed nothing.
   *
   * These go out as an out-of-range index, not as nil: a scope that cannot be expressed is one
   * the engine must DECLINE over. `nil` would mean "resolve by first match", which is the
   * silent wrong answer this whole scope exists to prevent (#396).
   */
  it('sends an out-of-range index rather than uncompilable text', () => {
    expect(dictionaryArgExpr(NaN)).toBe('-1');
    expect(dictionaryArgExpr(Infinity)).toBe('-1');
    expect(dictionaryArgExpr(-Infinity)).toBe('-1');
    expect(dictionaryArgExpr(1.5)).toBe('-1');
  });

  it('never turns one into nil, which would mean "any class of that name"', () => {
    for (const n of [NaN, Infinity, 1.5]) expect(dictionaryArgExpr(n)).not.toBe('nil');
  });
});
