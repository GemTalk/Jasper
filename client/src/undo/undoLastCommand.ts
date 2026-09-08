/**
 * "Undo" — the one entry point behind the Actions & Navigation pane's button, the palette
 * entry, the keybinding and the post-apply toast (issue #434).
 *
 * Its whole job is to take the top entry off the session's stack and hand it to the
 * reverser for its kind. This is the ONLY module in `undo/` that knows the refactoring
 * engine exists: the generic layer defines the stack and the local reversers, and a
 * refactoring plugs in here as one more kind. Adding a further kind means another branch
 * here and a reverser beside it — not a change to the stack, the UI, or any recording site.
 *
 * Every undo CONFIRMS first, naming the change — see `confirmUndo` for why it is
 * unconditional. Past that, the kinds behave differently on purpose, and the difference is
 * the point of the design:
 *
 *  - a METHOD EDIT reverses straight away, because the user just made it and it is one
 *    method;
 *  - a CLASS EDIT reverses straight away too, but calls itself a REVERT and asks a SECOND
 *    time when binding the earlier version would leave methods behind — that question is
 *    what the reversal costs, rather than which change it is, and GemStone re-versions a
 *    class rather than rolling it back, so the user has to know before it happens;
 *  - a CLASS COMMENT and a CLASS VARIABLE reverse straight away and stay UNDOs: neither
 *    re-versions the class, so putting the earlier text back, or taking the declaration and
 *    its accessors away again, is exact and leaves nothing behind;
 *  - a METHOD CATEGORY is renamed back, a CLASS CATEGORY is put back one class at a time, and a
 *    DICTIONARY is renamed back or put back at its old position on the symbol list — all exact,
 *    and all UNDOs for the same reason;
 *  - a REFACTORING opens the preview panel it already has INSTEAD of the confirmation,
 *    because it can have rewritten dozens of methods across a hierarchy and undoing it
 *    wholesale, unseen, is not a decision to take on the user's behalf.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import { logInfo } from '../gciLog';
import { dropUndoEntry, peekUndoEntry, popUndoEntry } from './undoStack';
import { refreshUndoUi, undoVerb } from './undoUi';
import { UndoEntry } from './undoTypes';
import { reverseMethodEdit } from './reverseMethodEdit';
import { reverseClassEdit } from './reverseClassEdit';
import { reverseClassComment } from './reverseClassComment';
import { reverseClassVarEdit } from './reverseClassVarEdit';
import { reverseMethodCategoryEdit } from './reverseMethodCategoryEdit';
import { reverseDictionaryEdit } from './reverseDictionaryEdit';
import { reverseClassCategoryEdit } from './reverseClassCategoryEdit';
import { checkRefactoringUndoAvailable } from '../refactoring/refactoringUndoAvailability';
import { undoLastRefactoringCommand } from '../refactoring/undoRefactoringCommand';

export async function undoLastCommand(sessions: SessionManager): Promise<void> {
  const session = sessions.getSelectedSession();
  if (!session) {
    void vscode.window.showWarningMessage('Select a GemStone session first.');
    return;
  }

  // Loop rather than take one shot: a refactoring entry can turn out to be stale (the
  // stone's record is per session and a reconnect clears it), and dropping it should fall
  // through to whatever is under it rather than answer "nothing to undo" over a stack
  // that still has entries.
  for (;;) {
    const entry = peekUndoEntry(session.id);
    if (!entry) {
      // Nothing changed here, so the stack has nothing to announce — but reaching this
      // point at all means a button or menu item was showing over an empty stack. Correct
      // it, so the refusal is the last time it happens.
      refreshUndoUi(session);
      void vscode.window.showWarningMessage(
        'There is nothing to undo in this session. Undo covers the edits and refactorings ' +
          'you have made since you connected.',
      );
      return;
    }

    logInfo(`[undo] invoked on #${entry.id} (${entry.kind}) "${entry.label}"`);

    // Confirm before reversing anything, naming the change. A REFACTORING is the one
    // exemption: it opens a preview listing every reversal with its diff and its own
    // checkbox, which is a fuller form of this same question, and asking twice would read
    // as Jasper not trusting its own preview.
    if (entry.kind !== 'refactoring' && !(await confirmUndo(entry))) {
      logInfo(`[undo] #${entry.id} declined at the confirmation`);
      return;
    }

    // Popping is enough: the stack's change listener updates the button and the context key.
    // Leaving the entry in place when it was not spent is what keeps a cancelled or
    // unreadable undo on offer.
    if (entry.kind === 'methodEdit') {
      if (await reverseMethodEdit(session, entry)) popUndoEntry(session.id);
      return;
    }

    if (entry.kind === 'classEdit') {
      if (await reverseClassEdit(session, entry)) popUndoEntry(session.id);
      return;
    }

    if (entry.kind === 'classComment') {
      if (await reverseClassComment(session, entry)) popUndoEntry(session.id);
      return;
    }

    if (entry.kind === 'classVarEdit') {
      if (await reverseClassVarEdit(session, entry)) popUndoEntry(session.id);
      return;
    }

    if (entry.kind === 'methodCategoryEdit') {
      if (await reverseMethodCategoryEdit(session, entry)) popUndoEntry(session.id);
      return;
    }

    if (entry.kind === 'dictionaryEdit') {
      if (await reverseDictionaryEdit(session, entry)) popUndoEntry(session.id);
      return;
    }

    if (entry.kind === 'classCategoryEdit') {
      if (await reverseClassCategoryEdit(session, entry)) popUndoEntry(session.id);
      return;
    }

    // A refactoring's record lives in the stone, so the client entry is only a pointer.
    // Verify it still points at something before opening a preview over nothing.
    const status = checkRefactoringUndoAvailable(session);
    if (!status.available || status.sequence !== entry.sequence) {
      logInfo(`[undo] #${entry.id} no longer held by the stone; dropping it`);
      dropUndoEntry(session.id, entry.id);
      continue;
    }

    await undoLastRefactoringCommand(sessions);
    // The panel can be cancelled, and a partial undo leaves the record in place, so ask
    // the stone what actually happened rather than assume the entry is spent.
    const after = checkRefactoringUndoAvailable(session);
    if (!after.available || after.sequence !== entry.sequence) popUndoEntry(session.id);
    return;
  }
}

/**
 * Name the change and ask, before anything is reversed.
 *
 * Undo takes the top of the STACK, which is not always the last thing the user did: an
 * action that cannot be reversed records nothing, so the entry underneath it — an older
 * change, possibly several actions back — becomes what a click reverses. Every affordance
 * says which change that is (the tooltip names it, the toast is raised by the action
 * itself), but a tooltip is only read by someone who hovers, and a quick click on the
 * button was reversing the wrong change with nothing to stop it (review of #507).
 *
 * So the confirmation is unconditional rather than clever: no attempt is made to work out
 * whether this particular entry is the user's most recent action and skip the question when
 * it is. That test would be wrong exactly when it matters — an unrecorded action is by
 * definition one Jasper knows nothing about — and a prompt that usually does not appear is
 * worse than one that always does, because the one time it appears is the time the user has
 * already clicked through.
 *
 * The VERB matches every other affordance: `Revert` for a class edit, which binds an
 * earlier version rather than rolling anything back, and `Undo` for the rest. The
 * consequence modals that some reversals raise afterwards are a different question — what
 * it costs, rather than which change it is — and are left where they are.
 */
async function confirmUndo(entry: UndoEntry): Promise<boolean> {
  const verb = undoVerb(entry);
  const choice = await vscode.window.showWarningMessage(
    `${verb} ${entry.label}?`,
    {
      modal: true,
      detail:
        'This is the most recent change Jasper recorded in this session. It is not ' +
        'necessarily the last thing you did — an action that cannot be reversed records ' +
        'nothing, so the change before it is what this reverses.',
    },
    verb,
  );
  return choice === verb;
}
