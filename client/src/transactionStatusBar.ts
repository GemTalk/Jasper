import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import {
  canBegin,
  canCommit,
  modeDescription,
  transactionStateLabel,
} from './queries/transactionMode';

// The always-on answer to "what will Commit do right now?".
//
// A session's transaction mode changes what Commit, Abort and Begin mean, and
// until now nothing in Jasper said which mode a session was in — the answer was
// "autoBegin, because that is what Jasper assumed". A status-bar item is the
// right home for it: it is visible without being asked for, it costs no pane and
// no row, and it is one click from switching. It follows the *selected* session,
// which is the one Display It, Inspect It and the Explorer all act in, and hides
// itself entirely when nothing is logged in.
//
// Modelled on openEditorsStatusBar.ts.

export const SET_MODE_COMMAND = 'gemstone.setTransactionMode';

/**
 * The glyph for a session's state, chosen so the shape alone carries the part
 * that matters: a filled circle means "inside a transaction — a commit can
 * land", a hollow one means "outside one — it cannot". Transactionless gets the
 * eye it earns: a mode for looking, not writing.
 *
 * Colour is deliberately not doing this work; a status bar is a place readers
 * scan rather than study, and the two circles differ in shape as well as fill.
 */
export function transactionStatusIcon(session: ActiveSession): string {
  if (session.transactionMode === 'transactionless' && session.inTransaction !== true) {
    return 'eye';
  }
  if (session.inTransaction === true) return 'circle-filled';
  if (session.inTransaction === false) return 'circle-outline';
  return 'question';
}

/** What the status-bar item reads when `session` is the selected one. */
export function transactionStatusText(session: ActiveSession): string {
  return `$(${transactionStatusIcon(session)}) ${transactionStateLabel(
    session.transactionMode,
    session.inTransaction,
  )}`;
}

/**
 * The hover: what the mode means, what it lets the session do right now, and
 * that clicking changes it. Spelled out rather than left to the mode's name,
 * because the names are GemStone's and not self-explaining.
 */
export function transactionStatusTooltip(session: ActiveSession): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(
    `**Session ${session.id} — ${transactionStateLabel(session.transactionMode, session.inTransaction)}**\n\n`,
  );
  md.appendMarkdown(`${modeDescription(session.transactionMode)}\n\n`);
  md.appendMarkdown(
    canCommit(session.inTransaction)
      ? '- Commit: available\n'
      : '- Commit: unavailable — the session is not in a transaction\n',
  );
  md.appendMarkdown(
    canBegin(session.transactionMode, session.inTransaction)
      ? '- Begin Transaction: available\n'
      : '- Begin Transaction: not needed in this mode\n',
  );
  md.appendMarkdown('- Abort: always available\n\n');
  md.appendMarkdown('_Click to change the transaction mode._');
  return md;
}

/**
 * Show the selected session's transaction state in the status bar, and make it
 * the shortest route to changing it.
 *
 * Redraws on three signals rather than polling: the selection moving, a session
 * arriving or leaving, and the transaction state itself changing (which
 * SessionManager fires after every commit, abort, begin and switch).
 */
export function registerTransactionStatusBar(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
): void {
  // Priority 1 so it sits to the left of the open-editors tally, which is about
  // editors rather than the session and is the less consequential of the two.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  item.command = SET_MODE_COMMAND;

  const refresh = () => {
    const session = sessionManager.getSelectedSession();
    if (!session) {
      item.hide();
      return;
    }
    item.text = transactionStatusText(session);
    item.tooltip = transactionStatusTooltip(session);
    item.show();
  };
  refresh();

  context.subscriptions.push(
    item,
    sessionManager.onDidChangeSelection(refresh),
    sessionManager.onDidAddSession(refresh),
    sessionManager.onDidRemoveSession(refresh),
    sessionManager.onDidChangeTransactionState(refresh),
  );
}
