/**
 * Shared types for Omni Search (issue #378).
 *
 * Providers are written against these types and are injected with their data sources (a class-name
 * loader, a selector-search runner, a tab lister, …) rather than reaching for `vscode` or a stone
 * session directly — so every provider is unit-testable with plain fakes and no stone. The command
 * layer (`omniSearchCommand.ts`) wires the real, session-bound dependencies.
 */

import { MatchMode } from './omniMatch';

export type OmniCategoryId = 'classes' | 'methods' | 'dictionaries' | 'openEditors';

export interface OmniCategory {
  id: OmniCategoryId;
  /** Human label shown as the group separator, e.g. "Classes". */
  label: string;
  /** VS Code codicon id (no `$(...)`), e.g. "symbol-class". */
  icon: string;
  /** Single-char prefix sigil that scopes the field to this category, e.g. "c". */
  sigil: string;
}

/** Categories in display order. The order also drives the grouped result layout. */
export const OMNI_CATEGORIES: readonly OmniCategory[] = [
  { id: 'classes', label: 'Classes', icon: 'symbol-class', sigil: 'c' },
  { id: 'methods', label: 'Methods', icon: 'symbol-method', sigil: 'm' },
  { id: 'dictionaries', label: 'Dictionaries', icon: 'symbol-namespace', sigil: 'd' },
  { id: 'openEditors', label: 'Open Editors', icon: 'go-to-file', sigil: 'e' },
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
  | { kind: 'focusEditor'; uri: string };

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
  /** Ranked, already-limited results for `query` (the sigil prefix, if any, is already stripped). */
  search(query: string, cfg: OmniConfig, token: OmniCancel): Promise<OmniResult[]> | OmniResult[];
}
