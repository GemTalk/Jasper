/**
 * Literals provider (explicit-only): find methods that use a value as a LITERAL — not as a message
 * send, and not merely somewhere in source text. Restricted to the two forms that are meaningful:
 *   - a **symbol** `#at:put:` → `literalSymbolReferences` = literal-frame refs MINUS senders, so only
 *     the methods that use `#at:put:` as data (a selector send is excluded);
 *   - a **string** `'error'` → `stringLiteralReferences` = source-substring candidates filtered to
 *     those whose literal frame holds that String EXACTLY (so `'name'` finds the literal 'name', not
 *     every string containing "name" like 'className'; excludes comments/selectors).
 * Anything else (a bare number, a character — immediates that aren't in the literal frame) is rejected
 * up front (shows nothing; the scoped placeholder tells the user to type `#symbol` or `'string'`).
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

/** The content of a complete `'...'` string literal, or null if it isn't a closed, non-empty string. */
export function parseStringLiteral(term: string): string | null {
  if (!term.startsWith("'") || term.length < 2 || !term.endsWith("'")) return null;
  const inner = term.slice(1, -1).replace(/''/g, "'");
  return inner.length > 0 ? inner : null;
}

export function createLiteralsProvider(
  sessionId: number,
  runSymbol: LiteralSymbolRunner,
  runString: LiteralStringRunner,
): OmniProvider {
  return {
    category: CATEGORY_BY_ID.literals,
    search(query: string, cfg: OmniConfig): OmniResult[] {
      const term = query.trim();

      let rows: MethodSearchResult[];
      try {
        if (term.startsWith('#') && term.length > 1) {
          rows = runSymbol(term);
        } else if (term.startsWith("'")) {
          const content = parseStringLiteral(term);
          if (content === null) return []; // still typing an unclosed/empty string
          rows = runString(content, !cfg.caseSensitive);
        } else {
          return []; // not a #symbol or 'string' — the placeholder instructs the user
        }
      } catch {
        return []; // not (yet) a compilable expression
      }
      return methodRowsToResults(rows, sessionId, 'literals').slice(0, cfg.maxResultsPerCategory);
    },
  };
}
