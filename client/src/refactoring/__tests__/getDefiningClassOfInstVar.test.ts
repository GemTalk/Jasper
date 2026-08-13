import { describe, it, expect, vi } from 'vitest';
import { getDefiningClassOfInstVar } from '../queries/getDefiningClassOfInstVar';

/**
 * Unit-tests the defining-class-of-ivar query: it walks up from the starting class
 * for the one that declares the ivar in its OWN instVarNames, and reports that class
 * with the SymbolList index that binds it. No GCI: the executor is a spy returning a
 * canned string.
 */

describe('defining-class-of-instance-variable query', () => {
  it('parses the defining class name and its binding dictionary index', () => {
    const exec = vi.fn().mockReturnValue('BaseDemo\n5');

    const result = getDefiningClassOfInstVar(exec, 'LeafDemo', 'count', 3);

    expect(result).toEqual({ className: 'BaseDemo', dictIndex: 5 });
  });

  it('walks the superclass chain scoped to the starting class and its own ivars', () => {
    const exec = vi.fn().mockReturnValue('BaseDemo\n5');

    getDefiningClassOfInstVar(exec, 'LeafDemo', 'count', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('cls superclass');
    expect(code).toContain('cls instVarNames anySatisfy:');
    expect(code).toContain('e asSymbol == want');
    expect(code).toContain("want := 'count' asSymbol");
  });

  it('reports index 0 when the defining class is not bound by its own name', () => {
    const exec = vi.fn().mockReturnValue('BaseDemo\n0');

    expect(getDefiningClassOfInstVar(exec, 'LeafDemo', 'count', 3)).toEqual({
      className: 'BaseDemo',
      dictIndex: 0,
    });
  });

  it('answers undefined when no class in the chain declares the variable', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(getDefiningClassOfInstVar(exec, 'LeafDemo', 'notAnIvar', 3)).toBeUndefined();
  });

  it("escapes a quote in the variable name so the probe can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('');

    getDefiningClassOfInstVar(exec, 'LeafDemo', "od'd", 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("want := 'od''d' asSymbol");
  });
});
