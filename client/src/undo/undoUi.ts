/**
 * The one place that says whether there is anything to undo (issue #434).
 *
 * There is a single Undo affordance for the whole extension — a saved method and an
 * applied refactoring are undone by the same button, in the order they happened. Two
 * separate Undo buttons, each covering half of what the user just did, would be worse
 * than one that covers everything.
 *
 * The BUTTON itself lives in the Explorer's Actions & Navigation pane, beside Commit and
 * Abort, which are the other two controls that act on uncommitted work. It went there on
 * the review of #507: there had been five ways to reach this one action — a status-bar
 * item, an icon on the Explorer's Methods pane, one on the editor title bar, the palette
 * entry and the toast — and a reviewer who went looking found three of them and wanted one.
 *
 * Being a webview button rather than a contributed menu entry is what makes it the right
 * one to keep. A contributed menu title is a fixed string in `package.json`, so none of the
 * icons could ever say WHAT it would reverse; the status-bar item could, and that tooltip
 * was the only reason it earned its place. The pane's button writes its own tooltip per
 * state (`undoLabel`, built in `syncNavigationState`), so the affordance that names the
 * change is now also the one that is a button, and nothing is left that only half works.
 *
 * What stays here is the pair of CONTEXT KEYS, which the palette entries and the keybinding
 * still need: `undoLast` and `revertLast` are one dispatcher under two names, and the only
 * way for a palette entry or a chord to say "Revert" for a class edit is to have a second
 * command whose fixed title says it. The keys keep exactly one of the two live.
 *
 * The VERB follows the entry. A class edit is reversed by binding the earlier version
 * again, which is a revert and not a rollback, and every message that action produces says
 * so; the button has to agree, or the user is promised an undo and handed a revert. It is
 * still the one command and the one keybinding — semantically it is the same act, and making
 * the user pick between two would be worse than one that names what it will do.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { peekUndoEntry } from './undoStack';
import { UndoEntry } from './undoTypes';

/** The command every Undo affordance runs. */
export const UNDO_COMMAND = 'gemstone.undoLast';

/**
 * The two context keys the palette entries and the keybinding gate on: exactly one is true
 * while there is something to reverse, and both are false when there is not.
 *
 * They exist because a CONTRIBUTED entry's title is a fixed string in `package.json` — the
 * palette cannot name the specific change the way the pane's button does. What it CAN do is
 * pick between two contributed commands, so the VERB at least agrees rather than promising
 * an undo and handing the user a revert.
 *
 * Two BOOLEANS rather than one key holding the verb: a boolean is the plainest thing a `when`
 * clause can test, it is how every other condition in this manifest is written, and it leaves
 * no question about how a value is quoted or compared.
 */
export const UNDO_AVAILABLE_CONTEXT_KEY = 'gemstone.undoAvailable';
export const REVERT_AVAILABLE_CONTEXT_KEY = 'gemstone.revertAvailable';

/**
 * The internal command that tells the Explorer to redraw its Undo button.
 *
 * Deliberately not contributed in `package.json`, and deliberately a command rather than a
 * direct call: the button's tooltip is built from the stack, but this module has no business
 * knowing the Explorer exists — the same arrangement every other view-side reversal uses
 * (see `afterUndo`).
 */
export const undoStateChangedCommand = 'gemstone.explorer.undoStateChanged';

/**
 * Republish the context keys and redraw the button from the selected session's stack.
 *
 * Cheap and synchronous — the stack lives in this process — so it can be called after
 * every edit, on every session switch, and on every stack change without a round trip.
 */
export function refreshUndoUi(session: ActiveSession | undefined): void {
  const entry = peekUndoEntry(session?.id);
  const verb = entry ? undoVerb(entry) : undefined;
  void vscode.commands.executeCommand('setContext', UNDO_AVAILABLE_CONTEXT_KEY, verb === 'Undo');
  void vscode.commands.executeCommand(
    'setContext',
    REVERT_AVAILABLE_CONTEXT_KEY,
    verb === 'Revert',
  );
  // Best-effort: the Explorer may not be registered yet, or at all. Wrapped in
  // Promise.resolve because this function is synchronous and so cannot `await` — which is how
  // every other best-effort call into the view tolerates both a rejection and a command that
  // hands back something that is not a promise at all (see `afterUndo`).
  void Promise.resolve(vscode.commands.executeCommand(undoStateChangedCommand)).catch(() => {});
}

/** What reversing this entry is honestly called. A class edit binds an earlier version
 *  rather than rolling anything back, so it is a revert; everything else is an undo. */
export function undoVerb(entry: UndoEntry): 'Undo' | 'Revert' {
  return entry.kind === 'classEdit' ? 'Revert' : 'Undo';
}
