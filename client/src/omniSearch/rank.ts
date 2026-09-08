/**
 * Shared ranking helpers for providers: `rankAndLimit` matches every candidate against the query,
 * drops non-matches, sorts by the matcher's total order and caps to `maxResultsPerCategory`;
 * `compareMethodRows` is the total order over METHOD-like rows, shared with the engine so the page a
 * provider caps and the flat list the engine ranks are decided by one key.
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

/** Ordering key for a method-like row: the class it lives on, which side of it, and its selector.
 *  Non-method rows (Source/Literals hits are `openMethod` too, so there are none today) fall back to
 *  their label, so the key is total whatever lands here. */
function methodSortKey(r: OmniResult): [string, number, string] {
  return r.action.kind === 'openMethod'
    ? [r.action.className, r.action.isMeta ? 1 : 0, r.action.selector]
    : [r.label, 0, ''];
}

/**
 * Total order over method-like rows: matcher score first (Source/Literals rows all tie at 0), then
 * the method key above, then the label as a last resort so two rows are never merely "equal".
 *
 * Shared deliberately. The Methods provider caps its own page with this, and the engine re-ranks the
 * whole flat list with it, so a row cannot be kept by one order and then displayed in another — at
 * the cap boundary that would drop an instance-side row while keeping its class-side sibling, and
 * then claim to show the instance side first. Ordering by the METHOD rather than by the label text
 * is what makes the two agree: `'Array class>>at:'.localeCompare('Array>>at:')` is -1, so a label
 * tiebreak puts the class side FIRST, the opposite of the side step here.
 */
export function compareMethodRows(a: OmniResult, b: OmniResult): number {
  if (a.score !== b.score) return b.score - a.score;
  const [aClass, aSide, aSel] = methodSortKey(a);
  const [bClass, bSide, bSel] = methodSortKey(b);
  const byClass = aClass.localeCompare(bClass);
  if (byClass !== 0) return byClass;
  if (aSide !== bSide) return aSide - bSide;
  const bySelector = aSel.localeCompare(bSel);
  if (bySelector !== 0) return bySelector;
  return a.label.localeCompare(b.label);
}
