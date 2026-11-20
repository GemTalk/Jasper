/**
 * Methods provider: the selector space is too large to preload, so this queries the stone per
 * search term (the controller debounces, and we skip terms shorter than `methodMinQueryLength` to
 * avoid hammering the stone). The server pre-filters by selector substring and returns its rows
 * best-tier-first (exact selector, then prefix, then substring elsewhere — see `searchSelectors`); we
 * re-rank client-side with the configured matcher for a consistent order.
 *
 * The row label is `Class>>selector` (or `Class class>>selector` for the class side); the match is
 * computed against the selector and the highlight ranges are shifted into label coordinates.
 *
 * A term that names one method (`Object>>printString`, a pasted GsNMethod or debugger frame) skips
 * the scan and the minimum length: it is looked up directly, exact case, and answers that method —
 * on the class named, or on the ancestor it inherits it from.
 */
import { SelectorSearchResult } from '../../queries/searchSelectors';
import { MethodLookupResult } from '../queries/lookupMethod';
import { MethodReference, parseMethodReference } from '../../methodReference';
import {
  CATEGORY_BY_ID,
  OmniCancel,
  OmniConfig,
  OmniProvider,
  OmniResult,
  OmniTruncationSink,
} from '../omniTypes';
import { match } from '../omniMatch';
import { compareMethodRows } from '../rank';

/** Runs the bounded selector search against the stone. Injected so the provider is stone-free. */
export type SelectorSearchRunner = (
  term: string,
  limit: number,
  ignoreCase: boolean,
) => SelectorSearchResult[];

/** Looks one method up by class, side and selector. Injected so the provider is stone-free. */
export type MethodLookupRunner = (
  className: string,
  isMeta: boolean,
  selector: string,
) => MethodLookupResult[];

/** Over-fetch factor: request this many × the displayed cap from the server, so ranking has a
 *  wider pool to pick the best matches from — the tie-break by class name (below) can only be A→Z
 *  over the rows it was given (see search()). */
export const SERVER_OVERFETCH = 4;
function labelFor(r: SelectorSearchResult): string {
  return `${r.className}${r.isMeta ? ' class' : ''}>>${r.selector}`;
}

function openMethod(sessionId: number, r: SelectorSearchResult): OmniResult['action'] {
  return {
    kind: 'openMethod',
    sessionId,
    dictName: r.dictName,
    className: r.className,
    isMeta: r.isMeta,
    category: r.category,
    selector: r.selector,
    environmentId: 0,
    dictIndex: 0,
  };
}

function referenceResults(
  sessionId: number,
  ref: MethodReference,
  lookup: MethodLookupRunner,
): OmniResult[] {
  return lookup(ref.className, ref.isMeta, ref.selector).map((r) => {
    const label = labelFor(r);
    const description = [
      r.dictName,
      ...(r.inheritedBy ? [`inherited by ${r.inheritedBy}`] : []),
      ...(ref.inBlock ? ['contains the block'] : []),
    ].join(' · ');
    return {
      categoryId: 'methods',
      label,
      description,
      score: 0,
      ranges: [[0, label.length]],
      exact: true,
      action: openMethod(sessionId, r),
    };
  });
}

export function createMethodsProvider(
  sessionId: number,
  runSearch: SelectorSearchRunner,
  lookup?: MethodLookupRunner,
): OmniProvider {
  // A reference costs one lookup, not a scan, so it runs even with Methods held back from All.
  const referenceIn = (query: string) => (lookup ? parseMethodReference(query.trim()) : null);
  return {
    category: CATEGORY_BY_ID.methods,
    runsWhenHeldBack: (query) => referenceIn(query) !== null,
    search(
      query: string,
      cfg: OmniConfig,
      _token?: OmniCancel,
      reportTruncated?: OmniTruncationSink,
    ): OmniResult[] {
      const term = query.trim();
      const ref = referenceIn(term);
      if (ref && lookup) return referenceResults(sessionId, ref, lookup);
      if (term.length < cfg.methodMinQueryLength) return [];

      // Fetch a WIDER server slice than we display, then rank + cap client-side: the slice is what the
      // A→Z tie-break at the bottom gets to order, so a tight one would show the first few classes the
      // scan reached rather than the first few alphabetically.
      // The `gemstone.omniSearch.maxServerScan` setting bounds the server slice, and so the scan cost,
      // regardless of maxResultsPerCategory. `readOmniConfig` has already clamped it into 20–20 000, so
      // it is read straight. It bounds the RESULTS as well as the cost: `searchSelectors` yields at most
      // that many rows, so a broad term can never return more no matter how far the display cap is
      // raised — "Load all" included. `search` therefore reports truncation to the engine, which would
      // otherwise present a cut-off count as an exact total, with nothing on screen saying the scan
      // stopped short. What the cut-off can no longer do is hide the BEST matches: the server orders
      // its rows by match tier, so what a full slice drops is the least relevant tail (issue #517).
      const ceiling = cfg.maxServerScan;
      const serverLimit = Math.min(cfg.maxResultsPerCategory * SERVER_OVERFETCH, ceiling);
      const rows = runSearch(term, serverLimit, !cfg.caseSensitive);
      // A FULL slice means the scan had rows it could not hand back, so the image almost certainly
      // holds matches we never saw: the count is a floor, not a total. Judged on the RAW row count, before the re-filter
      // below — that drops rows and would mask the fact that we stopped early. When the image happens
      // to hold exactly `serverLimit` matches this over-reports by claiming "more exist"; telling the
      // two apart would cost another fetch, so we stay conservative.
      //
      // `atCeiling` separates the two very different reasons the slice can be full. If the CONFIGURED
      // ceiling bound it, Load-more cannot fetch more and the user should be told, naming their own
      // setting. If the (smaller) over-fetch bound it, Load-more raises the cap and genuinely widens
      // the scan — warning there would be wrong, and reporting `scanned` as the limit would show a
      // number nobody configured that then changes on every Load-more.
      if (rows.length >= serverLimit) {
        reportTruncated?.({
          categoryId: 'methods',
          scanned: serverLimit,
          ceiling,
          atCeiling: serverLimit >= ceiling,
        });
      }
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
          action: openMethod(sessionId, r),
        });
      }
      // Rank by match score, but break ties between same-scored selectors (e.g. many `withAll:`
      // implementors) by class A→Z, then instance side before class side, then selector, so the
      // capped page — and each "Load more" page — is a predictable list rather than
      // shortest-label-first. `compareMethodRows` is the SAME comparator the engine ranks the flat
      // list with (not a hand-rolled mirror of it): the cap below decides which rows survive, so an
      // order of our own would drop rows by one key and display the survivors by another — at the
      // boundary, dropping an instance-side row while keeping its class-side sibling.
      out.sort(compareMethodRows);
      return out.slice(0, cfg.maxResultsPerCategory);
    },
  };
}
