import { describe, it, expect, vi } from 'vitest';
import { addAccessors, accessorSpecsFor } from '../queries/addAccessors';

/**
 * Unit-tests the accessor helpers: the getter/setter spec computation (selector
 * lowercasing, body references the actual variable, side by kind) and the query
 * builder/parser (compile-if-absent, created/skipped/no-class). No GCI.
 */

describe('accessor spec computation', () => {
  it('uses the instance side and the ivar name unchanged for an instance variable', () => {
    const { isMeta, accessors } = accessorSpecsFor('count', 'ivar');

    expect(isMeta).toBe(false);
    expect(accessors).toEqual([
      { selector: 'count', source: 'count\n\t^count' },
      { selector: 'count:', source: 'count: aValue\n\tcount := aValue' },
    ]);
  });

  it('uses the class side and a lowercased selector for a class variable, body keeps the real name', () => {
    const { isMeta, accessors } = accessorSpecsFor('Registry', 'classvar');

    expect(isMeta).toBe(true);
    expect(accessors).toEqual([
      { selector: 'registry', source: 'registry\n\t^Registry' },
      { selector: 'registry:', source: 'registry: aValue\n\tRegistry := aValue' },
    ]);
  });
});

describe('add-accessors query', () => {
  it('compiles each accessor only when its selector is absent, on the class side for isMeta', () => {
    const exec = vi.fn().mockReturnValue('created:2 skipped:0');

    const result = addAccessors(
      exec,
      'Foo',
      true,
      [
        { selector: 'registry', source: 'registry\n\t^Registry' },
        { selector: 'registry:', source: 'registry: aValue\n\tRegistry := aValue' },
      ],
      3,
    );

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('tgt := c class'); // class side
    expect(code).toContain('includesSelector: sel');
    expect(code).toContain('compileMethod: src');
    expect(code).toContain("add value: #'registry:'");
    expect(result).toEqual({ created: 2, skipped: 0, noClass: false });
  });

  it('targets the instance side when not isMeta', () => {
    const exec = vi.fn().mockReturnValue('created:0 skipped:2');

    const result = addAccessors(exec, 'Foo', false, [
      { selector: 'count', source: 'count\n\t^count' },
    ]);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('tgt := c.');
    expect(result).toEqual({ created: 0, skipped: 2, noClass: false });
  });

  it('reports noClass when the class cannot be resolved', () => {
    const exec = vi.fn().mockReturnValue('no-class');

    expect(addAccessors(exec, 'Missing', false, [{ selector: 'x', source: 'x\n\t^x' }])).toEqual({
      created: 0,
      skipped: 0,
      noClass: true,
    });
  });

  it('escapes quotes in the selector and source', () => {
    const exec = vi.fn().mockReturnValue('created:1 skipped:0');

    addAccessors(exec, 'Foo', false, [{ selector: "x'", source: "x'\n\t^y" }]);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("add value: #'x''' value: 'x''");
  });
});
