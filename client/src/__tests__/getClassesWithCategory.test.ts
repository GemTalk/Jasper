import { describe, it, expect, vi } from 'vitest';
import { getClassesWithCategory } from '../queries/getClassesWithCategory';

describe("listing a dictionary's classes with their categories", () => {
  it('pairs each class name with its category', () => {
    const execute = vi
      .fn()
      .mockReturnValue('Kernel\t1\tObject\nKernel\t1\tBehavior\nCollections\t0\tArray\n');

    const entries = getClassesWithCategory(execute, 1);

    expect(entries).toEqual([
      { category: 'Kernel', className: 'Object', hasComment: true },
      { category: 'Kernel', className: 'Behavior', hasComment: true },
      { category: 'Collections', className: 'Array', hasComment: false },
    ]);
  });

  // #387 item 11. The flag has to come from the `#comment` extra-dict key, because
  // `Class>>comment` synthesises "No class-specific documentation for X…" when
  // there is none — so a non-empty comment string proves nothing.
  it('reports whether each class carries a real comment', () => {
    const execute = vi.fn().mockReturnValue('Kernel\t0\tObject\nKernel\t1\tArray\n');

    expect(getClassesWithCategory(execute, 1).map((e) => e.hasComment)).toEqual([false, true]);
  });

  // The engine-side behaviour this encodes (a stored `''`, a whitespace-only
  // comment) is pinned against a real stone in explorerQueries.integration.test.ts;
  // here we only pin that a blank comment reaches the Explorer as `hasComment: false`.
  it('reports a blank comment as no comment at all', () => {
    const execute = vi.fn().mockReturnValue('Kernel\t0\tEmptied\nKernel\t1\tReal\n');

    expect(getClassesWithCategory(execute, 1).map((e) => e.hasComment)).toEqual([false, true]);
  });

  it('asks for any non-whitespace character, not merely a non-nil comment', () => {
    const execute = vi.fn().mockReturnValue('');

    getClassesWithCategory(execute, 1);

    const code = execute.mock.calls[0][0] as string;
    // A bare `notNil` would count the `''` that emptying the editor stores (#387
    // item 11 / PR #442 review).
    expect(code).not.toMatch(/#comment\) notNil/);
    expect(code).toContain('isSeparator not');
  });

  it('asks the class for the comment KEY, never for the synthesised comment text', () => {
    const execute = vi.fn().mockReturnValue('');

    getClassesWithCategory(execute, 1);

    const code = execute.mock.calls[0][0] as string;
    expect(code).toContain('_extraDictAt: #comment');
    // `v comment` would always answer a non-empty string, making every class look
    // commented — and would build a hierarchy report per class while doing it.
    expect(code).not.toMatch(/\bv comment\b/);
  });

  it('keeps a tab in a category name from shifting the class name', () => {
    // A category is free text; a class name cannot hold a tab. So the fields are
    // read from the RIGHT, and a category carrying one stays in the category.
    // Left-anchored, this line parsed as category 'Od', hasComment false, className
    // '1\tArray' — every field wrong.
    const execute = vi.fn().mockReturnValue('Od\td\t1\tArray\n');

    expect(getClassesWithCategory(execute, 1)).toEqual([
      { category: 'Od\td', className: 'Array', hasComment: true },
    ]);
  });

  it('looks the dictionary up by name when given a string', () => {
    const execute = vi.fn().mockReturnValue('');

    getClassesWithCategory(execute, 'UserGlobals');

    expect(execute).toHaveBeenCalledWith(expect.stringContaining("objectNamed: #'UserGlobals'"));
  });

  it('returns nothing for an empty dictionary', () => {
    const execute = vi.fn().mockReturnValue('');

    expect(getClassesWithCategory(execute, 5)).toEqual([]);
  });
});
