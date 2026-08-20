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
import { OmniCategoryId, OmniResult } from './omniTypes';

export type ReferenceRequest =
  | { title: string; kind: 'senders'; selector: string }
  | { title: string; kind: 'references'; className: string };

/** What (if anything) the reference button on a result should fetch, plus its breadcrumb title.
 *  No environment is carried: senders/references can live in ANY method environment, so the command
 *  layer sweeps every environment (0..maxEnvironment) rather than the source row's own — see
 *  `resolveReferencesUsing`. */
export function referenceRequestFor(result: OmniResult): ReferenceRequest | null {
  const a = result.action;
  if (a.kind === 'openMethod') {
    return { title: `Senders of ${a.selector}`, kind: 'senders', selector: a.selector };
  }
  if (a.kind === 'openClass') {
    return { title: `References to ${a.className}`, kind: 'references', className: a.className };
  }
  if (a.kind === 'revealGlobal') {
    // A global is referenceable by its name, exactly like a class (referencesToObject takes any
    // symbol-list name), so "who uses this variable?" works from a global hit too.
    return { title: `References to ${a.name}`, kind: 'references', className: a.name };
  }
  return null;
}

/** Shape method-search rows into method OmniResults (label `Class>>selector`, opens the method).
 *  `categoryId` lets non-method sources (e.g. the Source scope) group their method hits under their
 *  own separator while still opening the method. `environmentId` is the method environment the rows
 *  were found in — it must ride through to the open action so a hit in a non-zero environment opens
 *  there; it defaults to 0 for the env-0 sources (Source/Literals). */
export function methodRowsToResults(
  rows: readonly MethodSearchResult[],
  sessionId: number,
  categoryId: OmniCategoryId = 'methods',
  environmentId = 0,
): OmniResult[] {
  return rows.map((r) => ({
    categoryId,
    label: `${r.className}${r.isMeta ? ' class' : ''}>>${r.selector}`,
    // Home dictionary only — the method protocol/category is omitted to keep long Class>>selector
    // rows from truncating (Eric's ask M); it added width for little value.
    description: r.dictName,
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
      environmentId,
      dictIndex: 0,
    },
  }));
}
