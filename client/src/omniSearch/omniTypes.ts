/**
 * Shared types for Omni Search (issue #378).
 *
 * Providers are written against these types and are injected with their data sources (a class-name
 * loader, a selector-search runner, a tab lister, …) rather than reaching for `vscode` or a stone
 * session directly — so every provider is unit-testable with plain fakes and no stone. The command
 * layer (`omniSearchCommand.ts`) wires the real, session-bound dependencies.
 */

import { MatchMode } from './omniMatch';

export type OmniCategoryId =
  'classes' | 'methods' | 'dictionaries' | 'globals' | 'source' | 'literals' | 'categories';

export interface OmniCategory {
  id: OmniCategoryId;
  /** Human label shown as the group separator, e.g. "Classes". */
  label: string;
  /** VS Code codicon id (no `$(...)`), e.g. "symbol-class". Also the scope button's icon. */
  icon: string;
  /** When true, this category is NOT part of the default "all" fan-out — it only runs when the user
   *  explicitly scopes to it. For heavyweight searches (full method-source scan) that shouldn't fire
   *  on every keystroke of a plain search. */
  explicitOnly?: boolean;
  /** Placeholder instruction shown while scoped here — teaches what to type (with an example) for
   *  the explicit-only searches, which start a search rather than filter existing results. */
  searchHint?: string;
}

/** Categories in display order. The order also drives the grouped result layout. */
export const OMNI_CATEGORIES: readonly OmniCategory[] = [
  { id: 'classes', label: 'Classes', icon: 'symbol-class' },
  { id: 'methods', label: 'Methods', icon: 'symbol-method' },
  { id: 'dictionaries', label: 'Dictionaries', icon: 'symbol-namespace' },
  { id: 'globals', label: 'Globals', icon: 'symbol-variable' },
  {
    id: 'source',
    label: 'Source',
    icon: 'file-code',
    explicitOnly: true,
    searchHint: 'Type text to find inside method source',
  },
  {
    id: 'literals',
    label: 'Literals',
    icon: 'symbol-constant',
    explicitOnly: true,
    // Finds LITERAL uses only (not senders / not source text): a #symbol used as data, or a 'string'
    // literal. e.g. #at:put: as a literal, or the string 'no such element'.
    searchHint:
      "Type a symbol literal (#at:put:) or a string literal ('no such element') to find its literal uses",
  },
  // Class categories are a whole-image scan to build; explicitOnly + lazy load keeps picker-open fast.
  {
    id: 'categories',
    label: 'Categories',
    icon: 'symbol-folder',
    explicitOnly: true,
    searchHint: 'Type a class-category name, e.g. Kernel-Objects',
  },
];

/** Category lookup by id (all ids are known at compile time, so this is total). */
export const CATEGORY_BY_ID: Record<OmniCategoryId, OmniCategory> = Object.fromEntries(
  OMNI_CATEGORIES.map((c) => [c.id, c]),
) as Record<OmniCategoryId, OmniCategory>;

/** What activating a result does. Kept as a serializable descriptor so `runOmniAction` (the one
 *  place that touches `vscode`) is small and tested, and providers stay pure. */
export type OmniAction =
  | { kind: 'openClass'; sessionId: number; dictName: string; className: string; dictIndex: number }
  | {
      kind: 'openMethod';
      sessionId: number;
      dictName: string;
      className: string;
      isMeta: boolean;
      category: string;
      selector: string;
      environmentId: number;
      dictIndex: number;
    }
  | { kind: 'revealDictionary'; sessionId: number; dictName: string }
  | { kind: 'revealGlobal'; sessionId: number; dictName: string; name: string; className: string }
  | {
      kind: 'revealCategory';
      sessionId: number;
      dictName: string;
      dictIndex: number;
      category: string;
    };

export interface OmniResult {
  categoryId: OmniCategoryId;
  /** Primary text, matched + shown as the row label (e.g. class name, `Class>>selector`). */
  label: string;
  /** Secondary text (e.g. dictionary name, category). */
  description?: string;
  /** Tertiary detail line. */
  detail?: string;
  /** Ranking score from the matcher (higher = better). */
  score: number;
  /** Matched ranges in `label` (for future highlighting). */
  ranges: Array<[number, number]>;
  action: OmniAction;
}

