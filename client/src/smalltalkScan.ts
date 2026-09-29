/**
 * Scanning Smalltalk source for the parts that are quoted rather than code.
 *
 * Several client features walk method source looking for structure — the
 * debugger's inline-value mask, the step-point keyword scan — and every one of
 * them has to step over strings, comments and character literals first. Getting
 * that wrong is quiet: nothing fails to parse, the scan simply reads a quoted
 * character as a delimiter and everything after it is misread. The fix for
 * https://github.com/GemTalk/Jasper/issues/466 was exactly that bug, found
 * independently in two scanners that had each rolled their own loop.
 *
 * ── Keeping this in step with the server ──────────────────────────────────
 * The server has its own scanner, `server/src/lexer/lexer.ts`, and it must agree
 * with this one. It cannot simply import this file: `client/tsconfig.json` and
 * `server/tsconfig.json` each pin `rootDir` to their own `src`, so sharing code
 * would take a third workspace and a build change.
 *
 * What holds the two together instead is `test-fixtures/smalltalkLiteralCorpus.json`.
 * It declares where every string, comment and character literal in a set of
 * tricky snippets begins and ends, and both sides assert against it:
 *
 *   client/src/__tests__/smalltalkScan.test.ts
 *   server/src/lexer/__tests__/literalCorpusAgreement.test.ts
 *
 * So: teaching this scanner a new Smalltalk quirk means adding the case to that
 * corpus, which will fail the server's test until the lexer learns it too (and
 * the other way round). Do not fix one side alone, and do not add the case to
 * only one of the two test files — the corpus is the shared contract.
 */

/** What `skipLiteral` found, and the offset just past it. */
export interface QuotedSpan {
  kind: 'character' | 'string' | 'comment';
  /** Offset of the first character AFTER the construct. Always > the start. */
  end: number;
}

/**
 * If a quoted construct begins at `at`, return its kind and where it ends;
 * otherwise return null. An unterminated string or comment runs to the end of
 * the source rather than throwing — a half-typed method is an ordinary state for
 * a scanner to be handed, not an error.
 *
 * Callers that count brackets must consult this BEFORE their depth counting, not
 * merely before their own string check: `$[` and `$(` would otherwise raise a
 * depth that never comes back down.
 *
 * `#` is not handled here. It is an ordinary token character to this scanner, so
 * the body of `#'sym'` is reported as a plain string one offset later. That is
 * enough for every caller, all of which care where a construct ENDS rather than
 * what it was called.
 */
export function skipLiteral(source: string, at: number): QuotedSpan | null {
  if (at < 0 || at >= source.length) return null;

  const ch = source[at];

  // A character literal's value is data, never a delimiter: `$[` opens no block,
  // `$'` no string, `$"` no comment, `$.` ends no statement. Exactly one
  // character is consumed, so a real `.` after `$a` still ends the statement,
  // and a trailing `$` stops at the end of the source.
  if (ch === '$') {
    return { kind: 'character', end: Math.min(at + 2, source.length) };
  }

  // A string. `''` inside one is an escaped quote, not a close followed by an
  // open, so a doubled quote keeps the string running.
  if (ch === "'") {
    let i = at + 1;
    while (i < source.length) {
      if (source[i] === "'") {
        i++;
        if (i >= source.length || source[i] !== "'") break;
      }
      i++;
    }
    return { kind: 'string', end: Math.min(i, source.length) };
  }

  // A comment. Like a string, it escapes its own delimiter by doubling it, so
  // `""` inside a comment is one embedded quote and the comment keeps running.
  // The class comments under gs-src/refactoring/ rely on this — RBBlockNode's
  // says it `represents a block ""[...]""`. An empty comment is still written
  // `""`: at the second quote there is no third one following, so it closes.
  if (ch === '"') {
    let i = at + 1;
    while (i < source.length) {
      if (source[i] === '"') {
        i++;
        if (i >= source.length || source[i] !== '"') break;
      }
      i++;
    }
    return { kind: 'comment', end: Math.min(i, source.length) };
  }

  return null;
}
