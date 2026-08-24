/**
 * The one place that says whether there is anything to undo, and shows it (issue #434).
 *
 * There is a single Undo affordance for the whole extension — a saved method and an
 * applied refactoring are undone by the same button, in the order they happened. Two
 * separate Undo buttons, each covering half of what the user just did, would be worse
 * than one that covers everything.
 *
 * The button is PURPLE (`charts.purple`, a real theme colour, so it reads correctly in
 * light and dark) against a row of otherwise neutral status-bar items, and carries a text
 * label rather than a bare glyph, because a glyph with no owner is a mystery. The tooltip
 * names both GemStone and the specific thing that would be undone — which is exactly what
 * a contributed menu title cannot do, since those are static.
 *
 * It STAYS PUT while a session is connected, dimmed when there is nothing to undo, rather
 * than appearing and vanishing with the stack. A control that is usually absent cannot be
 * learned: you find it once, by accident, and then never again, because there is nowhere
 * to look when it is not there (Eric, F5: "I couldn't find it again"). Dimmed still
 * responds — clicking it gives the plain "there is nothing to undo" refusal, which tells
 * the user what the button is for. It hides only when no session is selected, since undo
 * is per session and there is nothing GemStone-ish to offer without one.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import { peekUndoEntry } from './undoStack';

/** The command every Undo affordance runs. */
export const UNDO_COMMAND = 'gemstone.undoLast';

/** The context key the Explorer title-bar button and the palette entry gate on. */
export const UNDO_AVAILABLE_CONTEXT_KEY = 'gemstone.undoAvailable';

let statusItem: vscode.StatusBarItem | undefined;

/** Create the status-bar button. The caller owns disposal (push it on the subscriptions). */
export function createUndoStatusBarItem(): vscode.StatusBarItem {
  // Left, so it sits with the always-relevant items rather than at the end of the crowded
  // right side where the session indicator and perf counters already live.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = UNDO_COMMAND;
  // The live colour; `refreshUndoUi` dims it when the stack is empty.
  item.color = new vscode.ThemeColor('charts.purple');
  statusItem = item;
  return item;
}

/** Point the module at a specific item (tests; and to release it on dispose). */
export function setUndoStatusBarItem(item: vscode.StatusBarItem | undefined): void {
  statusItem = item;
}

/**
 * Republish the context key and update the button from the selected session's stack.
 *
 * Cheap and synchronous — the stack lives in this process — so it can be called after
 * every edit, on every session switch, and on every stack change without a round trip.
 */
export function refreshUndoUi(session: ActiveSession | undefined): void {
  const entry = peekUndoEntry(session?.id);
  void vscode.commands.executeCommand(
    'setContext',
    UNDO_AVAILABLE_CONTEXT_KEY,
    entry !== undefined,
  );
  if (!statusItem) return;
  if (!session) {
    statusItem.hide();
    return;
  }
  statusItem.text = '$(discard) Undo';
  statusItem.color = new vscode.ThemeColor(entry ? 'charts.purple' : 'disabledForeground');
  statusItem.tooltip = entry
    ? `GemStone — Undo ${entry.label} (Ctrl+K U)`
    : 'GemStone — nothing to undo yet (Ctrl+K U)';
  statusItem.show();
}
