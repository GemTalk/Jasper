/**
 * Undoing a class-category change — immediately, with no preview (issue #434).
 *
 * Each class is put back under the label it carried, one `Class>>category:` per class, rather
 * than renaming a category back. That is what makes it exact: a rename that MERGED into an
 * existing category cannot be undone by renaming, because the classes that were already there
 * would come along; a rename that moved a dash-segmented subtree spans several labels; and a
 * rename that skipped a class it could not write moved fewer classes than it named.
 *
 * Nothing is recompiled and nothing commits — `category:` is a label on the class.
 *
 * Drift is a warning, as everywhere else: a class refiled since the change keeps whatever the
 * user put it under only if they decline.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { getClassesWithCategory, recategorizeClass } from '../browserQueries';
import { logInfo } from '../gciLog';
import { ClassCategoryChange, ClassCategoryUndoEntry } from './undoTypes';
import { refreshExplorer, refreshSearch, reloadGemstoneEditors } from './afterUndo';

/** Whether the entry is finished with — true when it was undone (or found already undone),
 *  false when the user backed out or it could not run at all. */
export async function reverseClassCategoryEdit(
  session: ActiveSession,
  entry: ClassCategoryUndoEntry,
): Promise<boolean> {
  let now: Map<string, string>;
  try {
    now = new Map(
      getClassesWithCategory(session, entry.dict).map((e) => [e.className, e.category]),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: could not read the class categories ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  // Plan against the LIVE state: a class already back where it was needs no work, and one that
  // has gone away cannot be refiled.
  const todo = entry.changes.filter((c) => {
    const current = now.get(c.className);
    return current !== undefined && current !== c.before;
  });
  if (todo.length === 0) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — those classes are already filed as they were.`,
      4000,
    );
    return true;
  }

  const drifted = todo.filter((c) => now.get(c.className) !== c.after);
  if (drifted.length > 0 && !(await confirmDrift(entry, drifted))) {
    logInfo(`[undo] #${entry.id} declined at the class-category drift prompt`);
    return false;
  }

  const failures: string[] = [];
  for (const c of todo) {
    try {
      const answer = recategorizeClass(session, c.className, c.before, entry.dict);
      // recategorizeClass reports a class it cannot resolve or write by RETURNING a status
      // string rather than raising, so a bare call would read as success over a class nothing
      // refiled.
      if (!answer.startsWith('Recategorized:')) failures.push(`${c.className}: ${answer}`);
    } catch (e: unknown) {
      failures.push(`${c.className}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await refreshExplorer();
  await refreshSearch(session.id);
  await reloadGemstoneEditors();

  const moved = todo.length - failures.length;
  if (failures.length > 0) {
    void vscode.window.showErrorMessage(
      moved === 0
        ? `Undo of ${entry.label} failed: ${failures[0]}`
        : `Undo of ${entry.label} was partial — ${failures[0]}`,
    );
    // Partial or total, what was recorded no longer describes the dictionary, so the entry is
    // spent either way.
    return true;
  }
  logInfo(`[undo] #${entry.id} refiled ${moved} class(es)`);

  void vscode.window.showInformationMessage(
    `Undid ${entry.label} — ${moved} class${moved === 1 ? '' : 'es'} filed as before. ` +
      'Changed but NOT committed — commit when ready.',
  );
  return true;
}

async function confirmDrift(
  entry: ClassCategoryUndoEntry,
  drifted: ClassCategoryChange[],
): Promise<boolean> {
  const names = drifted.map((c) => c.className);
  const shown = names.slice(0, 10).join(', ');
  const more = names.length > 10 ? `, and ${names.length - 10} more` : '';
  const choice = await vscode.window.showWarningMessage(
    `${names.length} class${names.length === 1 ? ' has' : 'es have'} been refiled since ` +
      `${entry.label}. Undoing puts ${names.length === 1 ? 'it' : 'them'} back under the ` +
      'earlier category and discards that change.',
    { modal: true, detail: `${shown}${more}` },
    'Undo Anyway',
  );
  return choice === 'Undo Anyway';
}
