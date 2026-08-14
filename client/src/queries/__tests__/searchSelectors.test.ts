import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  buildSelectorSearchCode,
  parseSelectorSearchResults,
  searchSelectors,
} from '../searchSelectors';

describe('buildSelectorSearchCode', () => {
  it('escapes the term and uses the 3.6.2-safe includesString:', () => {
    const code = buildSelectorSearchCode("o'clock", { limit: 50, ignoreCase: true });
    expect(code).toContain("'o''clock'"); // doubled quote
    expect(code).toContain('includesString:');
    expect(code).not.toContain('includesSubstring:'); // DNUs on 3.6.2
  });

  it('folds case on both sides when ignoreCase is true', () => {
    const code = buildSelectorSearchCode('at', { limit: 10, ignoreCase: true });
    expect(code).toContain("'at' asLowercase");
    expect(code).toContain('sel asString asLowercase includesString:');
  });

  it('compares as-is when ignoreCase is false', () => {
    const code = buildSelectorSearchCode('at', { limit: 10, ignoreCase: false });
    expect(code).not.toContain('asLowercase');
    expect(code).toContain('sel asString includesString:');
  });

  it('bounds the scan with an early return at the limit', () => {
    const code = buildSelectorSearchCode('at', { limit: 25, ignoreCase: true });
    expect(code).toContain('count >= 25 ifTrue: [^ws contents]');
  });

  it('honors a non-default environmentId', () => {
    const code = buildSelectorSearchCode('at', { limit: 10, ignoreCase: true, environmentId: 2 });
    expect(code).toContain('categoryOfSelector: sel environmentId: 2');
  });

  it('is pure ASCII (3.6.2 ComStrmSetCursor safety)', () => {
    const code = buildSelectorSearchCode('at:put:', { limit: 10, ignoreCase: true });
    expect([...code].every((ch) => ch.charCodeAt(0) <= 127)).toBe(true);
  });
});

describe('parseSelectorSearchResults', () => {
  it('parses tab-separated rows and drops malformed / blank lines', () => {
    const raw =
      'Globals\tOrderedCollection\t0\tadd:\tadding\n' +
      'Globals\tArray\t1\tnew:\tinstance creation\n' +
      '\n' +
      'too\tfew\tfields\n';
    expect(parseSelectorSearchResults(raw)).toEqual([
      {
        dictName: 'Globals',
        className: 'OrderedCollection',
        isMeta: false,
        selector: 'add:',
        category: 'adding',
      },
      {
        dictName: 'Globals',
        className: 'Array',
        isMeta: true,
        selector: 'new:',
        category: 'instance creation',
      },
    ]);
  });

  it('keeps an empty trailing category field', () => {
    const [row] = parseSelectorSearchResults('Globals\tArray\t0\tfoo\t\n');
    expect(row.category).toBe('');
  });
});

describe('searchSelectors', () => {
  it('runs the built code through the executor and parses the result', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Globals\tArray\t0\tsize\taccessing\n');
    const rows = searchSelectors(execute, 'siz', { limit: 5, ignoreCase: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain("'siz' asLowercase");
    expect(rows).toEqual([
      {
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'size',
        category: 'accessing',
      },
    ]);
  });
});
