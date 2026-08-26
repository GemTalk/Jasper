/**
 * Undoing a method-category rename — immediately, with no preview (issue #434).
 *
 * A category renamed on the STONE is reversed by renaming it back, not by recompiling the
 * methods it holds: `renameCategory:to:` moves all of them in one message and recompiles
 * none. GemStone REFUSES a rename onto a category that already exists, which is the whole
 * reason this reversal is exact — a rename is one name becoming another, never two categories
 * merging. It is also the one thing that can stop the undo: if the old name has since been
 * taken, the reversal refuses and NAMES the collision rather than clobbering it.
 *
 * CREATING a category (`before: null`) is reversed by taking it away, and only ever while it
 * is still EMPTY. GemStone's `removeCategory:` takes the methods in a category with it rather
 * than refusing, so a category that has been filled since is a refusal with a count, never an
 * attempt.
 *
 * A STILL-EMPTY category is reversed in the Explorer's own overlay instead, because that is
 * the only place it exists — the "+" button leaves the stone alone until something is filed
 * there. To the user the two are the same act and get the same button; the difference is
 * Jasper's to keep track of, not theirs.
 *
 * Which of the two runs is decided from the LIVE state, never from a flag recorded at the
 * time, because a category can cross between them: filing a method into a fresh one — by
 * compiling, or by dropping a method on it — is all it takes to make it real.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { getMethodCategories, removeMethodCategory, renameCategory } from '../browserQueries';
import { logInfo } from '../gciLog';
import { MethodCategoryUndoEntry, methodCategorySlotLabel } from './undoTypes';
import {
  refreshExplorer,
  refreshSearch,
  reloadGemstoneEditors,
  removeOverlayCategory,
  renameOverlayCategory,
} from './afterUndo';

/** Whether the entry is finished with — true when it was undone (or found already undone, or
 *  found to describe a category that no longer exists anywhere), false when the user backed
 *  out or the reversal could not run. */
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

  // The stone does not have the category, so this is a still-empty one and the Explorer's
  // overlay is the only place the action happened.
  if (!categories.includes(entry.after)) {
    return reverseInOverlay(entry, categories, where);
  }

  // From here the category is real.
  if (entry.before === null) return removeReal(session, entry, where);

  // Check BEFORE asking anything: one already back the way it was costs no modal.
  if (categories.includes(entry.before)) {
    // Renaming onto it would be refused by the stone anyway; say which name is in the way.
    void vscode.window.showErrorMessage(
      `Cannot undo ${entry.label}: ${where} has a category called '${entry.before}' again, and ` +
        'GemStone will not rename one category onto another. Rename or empty that one first.',
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

/**
 * Undoing a CREATE on a category the stone now has: take it away, but only if it is empty.
 *
 * `removeMethodCategory` does the check and the removal in one doit, so nothing can file a
 * method into it in between — and it refuses rather than removing a category with methods,
 * because `removeCategory:` would take them with it.
 */
async function removeReal(
  session: ActiveSession,
  entry: MethodCategoryUndoEntry,
  where: string,
): Promise<boolean> {
  let answer: string;
  try {
    answer = removeMethodCategory(
      session,
      entry.slot.className,
      entry.slot.isMeta,
      entry.after,
      entry.slot.dict,
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo of ${entry.label} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }

  const held = /^holds:(\d+)$/.exec(answer.trim());
  if (held) {
    const n = Number(held[1]);
    void vscode.window.showErrorMessage(
      `Cannot undo ${entry.label}: '${entry.after}' now holds ${n} method${n === 1 ? '' : 's'}, ` +
        'and removing a category in GemStone removes the methods in it. Move them elsewhere first.',
    );
    return false;
  }
  if (answer.trim() !== 'ok') {
    void vscode.window.showErrorMessage(`Undo of ${entry.label} failed: ${answer}`);
    return false;
  }
  logInfo(`[undo] #${entry.id} removed the empty category '${entry.after}' from ${where}`);

  await refreshExplorer();
  await refreshSearch(session.id);
  await reloadGemstoneEditors();

  void vscode.window.showInformationMessage(
    `Undid ${entry.label} — '${entry.after}' is gone again. It was empty, so no method moved. ` +
      'Changed but NOT committed — commit when ready.',
  );
  return true;
}

/**
 * The still-empty case: rename it back, or take it away, where it lives — in the Explorer's
 * overlay.
 *
 * Nothing reaches the stone, so there is nothing to commit and nothing to refresh beyond the
 * pane the Explorer redraws itself.
 */
async function reverseInOverlay(
  entry: MethodCategoryUndoEntry,
  serverCategories: string[],
  where: string,
): Promise<boolean> {
  const outcome =
    entry.before === null
      ? await removeOverlayCategory(entry.slot, entry.after)
      : await renameOverlayCategory(entry.slot, entry.after, entry.before);

  if (outcome === 'ok') {
    logInfo(`[undo] #${entry.id} reversed '${entry.after}' in the overlay`);
    void vscode.window.showInformationMessage(
      entry.before === null
        ? `Undid ${entry.label} — '${entry.after}' is gone again. It was still empty, so ` +
            'nothing had reached the stone.'
        : `Undid ${entry.label} — the category is called '${entry.before}' again. It is still ` +
            'empty, so nothing has reached the stone.',
    );
    return true;
  }

  if (outcome === 'collision') {
    void vscode.window.showErrorMessage(
      `Cannot undo ${entry.label}: ${where} has a category called '${entry.before}' again. ` +
        'Rename that one first.',
    );
    return false;
  }

  // 'not-listed'. The category was empty and lived only in the Explorer's overlay, which is
  // discarded whenever the browsed class changes — so this entry now describes something that
  // is not anywhere. Spend it rather than leave it on offer over nothing; the message says
  // why, and the next Undo reaches whatever is under it.
  const alreadyBack = entry.before !== null && serverCategories.includes(entry.before);
  void vscode.window.setStatusBarMessage(
    alreadyBack
      ? `Nothing to undo for ${entry.label} — the category is already called '${entry.before}'.`
      : `Nothing to undo for ${entry.label} — that category was still empty and is no longer listed.`,
    5000,
  );
  return true;
}
