/**
 * The one call a class-category command makes to become undoable (issue #434).
 *
 * Two-step, because what matters is what each class was filed under BEFORE:
 *
 *   const recording = beginClassCategoryEdit(session, dict);   // reads every class's category
 *   ... rename the category, or move a class into another ...
 *   recording?.commit('Rename class category Foo to Bar');     // reads them again and diffs
 *
 * The diff is what makes this exact. `renameClassCategory` reassigns every class carrying the
 * old label AND the dash-segmented subtree beneath it, merges into an existing category rather
 * than refusing, and skips any class it cannot write — so the set of classes that actually
 * moved is only knowable by comparing before and after. A class the command did not touch shows
 * no difference and contributes nothing, which is also why a partial rename needs no special
 * handling here.
 *
 * Best-effort, like every other recorder: a read that fails answers `undefined` and the command
 * proceeds exactly as it did before undo existed.
 */
import { ActiveSession } from '../sessionManager';
import { getClassesWithCategory } from '../browserQueries';
import { logInfo } from '../gciLog';
import { pushUndoEntry } from './undoStack';
import { ClassCategoryChange, UndoEntry } from './undoTypes';

export interface ClassCategoryRecording {
  commit(label: string): UndoEntry | undefined;
}

/** Category per class name, as the dictionary reads right now. */
function readCategories(
  session: ActiveSession,
  dict: number | string,
): Map<string, string> | undefined {
  try {
    const entries = getClassesWithCategory(session, dict);
    return new Map(entries.map((e) => [e.className, e.category]));
  } catch (e: unknown) {
    logInfo(
      `[undo] class-category read failed, the change will not be undoable: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
}

export function beginClassCategoryEdit(
  session: ActiveSession,
  dict: number | string,
): ClassCategoryRecording | undefined {
  const before = readCategories(session, dict);
  if (!before) return undefined;

  return {
    commit(label: string): UndoEntry | undefined {
      const after = readCategories(session, dict);
      if (!after) {
        logInfo(`[undo] not recording "${label}": could not read the result`);
        return undefined;
      }
      // Only classes whose category actually changed. A class that has APPEARED since is not a
      // recategorization and has no "before" to go back to.
      const changes: ClassCategoryChange[] = [];
      for (const [className, now] of after) {
        const was = before.get(className);
        if (was !== undefined && was !== now) changes.push({ className, before: was, after: now });
      }
      if (changes.length === 0) {
        logInfo(`[undo] not recording "${label}": no class changed category`);
        return undefined;
      }
      const entry = pushUndoEntry({
        kind: 'classCategoryEdit',
        sessionId: session.id,
        label,
        dict,
        changes,
      });
      logInfo(`[undo] recorded #${entry.id} "${label}" (${changes.length} class(es))`);
      return entry;
    },
  };
}
