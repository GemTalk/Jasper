/**
 * Dictionaries provider: load the symbol-list dictionary names once, match client-side.
 * Activating a result reveals the Dictionaries pane of the GemStone Explorer (there is no
 * `gemstone:` document for a dictionary; a richer reveal is a follow-up).
 */
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { rankAndLimit } from '../rank';

export function createDictionariesProvider(
  sessionId: number,
  loadNames: () => string[],
): OmniProvider {
  let names: readonly string[] = [];
  return {
    category: CATEGORY_BY_ID.dictionaries,
    prime() {
      names = loadNames();
    },
    search(query: string, cfg: OmniConfig): OmniResult[] {
      return rankAndLimit(
        query,
        names,
        cfg,
        (n) => n,
        (n, m) => ({
          categoryId: 'dictionaries',
          label: n,
          score: m.score,
          ranges: m.ranges,
          action: { kind: 'revealDictionary', sessionId, dictName: n },
        }),
      );
    },
  };
}
