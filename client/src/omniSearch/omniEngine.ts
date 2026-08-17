/**
 * Transport-agnostic Omni Search engine for the Phase-2 webview Spotter (issue #378).
 *
 * The Phase-1 UI is a native `vscode.QuickPick` driven by `omniSearchController.ts`. Phase 2 replaces
 * that chrome with a webview panel (`omniSearchPanel.ts`), but the SEARCH behaviour is identical:
 * hold the active scope + case flag + result cap, fan out to the in-scope providers, rank/group the
 * results by category, and support the reference pivot. That behaviour lives here — a pure engine
 * with NO `vscode` dependency, so it unit-tests with plain fake providers and is reused by the panel.
 *
 * The engine deliberately does not import the controller (which pulls in `vscode`); the two tiny
 * pure helpers it shares with the controller (`providersInScope` / `gatherResults`) are re-stated
 * here so this module stays `vscode`-free and independently testable. Behaviour is kept in lockstep.
 *
 * Output is a plain `OmniViewData` (serialisable rows grouped by category, plus the footer meta) that
 * the panel forwards to the webview verbatim. Rows are addressed by a stable numeric `id` within a
 * run so the webview can ask the engine to activate/pivot/preview a row without shipping the whole
 * `OmniResult` (which carries the non-serialisable action) across the postMessage boundary.
 */
import {
  OMNI_CATEGORIES,
  OmniCancel,
  OmniCategoryId,
  OmniConfig,
  OmniProvider,
  OmniResult,
  OmniTruncation,
  OmniTruncationSink,
} from './omniTypes';
import { match, compareMatches } from './omniMatch';
import { referenceRequestFor } from './references';

/** A provider's truncation report plus the human scope name, so the webview can say WHICH scope was
 *  capped and at what number without carrying a category table of its own. */
export interface OmniViewTruncation extends OmniTruncation {
  /** e.g. "Methods" — the category's display label. */
  categoryLabel: string;
}

/** A single result row, flattened for the webview (no non-serialisable `action`). */
export interface OmniViewRow {
  /** Stable id within the current view; the webview echoes it back to act on the row. */
  id: number;
  label: string;
  description?: string;
  detail?: string;
  /** Which category produced this row — the webview shows it as a small per-row tag (the flat list
   *  drops category grouping, so this is how you still see what a row is). */
  categoryId: OmniCategoryId;
  /** Short human category label for the per-row tag (e.g. "Class", "Method"). */
  categoryLabel: string;
  /** VS Code codicon id (no `$(...)`) for the category. */
  icon: string;
  /** Matched `[start,end)` ranges in `label`, for the webview's own (case-correct) highlighting. */
  ranges: Array<[number, number]>;
  /** True when this row can pivot to its references/senders (a class or method). */
  referenceable: boolean;
  /** Adaptive breadcrumb the reference pivot would show, e.g. "Senders of foo". */
  referenceTitle?: string;
}

/**
 * The whole view the panel forwards to the webview.
 *
 * `rows` is a SINGLE flat list ranked globally by match quality (best first), NOT grouped by
 * category — when you type "foo" you want the closest "foo" at the top regardless of whether it's a
 * class or a global. Each row keeps its `categoryId`/`categoryLabel` so a per-row tag still shows
 * what it is. (Category grouping was tried and dropped per Eric; re-grouping later is a view concern.)
 */
export interface OmniViewData {
  rows: OmniViewRow[];
  /** Total rows currently shown. */
  shownCount: number;
  /** True when at least one category filled its cap — more results are available. */
  hasMore: boolean;
  /** True when `shownCount` IS the total for this term — nothing was left unfetched. Requires both
   *  that the cap was jumped to "load all" and that no provider hit its own fetch ceiling; see
   *  `truncations` (triage #14 — this used to be derived from the cap alone, which let the footer
   *  report a ceiling-truncated slice as an exact count). */
  exact: boolean;
  /** One entry per in-scope provider whose own server fetch ceiling bounded its results, so
   *  `shownCount` is a floor and raising the display cap cannot reveal the rest. Empty = nothing was
   *  cut off. Non-empty is never `exact`, and the view surfaces it as a visible notice naming the
   *  scope and the number it stopped at. */
  truncations: OmniViewTruncation[];
  /** True while showing a reference pivot (typing then filters these rows client-side). */
  pivot: boolean;
  /** Breadcrumb title while pivoted (e.g. "Senders of printString"). */
  pivotTitle?: string;
}

