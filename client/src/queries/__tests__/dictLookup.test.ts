import { describe, it, expect, vi } from 'vitest';
import { dictLookupExpr, homeDictionaryNameExpr, symbolListIndexOfClassExpr } from '../util';
import { classExistsInDictionary } from '../getClassCategory';

describe('dictLookupExpr', () => {
  it('resolves a dictionary by 1-based SymbolList index (nil if out of range)', () => {
    expect(dictLookupExpr(3)).toBe('System myUserProfile symbolList at: 3 ifAbsent: [nil]');
  });

  it('resolves a dictionary by name, doubling single quotes', () => {
    expect(dictLookupExpr("O'Dict")).toBe(
      "System myUserProfile symbolList objectNamed: #'O''Dict'",
    );
  });
});

describe('homeDictionaryNameExpr', () => {
  /**
   * One rule for "which dictionary owns this class", asked by a class rename's
   * scope, the debugger's Browse and both inspectors' Browse Class: the
   * symbol-list slot that binds the class object BY IDENTITY under its own name.
   * A name-only match picks up an alias entry (Python's #object -> Object sorts
   * before Globals) and navigates somewhere the user didn't ask for.
   */
  it('resolves by identity through the shared symbol-list index', () => {
    const code = homeDictionaryNameExpr('cls');

    expect(code).toContain(symbolListIndexOfClassExpr('cls'));
    expect(code).toContain('cls name asSymbol ifAbsent: [nil]) == cls');
  });

  it('answers a plain string for an unbound class and an unnamed dictionary', () => {
    const code = homeDictionaryNameExpr('cls');

    expect(code).toContain("slot = 0 ifTrue: ['']");
    expect(code).toContain("name ifNil: ['']) asString");
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
