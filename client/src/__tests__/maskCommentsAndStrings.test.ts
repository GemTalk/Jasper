import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { maskCommentsAndStrings } from '../debuggerPanel';

/**
 * Characterization tests for the mask the debugger's inline-value annotations are
 * matched against. They pin the behaviour that was in place when the scan moved
 * onto the shared `skipLiteral` helper, so the move could be shown to change
 * nothing: every test here passed before that change and must keep passing after.
 *
 * Two rules are easy to break. A string or comment is blanked INCLUDING its
 * delimiters, so no leftover quote can be read as the start of another one. A
 * character literal is left alone — `$'` is code, not quoted text.
 *
 * Cases come from the corpus shared with the server lexer's own agreement test,
 * so a Smalltalk quirk taught to one scanner and not the other turns one of the
 * two red. Add quirks there, not here.
 */
const corpus = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'test-fixtures', 'smalltalkLiteralCorpus.json'),
    'utf-8',
  ),
) as { cases: Array<{ name: string; source: string; literals: string[]; why: string }> };

/**
 * Offsets the mask is expected to blank: everything inside a declared string or
 * comment. Character literals are excluded — the mask deliberately leaves them
 * standing — which is what the `$` test below distinguishes.
 */
function quotedOffsets(c: { source: string; literals: string[] }): Set<number> {
  const offsets = new Set<number>();
  let cursor = 0;
  for (const literal of c.literals) {
    const at = c.source.indexOf(literal, cursor);
    expect(at, `corpus literal ${JSON.stringify(literal)} not found in its source`).toBeGreaterThan(
      -1,
    );
    cursor = at + literal.length;
    if (literal.startsWith('$')) continue; // a character literal is code
    for (let i = at; i < at + literal.length; i++) offsets.add(i);
  }
  return offsets;
}

describe('maskCommentsAndStrings over the shared literal corpus', () => {
  for (const c of corpus.cases) {
    describe(`${c.name}`, () => {
      it('blanks every character inside a string or comment, newlines aside', () => {
        const masked = maskCommentsAndStrings(c.source);
        const quoted = quotedOffsets(c);
        for (const i of quoted) {
          // Newlines survive so that masking never changes line numbering.
          const expected = c.source[i] === '\n' ? '\n' : ' ';
          expect(masked[i], `offset ${i} of ${JSON.stringify(c.source)}`).toBe(expected);
        }
      });

      it('leaves every character outside a string or comment untouched', () => {
        const masked = maskCommentsAndStrings(c.source);
        const quoted = quotedOffsets(c);
        for (let i = 0; i < c.source.length; i++) {
          if (quoted.has(i)) continue;
          expect(masked[i], `offset ${i} of ${JSON.stringify(c.source)}`).toBe(c.source[i]);
        }
      });

      it('preserves length, so every offset still addresses the same character', () => {
        expect(maskCommentsAndStrings(c.source)).toHaveLength(c.source.length);
      });
    });
  }
});

describe('maskCommentsAndStrings, spelled out', () => {
  // A few masks written in full. The corpus cases above assert the same rules
  // offset by offset; these are here so the shape is readable at a glance.
  it('blanks a string but not the code around it', () => {
    expect(maskCommentsAndStrings("s := 'hello'.")).toBe('s :=        .');
  });

  it('blanks a comment', () => {
    expect(maskCommentsAndStrings('"a comment" x := 1.')).toBe('            x := 1.');
  });

  it('leaves a character literal standing', () => {
    expect(maskCommentsAndStrings("x := $'. y := 3.")).toBe("x := $'. y := 3.");
  });

  it('keeps the # of a quoted symbol and blanks only its body', () => {
    expect(maskCommentsAndStrings("s := #'odd symbol'.")).toBe('s := #            .');
  });

  it('does not read past the end of the buffer for a trailing $', () => {
    expect(maskCommentsAndStrings('c := $')).toBe('c := $');
  });
});
