/**
 * Source provider: full-text search over method SOURCE (`searchMethodSource`) — the
 * heavyweight one. It scans every method's source, so it is marked `explicitOnly` on its category
 * and never runs in the default "search everything" fan-out; it fires only when the user scopes
 * directly to Source (the Source button), and even then only past `methodMinQueryLength` (with the
 * controller's debounce). Hits are methods, so they open the method and carry the ↗ senders button.
 *
 * It honours the match-algorithm chip, which it used to ignore entirely — all three positions ran
 * the same substring scan, so setting **Prefix** and getting `barfoo` and `doFooling` back was the
 * UI stating something untrue. Over a method body the chip's name-oriented meanings do not
 * transfer literally, so:
 *
 *   - **Prefix**    — the match must start at a word boundary. "Starts with the query" is
 *                     meaningless for a whole method's source; starting a token is the useful
 *                     reading, and is what "it finds it mid-word" asks for.
 *   - **Substring** — unchanged: the term anywhere in the source.
 *   - **Fuzzy**     — letters in order with gaps, WITHIN one identifier: `ordcol` finds a
 *                     method mentioning `OrderedCollection`. Per token rather than per body
 *                     because a subsequence across 370 characters of source matches nearly
 *                     anything — the reason the naive reading is useless. Constrained this way
 *                     it means what the chip means everywhere else (fuzzy over a NAME), applied
 *                     to the names the body mentions. It is the one mode that cannot use the
 *                     engine's substring scan, since a subsequence is not a substring.
 *                     A term that cannot BE an identifier — one carrying a space, a colon or
 *                     punctuation — has no per-identifier reading, and would match nothing at
 *                     all rather than approximately; those fall back to substring. See
 *                     `effectiveScanMode` in methodSearch.ts.
 */
import { MethodSearchResult, SourceScanMode } from '../../queries/methodSearch';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { methodRowsToResults } from '../references';

/** Runs the source search against the stone. Injected so the provider is stone-free.
 *  The scan mode is applied server-side; see searchMethodSource for why it cannot usefully be
 *  done here (the rows carry no source text, and the result cap is server-side). */
export type SourceSearchRunner = (
  term: string,
  ignoreCase: boolean,
  mode: SourceScanMode,
) => MethodSearchResult[];

/** The chip's position, in terms of what the scan should do over a method body. */
const SCAN_FOR: Record<OmniConfig['matchMode'], SourceScanMode> = {
  prefix: 'wordStart',
  fuzzy: 'fuzzyToken',
  substring: 'substring',
};

export function createSourceProvider(
  sessionId: number,
  runSearch: SourceSearchRunner,
): OmniProvider {
  return {
    category: CATEGORY_BY_ID.source,
    search(query: string, cfg: OmniConfig): OmniResult[] {
      const term = query.trim();
      if (term.length < cfg.methodMinQueryLength) return [];

      const rows = runSearch(term, !cfg.caseSensitive, SCAN_FOR[cfg.matchMode]);
      return methodRowsToResults(rows, sessionId, 'source').slice(0, cfg.maxResultsPerCategory);
    },
  };
}
