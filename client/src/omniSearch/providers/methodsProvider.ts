/**
 * Methods provider: the selector space is too large to preload, so this queries the stone per
 * search term (the controller debounces, and we skip terms shorter than `methodMinQueryLength` to
 * avoid hammering the stone). The server pre-filters by selector substring; we re-rank client-side
 * with the configured matcher for a consistent order.
 *
 * The row label is `Class>>selector` (or `Class class>>selector` for the class side); the match is
 * computed against the selector and the highlight ranges are shifted into label coordinates.
 */
import { SelectorSearchResult } from '../../queries/searchSelectors';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { match } from '../omniMatch';

/** Runs the bounded selector search against the stone. Injected so the provider is stone-free. */
export type SelectorSearchRunner = (
  term: string,
  limit: number,
  ignoreCase: boolean,
) => SelectorSearchResult[];

/** Over-fetch factor: request this many × the displayed cap from the server, so ranking has a
 *  wider pool to pick the best matches from (see search()). */
export const SERVER_OVERFETCH = 4;
/** Hard ceiling on the server slice, to bound the scan cost regardless of maxResultsPerCategory. */
export const MAX_SERVER_LIMIT = 200;

function labelFor(r: SelectorSearchResult): string {
  return `${r.className}${r.isMeta ? ' class' : ''}>>${r.selector}`;
}

export function createMethodsProvider(
  sessionId: number,
  runSearch: SelectorSearchRunner,
): OmniProvider {
  return {
    category: CATEGORY_BY_ID.methods,
    search(query: string, cfg: OmniConfig): OmniResult[] {
      const term = query.trim();
      if (term.length < cfg.methodMinQueryLength) return [];

      // Fetch a WIDER server slice than we display, then rank + cap client-side. The server scan is
      // substring-match in symbol-list order (not by relevance), so a high-quality selector match
      // could sit past a tight cutoff and never reach us; over-fetching lets the ranking surface it.
      const serverLimit = Math.min(cfg.maxResultsPerCategory * SERVER_OVERFETCH, MAX_SERVER_LIMIT);
      const rows = runSearch(term, serverLimit, !cfg.caseSensitive);
      const out: OmniResult[] = [];
      for (const r of rows) {
        const m = match(term, r.selector, {
          mode: cfg.matchMode,
          caseSensitive: cfg.caseSensitive,
        });
        if (!m) continue;
        const label = labelFor(r);
        const shift = label.length - r.selector.length; // the `Class>>`/`Class class>>` prefix
        out.push({
          categoryId: 'methods',
          label,
          // Just the home dictionary — NOT the method protocol/category, which ate row width and
          // truncated long Class>>selector labels for little value (Eric's ask M).
          description: r.dictName,
          score: m.score,
          ranges: m.ranges.map(([s, e]) => [s + shift, e + shift] as [number, number]),
          action: {
            kind: 'openMethod',
            sessionId,
            dictName: r.dictName,
            className: r.className,
            isMeta: r.isMeta,
            category: r.category,
            selector: r.selector,
            environmentId: 0,
            dictIndex: 0,
          },
        });
      }
      // Rank by match score, but break ties between same-scored selectors (e.g. many `withAll:`
      // implementors) alphabetically by class name so the capped page — and each "Load more" page —
      // is a predictable A→Z list rather than shortest-label-first. Mirrors the engine's final sort.
      out.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const ac = a.action.kind === 'openMethod' ? a.action.className : a.label;
        const bc = b.action.kind === 'openMethod' ? b.action.className : b.label;
        const byClass = ac.localeCompare(bc);
        return byClass !== 0 ? byClass : a.label.localeCompare(b.label);
      });
      return out.slice(0, cfg.maxResultsPerCategory);
    },
  };
}
