/**
 * Classes provider: enumerate every class once when the picker opens (reusing the same
 * `getAllClassNames` corpus `Find Class` uses), then match client-side on each keystroke.
 */
import { ClassNameEntry } from '../../queries/getAllClassNames';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { rankAndLimit } from '../rank';

export function createClassesProvider(
  sessionId: number,
  loadEntries: () => ClassNameEntry[],
): OmniProvider {
  let entries: readonly ClassNameEntry[] = [];
  return {
    category: CATEGORY_BY_ID.classes,
    prime() {
      entries = loadEntries();
    },
    search(query: string, cfg: OmniConfig): OmniResult[] {
      return rankAndLimit(
        query,
        entries,
        cfg,
        (e) => e.className,
        (e, m) => ({
          categoryId: 'classes',
          label: e.className,
          description: e.dictName,
          score: m.score,
          ranges: m.ranges,
          action: {
            kind: 'openClass',
            sessionId,
            dictName: e.dictName,
            className: e.className,
            dictIndex: e.dictIndex,
          },
        }),
      );
    },
  };
}
