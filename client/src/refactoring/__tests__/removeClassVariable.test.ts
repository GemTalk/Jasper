import { describe, it, expect, vi } from 'vitest';
import { removeClassVariable } from '../queries/removeClassVariable';

/**
 * Unit-tests the remove-class-variable query — the mirror of the add, and what undoing an
 * add runs (#434). No GCI: the executor is a spy returning a canned string.
 *
 * The rule with teeth is the DECLARING-CLASS guard: a name the class merely inherits must be
 * reported as 'not-defined' rather than removed from an ancestor, which would take the
 * variable away from every other subclass too.
 */

describe('remove-class-variable query', () => {
  it('removes the class variable via removeClassVarName: on the dict-resolved class', () => {
    const exec = vi.fn().mockReturnValue('ok');

    const result = removeClassVariable(exec, 'Foo', 'Registry', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("removeClassVarName: 'Registry'");
    expect(code).toContain('symbolList at: 3'); // dict-scoped lookup
    expect(result).toBe('ok');
  });

  it('only removes a name the class DECLARES, never one it inherits', () => {
    const exec = vi.fn().mockReturnValue('not-defined');

    removeClassVariable(exec, 'Foo', 'Registry', 3);

    // classVarNames is the class's OWN declarations; an inherited name is not in it, so the
    // guard answers 'not-defined' instead of reaching up the hierarchy.
    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("classVarNames includes: #'Registry'");
    expect(code).toContain("'not-defined'");
  });

  it('answers no-class when the class cannot be resolved', () => {
    const exec = vi.fn().mockReturnValue('no-class');

    expect(removeClassVariable(exec, 'Missing', 'Registry')).toBe('no-class');
  });

  it("escapes a quote in the variable name so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('ok');

    removeClassVariable(exec, 'Foo', "b'r", 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("removeClassVarName: 'b''r'");
    expect(code).toContain("includes: #'b''r'");
  });
});
