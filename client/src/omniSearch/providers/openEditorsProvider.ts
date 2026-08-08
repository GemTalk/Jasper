/**
 * Open Editors provider: the currently open GemStone tabs (classes/methods the user already has
 * open). Purely local — no stone — so it is instant and available even before the class corpus
 * finishes loading. Activating a result focuses that editor.
 */
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { rankAndLimit } from '../rank';

export interface OpenTab {
  /** Display label (VS Code's tab label, e.g. `OrderedCollection` or `at:put:`). */
  label: string;
  /** The tab's document uri, as a string (a `gemstone:` uri). */
  uri: string;
  /** Optional secondary text (e.g. the class for a method tab). */
  description?: string;
}

export function createOpenEditorsProvider(listTabs: () => OpenTab[]): OmniProvider {
  return {
    category: CATEGORY_BY_ID.openEditors,
    search(query: string, cfg: OmniConfig): OmniResult[] {
      return rankAndLimit(
        query,
        listTabs(),
        cfg,
        (t) => t.label,
        (t, m) => ({
          categoryId: 'openEditors',
          label: t.label,
          description: t.description,
          score: m.score,
          ranges: m.ranges,
          action: { kind: 'focusEditor', uri: t.uri },
        }),
      );
    },
  };
}
