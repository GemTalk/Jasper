import { describe, it, expect, vi } from 'vitest';
import { dictLookupExpr } from '../util';
import { classExistsInDictionary } from '../getClassCategory';

describe('dictLookupExpr', () => {
  it('resolves a dictionary by 1-based SymbolList index', () => {
    expect(dictLookupExpr(3)).toBe('System myUserProfile symbolList at: 3');
  });

  it('resolves a dictionary by name, doubling single quotes', () => {
    expect(dictLookupExpr("O'Dict")).toBe(
      "System myUserProfile symbolList objectNamed: #'O''Dict'",
    );
  });
});

describe('classExistsInDictionary (reuses classLookupExpr)', () => {
  it('resolves the class within the dictionary and checks isBehavior — not a hand-rolled dict lookup', () => {
    const exec = vi.fn().mockReturnValue('true');

    expect(classExistsInDictionary(exec, 'Foo', 3)).toBe(true);

    const code = exec.mock.calls[0][0] as string;
    // Goes through the shared class-in-dictionary resolution…
    expect(code).toContain("(System myUserProfile symbolList at: 3) at: #'Foo' ifAbsent: [nil]");
    expect(code).toContain('isBehavior');
    // …and does NOT hand-roll the dict-by-parameter resolution.
    expect(code).not.toContain('symbolList at: 3 ifAbsent:');
  });

  it('is false when the class is absent (query returns false)', () => {
    const exec = vi.fn().mockReturnValue('false');
    expect(classExistsInDictionary(exec, 'Foo', 'UserGlobals')).toBe(false);
  });
});
