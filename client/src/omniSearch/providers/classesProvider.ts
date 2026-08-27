/**
 * Classes provider: enumerate every class once when the picker opens (reusing the same
 * `getAllClassNames` corpus `Find Class` uses), then match client-side on each keystroke.
 *
 * The cached corpus is kept fresh two ways: a full `reprime` (drop + reload) on a session sync or an
 * explicit user refresh, and a
 * lightweight `applyChange` that re-fetches just that one class (via `lookupClassEntries`) and
 * reconciles it, so a change shows up in search without re-enumerating the whole image. The granular
 * path covers a local compile AND a removal (Explorer → Remove Class, notified per class): the
 * re-fetch simply comes back empty for a class that is gone, which is what drops it.
 */
import { ClassNameEntry } from '../../queries/getAllClassNames';
import {
  CATEGORY_BY_ID,
  OmniConfig,
  OmniCorpusChange,
  OmniProvider,
  OmniResult,
} from '../omniTypes';
import { rankAndLimit } from '../rank';

export function createClassesProvider(
  sessionId: number,
  loadEntries: () => ClassNameEntry[],
  /** Fetch just the entries for one class name (all its dictionary aliases). Enables the granular
   *  applyChange; when omitted (e.g. in a test that doesn't exercise it) applyChange is a no-op. */
  lookupClassEntries?: (className: string) => ClassNameEntry[],
): OmniProvider {
  let entries: readonly ClassNameEntry[] = [];
  return {
    category: CATEGORY_BY_ID.classes,
    prime() {
      entries = loadEntries();
    },
    reprime() {
      entries = loadEntries();
    },
    applyChange(change: OmniCorpusChange): boolean {
      if (change.kind !== 'class' || !lookupClassEntries) return false;
      // Replace every entry for this class name with a fresh lookup (a class can be registered under
      // more than one dictionary/key, so there may be several). A pure redefine leaves the set of
      // names unchanged; a create/remove changes the count — that's what tells the caller to redraw.
      const fresh = lookupClassEntries(change.className);
      const others = entries.filter((e) => e.className !== change.className);
      const next = [...others, ...fresh];
      const changed = next.length !== entries.length;
      entries = next;
      return changed;
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
