import { describe, it, expect, vi } from 'vitest';
import { recategorizeMethod } from '../queries/recategorizeMethod';

/**
 * Unit-tests the move-a-method-to-a-category query. No GCI: the executor is a spy
 * returning a canned string.
 *
 * The behaviour that matters is that it CREATES a category the class does not have. The
 * Explorer's "+ new category" leaves the stone untouched until something is filed there, so
 * dropping a method on one of those rows targets a category that does not exist yet, and a
 * bare `moveMethod:toCategory:` answers `classErrMethCatNotFound`.
 */

describe('recategorize-method query', () => {
  it('creates the category first, then moves the method into it', () => {
    const exec = vi.fn().mockReturnValue('ok');

    const result = recategorizeMethod(exec, 'Foo', false, 'bar', 'tests', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("addCategory: 'tests'");
    expect(code).toContain("moveMethod: #'bar' toCategory: 'tests'");
    // The create is guarded: addCategory: raises on a category that already exists.
    expect(code).toContain("categoryNames includes: #'tests'");
    expect(code).toContain('ifFalse:');
    expect(result).toBe('ok');
  });

  it('compares category names as SYMBOLS', () => {
    // `each asString = 'tests'` raises "Unicode argument disallowed in String comparison"
    // on a stone in legacy string mode.
    const exec = vi.fn().mockReturnValue('ok');

    recategorizeMethod(exec, 'Foo', false, 'bar', 'tests', 3);

    expect(exec.mock.calls[0][0] as string).not.toContain('asString =');
  });

  it('targets the class side when isMeta is set', () => {
    const exec = vi.fn().mockReturnValue('ok');

    recategorizeMethod(exec, 'Foo', true, 'make', 'building', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('class');
    expect(code).toContain('symbolList at: 3'); // dict-scoped lookup
  });

  it("escapes quotes in the category and the selector so the statement can't be broken out of", () => {
    const exec = vi.fn().mockReturnValue('ok');

    recategorizeMethod(exec, 'Foo', false, "b'r", "te'sts", 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("addCategory: 'te''sts'");
    expect(code).toContain("moveMethod: #'b''r' toCategory: 'te''sts'");
  });
});
