/**
 * Globals provider: enumerate every non-class symbol-list entry once when the picker opens
 * (`getAllGlobalNames`), then match client-side on each keystroke — the variables/constants half of
 * "search any name," alongside classes and method selectors. Activating a global jumps to the class
 * of its VALUE (e.g. Transcript → its stream class), not its home dictionary — more useful than
 * landing in the whole dictionary. The reference (↗) button finds who uses it (globals are
 * referenceable by name).
 */
import { GlobalNameEntry } from '../../queries/getAllGlobalNames';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';
import { rankAndLimit } from '../rank';

export function createGlobalsProvider(
  sessionId: number,
  loadEntries: () => GlobalNameEntry[],
): OmniProvider {
  let entries: readonly GlobalNameEntry[] = [];
  return {
    category: CATEGORY_BY_ID.globals,
    prime() {
      entries = loadEntries();
    },
    search(query: string, cfg: OmniConfig): OmniResult[] {
      return rankAndLimit(
        query,
        entries,
        cfg,
        (e) => e.name,
        (e, m) => ({
          categoryId: 'globals',
          label: e.name,
          // Show the value's class so the row reads e.g. "Transcript — GsTerminalStream".
          description: `${e.dictName} · ${e.className}`,
          score: m.score,
          ranges: m.ranges,
          action: {
            kind: 'revealGlobal',
            sessionId,
            dictName: e.dictName,
            name: e.name,
            className: e.className,
          },
        }),
      );
    },
  };
}
