import { describe, it, expect, vi } from 'vitest';
import { deleteClassVariable } from '../queries/deleteClassVariable';

/**
 * Unit-tests the remove-class-variable query. Like adding one this needs no refactoring
 * engine — `removeClassVarName:` is a base-image method and does not reshape the class —
 * so the query is a single dict-scoped statement. No GCI: the executor is a spy returning
 * a canned string.
 */

describe('remove-class-variable query', () => {
  it('removes the class variable from the dict-resolved class', () => {
    const exec = vi.fn().mockReturnValue('ok');

    const result = deleteClassVariable(exec, 'Foo', 'Registry', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("removeClassVarName: 'Registry'");
    expect(code).toContain('symbolList at: 3');
    expect(result).toBe('ok');
  });

  it('answers the not-found sentinel when the class cannot be resolved', () => {
    const exec = vi.fn().mockReturnValue('no-class');

    expect(deleteClassVariable(exec, 'Missing', 'Registry')).toBe('no-class');
  });

  it('refuses a variable the class does not declare itself', () => {
    const exec = vi.fn().mockReturnValue('not-declared');

    expect(deleteClassVariable(exec, 'Foo', 'Inherited', 3)).toBe('not-declared');

    const code = exec.mock.calls[0][0] as string;
    // The guard is server-side so an inherited name can never be removed from the wrong
    // class, whatever the caller believed the row was.
    expect(code).toContain('classVarNames');
  });

  it("escapes a quote in the variable name so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('ok');

    deleteClassVariable(exec, 'Foo', "b'r", 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("'b''r'");
  });
});
