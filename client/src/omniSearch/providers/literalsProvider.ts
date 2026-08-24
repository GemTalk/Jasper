/**
 * Literals provider (explicit-only): find methods that use a value as a LITERAL — not as a message
 * send, and not merely somewhere in source text. Restricted to the two forms that are meaningful:
 *   - a **symbol** `#at:put:` → `literalSymbolReferences` = literal-frame refs MINUS senders, so only
 *     the methods that use `#at:put:` as data (a selector send is excluded);
 *   - a **string** `'error'` → `stringLiteralReferences` = source-substring candidates filtered to
 *     those whose literal frame holds that String EXACTLY (so `'name'` finds the literal 'name', not
 *     every string containing "name" like 'className'; excludes comments/selectors).
 * Anything else (a bare number, a character — immediates that aren't in the literal frame) is rejected
 * up front (shows nothing; the scoped placeholder tells the user to type `#symbol` or `'string'`). The
 * `#` branch also insists on a COMPLETE, well-formed symbol literal (`isSymbolLiteral`) before it runs:
 * the expression is evaluated on the server, so a shape gate keeps `#foo. System abortTransaction` and
 * other partial/injecting input from ever reaching the stone.
 *
 * Heavyweight + expression-based, so a partial/invalid form shows nothing (no error popup). Hits are
 * methods (open + ↗ senders), grouped under the Literals scope.
 */
import { MethodSearchResult } from '../../queries/methodSearch';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { methodRowsToResults } from '../references';

/** Reference-search for a compilable `#symbol` expression. Injected so the provider stays stone-free. */
export type LiteralSymbolRunner = (symbolExpr: string) => MethodSearchResult[];
/** Source substring search for a string literal's content. Injected so the provider stays stone-free. */
export type LiteralStringRunner = (text: string, ignoreCase: boolean) => MethodSearchResult[];
/** Reports a REAL runner failure (GCI drop, aborted transaction, ...) so it can be logged rather than
 *  masquerading as "no results". Injected so the provider stays stone-free (and UI-/logger-free). */
export type LiteralSearchErrorSink = (message: string) => void;

/** The content of a complete `'...'` string literal, or null if it isn't a closed, non-empty string. */
export function parseStringLiteral(term: string): string | null {
  if (!term.startsWith("'") || term.length < 2 || !term.endsWith("'")) return null;
  const inner = term.slice(1, -1).replace(/''/g, "'");
  return inner.length > 0 ? inner : null;
}

// A well-formed Smalltalk symbol literal, in full: `#` followed by exactly one of
//   - a keyword selector `at:put:` (one-or-more `ident:` segments),
//   - a unary identifier `foo` / `_bar1`,
//   - a binary selector `+` / `<=` / `,`,
//   - a quoted symbol `'anything, '' to escape a quote'`.
// The whole term must be this and nothing more — this is the shape gate that stops the symbol branch
// from evaluating arbitrary server code (e.g. `#foo. System abortTransaction`): anything with a
// trailing `.`, space, or stray statement fails the anchors and is rejected before it reaches the stone.
const SYMBOL_LITERAL_RE =
  /^#(?:[A-Za-z_]\w*:(?:[A-Za-z_]\w*:)*|[A-Za-z_]\w*|[-+*/\\~<>=&|@%,?!]+|'(?:[^']|'')*')$/;

/** Whether `term` is a complete, well-formed `#symbol` literal (and nothing else). */
export function isSymbolLiteral(term: string): boolean {
  return SYMBOL_LITERAL_RE.test(term);
}

export function createLiteralsProvider(
  sessionId: number,
  runSymbol: LiteralSymbolRunner,
  runString: LiteralStringRunner,
  onError?: LiteralSearchErrorSink,
): OmniProvider {
  return {
    category: CATEGORY_BY_ID.literals,
    search(query: string, cfg: OmniConfig): OmniResult[] {
      const term = query.trim();

      // Resolve the term to a runner call, or bail out for the "not a literal / still typing" cases.
      // These bailouts are pure (no server round-trip), so anything that reaches the try below is a
      // COMPLETE, well-formed literal — which means a throw from the runner is a real backend failure,
      // never "not yet compilable". Keep the `isSymbolLiteral` gate before `runSymbol`: the symbol
      // branch evaluates on the server, so only a whole `#symbol` may reach the stone.
      let run: () => MethodSearchResult[];
      if (term.startsWith('#')) {
        if (!isSymbolLiteral(term)) return []; // partial or malformed — don't eval raw input
        run = () => runSymbol(term);
      } else if (term.startsWith("'")) {
        const content = parseStringLiteral(term);
        if (content === null) return []; // still typing an unclosed/empty string
        run = () => runString(content, !cfg.caseSensitive);
      } else {
        return []; // not a #symbol or 'string' — the placeholder instructs the user
      }

      let rows: MethodSearchResult[];
      try {
        rows = run();
      } catch (e) {
        // A real failure from the server-side runner (GCI drop, aborted transaction, ...). Surface it
        // so it's diagnosable instead of masquerading as "no results". Still return [] — the sync
        // provider API has no error row, and throwing would abort sibling providers in the All scope.
        onError?.(
          `Literals search failed for ${term}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return [];
      }
      return methodRowsToResults(rows, sessionId, 'literals').slice(0, cfg.maxResultsPerCategory);
    },
  };
}
