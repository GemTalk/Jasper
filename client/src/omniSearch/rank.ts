/**
 * Shared ranking helper for providers: match every candidate against the query, drop non-matches,
 * sort by the matcher's total order, and cap to `maxResultsPerCategory`.
 */
import { match, compareMatches, MatchResult } from './omniMatch';
import { OmniConfig, OmniResult } from './omniTypes';

export function rankAndLimit<T>(
  query: string,
  items: readonly T[],
  cfg: OmniConfig,
  textOf: (item: T) => string,
  toResult: (item: T, m: MatchResult) => OmniResult,
): OmniResult[] {
  const out: OmniResult[] = [];
  for (const item of items) {
    const m = match(query, textOf(item), { mode: cfg.matchMode, caseSensitive: cfg.caseSensitive });
    if (m) out.push(toResult(item, m));
  }
  out.sort((a, b) =>
    compareMatches({ score: a.score, label: a.label }, { score: b.score, label: b.label }),
  );
  return out.slice(0, cfg.maxResultsPerCategory);
}
