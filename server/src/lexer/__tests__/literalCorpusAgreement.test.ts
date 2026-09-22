import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from '../lexer';
import { TokenType } from '../tokens';

/**
 * Jasper scans Smalltalk source in two places that cannot import each other: this
 * lexer (server workspace) and `client/src/smalltalkScan.ts` (client workspace).
 * Each `tsconfig.json` pins `rootDir` to its own `src`, so a shared module would
 * need a third workspace and a build change — see the note at the top of the
 * lexer and of `smalltalkScan.ts`.
 *
 * What keeps the two honest is this corpus, not a comment. The fixture declares
 * where every string, comment and character literal begins and ends; this file
 * asserts the lexer agrees, and `client/src/__tests__/smalltalkScan.test.ts`
 * asserts the client scanner agrees with the same fixture. Teaching one side a
 * new Smalltalk quirk without the other turns one of the two red.
 *
 * Add new quirks to the fixture, never to only one of these two files.
 */
const corpus = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', '..', 'test-fixtures', 'smalltalkLiteralCorpus.json'),
    'utf-8',
  ),
) as {
  cases: Array<{
    name: string;
    source: string;
    literals: string[];
    lexerLiterals?: string[];
    why: string;
  }>;
};

/**
 * The spans the lexer considers "quoted" — the things whose contents are data
 * rather than code. `#'...'` arrives as one Symbol token that includes its `#`;
 * a bare `#foo` is an ordinary token, not a quoted span, so it is not collected.
 */
function quotedSpans(source: string): string[] {
  const spans: string[] = [];
  for (const token of new Lexer(source).tokenize()) {
    if (
      token.type === TokenType.Character ||
      token.type === TokenType.String ||
      token.type === TokenType.Comment ||
      (token.type === TokenType.Symbol && token.text.startsWith("#'"))
    ) {
      spans.push(token.text);
    }
  }
  return spans;
}

describe('the lexer agrees with the shared literal corpus', () => {
  it('covers every case in the fixture', () => {
    expect(corpus.cases.length).toBeGreaterThan(0);
  });

  for (const c of corpus.cases) {
    it(`${c.name}: ${c.why}`, () => {
      expect(quotedSpans(c.source)).toEqual(c.lexerLiterals ?? c.literals);
    });
  }

  it('reports each quoted span at the offset it actually occupies', () => {
    // Text equality alone would pass even if the lexer mislocated a span, which
    // is the failure that would break findMethodEnd's line arithmetic.
    for (const c of corpus.cases) {
      for (const token of new Lexer(c.source).tokenize()) {
        expect(c.source.slice(token.range.start.offset, token.range.end.offset)).toBe(token.text);
      }
    }
  });
});
