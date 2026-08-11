/**
 * Reference Search (Omni Wishlist Task 1): pivot from a found result to "who references it".
 *
 * Pure glue between an OmniResult and the shared reference queries (`sendersOf` /
 * `referencesToObject` in `browserQueries.ts`). Kept free of `vscode` and any stone session so it
 * unit-tests with plain data; the command layer runs the actual query and feeds the rows here.
 *
 * The reference action adapts to what the result is:
 *   - a **method** row (`Class>>selector`) → **senders** of that selector;
 *   - a **class** row → **references to** that class (methods that name it).
 * Dictionaries have no reference sense, so they yield no request (and get no button).
 */
import { MethodSearchResult } from '../queries/methodSearch';
import { OmniResult } from './omniTypes';

export type ReferenceRequest =
  | { title: string; kind: 'senders'; selector: string; environmentId: number }
  | { title: string; kind: 'references'; className: string; environmentId: number };

/** What (if anything) the reference button on a result should fetch, plus its breadcrumb title. */
export function referenceRequestFor(result: OmniResult): ReferenceRequest | null {
  const a = result.action;
  if (a.kind === 'openMethod') {
    return {
      title: `Senders of ${a.selector}`,
      kind: 'senders',
      selector: a.selector,
      environmentId: a.environmentId,
    };
  }
  if (a.kind === 'openClass') {
    return {
      title: `References to ${a.className}`,
      kind: 'references',
      className: a.className,
      environmentId: 0,
    };
  }
  return null;
}

/** Shape reference-query rows into method OmniResults (label `Class>>selector`, opens the method). */
export function methodRowsToResults(
  rows: readonly MethodSearchResult[],
  sessionId: number,
): OmniResult[] {
  return rows.map((r) => ({
    categoryId: 'methods',
    label: `${r.className}${r.isMeta ? ' class' : ''}>>${r.selector}`,
    description: r.category ? `${r.dictName} · ${r.category}` : r.dictName,
    score: 0,
    ranges: [],
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
  }));
}
