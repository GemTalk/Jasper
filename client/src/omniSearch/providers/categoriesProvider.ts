/**
 * Class-categories provider: match the class-category names (Kernel-Objects, MyApp-Model, …) by
 * name. Building the corpus is a whole-image scan (`getAllClassCategories`), so unlike the classes
 * provider this loads LAZILY — on the first search, not in prime() — and its category is
 * `explicitOnly`, so that first load happens only when the user scopes to Categories, never on a
 * plain picker open. Activating a hit reveals its home dictionary (a precise category reveal is a
 * follow-up — see the revealCategory handler).
 */
import { ClassCategoryNameEntry } from '../../queries/getAllClassCategories';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { rankAndLimit } from '../rank';

export function createCategoriesProvider(
  sessionId: number,
  loadEntries: () => ClassCategoryNameEntry[],
): OmniProvider {
  let entries: readonly ClassCategoryNameEntry[] | null = null;
  return {
    category: CATEGORY_BY_ID.categories,
    search(query: string, cfg: OmniConfig): OmniResult[] {
      if (entries === null) entries = loadEntries(); // lazy: pay the scan only when first used
      return rankAndLimit(
        query,
        entries,
        cfg,
        (e) => e.category,
        (e, m) => ({
          categoryId: 'categories',
          label: e.category,
          description: e.dictName,
          score: m.score,
          ranges: m.ranges,
          action: {
            kind: 'revealCategory',
            sessionId,
            dictName: e.dictName,
            dictIndex: e.dictIndex,
            category: e.category,
          },
        }),
      );
    },
  };
}
