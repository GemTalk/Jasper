/**
 * Read + normalize the `gemstone.omniSearch.*` settings into a typed OmniConfig.
 *
 * Kept free of a direct `vscode` import: it takes a minimal `ConfigLike` (what
 * `vscode.workspace.getConfiguration('gemstone.omniSearch')` provides) so it unit-tests with a
 * plain fake. Every value is validated + clamped so a hand-edited settings.json can't break search.
 */

import { MatchMode } from './omniMatch';
import { OmniCategoryId, OmniConfig, OMNI_CATEGORIES } from './omniTypes';

export interface ConfigLike {
  get<T>(section: string, defaultValue: T): T;
}

const MATCH_MODES: readonly MatchMode[] = ['fuzzy', 'substring', 'prefix'];
const ALL_CATEGORY_IDS: readonly OmniCategoryId[] = OMNI_CATEGORIES.map((c) => c.id);

export const OMNI_DEFAULTS: OmniConfig = {
  matchMode: 'fuzzy',
  caseSensitive: false,
  enabledCategories: [...ALL_CATEGORY_IDS],
  maxResultsPerCategory: 20,
  debounceMs: 120,
  // Methods hit the stone per keystroke, so we don't search selectors until the term is at least
  // this long. 2 lets a short lead like "si" surface methods (so the lowercase-first ranking has
  // methods to promote); 1-char selector scans across the whole image are too heavy, so they stay
  // off. Raise this via settings if per-keystroke method search feels slow on a large stone.
  methodMinQueryLength: 2,
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function readOmniConfig(cfg: ConfigLike): OmniConfig {
  const rawMode = cfg.get<string>('matchMode', OMNI_DEFAULTS.matchMode);
  const matchMode = (MATCH_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as MatchMode)
    : OMNI_DEFAULTS.matchMode;

  const rawCats = cfg.get<string[]>('categories', [...ALL_CATEGORY_IDS]);
  // Keep only known ids, preserve the canonical display order, and never end up empty.
  const enabledCategories = ALL_CATEGORY_IDS.filter(
    (id) => Array.isArray(rawCats) && rawCats.includes(id),
  );

  return {
    matchMode,
    caseSensitive: cfg.get<boolean>('caseSensitive', OMNI_DEFAULTS.caseSensitive) === true,
    enabledCategories:
      enabledCategories.length > 0 ? enabledCategories : [...OMNI_DEFAULTS.enabledCategories],
    maxResultsPerCategory: clampInt(
      cfg.get<number>('maxResultsPerCategory', OMNI_DEFAULTS.maxResultsPerCategory),
      1,
      200,
      OMNI_DEFAULTS.maxResultsPerCategory,
    ),
    debounceMs: clampInt(
      cfg.get<number>('debounceMs', OMNI_DEFAULTS.debounceMs),
      0,
      2000,
      OMNI_DEFAULTS.debounceMs,
    ),
    methodMinQueryLength: clampInt(
      cfg.get<number>('methodMinQueryLength', OMNI_DEFAULTS.methodMinQueryLength),
      1,
      10,
      OMNI_DEFAULTS.methodMinQueryLength,
    ),
  };
}
