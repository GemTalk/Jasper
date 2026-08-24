/**
 * "Undo" — the one entry point behind the status-bar button, the Explorer title-bar
 * button, the palette entry and the post-apply toast (issue #434).
 *
 * Its whole job is to take the top entry off the session's stack and hand it to the
 * reverser for its kind. This is the ONLY module in `undo/` that knows the refactoring
 * engine exists: the generic layer defines the stack and the method-edit reverser, and a
 * refactoring plugs in here as one more kind. Adding a further kind later means another
 * branch here and a reverser beside it — not a change to the stack, the UI, or any
 * recording site.
 *
 * The two kinds behave differently on purpose, and the difference is the point of the
 * design:
 *
 *  - a METHOD EDIT reverses immediately, because the user just made it and it is one
 *    method;
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

    if (entry.kind === 'methodEdit') {
      // Popping is enough: the stack's change listener updates the button and the context
      // key. Leaving the entry in place when it was not spent is what keeps a cancelled or
      // unreadable undo on offer.
      if (await reverseMethodEdit(session, entry)) popUndoEntry(session.id);
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
