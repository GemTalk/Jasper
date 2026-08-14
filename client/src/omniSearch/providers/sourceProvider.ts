/**
 * Source provider: full-text substring search over method SOURCE (`searchMethodSource`) — the
 * heavyweight one. It scans every method's source, so it is marked `explicitOnly` on its category
 * and never runs in the default "search everything" fan-out; it fires only when the user scopes
 * directly to Source (the Source button), and even then only past `methodMinQueryLength` (with the
 * controller's debounce). Hits are methods, so they open the method and carry the ↗ senders button.
 */
import { MethodSearchResult } from '../../queries/methodSearch';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { methodRowsToResults } from '../references';

/** Runs the substring-over-source search against the stone. Injected so the provider is stone-free. */
export type SourceSearchRunner = (term: string, ignoreCase: boolean) => MethodSearchResult[];

export function createSourceProvider(
  sessionId: number,
  runSearch: SourceSearchRunner,
): OmniProvider {
  return {
    category: CATEGORY_BY_ID.source,
    search(query: string, cfg: OmniConfig): OmniResult[] {
      const term = query.trim();
      if (term.length < cfg.methodMinQueryLength) return [];

      const rows = runSearch(term, !cfg.caseSensitive);
      return methodRowsToResults(rows, sessionId, 'source').slice(0, cfg.maxResultsPerCategory);
    },
  };
}
