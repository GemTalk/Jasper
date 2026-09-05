import { describe, it, expect } from 'vitest';
import { filterMatches } from '../../explorerFilter';

describe('GemStone Explorer pane filtering', () => {
  it('matches everything when the pattern is empty', () => {
    expect(filterMatches('anything', '')).toBe(true);
    expect(filterMatches('anything', undefined)).toBe(true);
  });

  it('matches from the beginning, not the middle', () => {
    expect(filterMatches('at:', 'at')).toBe(true);
    expect(filterMatches('at:put:', 'at')).toBe(true);
    expect(filterMatches('basicAt:', 'at')).toBe(false);
  });

  it('ignores case', () => {
    expect(filterMatches('at:put:', 'AT')).toBe(true);
    expect(filterMatches('PrintOn:', 'print')).toBe(true);
  });

  it('treats * as a wildcard for any run of characters', () => {
    expect(filterMatches('at:put:', 'at*put')).toBe(true);
    expect(filterMatches('atEndOfPut', 'at*put')).toBe(true);
    expect(filterMatches('at:', 'at*put')).toBe(false);
  });

  it('allows a leading * for a substring match', () => {
    expect(filterMatches('basicAt:', '*at')).toBe(true);
  });

  it('does not treat other regex metacharacters as special', () => {
    expect(filterMatches('a+b', 'a+')).toBe(true);
    expect(filterMatches('axb', 'a+')).toBe(false);
  });
});
