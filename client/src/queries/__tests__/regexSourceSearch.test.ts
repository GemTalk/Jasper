import { describe, it, expect, vi } from 'vitest';
import {
  RegexPatternError,
  parseRegexSourceSearch,
  regexSourceSearchCode,
  searchMethodSourceRegex,
  searchMethodSourceRegexAsync,
} from '../regexSourceSearch';
import { METHOD_SEARCH_RESULT_LIMIT } from '../methodSearch';

const ROW = 'Globals\tObject\t0\tprintOn:\tprinting\t0';

describe('regexSourceSearchCode', () => {
  it('passes the pattern as an escaped string literal', () => {
    const code = regexSourceSearchCode("it's", false);

    expect(code).toContain("pattern: 'it''s'");
  });

  it('passes ignore case through', () => {
    expect(regexSourceSearchCode('x', true)).toContain('ignoreCase: true');
    expect(regexSourceSearchCode('x', false)).toContain('ignoreCase: false');
  });

  it('asks for no more rows than every other method search returns', () => {
    expect(regexSourceSearchCode('x', false)).toContain(`limit: ${METHOD_SEARCH_RESULT_LIMIT}`);
  });

  // A soft break (Stop) is not a GsRegexError, so a handler naming Error or Exception
  // here would swallow the user's Stop and leave the search running.
  it('catches only GsRegexError around the search', () => {
    const code = regexSourceSearchCode('x', false);

    expect(code).toContain('on: GsRegexError do:');
    expect(code).not.toMatch(/on: (Error|Exception)\b/);
  });

  it('puts the summary line, then the match ranges, before the rows', () => {
    const code = regexSourceSearchCode('x', false);

    expect(code.trim().split('\n').pop()).toBe(
      'search summaryLine, (String with: Character lf), search rangesLine, (String with: Character lf), stream contents',
    );
  });
});

describe('parseRegexSourceSearch', () => {
  it('reads the summary and the rows', () => {
    const result = parseRegexSourceSearch(`0\t3\t17000\t0\n5-12\n${ROW}\n`);

    expect(result).toEqual({
      methods: [
        {
          dictName: 'Globals',
          className: 'Object',
          isMeta: false,
          selector: 'printOn:',
          category: 'printing',
          environmentId: 0,
          matches: [{ start: 4, end: 12 }],
        },
      ],
      wholeMethods: false,
      skipped: 3,
      scanned: 17000,
      truncated: false,
    });
  });

  it('reads whole-method mode and truncation', () => {
    const result = parseRegexSourceSearch(`1\t0\t42\t1\n5-12\n${ROW}\n`);

    expect(result.wholeMethods).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('reads every match of every method, converting to 0-based, end-exclusive offsets', () => {
    const second = 'Globals\tObject\t0\tprintString\tprinting\t0';
    const result = parseRegexSourceSearch(`0\t0\t9\t0\n1-3,10-14 7-7\n${ROW}\n${second}\n`);

    expect(result.methods.map((m) => m.matches)).toEqual([
      [
        { start: 0, end: 3 },
        { start: 9, end: 14 },
      ],
      [{ start: 6, end: 7 }],
    ]);
  });

  // A whole-method match is one range that runs across a line break; nothing about it is per-line.
  it('keeps a match that spans a line break as one range', () => {
    const result = parseRegexSourceSearch(`1\t0\t9\t0\n12-40\n${ROW}\n`);

    expect(result.methods[0].matches).toEqual([{ start: 11, end: 40 }]);
  });

  it('keeps an empty match (a pattern like ^), which still says where to put the cursor', () => {
    const result = parseRegexSourceSearch(`0\t0\t9\t0\n5-4\n${ROW}\n`);

    expect(result.methods[0].matches).toEqual([{ start: 4, end: 4 }]);
  });

  it('drops a malformed pair rather than guessing, and a method with none carries no matches', () => {
    const result = parseRegexSourceSearch(`0\t0\t9\t0\nx-3,2-5\n${ROW}\n`);

    expect(result.methods[0].matches).toEqual([{ start: 1, end: 5 }]);
    expect(parseRegexSourceSearch(`0\t0\t9\t0\nbad\n${ROW}\n`).methods[0].matches).toBeUndefined();
  });

  it('answers no rows when nothing matched', () => {
    expect(parseRegexSourceSearch('0\t0\t17000\t0\n\n').methods).toEqual([]);
    expect(parseRegexSourceSearch('0\t0\t17000\t0').methods).toEqual([]);
  });

  it("raises the server's reason for a refused pattern as RegexPatternError", () => {
    const parse = () =>
      parseRegexSourceSearch('#error\tcounted repetition such as {3} is not supported');

    expect(parse).toThrow(RegexPatternError);
    expect(parse).toThrow('counted repetition such as {3} is not supported');
  });

  it('refuses a summary it does not recognise rather than guessing', () => {
    expect(() => parseRegexSourceSearch(`${ROW}\n`)).toThrow(/Unexpected regex search summary/);
  });
});

describe('searchMethodSourceRegex', () => {
  it('runs the code and parses the answer', () => {
    const execute = vi.fn(() => `0\t0\t5\t0\n1-3\n${ROW}\n`);

    const result = searchMethodSourceRegex(execute, 'printOn:', false);

    expect(execute).toHaveBeenCalledWith(regexSourceSearchCode('printOn:', false));
    expect(result.methods.map((m) => m.selector)).toEqual(['printOn:']);
  });

  it('does the same without blocking', async () => {
    const execute = vi.fn(() => Promise.resolve(`0\t0\t5\t0\n1-3\n${ROW}\n`));

    const result = await searchMethodSourceRegexAsync(execute, 'printOn:', true);

    expect(execute).toHaveBeenCalledWith(regexSourceSearchCode('printOn:', true));
    expect(result.scanned).toBe(5);
  });
});
