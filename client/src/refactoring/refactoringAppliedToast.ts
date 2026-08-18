/**
 * The single post-apply notice for the whole refactoring family (issue #434).
 *
 * Every method-only refactoring used to end with its own `setStatusBarMessage` or
 * `showInformationMessage`. They now end here, because the notice is where the
 * cheapest and most discoverable UNDO affordance lives — a button on the toast, the
 * same shape VS Code itself uses after a rename.
 *
 * The notice adapts to whether an undo was actually recorded (it always asks the
 * stone rather than assuming):
 *
 *   - undo available  -> a toast carrying an "Undo" button;
 *   - no undo         -> whatever the refactoring asked for as its plain notice, so
 *                        a stone whose engine predates undo behaves exactly as before.
 *
 * The toast is fire-and-forget: `showInformationMessage` resolves only when the user
 * dismisses or clicks it, and the refactoring command must not stay "running" until
 * then. Nothing here awaits the user.
 *
 * If the toast is missed or dismissed the undo is NOT lost: it stays recorded in the
 * session until it is used, and the palette command and the Explorer context-menu
 * item reach it just as well.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { refreshRefactoringUndoContext } from './refactoringUndoAvailability';

/** How to tell the user when there is nothing to undo: a transient status-bar
 *  message (the quiet default the in-editor refactorings use) or a toast (what the
 *  Explorer-driven ones use, since there is no editor to look at). */
export type PlainNoticeStyle = 'statusBar' | 'toast';

/** The command the toast's button runs. */
export const UNDO_COMMAND = 'gemstone.undoLastRefactoring';

const UNDO_ACTION = 'Undo';

/**
 * Announce a completed refactoring and, when the stone recorded an undo for it,
 * offer to undo it right there. Returns immediately.
 */
export function notifyRefactoringApplied(
  session: ActiveSession | undefined,
  message: string,
  plainNotice: PlainNoticeStyle = 'statusBar',
): void {
  void (async () => {
    // Refreshing the context key here is what makes the Explorer item and the palette
    // entry appear the moment a refactoring is applied — this runs after every apply.
    const status = refreshRefactoringUndoContext(session);
    if (!status.available) {
      if (plainNotice === 'toast') void vscode.window.showInformationMessage(message);
      else void vscode.window.setStatusBarMessage(message, 4000);
      return;
    }
    const choice = await vscode.window.showInformationMessage(message, UNDO_ACTION);
    if (choice !== UNDO_ACTION) return;
    await vscode.commands.executeCommand(UNDO_COMMAND);
  })();
}
