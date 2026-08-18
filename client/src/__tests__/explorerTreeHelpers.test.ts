import { describe, it, expect } from 'vitest';
import {
  variableSides,
  defaultDictionaryIndex,
  matchesClassPrefix,
  categoryContains,
} from '../explorerTreeHelpers';

describe('variable-side grouping under a class', () => {
  it('shows an instance side then a class side when both kinds exist', () => {
    const sides = variableSides(['count', 'name'], ['Rate']);

    expect(sides.map((s) => s.isMeta)).toEqual([false, true]);
    expect(sides[0].names).toEqual(['count', 'name']);
    expect(sides[1].names).toEqual(['Rate']);
  });

  // #387 item 12. The convention is OMIT an empty section, not render it grayed:
  // a header for a definitively-empty section reads as something to open, and
  // opening it is the only way to find out there was nothing there.
  it('omits the class side entirely when there are no class variables', () => {
    const sides = variableSides(['count'], []);

    expect(sides.map((s) => s.isMeta)).toEqual([false]);
    expect(sides[0].names).toEqual(['count']);
  });

  it('omits the instance side entirely when there are no instance variables', () => {
    const sides = variableSides([], ['Rate', 'Minimum']);

    expect(sides.map((s) => s.isMeta)).toEqual([true]);
    expect(sides[0].names).toEqual(['Rate', 'Minimum']);
  });

  it('shows nothing when a class defines neither kind', () => {
    expect(variableSides([], [])).toHaveLength(0);
  });

  it('never returns a side with nothing in it', () => {
    // The invariant the whole convention rests on: no caller has to handle — or
    // render — an empty side, whichever combination it is given.
    const combos: [string[], string[]][] = [
      [[], []],
      [['a'], []],
      [[], ['B']],
      [['a'], ['B']],
    ];
    for (const [ivars, cvars] of combos) {
      for (const side of variableSides(ivars, cvars)) expect(side.names.length).toBeGreaterThan(0);
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
