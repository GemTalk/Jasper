import { describe, it, expect, vi } from 'vitest';
import { methodsAccessingInstVar } from '../queries/methodsAccessingInstVar';

/**
 * Unit-tests the instance-variable reference scan that guards safe delete: which methods
 * would break if the variable went away. It uses the same bytecode reflection the engine's
 * `instanceMethodsAccessing:inClass:` uses (`GsNMethod>>instVarsAccessed`), so a method
 * that merely mentions the name in a comment or a temporary is not a reference. No GCI:
 * the executor is a spy returning canned tab-separated rows.
 */

const row = (className: string, selector: string): string =>
  `UserGlobals\t${className}\t0\t${selector}\taccessing\n`;

describe('instance-variable reference scan', () => {
  it('scans the declaring class and every subclass', () => {
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingInstVar(exec, 'Account', 'balance', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('symbolList at: 3');
    expect(code).toContain('allSubclasses');
  });

  it('decides by bytecode reflection rather than by source text', () => {
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingInstVar(exec, 'Account', 'balance', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('instVarsAccessed');
    expect(code).not.toContain('substringSearch:');
  });

  it('reads the reported methods into browsable results', () => {
    const exec = vi.fn().mockReturnValue(row('Account', 'balance') + row('Savings', 'accrue'));

    const results = methodsAccessingInstVar(exec, 'Account', 'balance', 3);

    expect(results).toEqual([
      {
        dictName: 'UserGlobals',
        className: 'Account',
        isMeta: false,
        selector: 'balance',
        category: 'accessing',
        environmentId: 0,
      },
      {
        dictName: 'UserGlobals',
        className: 'Savings',
        isMeta: false,
        selector: 'accrue',
        category: 'accessing',
        environmentId: 0,
      },
    ]);
  });

  it('enumerates the selectors of the environment it was asked about', () => {
    // `selectors` lists environment 0 only, so a method that exists solely in another
    // environment was never offered to the accessed-variables test and the variable looked
    // unused — a delete would then go through without asking.
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingInstVar(exec, 'Account', 'balance', 3, 2);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('selectorsForEnvironment: 2');
    expect(code).not.toMatch(/\bselectors do:/);
  });

  it('reports nothing when no method touches the variable', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(methodsAccessingInstVar(exec, 'Account', 'balance', 3)).toEqual([]);
  });

  it('reports nothing when the class cannot be resolved', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(methodsAccessingInstVar(exec, 'Missing', 'balance')).toEqual([]);
    expect(exec.mock.calls[0][0]).toContain('isNil ifTrue:');
  });

  it("escapes a quote in the variable name so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingInstVar(exec, 'Account', "b'r", 3);

    expect(exec.mock.calls[0][0]).toContain("'b''r'");
  });
});
