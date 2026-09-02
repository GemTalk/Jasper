import { describe, it, expect } from 'vitest';
import {
  variableSides,
  defaultDictionaryIndex,
  matchesClassPrefix,
  categoryContains,
} from '../../explorerTreeHelpers';

describe('variable-side grouping under a class', () => {
  it('shows an instance side then a class side when both kinds exist', () => {
    const sides = variableSides(['count', 'name'], ['Rate']);

    expect(sides.map((s) => s.isMeta)).toEqual([false, true]);
    expect(sides[0].names).toEqual(['count', 'name']);
    expect(sides[1].names).toEqual(['Rate']);
  });

  // The inline "+" that adds a variable is hosted on the side row, so omitting the
  // empty side took away the only visible way to add the first class variable to a
  // class that has instance variables, or vice versa (#499).
  it('still shows the class side when there are no class variables', () => {
    const sides = variableSides(['count'], []);

    expect(sides.map((s) => s.isMeta)).toEqual([false, true]);
    expect(sides[0].names).toEqual(['count']);
    expect(sides[1].names).toEqual([]);
  });

  it('still shows the instance side when there are no instance variables', () => {
    const sides = variableSides([], ['Rate', 'Minimum']);

    expect(sides.map((s) => s.isMeta)).toEqual([false, true]);
    expect(sides[0].names).toEqual([]);
    expect(sides[1].names).toEqual(['Rate', 'Minimum']);
  });

  // A row can only carry children by declaring a collapsible state, and any
  // collapsible state draws the expansion chevron — so rows here would give a
  // variable-less class a chevron advertising variables it does not have. That class
  // reaches both adds from the "+" on the class row instead.
  it('shows nothing when a class defines neither kind', () => {
    expect(variableSides([], [])).toEqual([]);
  });

  it('shows either both sides or neither, never just one', () => {
    // What keeps the rows in step with the class row's chevron: the chevron is gated
    // on the class having variables of either kind, so a class that gets one must
    // have rows behind it, and a class that gets none must have no rows at all.
    const combos: [string[], string[]][] = [
      [[], []],
      [['a'], []],
      [[], ['B']],
      [['a'], ['B']],
    ];
    for (const [ivars, cvars] of combos) {
      const sides = variableSides(ivars, cvars);
      const hasAny = ivars.length + cvars.length > 0;
      expect(sides.map((s) => s.isMeta)).toEqual(hasAny ? [false, true] : []);
    }
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

describe('class-picker prefix matching (matchesClassPrefix)', () => {
  it('matches only labels that START with the query, not substrings', () => {
    // The whole point: "Z" must not surface "AZure"/"Blaze".
    expect(matchesClassPrefix('Zoo', 'Z')).toBe(true);
    expect(matchesClassPrefix('AZure', 'Z')).toBe(false);
    expect(matchesClassPrefix('Blaze', 'z')).toBe(false);
  });

  it('is case-insensitive on both sides', () => {
    expect(matchesClassPrefix('Account', 'acc')).toBe(true);
    expect(matchesClassPrefix('account', 'ACC')).toBe(true);
    expect(matchesClassPrefix('Account', 'x')).toBe(false);
  });

  it('trims the query', () => {
    expect(matchesClassPrefix('Account', '  acc  ')).toBe(true);
    expect(matchesClassPrefix('Account', '   ')).toBe(true); // trims to empty → matches all
  });

  it('matches everything for an empty query (show the full list)', () => {
    expect(matchesClassPrefix('Anything', '')).toBe(true);
    expect(matchesClassPrefix('', '')).toBe(true);
  });

  it('a longer query than the label does not match', () => {
    expect(matchesClassPrefix('Acc', 'Account')).toBe(false);
  });

  it('an exact full-length match matches', () => {
    expect(matchesClassPrefix('Account', 'Account')).toBe(true);
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
