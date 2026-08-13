import { describe, it, expect, vi } from 'vitest';
import { getDefiningClassOfClassVar } from '../queries/getDefiningClassOfClassVar';

/**
 * Unit-tests the defining-class-of-classvar query: it walks up from the starting
 * class for the one that declares the class variable in its OWN classVarNames, and
 * reports that class with the SymbolList index that binds it. No GCI: the executor
 * is a spy returning a canned string.
 */

describe('defining-class-of-class-variable query', () => {
  it('parses the defining class name and its binding dictionary index', () => {
    const exec = vi.fn().mockReturnValue('BaseDemo\n5');

    const result = getDefiningClassOfClassVar(exec, 'LeafDemo', 'Registry', 3);

    expect(result).toEqual({ className: 'BaseDemo', dictIndex: 5 });
  });

  it('walks the superclass chain against each class own classVarNames, matching by symbol', () => {
    const exec = vi.fn().mockReturnValue('BaseDemo\n5');

    getDefiningClassOfClassVar(exec, 'LeafDemo', 'Registry', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('cls superclass');
    expect(code).toContain('cls classVarNames anySatisfy:');
    expect(code).toContain('e asSymbol == want');
    expect(code).toContain("want := 'Registry' asSymbol");
  });

  it('reports index 0 when the defining class is not bound by its own name', () => {
    const exec = vi.fn().mockReturnValue('BaseDemo\n0');

    expect(getDefiningClassOfClassVar(exec, 'LeafDemo', 'Registry', 3)).toEqual({
      className: 'BaseDemo',
      dictIndex: 0,
    });
  });

  it('answers undefined when no class in the chain declares the class variable', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(getDefiningClassOfClassVar(exec, 'LeafDemo', 'NotAClassVar', 3)).toBeUndefined();
  });

  it("escapes a quote in the class-variable name so the probe can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('');

    getDefiningClassOfClassVar(exec, 'LeafDemo', "od'd", 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("want := 'od''d' asSymbol");
  });
});
