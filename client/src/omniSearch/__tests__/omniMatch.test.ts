import { describe, it, expect } from 'vitest';
import { match, compareMatches, isWordStart, MatchMode } from '../omniMatch';

const opts = (mode: MatchMode, caseSensitive = false) => ({ mode, caseSensitive });

/** Convenience: rank targets against a query by score (best first), dropping non-matches. */
function rank(query: string, targets: string[], mode: MatchMode, caseSensitive = false): string[] {
  return targets
    .map((label) => ({ label, r: match(query, label, opts(mode, caseSensitive)) }))
    .filter((x): x is { label: string; r: NonNullable<ReturnType<typeof match>> } => x.r !== null)
    .map((x) => ({ label: x.label, score: x.r.score }))
    .sort(compareMatches)
    .map((x) => x.label);
}

describe('omniMatch — fuzzy (default)', () => {
  it('matches a subsequence in order and rejects out-of-order / missing chars', () => {
    expect(match('oc', 'OrderedCollection', opts('fuzzy'))).not.toBeNull();
    expect(match('ordc', 'OrderedCollection', opts('fuzzy'))).not.toBeNull();
    // 'co' is NOT a subsequence of 'OrderedCollection' in order? c(9) then o... there is 'o' after
    // c at index 12 ('Collection' -> C-o-l-l...), so 'co' DOES match. Use a genuine non-match:
    expect(match('zx', 'OrderedCollection', opts('fuzzy'))).toBeNull();
    expect(match('ocz', 'OrderedCollection', opts('fuzzy'))).toBeNull();
  });

  it('returns coalesced ranges in original coordinates', () => {
    const r = match('Or', 'OrderedCollection', opts('fuzzy'));
    expect(r?.ranges).toEqual([[0, 2]]);
    const r2 = match('OC', 'OrderedCollection', opts('fuzzy'));
    // O at 0, C at 7 → two single-char ranges
    expect(r2?.ranges).toEqual([
      [0, 1],
      [7, 1 + 7],
    ]);
  });

  it('ranks a camelCase-initials / word-start match above a scattered mid-word one', () => {
    // 'oc' should prefer OrderedCollection (O…C word starts) over a scattered hit like 'Document'.
    const ranked = rank('oc', ['Document', 'OrderedCollection'], 'fuzzy');
    expect(ranked[0]).toBe('OrderedCollection');
  });

  it('ranks a contiguous run above a scattered subsequence', () => {
    const ranked = rank('read', ['ReadStream', 'RowanExternalDiffApiTool'], 'fuzzy');
    expect(ranked[0]).toBe('ReadStream');
  });

  it('ranks a shorter target above a longer one when otherwise equal', () => {
    const ranked = rank('set', ['Set', 'IdentitySet', 'SetOfHugeLongNameThing'], 'fuzzy');
    expect(ranked[0]).toBe('Set');
  });

  it('prefers a prefix/word-start hit over a deep mid-word subsequence', () => {
    const s1 = match('str', 'String', opts('fuzzy'))!.score; // prefix, word start
    const s2 = match('str', 'aVeryLongstrandThing', opts('fuzzy'))!.score; // mid-word
    expect(s1).toBeGreaterThan(s2);
  });
});

describe('omniMatch — substring', () => {
  it('matches only a contiguous run', () => {
    expect(match('deco', 'OrderedCollection', opts('substring'))).toBeNull();
    const r = match('Coll', 'OrderedCollection', opts('substring'));
    expect(r).not.toBeNull();
    expect(r?.ranges).toEqual([[7, 11]]);
  });

  it('an earlier occurrence scores higher than a later one', () => {
    const early = match('ab', 'abXXXXXX', opts('substring'))!.score;
    const late = match('ab', 'XXXXXXab', opts('substring'))!.score;
    expect(early).toBeGreaterThan(late);
  });
});

describe('omniMatch — prefix', () => {
  it('matches only at the start', () => {
    expect(match('Ord', 'OrderedCollection', opts('prefix'))).not.toBeNull();
    expect(match('Coll', 'OrderedCollection', opts('prefix'))).toBeNull();
  });

  it('prefers the shorter target on a shared prefix', () => {
    const ranked = rank('Set', ['SetOfThings', 'Set'], 'prefix');
    expect(ranked[0]).toBe('Set');
  });
});

describe('omniMatch — case sensitivity', () => {
  it('is case-insensitive by default', () => {
    expect(match('OC', 'orderedcollection', opts('fuzzy'))).not.toBeNull(); // fuzzy o…c, folded
    expect(match('COLL', 'orderedcollection', opts('substring'))).not.toBeNull(); // folded run
  });

  it('respects caseSensitive=true', () => {
    // No uppercase letters in the target, so an uppercase query cannot match.
    expect(match('OC', 'orderedcollection', opts('fuzzy', true))).toBeNull();
    expect(match('OC', 'OrderedCollection', opts('fuzzy', true))).not.toBeNull();
  });
});

describe('omniMatch — empty query is a neutral match-all', () => {
  it('returns score 0, no ranges, for every mode', () => {
    for (const mode of ['fuzzy', 'substring', 'prefix'] as MatchMode[]) {
      const r = match('   ', 'Anything', opts(mode));
      expect(r).toEqual({ score: 0, ranges: [] });
    }
  });

  it('never matches against an empty target for a non-empty query', () => {
    expect(match('x', '', opts('fuzzy'))).toBeNull();
  });
});

describe('isWordStart', () => {
  it('flags string start, post-separator, and camelCase humps', () => {
    expect(isWordStart('OrderedCollection', 0)).toBe(true); // start
    expect(isWordStart('OrderedCollection', 7)).toBe(true); // d|C hump
    expect(isWordStart('OrderedCollection', 3)).toBe(false); // mid-word
    expect(isWordStart('Array>>at:put:', 7)).toBe(true); // after '>'
    expect(isWordStart('as_yet_unclassified', 3)).toBe(true); // after '_'
  });
});

describe('compareMatches — total order', () => {
  it('score desc, then length asc, then alphabetical', () => {
    const items = [
      { score: 5, label: 'bbb' },
      { score: 9, label: 'zzzz' },
      { score: 5, label: 'aa' },
      { score: 5, label: 'cc' },
    ];
    expect([...items].sort(compareMatches).map((x) => x.label)).toEqual([
      'zzzz',
      'aa',
      'cc',
      'bbb',
    ]);
  });
});

describe('case sensitivity', () => {
  it('folds case when caseSensitive is false (Foo matches foo)', () => {
    expect(match('foo', 'FooBar', { mode: 'substring', caseSensitive: false })).not.toBeNull();
  });

  it('respects case when caseSensitive is true', () => {
    expect(match('foo', 'FooBar', { mode: 'substring', caseSensitive: true })).toBeNull();
    expect(match('Foo', 'FooBar', { mode: 'substring', caseSensitive: true })).not.toBeNull();
  });

  it('fuzzy skips a wrong-case char when case-sensitive (the K2 behaviour)', () => {
    // "InfoOrbit" has only one lowercase 'o' (in "Info") plus a capital 'O'.
    // Insensitive folds the capital O and matches f-o-O; sensitive needs three lowercase → no match.
    expect(match('foo', 'InfoOrbit', { mode: 'fuzzy', caseSensitive: false })).not.toBeNull();
    expect(match('foo', 'InfoOrbit', { mode: 'fuzzy', caseSensitive: true })).toBeNull();
  });
});
