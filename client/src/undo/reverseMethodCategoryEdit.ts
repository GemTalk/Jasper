/**
 * Undoing a method-category rename — immediately, with no preview (issue #434).
 *
 * Reversed by renaming it back, not by recompiling the methods it holds:
 * `renameCategory:to:` moves all of them in one message and recompiles none.
 *
 * GemStone REFUSES a rename onto a category that already exists, which is the whole reason
 * this reversal is exact — a rename is one name becoming another, never two categories
 * merging. It is also the one thing that can stop the undo: if the old name has since been
 * taken by a new category, the reversal refuses and NAMES the collision rather than
 * clobbering it. Drift — the category renamed again since — is a warning, as everywhere else.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { getMethodCategories, renameCategory } from '../browserQueries';
import { logInfo } from '../gciLog';
import { MethodCategoryUndoEntry, methodCategorySlotLabel } from './undoTypes';
import { refreshExplorer, refreshSearch, reloadGemstoneEditors } from './afterUndo';

/** Whether the entry is finished with — true when it was undone (or found already undone),
 *  false when the user backed out or the reversal could not run at all. */
export async function reverseMethodCategoryEdit(
  session: ActiveSession,
  entry: MethodCategoryUndoEntry,
): Promise<boolean> {
  const where = methodCategorySlotLabel(entry.slot);

  let categories: string[];
  try {
    categories = getMethodCategories(
      session,
      entry.slot.className,
      entry.slot.isMeta,
      entry.slot.dict,
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: could not read the method categories on ${where} ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  // Check BEFORE asking anything: a category already back the way it was costs no modal.
  if (!categories.includes(entry.after) && categories.includes(entry.before)) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — the category is already called '${entry.before}'.`,
      4000,
    );
    return true;
  }

  if (categories.includes(entry.before)) {
    // Renaming onto it would be refused by the stone anyway; say which name is in the way.
    void vscode.window.showErrorMessage(
      `Cannot undo ${entry.label}: ${where} has a category called '${entry.before}' again, and ` +
        'GemStone will not rename one category onto another. Rename or empty that one first.',
    );
    return false;
  }

  if (!categories.includes(entry.after)) {
    void vscode.window.showErrorMessage(
      `Cannot undo ${entry.label}: ${where} no longer has a category called '${entry.after}'.`,
    );
    return false;
  }

  try {
    renameCategory(
      session,
      entry.slot.className,
      entry.slot.isMeta,
      entry.after,
      entry.before,
      entry.slot.dict,
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo of ${entry.label} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  logInfo(`[undo] #${entry.id} renamed '${entry.after}' back to '${entry.before}' on ${where}`);

  await refreshExplorer();
  await refreshSearch(session.id);
  await reloadGemstoneEditors();

  void vscode.window.showInformationMessage(
    `Undid ${entry.label} — the category is called '${entry.before}' again, with the same ` +
      'methods in it. Changed but NOT committed — commit when ready.',
  );
  return true;
}
