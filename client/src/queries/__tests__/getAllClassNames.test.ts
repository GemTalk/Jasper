import { describe, it, expect, vi } from 'vitest';
import { getClassNameEntriesFor } from '../getAllClassNames';

describe('getClassNameEntriesFor', () => {
  it('parses the tab-separated dictionary/index/name rows the stone returns', () => {
    const exec = vi.fn((_code: string) => '1\tUserGlobals\tFoo\n42\tPython\tFoo\n');

    const entries = getClassNameEntriesFor(exec, 'Foo');

    expect(entries).toEqual([
      { dictIndex: 1, dictName: 'UserGlobals', className: 'Foo' },
      { dictIndex: 42, dictName: 'Python', className: 'Foo' },
    ]);
  });

  it('returns nothing when the name resolves to no class', () => {
    const exec = vi.fn((_code: string) => '');

    expect(getClassNameEntriesFor(exec, 'Nope')).toEqual([]);
  });

  it('looks the name up as an interned symbol key, not a string compare (Unicode7-safe)', () => {
    const exec = vi.fn((_code: string) => '');

    getClassNameEntriesFor(exec, 'Foo');

    const code = exec.mock.calls[0][0];
    expect(code).toContain("target := #'Foo'.");
    expect(code).toContain('dict at: target otherwise: nil');
    expect(code).not.toMatch(/= 'Foo'/);
  });

  it('escapes a quote in the class name', () => {
    const exec = vi.fn((_code: string) => '');

    getClassNameEntriesFor(exec, "O'Hara");

    expect(exec.mock.calls[0][0]).toContain("#'O''Hara'");
  });
});
