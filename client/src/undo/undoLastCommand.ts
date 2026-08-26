/**
 * "Undo" — the one entry point behind the status-bar button, the Explorer title-bar
 * button, the palette entry and the post-apply toast (issue #434).
 *
 * Its whole job is to take the top entry off the session's stack and hand it to the
 * reverser for its kind. This is the ONLY module in `undo/` that knows the refactoring
 * engine exists: the generic layer defines the stack and the local reversers, and a
 * refactoring plugs in here as one more kind. Adding a further kind means another branch
 * here and a reverser beside it — not a change to the stack, the UI, or any recording site.
 *
 * The kinds behave differently on purpose, and the difference is the point of the design:
 *
 *  - a METHOD EDIT reverses immediately, because the user just made it and it is one
 *    method;
 *  - a CLASS EDIT reverses immediately too, but calls itself a REVERT and asks first when
 *    binding the earlier version would leave methods behind — GemStone re-versions a class
 *    rather than rolling it back, and the user has to know that before it happens;
 *  - a CLASS COMMENT and a CLASS VARIABLE reverse immediately and stay UNDOs: neither
 *    re-versions the class, so putting the earlier text back, or taking the declaration and
 *    its accessors away again, is exact and leaves nothing behind;
 *  - a METHOD CATEGORY is renamed back, and a DICTIONARY is renamed back or put back at its
 *    old position on the symbol list — both exact, and both UNDOs for the same reason;
 *  - a REFACTORING opens the preview panel it already has, because it can have rewritten
 *    dozens of methods across a hierarchy and undoing it wholesale, unseen, is not a
 *    decision to take on the user's behalf.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import { logInfo } from '../gciLog';
import { dropUndoEntry, peekUndoEntry, popUndoEntry } from './undoStack';
import { refreshUndoUi } from './undoUi';
import { reverseMethodEdit } from './reverseMethodEdit';
import { reverseClassEdit } from './reverseClassEdit';
import { reverseClassComment } from './reverseClassComment';
import { reverseClassVarEdit } from './reverseClassVarEdit';
import { reverseMethodCategoryEdit } from './reverseMethodCategoryEdit';
import { reverseDictionaryEdit } from './reverseDictionaryEdit';
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
