import { describe, it, expect, vi } from 'vitest';
import { getClassDescendantNames } from '../queries/getClassDescendantNames';

describe('getClassDescendantNames', () => {
  it('scopes the class lookup through the dictionary index', () => {
    const exec = vi.fn().mockReturnValue('');

    getClassDescendantNames(exec, 'Mid', 2);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain("(System myUserProfile symbolList at: 2) at: #'Mid'");
    expect(code).toContain('subclassesOf:');
  });

  it('resolves each descendant to its binding dictionary by object identity', () => {
    const exec = vi.fn().mockReturnValue('');

    getClassDescendantNames(exec, 'Mid');

    // An IdentityDictionary keyed on the class OBJECT (not its name) is what makes a
    // shadowed subclass name resolve to its own dictionary rather than the first match.
    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('IdentityDictionary');
    expect(code).toContain('isBehavior');
  });

  it('parses each descendant with its parent and binding dictionary', () => {
    const exec = vi
      .fn()
      .mockReturnValue(
        'LeafA\tMid\t1\tUserGlobals\nLeafB\tMid\t3\tOther\nGrand\tLeafA\t1\tUserGlobals\n',
      );

    const result = getClassDescendantNames(exec, 'Mid');

    expect(result).toEqual([
      { className: 'LeafA', parentName: 'Mid', dictIndex: 1, dictName: 'UserGlobals' },
      { className: 'LeafB', parentName: 'Mid', dictIndex: 3, dictName: 'Other' },
      { className: 'Grand', parentName: 'LeafA', dictIndex: 1, dictName: 'UserGlobals' },
    ]);
  });

  it('reports dictIndex 0 / empty dictName for a descendant bound in no dictionary', () => {
    const exec = vi.fn().mockReturnValue('Unbound\tMid\t0\t\n');

    expect(getClassDescendantNames(exec, 'Mid')).toEqual([
      { className: 'Unbound', parentName: 'Mid', dictIndex: 0, dictName: '' },
    ]);
  });

  it('returns an empty list for a class with no descendants', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(getClassDescendantNames(exec, 'Leaf')).toEqual([]);
  });

  it('tolerates missing trailing fields', () => {
    const exec = vi.fn().mockReturnValue('Orphan\n');

    expect(getClassDescendantNames(exec, 'Root')).toEqual([
      { className: 'Orphan', parentName: '', dictIndex: 0, dictName: '' },
    ]);
  });
});
