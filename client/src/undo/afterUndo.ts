/**
 * Putting the IDE back in step after an undo (issue #434).
 *
 * Shared by every reverser — a method edit, a class edit, a class comment, a class variable, a
 * method category, a symbol-list dictionary, a refactoring — because the problem is the same
 * whichever it was: the stone has changed underneath whatever the user is looking at, and a
 * pane or editor still showing the pre-undo text is how an undo gets silently re-done on the
 * next save. The Explorer, the open editors and GemStone Search all cache what they show, so
 * all three have to be told. A change to the SYMBOL LIST needs more than a pane refresh —
 * see `refreshSymbolList`.
 */
import * as vscode from 'vscode';

/**
 * The command that tells the `gemstone://` file system provider its resources changed.
 * Internal — deliberately not contributed in `package.json`.
 */
export const FS_CHANGED_COMMAND = 'gemstone.fs.notifyChanged';

/** Announce that these `gemstone://` resources changed underneath VS Code. Best-effort —
 *  the provider may not be registered. */
async function announceGemstoneFilesChanged(uris: vscode.Uri[]): Promise<void> {
  if (uris.length === 0) return;
  try {
    await vscode.commands.executeCommand(FS_CHANGED_COMMAND, uris);
  } catch {
    /* the file system provider may not be registered */
  }
}

/**
 * Put every open GemStone editor back in step with the stone after an undo.
 *
 * Two mechanisms, because they cover different editors:
 *
 *  - a CHANGE NOTIFICATION for every open clean `gemstone://` document. This is the same
 *    signal a save already sends (`writeFile` fires it on the provider), and an undo
 *    recompiles straight over GCI rather than through the provider — so without it VS Code
 *    has no reason to believe the source it is showing is stale, and an undone method goes
 *    on displaying the text the undo just discarded. It reaches tabs in every group and
 *    tabs that are not on top, and it needs no focus.
 *  - an explicit REVERT of the visible editors, which is the belt-and-braces that was here
 *    first: it forces a re-read rather than relying on VS Code to act on the notification.
 *
 * Dirty editors are left out of both: reverting one would discard the user's typing, and an
 * undo of something else is not licence to do that. Focus is put back where it started.
 */
export async function reloadGemstoneEditors(): Promise<void> {
  await announceGemstoneFilesChanged(
    vscode.workspace.textDocuments
      .filter((d) => d.uri.scheme === 'gemstone' && !d.isDirty)
      .map((d) => d.uri),
  );

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

/**
 * The command that rebuilds GemStone Search's cached corpora. Internal — deliberately not
 * contributed in `package.json`, since there is nothing for a user to invoke here.
 */
export const SEARCH_RESYNC_COMMAND = 'gemstone.omniSearch.resync';

/**
 * Put GemStone Search back in step with the stone.
 *
 * Search caches its class list rather than re-reading it per keystroke, and an undo binds
 * and unbinds classes behind that cache. Without this, a class an undo removed keeps being
 * offered as a hit, and opening it lands on `Class not found` — the search panel showing a
 * class the Explorer no longer has.
 *
 * The same blunt resync a commit or an abort does: an undo can restore a class, remove one,
 * restore a method or take one away, and folding each of those in per corpus would be a
 * second, subtler copy of the reversal planner. Best-effort — search may not be registered.
 */
export async function refreshSearch(sessionId: number): Promise<void> {
  try {
    await vscode.commands.executeCommand(SEARCH_RESYNC_COMMAND, sessionId);
  } catch {
    /* GemStone Search may not be registered */
  }
}

/**
 * The command that tells the Explorer its SYMBOL LIST changed — a dictionary put back, or
 * renamed back. Internal — deliberately not contributed in `package.json`.
 */
export const SYMBOL_LIST_CHANGED_COMMAND = 'gemstone.explorer.symbolListChanged';

/**
 * Rebuild the Explorer from the symbol list up, and tell everything else that watches it.
 *
 * A pane refresh is not enough here: the Dictionaries pane IS the symbol list, every
 * dictionary below the changed one has shifted index, and the Explorer caches those indices
 * as the key to everything it shows. Best-effort — the Explorer may not be active.
 */
export async function refreshSymbolList(sessionId: number): Promise<void> {
  try {
    await vscode.commands.executeCommand(SYMBOL_LIST_CHANGED_COMMAND, sessionId);
  } catch {
    /* the Explorer may not be active */
  }
}

/**
 * The command that asks the Explorer to rename a still-empty method category back in its own
 * overlay. Internal — deliberately not contributed in `package.json`.
 */
export const RENAME_OVERLAY_CATEGORY_COMMAND = 'gemstone.explorer.renameOverlayMethodCategory';

/** What the Explorer made of an overlay change: it worked, the category is not listed any
 *  more (the overlay is discarded whenever the browsed class changes), or the name being
 *  restored is taken. */
export type OverlayRenameOutcome = 'ok' | 'not-listed' | 'collision';

/**
 * The command that asks the Explorer to take a still-empty method category out of its own
 * overlay. Internal — deliberately not contributed in `package.json`.
 */
export const REMOVE_OVERLAY_CATEGORY_COMMAND = 'gemstone.explorer.removeOverlayMethodCategory';

/**
 * Rename a still-empty category back, in the pane that is the only place it exists.
 *
 * A category the "+" button made has no server existence until something is filed there, so
 * there is no doit to run — the Explorer's own overlay IS the state, and this is the one
 * reversal that has to be asked of the view rather than the stone. Answers 'not-listed' when
 * the Explorer is gone, showing another class, or has since discarded the overlay.
 */
export async function renameOverlayCategory(
  slot: { className: string; isMeta: boolean; dict?: number | string },
  from: string,
  to: string,
): Promise<OverlayRenameOutcome> {
  try {
    const outcome = await vscode.commands.executeCommand<OverlayRenameOutcome>(
      RENAME_OVERLAY_CATEGORY_COMMAND,
      slot,
      from,
      to,
    );
    return outcome ?? 'not-listed';
  } catch {
    return 'not-listed';
  }
}

/**
 * Take a still-empty category out of the overlay — the reversal of creating one.
 *
 * Nothing reaches the stone: a category the "+" button made has no server existence until
 * something is filed there, so the Explorer's own overlay IS the state. Answers 'not-listed'
 * when the Explorer is gone, showing another class, or has since discarded the overlay.
 */
export async function removeOverlayCategory(
  slot: { className: string; isMeta: boolean; dict?: number | string },
  name: string,
): Promise<OverlayRenameOutcome> {
  try {
    const outcome = await vscode.commands.executeCommand<OverlayRenameOutcome>(
      REMOVE_OVERLAY_CATEGORY_COMMAND,
      slot,
      name,
    );
    return outcome ?? 'not-listed';
  } catch {
    return 'not-listed';
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
