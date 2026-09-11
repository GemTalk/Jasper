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
 *  - a CREATED one is taken off the list again. That is the one case that asks first: the
 *    dictionary was empty when it was made, so if it holds anything now, unlisting it puts
 *    that out of reach. Nothing is destroyed — `symbolList remove:` unlists rather than
 *    deletes — but "out of reach" is worth being told before it happens, not after.
 *
 * Called an UNDO, not a revert: nothing here is versioned and nothing is left behind. What it
 * cannot put back is source that named the dictionary literally, and the forward rename
 * already warned about that; undoing it restores exactly the name that source expects.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { defaultQueryExecutorUsing, removeDictionary, renameDictionary } from '../browserQueries';
import { logInfo } from '../gciLog';
import {
  captureDictionary,
  dictionaryEntryCount,
  reinsertDictionary,
} from './queries/dictionaryQueries';
import { DictionaryUndoEntry } from './undoTypes';
import { refreshSearch, refreshSymbolList, reloadGemstoneEditors } from './afterUndo';

/** Whether the entry is finished with — true when it was undone (or found already undone),
 *  false when it could not run at all. */
export async function reverseDictionaryEdit(
  session: ActiveSession,
  entry: DictionaryUndoEntry,
): Promise<boolean> {
  const execute = defaultQueryExecutorUsing(session);

  // A create is the one direction whose reversal REMOVES rather than restores, so it reads
  // the opposite question of the other two and gets its own path.
  if (!entry.before.present) return unlistCreated(session, execute, entry);

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

/**
 * Undoing a CREATE: take the dictionary off the symbol list again.
 *
 * It was empty when it was made, so anything in it now arrived afterwards — and unlisting it
 * puts all of that out of reach. Nothing is destroyed, and the forward Remove Dictionary says
 * the same thing, but the count is named up front rather than discovered afterwards.
 */
async function unlistCreated(
  session: ActiveSession,
  execute: ReturnType<typeof defaultQueryExecutorUsing>,
  entry: DictionaryUndoEntry,
): Promise<boolean> {
  let now;
  try {
    now = captureDictionary(execute, entry.after.name);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo failed: could not read the symbol list ` +
        `(${e instanceof Error ? e.message : String(e)}).`,
    );
    return false;
  }

  if (!now.present) {
    void vscode.window.setStatusBarMessage(
      `Nothing to undo for ${entry.label} — it is already off the symbol list.`,
      4000,
    );
    return true;
  }

  // Best-effort: a count that cannot be read must not block the undo, and no count means no
  // modal — the same state the user was in before this warning existed.
  let held = 0;
  try {
    held = dictionaryEntryCount(execute, entry.after.name);
  } catch (e: unknown) {
    logInfo(
      `[undo] could not count what ${entry.after.name} holds: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (held > 0 && !(await confirmNotEmpty(entry, held))) {
    logInfo(`[undo] #${entry.id} declined at the not-empty prompt`);
    return false;
  }

  let answer: string;
  try {
    answer = removeDictionary(session, entry.after.name);
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Undo of ${entry.label} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  // removeDictionary reports a dictionary it cannot find by RETURNING a status string.
  if (!answer.startsWith('Removed dictionary:')) {
    void vscode.window.showErrorMessage(`Undo of ${entry.label} failed: ${answer}`);
    return false;
  }
  logInfo(`[undo] #${entry.id} took ${entry.after.name} back off the symbol list`);

  await refreshSymbolList(session.id);
  await refreshSearch(session.id);
  await reloadGemstoneEditors();

  void vscode.window.showInformationMessage(
    `Undid ${entry.label} — ${entry.after.name} is off the symbol list again. ` +
      'Changed but NOT committed — commit when ready.',
  );
  return true;
}

async function confirmNotEmpty(entry: DictionaryUndoEntry, held: number): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `${entry.after.name} was empty when you created it, and holds ${held} ` +
      `${held === 1 ? 'entry' : 'entries'} now.`,
    {
      modal: true,
      detail:
        'Undoing takes the dictionary off the symbol list, which puts everything in it out ' +
        'of reach. Nothing is deleted — the dictionary is unlisted, not destroyed — but ' +
        'nothing will resolve those names until it is back on the list.',
    },
    'Undo Anyway',
  );
  return choice === 'Undo Anyway';
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
