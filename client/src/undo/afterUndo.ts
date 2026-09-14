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
 *
 * A method the undo DELETED is the one case where putting an editor back in step means closing
 * it rather than re-reading it: there is no source left to read, and a tab left open over a
 * method the stone does not have is the same re-done-on-the-next-save trap, only worse,
 * because saving it compiles the method back — see `closeEditorsForRemovedMethods`.
 */
import * as vscode from 'vscode';
import { MethodUriRef, parseMethodUri } from '../gemstoneFileSystemProvider';
import { logInfo } from '../gciLog';
import { MethodSlot } from './undoTypes';

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
 * Whether an undo entry's slot and an open editor name the same dictionary.
 *
 * The two sides record it differently, because they were built from different things. A slot
 * carries `dictIndex ?? dictName` — a 1-based symbol-list position when the recording site
 * knew one, and the dictionary's NAME when it did not. A method URI always carries the name
 * in its path, and the index only as an optional `?dict=N`.
 *
 * So: a name compares against the name, an index against the index, and either is conclusive.
 * What is left is an entry that recorded an INDEX against a tab that carries no index, where
 * there is nothing to compare without resolving one to the other against the live symbol
 * list — a query, from a function whose whole job is closing tabs. That case falls back to the
 * class-and-selector match, which is the right way to be wrong here: a URI with no `?dict=`
 * is one whose class was resolved by walking the symbol list in order, which is the same
 * lookup the Explorer's own selection used, so it is overwhelmingly the same class. Being
 * wrong costs a closed tab on a method that still exists; refusing to close would instead
 * leave the stale tab this function exists to remove, in the common case.
 */
function sameDictionary(slotDict: number | string | undefined, ref: MethodUriRef): boolean {
  if (slotDict === undefined) return true;
  if (typeof slotDict === 'string') return slotDict === ref.dictName;
  return ref.dictIndex === undefined || ref.dictIndex === slotDict;
}

/**
 * Close the editors showing methods the undo has just DELETED.
 *
 * `reloadGemstoneEditors` below puts an open editor back in step by re-reading its source,
 * which is the right answer for a method that changed. For one that no longer exists there is
 * nothing to re-read: the tab is a view of a method the stone does not have, and leaving it
 * open invites the user to carry on typing in it and save — which would compile the method
 * straight back and quietly undo the undo. So those tabs go.
 *
 * Called BEFORE the reload, so a removed method's tab is gone before anything tries to
 * refresh it.
 *
 * Matched on session, DICTIONARY, class, selector, side and environment rather than on the URI
 * string: the same method can be open under more than one URI (the breadcrumb and the Explorer
 * build theirs independently, and a base / session-override diff view carries a labelled
 * selector that `parseMethodUri` un-labels), and every one of them is now a view of nothing.
 *
 * The dictionary is part of the match because a class name is NOT unique in a session: a
 * symbol list can hold `Account` in two dictionaries, and closing the editor for the other
 * one — a method that still exists — would be worse than the stale tab this is here to get
 * rid of. See `sameDictionary` for what happens when the two sides cannot be compared.
 *
 * A DIRTY tab is left alone, which is the same line `reloadGemstoneEditors` draws: closing it
 * would discard whatever the user has typed, and an undo of something else is not licence to
 * do that. What they have is then a buffer over a method that is gone — saving it compiles it
 * back, which is a decision they can see themselves making.
 */
export async function closeEditorsForRemovedMethods(
  sessionId: number,
  removed: MethodSlot[],
): Promise<void> {
  if (removed.length === 0) return;
  const gone = (ref: MethodUriRef): boolean =>
    removed.some(
      (slot) =>
        slot.className === ref.className &&
        slot.selector === ref.selector &&
        slot.isMeta === ref.isMeta &&
        slot.environmentId === ref.environmentId &&
        sameDictionary(slot.dict, ref),
    );

  const closing: Thenable<unknown>[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputText)) continue;
      if (tab.isDirty) continue;
      const ref = parseMethodUri(tab.input.uri);
      if (!ref || ref.sessionId !== sessionId || !gone(ref)) continue;
      logInfo(`[undo] closing the editor for the removed ${ref.className}>>${ref.selector}`);
      closing.push(vscode.window.tabGroups.close(tab));
    }
  }
  try {
    await Promise.all(closing);
  } catch {
    /* best-effort: a tab that will not close must not fail the undo */
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

/**
 * The command that tells the Explorer its CLASS CATEGORIES changed. Internal — deliberately not
 * contributed in `package.json`.
 */
export const CLASS_CATEGORIES_CHANGED_COMMAND = 'gemstone.explorer.classCategoriesChanged';

/**
 * Put the Class Categories pane back in step after an undo refiled classes.
 *
 * A plain refresh is not enough, and the reason is the forward action: moving a class to a
 * category SELECTS that category, so after undoing the move the pane is still filtered to a
 * category the class has just left — the class is back where it belongs and invisible. Passing
 * the class lets the Explorer follow it to whatever it is filed under now; passing nothing
 * (a rename that refiled many classes, where following one would be arbitrary) just clears a
 * filter that no longer holds the selected class.
 *
 * Best-effort — the Explorer may not be active.
 */
export async function refreshClassCategories(className?: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(CLASS_CATEGORIES_CHANGED_COMMAND, className);
  } catch {
    /* the Explorer may not be active */
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
 *  where they are.
 *
 *  `dict` is the slot's dictionary, passed on for the same reason `closeEditorsForRemovedMethods`
 *  matches on it: a class name is not unique in a session, and revealing the `Account` that was
 *  never touched shows the user a class where nothing happened. The Explorer falls back to first
 *  match when it is omitted or resolves to nothing. */
export async function revealMethod(
  className: string,
  selector: string,
  isMeta: boolean,
  dict?: number | string,
): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      'gemstone.explorer.revealMethodByName',
      className,
      selector,
      isMeta,
      dict,
    );
  } catch {
    /* the Explorer may not be active, or the row may not be in the rebuilt tree */
  }
}
