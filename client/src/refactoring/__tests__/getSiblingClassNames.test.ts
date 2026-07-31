import { describe, it, expect, vi } from 'vitest';
import { getSiblingClassNames } from '../queries/getSiblingClassNames';

/**
 * Unit-tests the sibling-names query: it resolves the anchor through the dictionary, walks its
 * superclass's immediate subclasses excluding the anchor, and parses the lf-separated result into
 * a name list. No GCI: the executor is a spy returning a canned string.
 */

describe('sibling-class-names query', () => {
  it('excludes the anchor and resolves through the dictionary', () => {
    const exec = vi.fn().mockReturnValue('Cat\nFish\n');

    const names = getSiblingClassNames(exec, 'Dog', 3);

    const code = exec.mock.calls[0][0] as string;
    expect(code).toContain('cls superclass');
    expect(code).toContain('c == cls ifFalse:');
    expect(names).toEqual(['Cat', 'Fish']);
  });

  it('returns an empty list when the class has no siblings', () => {
    const exec = vi.fn().mockReturnValue('');

    expect(getSiblingClassNames(exec, 'Dog')).toEqual([]);
  });
});
