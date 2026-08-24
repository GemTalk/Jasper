/**
 * Putting the IDE back in step after an undo (issue #434).
 *
 * Shared by every reverser — a method edit, a class edit, a refactoring — because the
 * problem is the same whichever it was: the stone has changed underneath whatever the user is looking at,
 * and a pane or editor still showing the pre-undo text is how an undo gets silently
 * re-done on the next save.
 */
import * as vscode from 'vscode';

/**
 * Reload every VISIBLE GemStone editor that has no unsaved edits, so an undone method
 * shows its restored source instead of the edited one.
 *
 * Dirty editors are left alone: reverting one would discard the user's typing, and an
 * undo of something else is not licence to do that. Focus is put back where it started.
 */
export async function reloadVisibleGemstoneEditors(): Promise<void> {
  const active = vscode.window.activeTextEditor;
  const targets = vscode.window.visibleTextEditors.filter(
    (e) => e.document.uri.scheme === 'gemstone' && !e.document.isDirty,
  );
  for (const editor of targets) {
    try {
      await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
      await vscode.commands.executeCommand('workbench.action.files.revert');
    } catch {
      /* best-effort: a closed or unrevertable editor must not fail the undo */
    }
  }
  if (active && active !== vscode.window.activeTextEditor) {
    try {
      await vscode.window.showTextDocument(active.document, { preserveFocus: false });
    } catch {
      /* best-effort */
    }
  }
}

/** Rebuild the Explorer's panes. Best-effort — the Explorer may not be active. */
export async function refreshExplorer(): Promise<void> {
  try {
    await vscode.commands.executeCommand('gemstone.explorer.refresh');
  } catch {
    /* the Explorer may not be active */
  }
}

/** Put the Explorer on a method, so what an undo brought back is what the user is
 *  looking at. Best-effort: a row that is not in the rebuilt tree just leaves the panes
 *  where they are. */
export async function revealMethod(
  className: string,
  selector: string,
  isMeta: boolean,
): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      'gemstone.explorer.revealMethodByName',
      className,
      selector,
      isMeta,
    );
  } catch {
    /* the Explorer may not be active, or the row may not be in the rebuilt tree */
  }
}
