/**
 * Undoing a change to the session's symbol list (issue #434).
 *
 * One reverser for both shapes, because the goal is the same: put the symbol list back the
 * way it was.
 *
 *  - a REMOVED dictionary goes back at its old POSITION, not on the end. A symbol list is
 *    ordered and name resolution walks it in order, so appending a dictionary that used to
 *    sit first would silently change which class a bare name resolves to.
 *  - a RENAMED one is found under its new name and renamed back, which is the same reflective
 *    swap the forward rename made — its position never changed.
 *
 * Called an UNDO, not a revert: nothing here is versioned and nothing is left behind. What it
 * cannot put back is source that named the dictionary literally, and the forward rename
 * already warned about that; undoing it restores exactly the name that source expects.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing, renameDictionary } from '../browserQueries';
import { logInfo } from '../gciLog';
import { captureDictionary, reinsertDictionary } from './queries/dictionaryQueries';
import { DictionaryUndoEntry } from './undoTypes';
import { refreshSearch, refreshSymbolList, reloadGemstoneEditors } from './afterUndo';

/** Whether the entry is finished with — true when it was undone (or found already undone),
 *  false when it could not run at all. */
export async function reverseDictionaryEdit(
  session: ActiveSession,
  entry: DictionaryUndoEntry,
): Promise<boolean> {
  const execute = defaultQueryExecutorUsing(session);

  let asItWas;
  try {
    asItWas = captureDictionary(execute, entry.before.name);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: could not read the symbol list ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  // Check BEFORE doing anything: the old name being back is the whole definition of done,
  // whether this undo put it there or the user did.
  if (asItWas.present) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — ${entry.before.name} is already on the symbol list.`,
      4000,
    );
    return true;
  }

  const error = entry.after.present
    ? renameBack(session, entry)
    : reinsertDictionary(execute, entry.stashKey ?? '', entry.before.index);

  if (error !== null) {
    void vscode.window.showErrorMessage(`Undo of ${entry.label} failed: ${error}`);
    return false;
  }
  logInfo(`[undo] #${entry.id} put ${entry.before.name} back on the symbol list`);

  await refreshSymbolList(session.id);
  await refreshSearch(session.id);
  await reloadGemstoneEditors();

  void vscode.window.showInformationMessage(
    entry.after.present
      ? `Undid ${entry.label} — the dictionary is called ${entry.before.name} again. ` +
          'Changed but NOT committed — commit when ready.'
      : `Undid ${entry.label} — it is back at position ${entry.before.index} on the symbol ` +
          'list, with every class it held. Changed but NOT committed — commit when ready.',
  );
  return true;
}

/** Rename the dictionary back, found under the name the forward rename gave it. Answers null
 *  on success and the reason otherwise — `renameDictionary` reports a refusal (a system
 *  dictionary, a name collision, no such dictionary) by RETURNING it rather than raising. */
function renameBack(session: ActiveSession, entry: DictionaryUndoEntry): string | null {
  let answer: string;
  try {
    answer = renameDictionary(session, entry.after.name, entry.before.name);
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
  return answer.trim() === 'ok' ? null : answer;
}
