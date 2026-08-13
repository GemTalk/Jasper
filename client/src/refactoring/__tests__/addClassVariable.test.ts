import { describe, it, expect, vi } from 'vitest';
import { addClassVariable } from '../queries/addClassVariable';

/**
 * Unit-tests the add-class-variable query: it resolves the class through the dict
 * and adds the shared binding via `addClassVarName:`. No GCI: the executor is a spy
 * returning a canned string.
 */

describe('add-class-variable query', () => {
  it('adds the class variable via addClassVarName: on the dict-resolved class', () => {
    const exec = vi.fn().mockReturnValue('ok');

    const result = addClassVariable(exec, 'Foo', 'Registry', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("addClassVarName: 'Registry'");
    expect(code).toContain('symbolList at: 3'); // dict-scoped lookup
    expect(result).toBe('ok');
  });

  it('answers no-class when the class cannot be resolved', () => {
    const exec = vi.fn().mockReturnValue('no-class');

    expect(addClassVariable(exec, 'Missing', 'Registry')).toBe('no-class');
  });

  it("escapes a quote in the variable name so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('ok');

    addClassVariable(exec, 'Foo', "b'r", 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("addClassVarName: 'b''r'");
  });
});
