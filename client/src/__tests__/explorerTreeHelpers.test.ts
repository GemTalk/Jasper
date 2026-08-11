import { describe, it, expect } from 'vitest';
import { variableSides, defaultDictionaryIndex, categoryContains } from '../explorerTreeHelpers';

describe('variable-side grouping under a class', () => {
  it('shows an instance side then a class side when both kinds exist', () => {
    const sides = variableSides(['count', 'name'], ['Rate']);

    expect(sides.map((s) => s.isMeta)).toEqual([false, true]);
    expect(sides[0].names).toEqual(['count', 'name']);
    expect(sides[1].names).toEqual(['Rate']);
  });

  it('still shows both sides when there are no class variables, leaving the class side empty', () => {
    const sides = variableSides(['count'], []);

    expect(sides.map((s) => s.isMeta)).toEqual([false, true]);
    expect(sides[0].names).toEqual(['count']);
    expect(sides[1].names).toEqual([]);
  });

  it('still shows both sides when there are no instance variables, leaving the instance side empty', () => {
    const sides = variableSides([], ['Rate', 'Minimum']);

    expect(sides.map((s) => s.isMeta)).toEqual([false, true]);
    expect(sides[0].names).toEqual([]);
    expect(sides[1].names).toEqual(['Rate', 'Minimum']);
  });

  it('shows nothing when a class defines neither kind', () => {
    expect(variableSides([], [])).toHaveLength(0);
  });
});

describe('default dictionary selection on connect', () => {
  it('prefers UserGlobals when present', () => {
    expect(defaultDictionaryIndex(['Globals', 'UserGlobals', 'MyDict'])).toBe(1);
  });

  it('falls back to the first dictionary when UserGlobals is absent', () => {
    expect(defaultDictionaryIndex(['Globals', 'MyDict'])).toBe(0);
  });

  it('selects nothing when there are no dictionaries', () => {
    expect(defaultDictionaryIndex([])).toBe(-1);
  });
});

describe('categoryContains (keep a class selected when its category node is clicked)', () => {
  it('matches the exact category', () => {
    expect(categoryContains('User Classes', 'User Classes')).toBe(true);
  });

  it('matches a class in the dash-segmented subtree', () => {
    expect(categoryContains('Collections', 'Collections-Dictionaries')).toBe(true);
  });

  it('does not match a different category or a mere prefix without the dash', () => {
    expect(categoryContains('User Classes', 'Kernel-Objects')).toBe(false);
    expect(categoryContains('Coll', 'Collections')).toBe(false);
  });

  it('does not match when the class has no category', () => {
    expect(categoryContains('User Classes', undefined)).toBe(false);
  });
});
