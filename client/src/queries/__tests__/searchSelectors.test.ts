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
    expect(code).toContain('text := sel asString asLowercase');
    expect(code).toContain('text includesString: needle');
  });

  it('compares as-is when ignoreCase is false', () => {
    const code = buildSelectorSearchCode('at', { limit: 10, ignoreCase: false });
    expect(code).not.toContain('asLowercase');
    expect(code).toContain('text := sel asString');
  });

  it('caps every tier at the limit', () => {
    const code = buildSelectorSearchCode('at', { limit: 25, ignoreCase: true });
    expect(code).toContain('exactCount < 25');
    expect(code).toContain('prefixCount < 25');
    expect(code).toContain('otherCount < 25');
  });

  it('returns the tiers best-first, so a truncated slice keeps the strongest matches', () => {
    const code = buildSelectorSearchCode('at', { limit: 10, ignoreCase: true });
    expect(code).toContain('exact contents, prefixed contents, other contents');
  });

  it('leaves the scan early ONLY when the exact tier is full', () => {
    // A full exact tier is the one state where nothing later can change the answer, so it is the only
    // safe short-circuit: the old "stop at the first `limit` matches" is what let a common term fill
    // its slice with whatever the walk reached first and never reach the exact hit.
    const code = buildSelectorSearchCode('at', { limit: 25, ignoreCase: true });
    expect(code).toContain('exactCount >= 25 ifTrue: [^exact contents]');
    expect(code).not.toContain('prefixCount >= 25 ifTrue:');
    expect(code).not.toContain('otherCount >= 25 ifTrue:');
  });

  it('never compares strings with =, which the Utf8-compiled source makes an error', () => {
    // `GciLibrary.execute` compiles our source as Utf8, so a literal is a Utf8 and `sel asString` is a
    // String; `String = Utf8` raises ArgumentError 2718 and takes the whole search down with it. The
    // tier test therefore uses sizes + includesString: only. Guard against a "clearer" rewrite.
    const code = buildSelectorSearchCode('at', { limit: 10, ignoreCase: true });
    expect(code).not.toMatch(/text\s*=\s*needle/); // the exact-tier test
    expect(code).not.toMatch(/\)\s*=\s*needle/); // the prefix-tier test
    expect(code).toContain('text size = needle size');
    expect(code).toContain('(text copyFrom: 1 to: needle size) includesString: needle');
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
  it('hands back at most `limit` rows, keeping the best tiers', () => {
    // The server caps each TIER at `limit`, so it can answer up to 3 × limit rows; the rows arrive
    // best-tier-first, so the caller's `limit` is applied by keeping the FIRST of them.
    const raw = Array.from({ length: 7 }, (_, i) => `Globals\tC${i}\t0\tat:\taccessing\n`).join('');
    const rows = searchSelectors(() => raw, 'at:', { limit: 3, ignoreCase: true });
    expect(rows.map((r) => r.className)).toEqual(['C0', 'C1', 'C2']);
  });

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
