import { describe, it, expect, vi } from 'vitest';
import { getClassDescendantNames } from '../queries/getClassDescendantNames';

describe('getClassDescendantNames', () => {
  it('scopes the class lookup through the dictionary index', () => {
    const exec = vi.fn().mockReturnValue('');

    getClassDescendantNames(exec, 'Mid', 2);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('ClassOrganizer new');
    expect(code).toContain('subclassesOf:');
  });

  it('parses each descendant with its immediate parent', () => {
    const exec = vi.fn().mockReturnValue('LeafA\tMid\nLeafB\tMid\nGrand\tLeafA\n');

    const result = getClassDescendantNames(exec, 'Mid');

    expect(result).toEqual([
      { className: 'LeafA', parentName: 'Mid' },
      { className: 'LeafB', parentName: 'Mid' },
      { className: 'Grand', parentName: 'LeafA' },
    ]);
  });

  it('returns an empty list for a class with no descendants', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(getClassDescendantNames(exec, 'Leaf')).toEqual([]);
  });

  it('tolerates a missing parent field', () => {
    const exec = vi.fn().mockReturnValue('Orphan\n');

    expect(getClassDescendantNames(exec, 'Root')).toEqual([
      { className: 'Orphan', parentName: '' },
    ]);
  });
});
