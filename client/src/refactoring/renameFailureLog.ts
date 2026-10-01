import { RenameApplyResult } from './renameInstVarPreview';

/**
 * Format the persistent-log block listing EVERY method a rename could not recompile
 * onto the new class version, or `undefined` when none failed.
 *
 * A rename re-versions the class and copies methods forward; a method whose
 * rewritten source will not compile is reported here rather than dropped in
 * silence. The apply toast can only name the first failure (a notification
 * truncates and then vanishes), so the full set goes to the persistent "GemStone
 * GCI" output channel — a durable list the user can work through, per the
 * rename-family "surface post-rename warnings" hardening goal.
 */
export function formatRenameFailureLog(
  action: string,
  failed: RenameApplyResult['failed'],
): string | undefined {
  if (failed.length === 0) return undefined;
  return (
    `${action}: ${failed.length} method(s) did not recompile onto the new class version ` +
    '(compiled but NOT committed — abort if this was not intended):\n' +
    failed.map((f) => `    • ${f.label}: ${f.error}`).join('\n')
  );
}

export const UNDO_RENAME = 'Undo';
export const SHOW_RENAME_DETAILS = 'Show Details';

/**
 * The notification for the same failure, from the same two inputs — so the toast and the
 * log block cannot drift apart in what they tell the user. A notification collapses
 * newlines and truncates, so it names only the first failure and leans on the channel
 * (and the toast's Show Details button) for the rest. Every rename reports the
 * not-committed caveat, which previously only the instance-variable one carried.
 *
 * The message and the BUTTONS are built together, from the one `undoable` flag, and handed
 * back as a pair. They were built apart -- the caller chose the buttons from the flag, this
 * wrote the text without ever being told -- so every toast promised "Undo reverses this
 * rename" while three of the five rename paths armed nothing (a failed method rename arms
 * nothing at all). A user who trusted the sentence and reached for the Undo pane reversed
 * whatever they had done BEFORE the rename. Returning both from one place is what makes
 * that drift unsayable rather than merely fixed: there is no way to word the recourse
 * without also deciding the button.
 */
export function renameFailureNotification(
  action: string,
  result: RenameApplyResult,
  undoable: boolean,
): { message: string; actions: string[] } {
  const first = result.failed[0];
  const more = result.failed.length > 1 ? ` (+${result.failed.length - 1} more)` : '';
  // Not "abort if this is not what you wanted". Abort discards every uncommitted change in the
  // session, not this one refactoring, and a partial apply is undoable on its own WHEN one was
  // recorded -- which is the whole point of recording the reversal before reporting the
  // failure (#396). Where none was, the sentence stops at the caveat rather than naming a
  // recourse the user does not have.
  const recourse = undoable ? ' — Undo reverses this rename' : '';
  return {
    message:
      `${action}: applied ${result.applied} change(s), but ${result.failed.length} method(s) ` +
      `did not recompile onto the new class version: ${first.label}: ${first.error}${more}. ` +
      `Compiled but NOT committed${recourse}.`,
    actions: undoable ? [UNDO_RENAME, SHOW_RENAME_DETAILS] : [SHOW_RENAME_DETAILS],
  };
}