/** Short, singular per-row category tag (the flat list has no group header to carry the name). */
const CATEGORY_TAG: Record<OmniCategoryId, string> = {
  classes: 'Class',
  methods: 'Method',
  dictionaries: 'Dictionary',
  globals: 'Global',
  source: 'Source',
  literals: 'Literal',
  categories: 'Category',
};

/** A result the reference pivot loaded: its breadcrumb title + the reference rows. */
export interface ReferenceView {
  title: string;
  /** The symbol these are references/senders OF (selector or class/global name) — highlighted when a
   *  sender's source is expanded inline. */
  target?: string;
  results: OmniResult[];
}

/** The senders/references of a row, shaped for the sticky preview-pane list (the non-pivot path).
 *  `rows` carry ids that index the engine's stored reference rows, resolved by `referenceResultFor`
 *  when one is opened. Unlike the pivot this leaves the search list (and all search state) untouched. */
export interface ReferencePreview {
  title: string;
  /** The symbol to highlight in an expanded sender's source (the selector / class name searched). */
  highlightTerm?: string;
  rows: OmniViewRow[];
}

export interface OmniEngineDeps {
  providers: readonly OmniProvider[];
  config: OmniConfig;
  /** Load the references/senders of a result. Omit to disable the pivot. Null = not referenceable. */
  resolveReferences?: (result: OmniResult) => Promise<ReferenceView | null> | ReferenceView | null;
}

// "Load all" jumps the display cap here — big enough to mean "everything" in practice; the true
// ceiling is each provider's own server fetch cap (a few hundred), so this never runs away. Because
// that ceiling can bind BEFORE this cap does, reaching this value does not by itself mean the results
// are complete — see `truncated` (triage #14). Matches the QuickPick controller's constant so the two
// UIs behave identically.
export const LOAD_ALL_LIMIT = 100_000;

/** The enabled providers in scope. Under the all-scope (`null`), explicit-only categories are
 *  excluded so heavyweight searches never fire on a plain keystroke. (Mirror of the controller.) */
export function providersInScope(
  providers: readonly OmniProvider[],
  scopeId: OmniCategoryId | null,
): OmniProvider[] {
  if (scopeId === null) return providers.filter((p) => !p.category.explicitOnly);
  return providers.filter((p) => p.category.id === scopeId);
}

/** Run each in-scope provider and collect its results (each already ranked + capped). Providers with
 *  a server fetch ceiling of their own report through `reportTruncated` when that ceiling cut them
 *  off, so the caller can tell a complete result set from a bounded slice (triage #14). */
export async function gatherResults(
  term: string,
  providers: readonly OmniProvider[],
  cfg: OmniConfig,
  token: OmniCancel,
  reportTruncated?: OmniTruncationSink,
): Promise<OmniResult[]> {
  const all: OmniResult[] = [];
  for (const p of providers) {
    if (token.isCancelled) break;
    const part = await p.search(term, cfg, token, reportTruncated);
    all.push(...part);
  }
  return all;
}

/** The name a result is "really" about, for prefix ranking: a method/source/literal hit is about
 *  its selector; everything else is about its label (the class / global / dictionary / category). */
function primaryName(r: OmniResult): string {
  return r.action.kind === 'openMethod' ? r.action.selector : r.label;
}

/** Name-like categories (classes, globals, dictionaries, class-categories) vs. the method-like ones
 *  (methods, source, literals). Drives the case-of-first-letter preference (E). */
function isNameLike(categoryId: OmniCategoryId): boolean {
  return (
    categoryId === 'classes' ||
    categoryId === 'globals' ||
    categoryId === 'dictionaries' ||
    categoryId === 'categories'
  );
}

