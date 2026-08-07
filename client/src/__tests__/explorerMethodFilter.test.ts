import { describe, it, expect } from 'vitest';
import {
  parseMethodFilter,
  methodMatchesFilter,
  ivarAccessMark,
  ivarIdentifierRanges,
} from '../explorerMethodFilter';

describe('parseMethodFilter', () => {
  it('treats a bare term as the selector prefix', () => {
    expect(parseMethodFilter('at')).toEqual({ selector: 'at', ivar: [] });
  });

  it('reads reads:/writes:/accesses: tokens into ivar constraints', () => {
    expect(parseMethodFilter('reads:count')).toEqual({
      selector: undefined,
      ivar: [{ kind: 'reads', pattern: 'count' }],
    });
    expect(parseMethodFilter('writes:count')).toEqual({
      selector: undefined,
      ivar: [{ kind: 'writes', pattern: 'count' }],
    });
    expect(parseMethodFilter('accesses:count')).toEqual({
      selector: undefined,
      ivar: [{ kind: 'accesses', pattern: 'count' }],
    });
  });

  it('combines a selector prefix with an ivar token', () => {
    expect(parseMethodFilter('at reads:count')).toEqual({
      selector: 'at',
      ivar: [{ kind: 'reads', pattern: 'count' }],
    });
  });

  it('is case-insensitive on the token keyword and keeps the ivar wildcard', () => {
    expect(parseMethodFilter('WRITES:na*')).toEqual({
      selector: undefined,
      ivar: [{ kind: 'writes', pattern: 'na*' }],
    });
  });
});

describe('methodMatchesFilter', () => {
  const access = { reads: ['count'], writes: ['total'] };

  it('matches on the selector prefix alone', () => {
    expect(methodMatchesFilter(parseMethodFilter('inc'), 'increment', access)).toBe(true);
    expect(methodMatchesFilter(parseMethodFilter('dec'), 'increment', access)).toBe(false);
  });

  it('matches a reads: token only against read ivars', () => {
    expect(methodMatchesFilter(parseMethodFilter('reads:count'), 'increment', access)).toBe(true);
    expect(methodMatchesFilter(parseMethodFilter('reads:total'), 'increment', access)).toBe(false);
  });

  it('matches a writes: token only against written ivars', () => {
    expect(methodMatchesFilter(parseMethodFilter('writes:total'), 'increment', access)).toBe(true);
    expect(methodMatchesFilter(parseMethodFilter('writes:count'), 'increment', access)).toBe(false);
  });

  it('matches an accesses: token against reads or writes', () => {
    expect(methodMatchesFilter(parseMethodFilter('accesses:count'), 'm', access)).toBe(true);
    expect(methodMatchesFilter(parseMethodFilter('accesses:total'), 'm', access)).toBe(true);
    expect(methodMatchesFilter(parseMethodFilter('accesses:other'), 'm', access)).toBe(false);
  });

  it('fails a method with no recorded access under any ivar token', () => {
    expect(methodMatchesFilter(parseMethodFilter('reads:count'), 'm', undefined)).toBe(false);
  });
});

describe('ivarIdentifierRanges', () => {
  it('finds whole-identifier occurrences and ignores substrings', () => {
    const text = "describe\n\t^'A shape at ', origin printString, origins";

    const ranges = ivarIdentifierRanges(text, ['origin']);

    expect(ranges.map(([s, e]) => text.slice(s, e))).toEqual(['origin']);
  });

  it('matches every occurrence of every name', () => {
    const text = 'count := count + total';

    const ranges = ivarIdentifierRanges(text, ['count', 'total']);

    expect(ranges.map(([s, e]) => text.slice(s, e))).toEqual(['count', 'count', 'total']);
  });

  it('returns nothing when there are no names', () => {
    expect(ivarIdentifierRanges('origin', [])).toEqual([]);
  });
});

describe('ivarAccessMark', () => {
  it('is undefined without an ivar token', () => {
    expect(
      ivarAccessMark(parseMethodFilter('at'), { reads: ['count'], writes: [] }),
    ).toBeUndefined();
  });

  it('marks r / w / rw by what the method does to the named ivar', () => {
    const f = parseMethodFilter('accesses:count');
    expect(ivarAccessMark(f, { reads: ['count'], writes: [] })).toBe('r');
    expect(ivarAccessMark(f, { reads: [], writes: ['count'] })).toBe('w');
    expect(ivarAccessMark(f, { reads: ['count'], writes: ['count'] })).toBe('rw');
    expect(ivarAccessMark(f, { reads: ['other'], writes: [] })).toBeUndefined();
  });
});