export interface OmniConfig {
  matchMode: MatchMode;
  caseSensitive: boolean;
  enabledCategories: OmniCategoryId[];
  maxResultsPerCategory: number;
  debounceMs: number;
  /** Methods hit the stone per keystroke, so don't search until the term is at least this long. */
  methodMinQueryLength: number;
  /** How many matches a scope's server-side scan collects before stopping. Bounds the results, not
   *  just the cost: no display cap can reach past it, so the UI reports when a scan stops here. */
  maxServerScan: number;
  /** When true, the references/senders gesture shows the results in the right-hand preview pane (a
   *  sticky list you open source from) instead of pivoting the whole left list. Off = the classic
   *  list pivot. */
  referencesInPreview: boolean;
}

/** Minimal cancellation signal so providers need not import `vscode.CancellationToken`. */
export interface OmniCancel {
  readonly isCancelled: boolean;
}

export const NEVER_CANCELLED: OmniCancel = { isCancelled: false };

/**
 * A provider's report that its OWN fetch ceiling — not the display cap — bounded the results, so the
 * row count is a floor rather than a total.
 *
 * Only providers with a server-side scan bound have one (today: methods, whose scan short-circuits at
 * `maxServerScan`); the rest scan exhaustively and cap client-side, so they never report. The
 * engine cannot infer this: the display cap is its own number, and a count below the ceiling proves
 * nothing once the client-side re-filter has dropped rows. Without the report the footer claims an
 * exact total at the very moment the results were cut off, and the UI says nothing about the wall the
 * user just hit (triage #14).
 *
 * It carries the scope and the number so the UI can name both ("Methods stopped after 200") rather
 * than show an anonymous warning — and so any provider that gains a ceiling later is covered without
 * touching the view.
 */
export interface OmniTruncation {
  /** The category whose own fetch ceiling bound the results. */
  categoryId: OmniCategoryId;
  /** How many matches this run's scan actually collected before stopping. */
  scanned: number;
  /** The CONFIGURED ceiling (`maxServerScan`) — the number to show the user, because it is the one
   *  they set. `scanned` can be lower when the over-fetch was the tighter bound, and it changes as
   *  the display cap grows, so showing it made the message read as a limit nobody configured. */
  ceiling: number;
  /**
   * True when the configured ceiling is what bound the scan, so **Load-more cannot fetch any more** —
   * the only wall worth warning about.
   *
   * False when the smaller over-fetch (`maxResultsPerCategory × SERVER_OVERFETCH`) bound it: results
   * are still incomplete, so the count keeps its `+`, but Load-more genuinely widens the scan and is
   * the honest next step rather than a dead end.
   */
  atCeiling: boolean;
}

/** Called ONCE per truncated provider in a run; never called by a provider that returned everything,
 *  so "no calls" unambiguously means "nothing was cut off". */
export type OmniTruncationSink = (info: OmniTruncation) => void;

/** A single known local structural change to fold into a cached provider's corpus without a full
 *  reload. Today only a class definition produces one (the only granular local signal we have);
 *  other corpora refresh via `reprime` on a session sync instead. */
export interface OmniCorpusChange {
  kind: 'class';
  /** The class that was created or redefined. */
  className: string;
  dictName?: string;
}

/** The category a change belongs to (for deciding whether it can affect the current scope). */
export function changeCategoryId(change: OmniCorpusChange): OmniCategoryId {
  switch (change.kind) {
    case 'class':
      return 'classes';
  }
}

export interface OmniProvider {
  category: OmniCategory;
  /** Optional one-time load when the picker opens (load-once providers cache their corpus here). */
  prime?(token: OmniCancel): Promise<void> | void;
  /** Rebuild a cached corpus from scratch (drop + reload). No-op for per-query providers; used on a
   *  session sync (commit/abort) when changes from outside this UI — including other sessions — may
   *  have landed. Defaults to `prime` when a provider doesn't override it. */
  reprime?(token: OmniCancel): Promise<void> | void;
  /** Fold a single known local change into the cached corpus without a full reload. Returns true if
   *  the corpus actually changed (a new or removed name), so the caller can decide whether to
   *  re-render. Only providers with a granular local signal (classes) implement it. */
  applyChange?(change: OmniCorpusChange, token: OmniCancel): Promise<boolean> | boolean;
  /** Ranked, already-limited results for `query` (the raw, trimmed search term). A provider whose
   *  server fetch is bounded calls `reportTruncated` to say whether that bound cut the results off. */
  search(
    query: string,
    cfg: OmniConfig,
    token: OmniCancel,
    reportTruncated?: OmniTruncationSink,
  ): Promise<OmniResult[]> | OmniResult[];
}
