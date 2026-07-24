import { describe, it, expect, vi } from 'vitest';
import { getClassesWithCategory } from '../queries/getClassesWithCategory';

describe("listing a dictionary's classes with their categories", () => {
  it('pairs each class name with its category', () => {
    const execute = vi
      .fn()
      .mockReturnValue('Kernel\tObject\nKernel\tBehavior\nCollections\tArray\n');

    const entries = getClassesWithCategory(execute, 1);

    expect(entries).toEqual([
      { category: 'Kernel', className: 'Object' },
      { category: 'Kernel', className: 'Behavior' },
      { category: 'Collections', className: 'Array' },
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
