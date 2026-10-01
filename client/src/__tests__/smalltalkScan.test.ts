import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { skipLiteral } from '../smalltalkScan';

/**
 * The client half of the corpus agreement. The fixture declares where every
 * string, comment and character literal in a snippet begins and ends; this file
 * asserts `skipLiteral` finds exactly those, and
 * `server/src/lexer/__tests__/literalCorpusAgreement.test.ts` asserts the lexer
 * finds the same ones. The two scanners live in workspaces that cannot import
 * each other, so the corpus — not a comment — is what stops them drifting apart.
 *
 * Add a Smalltalk quirk to the fixture and both sides must handle it.
 */
const corpus = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'test-fixtures', 'smalltalkLiteralCorpus.json'),
    'utf-8',
  ),
) as { cases: Array<{ name: string; source: string; literals: string[]; why: string }> };

/** Walk a whole snippet the way a caller does, collecting what was skipped. */
function scan(source: string): string[] {
  const found: string[] = [];
  let i = 0;
  let guard = 0;
  while (i < source.length) {
    expect(guard++, `skipLiteral failed to advance in ${JSON.stringify(source)}`).toBeLessThan(
      source.length + 1,
    );
    const span = skipLiteral(source, i);
    if (span) {
      expect(span.end, 'a span must advance past its start').toBeGreaterThan(i);
      found.push(source.slice(i, span.end));
      i = span.end;
      continue;
    }
    i++;
  }
  return found;
}

describe('skipLiteral over the shared literal corpus', () => {
  for (const c of corpus.cases) {
    it(`${c.name}: ${c.why}`, () => {
      expect(scan(c.source)).toEqual(c.literals);
    });
  }
});

describe('skipLiteral reports which construct it skipped', () => {
  it('names a character literal', () => {
    expect(skipLiteral("$' rest", 0)).toEqual({ kind: 'character', end: 2 });
  });

  it('names a string', () => {
    expect(skipLiteral("'abc' rest", 0)).toEqual({ kind: 'string', end: 5 });
  });

  it('names a comment', () => {
    expect(skipLiteral('"abc" rest', 0)).toEqual({ kind: 'comment', end: 5 });
  });
});

describe('skipLiteral declines positions that open nothing', () => {
  it('returns null on ordinary code', () => {
    const source = "x := $'.";
    expect(skipLiteral(source, 0)).toBeNull(); // x
    expect(skipLiteral(source, 2)).toBeNull(); // :
    expect(skipLiteral(source, 7)).toBeNull(); // .
  });

  it('returns null at and past the end of the source', () => {
    expect(skipLiteral('abc', 3)).toBeNull();
    expect(skipLiteral('abc', 99)).toBeNull();
  });

  it('does not treat # as a quoting construct', () => {
    // `#` is an ordinary token character to this scanner; the quoted body of
    // `#'sym'` is picked up as a plain string one offset later. The server lexer
    // reports `#'sym'` as a single Symbol token instead — the two land in the
    // same place, which is all that depth and statement-end decisions need.
    expect(skipLiteral("#'sym'", 0)).toBeNull();
    expect(skipLiteral("#'sym'", 1)).toEqual({ kind: 'string', end: 6 });
  });
});

describe('skipLiteral on unterminated input', () => {
  it('runs an unterminated string to the end of the source', () => {
    const source = "s := 'no close";
    expect(skipLiteral(source, 5)).toEqual({ kind: 'string', end: source.length });
  });

  it('runs an unterminated comment to the end of the source', () => {
    const source = 'x "no close';
    expect(skipLiteral(source, 2)).toEqual({ kind: 'comment', end: source.length });
  });

  it('stops a trailing $ at the end of the source', () => {
    expect(skipLiteral('c := $', 5)).toEqual({ kind: 'character', end: 6 });
  });

  it('consumes exactly one character after a $, never two', () => {
    // `$.` must not eat the `.` that follows it, or a statement-end scan would
    // run on into the next statement.
    const source = 'x := $a. y';
    expect(skipLiteral(source, 5)).toEqual({ kind: 'character', end: 7 });
    expect(source[7]).toBe('.');
  });
});