/**
 * Global cross-category ranking for the flat list, layering two of Eric's rules on top of the
 * matcher score:
 *
 *  - **F (prefix leads):** a result whose primary name STARTS WITH the query outranks one that only
 *    contains it, in every case — "si" surfaces "size"/"Signal" before "Repository".
 *  - **E (first-letter case picks the kind):** a capitalised first letter means the user wants a
 *    NAME (class/global), a lowercase one means a METHOD — so that kind wins ties. With lowercase
 *    "si", method prefixes lead; with "Si", class/global prefixes lead.
 *
 * Prefix (F) dominates the kind preference (E), which dominates the matcher score, which falls back
 * to the shorter-then-alphabetical order. `q` is the trimmed, lower-cased query.
 */
function omniRank(a: OmniResult, b: OmniResult, q: string, upperFirst: boolean): number {
  const aPrefix = primaryName(a).toLowerCase().startsWith(q) ? 0 : 1;
  const bPrefix = primaryName(b).toLowerCase().startsWith(q) ? 0 : 1;
  if (aPrefix !== bPrefix) return aPrefix - bPrefix;

  // Preferred kind for this query's leading case: names when capitalised, methods when lowercase.
  const aKind = isNameLike(a.categoryId) === upperFirst ? 0 : 1;
  const bKind = isNameLike(b.categoryId) === upperFirst ? 0 : 1;
  if (aKind !== bKind) return aKind - bKind;

  // Two implementors of the SAME selector (e.g. every `withAll:`) sort alphabetically by class name,
  // not by the label-length tiebreak compareMatches would otherwise apply (which buries a long class
  // name below a short one). Keeps a wall of same-selector hits in a predictable A→Z order.
  if (
    a.action.kind === 'openMethod' &&
    b.action.kind === 'openMethod' &&
    a.action.selector === b.action.selector
  ) {
    const byClass = a.action.className.localeCompare(b.action.className);
    if (byClass !== 0) return byClass;
  }

  return compareMatches({ score: a.score, label: a.label }, { score: b.score, label: b.label });
}

/**
 * Build the flat view from a result list. Rows are ranked GLOBALLY (best first) across every
 * category — not grouped — so the closest match to what you typed sits at the top regardless of its
 * kind. When `rankTerm` is given (a live search) the ranking applies Eric's prefix + first-letter-
 * case rules; otherwise (a reference pivot, already ordered by its own filter) the incoming order is
 * kept. Each row keeps its `id` = its index in the ORIGINAL `results` array, so the engine resolves
 * it back to its `OmniResult` for activation even though the display order differs.
 */
function buildView(
  results: readonly OmniResult[],
  meta: Omit<OmniViewData, 'rows' | 'shownCount'>,
  referenceInfo: (r: OmniResult) => { referenceable: boolean; title?: string },
  rankTerm?: string,
): OmniViewData {
  const order = results.map((_, i) => i);
  if (rankTerm) {
    const q = rankTerm.toLowerCase();
    const upperFirst = /^[A-Z]/.test(rankTerm);
    order.sort((i, j) => omniRank(results[i], results[j], q, upperFirst));
  }
  const rows: OmniViewRow[] = order.map((i) => {
    const r = results[i];
    const ref = referenceInfo(r);
    const cat = OMNI_CATEGORIES.find((c) => c.id === r.categoryId);
    return {
      id: i,
      label: r.label,
      description: r.description,
      detail: r.detail,
      categoryId: r.categoryId,
      categoryLabel: CATEGORY_TAG[r.categoryId],
      icon: cat ? cat.icon : 'symbol-misc',
      ranges: r.ranges,
      referenceable: ref.referenceable,
      referenceTitle: ref.title,
    };
  });
  return { ...meta, rows, shownCount: results.length };
}

