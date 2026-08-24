/**
 * The notice that follows an undoable action, with Undo on it (issue #434).
 *
 * This is the affordance that actually gets used, and the only one with no discovery cost:
 * it appears where the user is already looking, at the moment they would want it. Every
 * other way in — the status-bar button, the Explorer title bar, the palette entry, the
 * keybinding — exists for the case where this one was missed or dismissed.
 *
 * Refactorings had this from the start (`refactoring/refactoringAppliedToast.ts`, which
 * additionally has to ask the stone whether anything was recorded). Ordinary method edits
 * know the answer already — `commit` hands back the entry, or nothing — so they come here.
 *
 * The button runs the ordinary Undo, which reverses whatever is on TOP of the stack. If
 * the user has done something else in the meantime, that is what gets undone — the same
 * rule the toast on a refactoring follows, and the same rule any "Undo" affordance in a
 * stack-based editor follows. The toast is transient; the stack is the record.
 *
 * Fire-and-forget: `showInformationMessage` resolves only when the user answers or
 * dismisses it, and the edit that triggered it must not stay "running" until then.
 */
import * as vscode from 'vscode';
import { UNDO_COMMAND } from './undoUi';
import { UndoEntry } from './undoTypes';

const UNDO_ACTION = 'Undo';

/**
 * Announce a completed action, offering Undo when one was recorded for it.
 *
 * `entry` is what `commit` answered: `undefined` means the action recorded nothing (the
 * snapshot failed, or it changed nothing), and the notice is shown plain rather than with
 * a button that would undo something else. Returns immediately.
 */
export function notifyUndoable(message: string, entry: UndoEntry | undefined): void {
  if (!entry) {
    void vscode.window.showInformationMessage(message);
    return;
  }
  void (async () => {
    const choice = await vscode.window.showInformationMessage(message, UNDO_ACTION);
    if (choice !== UNDO_ACTION) return;
    await vscode.commands.executeCommand(UNDO_COMMAND);
  })();
}
