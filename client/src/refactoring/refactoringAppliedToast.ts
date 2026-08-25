/**
 * The single post-apply notice for the whole refactoring family (issue #434).
 *
 * Every method-only refactoring used to end with its own `setStatusBarMessage` or
 * `showInformationMessage`. They now end here, because the notice is where the cheapest
 * and most discoverable UNDO affordance lives — a button on the toast, the same shape
 * VS Code itself uses after a rename.
 *
 * This is also where an applied refactoring joins Jasper's undo stack. The record itself
 * stays in the stone (only the engine can reverse it), so what goes on the stack is a
 * pointer carrying the stone's sequence number — enough to notice later that the stone has
 * replaced or forgotten it. Pushing here rather than in each refactoring command keeps the
 * stack out of fifteen call sites.
 *
 * The notice adapts to whether an undo was actually recorded (it always asks the stone
 * rather than assuming):
 *
 *   - undo available  -> a toast carrying an "Undo" button;
 *   - no undo         -> whatever the refactoring asked for as its plain notice, so
 *                        a stone whose engine predates undo behaves exactly as before.
 *
 * The toast is fire-and-forget: `showInformationMessage` resolves only when the user
 * dismisses or clicks it, and the refactoring command must not stay "running" until then.
 * Nothing here awaits the user.
 *
 * If the toast is missed or dismissed the undo is NOT lost: it stays on the stack until it
 * is used, and the status-bar button, the Explorer title-bar button and the palette
 * command all reach it just as well.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { checkRefactoringUndoAvailable } from './refactoringUndoAvailability';
import { pushUndoEntry } from '../undo/undoStack';
import { UNDO_COMMAND } from '../undo/undoUi';
import { logInfo } from '../gciLog';

/** How to tell the user when there is nothing to undo: a transient status-bar
 *  message (the quiet default the in-editor refactorings use) or a toast (what the
 *  Explorer-driven ones use, since there is no editor to look at). */
export type PlainNoticeStyle = 'statusBar' | 'toast';

const UNDO_ACTION = 'Undo';

/**
 * Announce a completed refactoring and, when the stone recorded an undo for it, put it on
 * the undo stack and offer to undo it right there. Returns immediately.
 */
export function notifyRefactoringApplied(
  session: ActiveSession | undefined,
  message: string,
  plainNotice: PlainNoticeStyle = 'statusBar',
): void {
  void (async () => {
    const status = checkRefactoringUndoAvailable(session);
    if (!status.available || !session) {
      logInfo(`[undoRefactoring] no undo on offer for "${message}" — plain notice`);
      if (plainNotice === 'toast') void vscode.window.showInformationMessage(message);
      else void vscode.window.setStatusBarMessage(message, 4000);
      return;
    }
    logInfo(`[undoRefactoring] offering undo #${status.sequence} "${status.label}"`);
    // Pushing is all it takes: the stack's change listener is what makes the status-bar
    // button and the Explorer item appear, so no recording site updates the UI itself.
    pushUndoEntry({
      kind: 'refactoring',
      sessionId: session.id,
      label: status.label,
      sequence: status.sequence,
    });

    const choice = await vscode.window.showInformationMessage(message, UNDO_ACTION);
    if (choice !== UNDO_ACTION) return;
    await vscode.commands.executeCommand(UNDO_COMMAND);
  })();
}