export interface OmniEngine {
  /** Prime load-once providers (concurrently; a failing prime just yields no results). */
  prime(onError?: (message: string) => void): Promise<void>;
  /** Run the search for a raw field value and return the view (or null if superseded by a newer
   *  call). In the pivot, this filters the loaded reference rows client-side instead. */
  search(rawValue: string): Promise<OmniViewData | null>;
  /** Narrow (or, with null, widen back to all) the active scope; re-runs the current term. */
  setScope(scopeId: OmniCategoryId | null): Promise<OmniViewData | null>;
  /** Toggle case-sensitive matching; re-runs the current term. */
  toggleCase(): Promise<OmniViewData | null>;
  /** Grow the result cap by one page; re-runs the current term. */
  loadMore(): Promise<OmniViewData | null>;
  /** Jump the cap to everything (bounded by the server fetch caps); re-runs the current term. */
  loadAll(): Promise<OmniViewData | null>;
  /** Pivot the list to a row's references/senders. Returns null if not referenceable / no resolver. */
  pivot(rowId: number): Promise<OmniViewData | null>;
  /** Leave the reference view and restore the prior search. */
  exitPivot(): Promise<OmniViewData | null>;
  /** Load a row's references/senders for the sticky preview-pane list WITHOUT pivoting — the search
   *  list and all search state are left intact. Returns null if not referenceable / no resolver. */
  referencesFor(rowId: number): Promise<ReferencePreview | null>;
  /** The `OmniResult` for a reference row id from the last `referencesFor` (for opening its source). */
  referenceResultFor(refId: number): OmniResult | undefined;
  /** The `OmniResult` for a row id in the CURRENT view (for activation), or undefined. */
  resultFor(rowId: number): OmniResult | undefined;
  /** Current UI state the panel needs to render chrome (scope, case, pivot). */
  state(): { scopeId: OmniCategoryId | null; caseSensitive: boolean; pivot: boolean };
}

