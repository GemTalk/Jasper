import { describe, it, expect, vi } from 'vitest';
import { removeMethodCategory } from '../queries/removeMethodCategory';

/**
 * Unit-tests the remove-a-method-category query. No GCI: the executor is a spy.
 *
 * The guard is the whole point. GemStone's `removeCategory:` does not refuse a category that
 * holds methods — it removes them along with it — so a bare call is a silent way to delete
 * every method in a category.
 */

describe('remove-method-category query', () => {
  it('refuses a category that holds methods rather than removing them with it', () => {
    const exec = vi.fn().mockReturnValue('holds:3');

    const result = removeMethodCategory(exec, 'Foo', false, 'tests', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("selectorsIn: 'tests'");
    expect(code).toContain("'holds:'");
    // The check and the removal are one doit, so nothing can file a method into the
    // category between reading it as empty and removing it.
    expect(code).toContain("removeCategory: 'tests'");
    expect(result).toBe('holds:3');
  });

  it('answers not-found rather than raising on a category the class does not have', () => {
    const exec = vi.fn().mockReturnValue('not-found');

    const code = (() => {
      removeMethodCategory(exec, 'Foo', false, 'nope', 3);
      return exec.mock.calls[0][0] as string;
    })();

    expect(code).toContain("categoryNames includes: #'nope'");
    expect(code).toContain("'not-found'");
  });

  it('compares category names as SYMBOLS', () => {
    // `each asString = '…'` raises "Unicode argument disallowed in String comparison" on a
    // stone in legacy string mode.
    const exec = vi.fn().mockReturnValue('ok');

    removeMethodCategory(exec, 'Foo', false, 'tests', 3);

    expect(exec.mock.calls[0][0] as string).not.toContain('asString =');
  });

  it('targets the class side when isMeta is set', () => {
    const exec = vi.fn().mockReturnValue('ok');

    removeMethodCategory(exec, 'Foo', true, 'creating', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('class');
    expect(code).toContain('symbolList at: 3');
  });

  it("escapes a quote in the category name so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('ok');

    removeMethodCategory(exec, 'Foo', false, "te'sts", 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("removeCategory: 'te''sts'");
    expect(code).toContain("includes: #'te''sts'");
  });
});
