/**
 * Undoing a class comment save — immediately, with no preview (issue #434).
 *
 * A comment is one piece of text on one class, and the user just wrote it, so this follows
 * the method-edit path rather than the class-edit one: reverse on the spot, report what it
 * did, and call it an UNDO. `comment:` does not re-version the class, so nothing is left
 * behind and there is no discard modal to show.
 *
 * The single thing worth asking about is DRIFT — the comment having changed since the save
 * being undone — and, as everywhere else, it is a warning rather than a refusal.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { getClassComment, setClassComment } from '../browserQueries';
import { logInfo } from '../gciLog';
import { ClassCommentUndoEntry } from './undoTypes';
import { refreshExplorer, refreshSearch, reloadGemstoneEditors } from './afterUndo';

/** Whether the entry is finished with — true when it was undone (or found already undone),
 *  false when the user backed out or the reversal could not run at all. */
export async function reverseClassComment(
  session: ActiveSession,
  entry: ClassCommentUndoEntry,
): Promise<boolean> {
  let now: string;
  try {
    now = getClassComment(session, entry.slot.className, entry.slot.dict);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: could not read the current comment on ${entry.slot.className} ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  // Check BEFORE asking anything: a comment already back the way it was costs no modal.
  if (now === entry.before) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — the comment is already as it was.`,
      4000,
    );
    return true;
  }

  if (now !== entry.after && !(await confirmDrift(entry))) {
    logInfo(`[undo] #${entry.id} declined at the comment drift prompt`);
    return false;
  }

  let result: string;
  try {
    result = setClassComment(session, entry.slot.className, entry.before, entry.slot.dict);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  // setClassComment reports a class it cannot resolve by RETURNING a status string rather
  // than throwing, so a bare call would look like success over a comment nothing wrote.
  if (!result.startsWith('Comment set:')) {
    void vscode.window.showErrorMessage(`Undo of ${entry.label} failed: ${result}`);
    return false;
  }

  await refreshExplorer();
  await refreshSearch(session.id);
  await reloadGemstoneEditors();

  void vscode.window.showInformationMessage(
    `Undid ${entry.label} — ${entry.before.length === 0 ? 'the comment is empty again' : 'the earlier comment is back'}. ` +
      'Written but NOT committed — commit when ready.',
  );
  return true;
}

async function confirmDrift(entry: ClassCommentUndoEntry): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `The comment on ${entry.slot.className} has changed since ${entry.label}. Undoing puts ` +
      'back the earlier text and discards that change.',
    { modal: true },
    'Undo Anyway',
  );
  return choice === 'Undo Anyway';
}