export function createOmniEngine(deps: OmniEngineDeps): OmniEngine {
  const { providers, config } = deps;
  let generation = 0;
  let scopeId: OmniCategoryId | null = null;
  let lastRawValue = '';
  let caseSensitive = config.caseSensitive;
  let scopeLimit = config.maxResultsPerCategory;
  // When non-null, the list shows the references/senders of a result (a "pivot"), not a live search.
  let pivot: ReferenceView | null = null;
  // The results backing the CURRENT view, indexed by row id.
  let current: OmniResult[] = [];
  // The reference rows from the last `referencesFor`, indexed by the preview list's row id. Kept
  // separate from `current` so loading references never disturbs the search list or its ids.
  let referenceRows: OmniResult[] = [];

  const effectiveConfig = (): OmniConfig => ({
    ...config,
    caseSensitive,
    maxResultsPerCategory: scopeLimit,
  });

  const referenceInfo = (r: OmniResult): { referenceable: boolean; title?: string } => {
    const req = deps.resolveReferences ? referenceRequestFor(r) : null;
    return req ? { referenceable: true, title: req.title } : { referenceable: false };
  };

  /** Client-side filter of the pivot rows by the typed term (empty term = show them all). */
  function filterPivot(rows: readonly OmniResult[], term: string): OmniResult[] {
    if (term.length === 0) return [...rows];
    const scored: OmniResult[] = [];
    for (const r of rows) {
      const m = match(term, r.label, { mode: config.matchMode, caseSensitive });
      if (m) scored.push({ ...r, score: m.score, ranges: m.ranges });
    }
    scored.sort((a, b) =>
      compareMatches({ score: a.score, label: a.label }, { score: b.score, label: b.label }),
    );
    return scored;
  }

  function pivotView(): OmniViewData {
    return buildView(
      current,
      {
        hasMore: false,
        exact: true,
        // The pivot shows a fully-loaded reference list, not a bounded provider fan-out.
        truncations: [],
        pivot: true,
        pivotTitle: pivot?.title,
      },
      // Reference rows are already the senders/references; don't offer a further pivot on them.
      () => ({ referenceable: false }),
    );
  }

  async function runSearch(rawValue: string): Promise<OmniViewData | null> {
    // In the reference view, typing filters the loaded rows client-side (no provider fan-out); don't
    // touch `lastRawValue` (it holds the search to restore when the pivot is dismissed).
    if (pivot) {
      current = filterPivot(pivot.results, rawValue.trim());
      return pivotView();
    }
    const term = rawValue.trim();
    // A genuinely new term restarts at the base cap: load-more/load-all raise `scopeLimit` for the
    // term in the box, but that must not leak into the next search (else every keystroke fans out at
    // LOAD_ALL_LIMIT and the footer falsely reads "exact"). The re-run paths (loadMore/loadAll/
    // setScope/toggleCase/exitPivot) pass the unchanged `lastRawValue`, so they keep their cap.
    if (term !== lastRawValue.trim()) scopeLimit = config.maxResultsPerCategory;
    lastRawValue = rawValue;
    // Empty term shows nothing rather than dumping the whole image (recents is a follow-up). Bump the
    // generation so a slow in-flight query dispatched just before the clear can't repopulate.
    if (term.length === 0) {
      ++generation;
      current = [];
      return buildView([], { hasMore: false, exact: false, truncations: [], pivot: false }, () => ({
        referenceable: false,
      }));
    }
    const gen = ++generation;
    const token: OmniCancel = {
      get isCancelled() {
        return gen !== generation;
      },
    };
    const inScope = providersInScope(providers, scopeId);
    // Collected from any provider whose own server fetch ceiling bounded its results (today: methods).
    // A non-empty list means the run can never be an exact total, however high the display cap goes.
    const truncations: OmniViewTruncation[] = [];
    const results = await gatherResults(term, inScope, effectiveConfig(), token, (t) => {
      const label = OMNI_CATEGORIES.find((c) => c.id === t.categoryId)?.label ?? t.categoryId;
      truncations.push({ ...t, categoryLabel: label });
    });
    if (token.isCancelled) return null; // a newer call superseded this run

    // Offer "load more" whenever ANY category filled its cap (so it works in the all-scope too).
    const perCategory = new Map<string, number>();
    for (const r of results)
      perCategory.set(r.categoryId, (perCategory.get(r.categoryId) ?? 0) + 1);
    const hasMore = [...perCategory.values()].some((n) => n >= scopeLimit);
    current = results;
    return buildView(
      results,
      // "Load all" alone does NOT make the count exact: a ceiling-truncated provider leaves rows
      // unfetched that no cap can reach, so claim exactness only when nothing was cut off (#14).
      {
        hasMore,
        exact: scopeLimit >= LOAD_ALL_LIMIT && truncations.length === 0,
        truncations,
        pivot: false,
      },
      referenceInfo,
      term,
    );
  }

  return {
    async prime(onError) {
      await Promise.all(
        providers.map(async (p) => {
          try {
            await p.prime?.({ isCancelled: false });
          } catch (e: unknown) {
            onError?.(e instanceof Error ? e.message : String(e));
          }
        }),
      );
    },
    search: (rawValue) => runSearch(rawValue),
    async setScope(newScope) {
      scopeId = newScope;
      scopeLimit = config.maxResultsPerCategory; // a fresh scope starts at the base cap
      return runSearch(lastRawValue);
    },
    async toggleCase() {
      caseSensitive = !caseSensitive;
      return runSearch(lastRawValue);
    },
    async loadMore() {
      scopeLimit += config.maxResultsPerCategory;
      return runSearch(lastRawValue);
    },
    async loadAll() {
      scopeLimit = LOAD_ALL_LIMIT;
      return runSearch(lastRawValue);
    },
    async pivot(rowId) {
      if (!deps.resolveReferences) return null;
      const result = current[rowId];
      if (!result) return null;
      ++generation; // supersede any in-flight search so its late result can't land over the pivot
      const view = await deps.resolveReferences(result);
      if (!view) return null; // not referenceable — leave the current list as-is
      pivot = view;
      current = view.results;
      return pivotView();
    },
    async exitPivot() {
      if (!pivot) return null;
      pivot = null;
      return runSearch(lastRawValue);
    },
    async referencesFor(rowId) {
      if (!deps.resolveReferences) return null;
      const result = current[rowId];
      if (!result) return null;
      const view = await deps.resolveReferences(result);
      if (!view) return null; // not referenceable
      referenceRows = view.results;
      const built = buildView(
        referenceRows,
        { hasMore: false, exact: true, truncations: [], pivot: false },
        () => ({ referenceable: false }),
      );
      return { title: view.title, highlightTerm: view.target, rows: built.rows };
    },
    referenceResultFor: (refId) => referenceRows[refId],
    resultFor: (rowId) => current[rowId],
    state: () => ({ scopeId, caseSensitive, pivot: pivot !== null }),
  };
}
