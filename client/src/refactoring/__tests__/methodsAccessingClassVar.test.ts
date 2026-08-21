import { describe, it, expect, vi } from 'vitest';
import { methodsAccessingClassVar } from '../queries/methodsAccessingClassVar';

/**
 * Unit-tests the class-variable reference scan that guards safe delete. A class variable
 * is a shared binding, so detection is by literal-frame IDENTITY — the same technique the
 * engine's `methodsAccessingClassVar:inHierarchyOf:` uses — which excludes a same-named
 * global (a different association) and a shadowing temporary (no association at all).
 * Both sides of the hierarchy are scanned, because either can reference the variable.
 * No GCI: the executor is a spy returning canned tab-separated rows.
 */

const row = (className: string, isMeta: boolean, selector: string): string =>
  `UserGlobals\t${className}\t${isMeta ? '1' : '0'}\t${selector}\taccessing\n`;

describe('class-variable reference scan', () => {
  it('looks the variable up as a binding on the class that declares it', () => {
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingClassVar(exec, 'Account', 'Registry', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('classVarNames');
    expect(code).toContain('_classVars associationAt:');
  });

  it('matches the binding by identity rather than by name', () => {
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingClassVar(exec, 'Account', 'Registry', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('literals');
    expect(code).toContain('== assoc');
  });

  it('scans the instance and the class side of the whole subtree', () => {
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingClassVar(exec, 'Account', 'Registry', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('allSubclasses');
    expect(code).toContain('each class');
  });

  it('reads the reported methods into browsable results, keeping their side', () => {
    const exec = vi
      .fn()
      .mockReturnValue(row('Account', false, 'record') + row('Account', true, 'reset'));

    const results = methodsAccessingClassVar(exec, 'Account', 'Registry', 3);

    expect(results).toEqual([
      {
        dictName: 'UserGlobals',
        className: 'Account',
        isMeta: false,
        selector: 'record',
        category: 'accessing',
      },
      {
        dictName: 'UserGlobals',
        className: 'Account',
        isMeta: true,
        selector: 'reset',
        category: 'accessing',
      },
    ]);
  });

  it('reports nothing when the variable is not declared anywhere in the chain', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(methodsAccessingClassVar(exec, 'Account', 'NotAVariable', 3)).toEqual([]);
  });

  it("escapes a quote in the variable name so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('');

    methodsAccessingClassVar(exec, 'Account', "b'r", 3);

    expect(exec.mock.calls[0][0]).toContain("'b''r'");
  });
});
