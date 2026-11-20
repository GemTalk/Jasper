/**
 * The stone counts characters; a JS string counts UTF-16 units. A regex hit's matches are converted
 * before they are placed on the method's text, or every match after an emoji lands one unit early.
 */
import { describe, it, expect } from 'vitest';
import { codePointMatchesToUtf16 } from '../matchOffsets';

/** Where `needle` is in `text`, as the stone would count it: in characters, not UTF-16 units. */
function stoneRange(text: string, needle: string) {
  const units = text.indexOf(needle);
  const start = [...text.slice(0, units)].length;
  return { start, end: start + [...needle].length };
}

describe('codePointMatchesToUtf16', () => {
  it('leaves text with only Basic Multilingual Plane characters as it is, accents included', () => {
    const text = 'café\n  ^self at: 1 put: 2';
    const range = stoneRange(text, 'at: 1 put:');

    const [m] = codePointMatchesToUtf16(text, [range]);

    expect(text.slice(m.start, m.end)).toBe('at: 1 put:');
  });

  it('moves a match after an emoji by the extra unit the emoji takes', () => {
    const text = '"😀 done"\n  ^self at: 1 put: 2';
    const range = stoneRange(text, 'at: 1 put:');

    const [m] = codePointMatchesToUtf16(text, [range]);

    expect(text.slice(m.start, m.end)).toBe('at: 1 put:');
    expect(m.start).toBe(range.start + 1);
  });

  it('converts each of several matches, around two emoji', () => {
    const text = 'a 😀 b 😀 c';
    const ranges = ['a', 'b', 'c'].map((n) => stoneRange(text, n));

    const out = codePointMatchesToUtf16(text, ranges);

    expect(out.map((m) => text.slice(m.start, m.end))).toEqual(['a', 'b', 'c']);
  });

  it('keeps an empty match empty', () => {
    const text = '😀x';
    const [m] = codePointMatchesToUtf16(text, [{ start: 1, end: 1 }]);
    expect(m).toEqual({ start: 2, end: 2 });
  });

  it('puts a match past the end of the text past its end, so it does not fit', () => {
    const text = '😀ab';
    const [m] = codePointMatchesToUtf16(text, [{ start: 2, end: 9 }]);
    expect(m.end).toBeGreaterThan(text.length);
  });
});
