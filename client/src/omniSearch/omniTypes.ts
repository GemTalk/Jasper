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
      "Type a #symbol or 'string' to find its literal uses, e.g. #at:put: or 'no such element'",
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
}

/** Minimal cancellation signal so providers need not import `vscode.CancellationToken`. */
export interface OmniCancel {
  readonly isCancelled: boolean;
}

export const NEVER_CANCELLED: OmniCancel = { isCancelled: false };

export interface OmniProvider {
  category: OmniCategory;
  /** Optional one-time load when the picker opens (load-once providers cache their corpus here). */
  prime?(token: OmniCancel): Promise<void> | void;
  /** Ranked, already-limited results for `query` (the raw, trimmed search term). */
  search(query: string, cfg: OmniConfig, token: OmniCancel): Promise<OmniResult[]> | OmniResult[];
}
