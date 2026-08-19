/**
 * Class-categories provider: match the class-category names (Kernel-Objects, MyApp-Model, …) by
 * name. Building the corpus is a whole-image scan (`getAllClassCategories`), so unlike the classes
 * provider this loads LAZILY — on the first search, not in prime() — and its category is
 * `explicitOnly`, so that first load happens only when the user scopes to Categories, never on a
 * plain picker open. Activating a hit selects the category's home dictionary, then selects + reveals
 * the category node and filters the classes pane to it (via the revealCategory handler →
 * `gemstone.explorer.revealCategory`) — a precise category reveal, not just landing in the dictionary.
 *
 * Staleness: the category set is derived from classes, so a class compile can introduce a brand-new
 * category. Both `reprime` (session sync) and `applyChange` (a class compile) just drop the lazy
 * cache, so the next Categories search re-scans — cheap, since the scan only reruns when that scope
 * is actually used again.
 */
import { ClassCategoryNameEntry } from '../../queries/getAllClassCategories';
import {
  CATEGORY_BY_ID,
  OmniConfig,
  OmniCorpusChange,
  OmniProvider,
  OmniResult,
} from '../omniTypes';
import { rankAndLimit } from '../rank';

export function createCategoriesProvider(
  sessionId: number,
  loadEntries: () => ClassCategoryNameEntry[],
): OmniProvider {
  let entries: readonly ClassCategoryNameEntry[] | null = null;
  return {
    category: CATEGORY_BY_ID.categories,
    reprime() {
      entries = null; // drop the lazy cache; the next search re-scans the image
    },
    applyChange(change: OmniCorpusChange): boolean {
      // A new class can bring a new category; we can't know which cheaply, so just invalidate and let
      // the next Categories search reload. Return false: nothing visible changed *now* (the reload is
      // lazy), so the engine shouldn't redraw off this alone.
      if (change.kind === 'class') entries = null;
      return false;
    },
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
