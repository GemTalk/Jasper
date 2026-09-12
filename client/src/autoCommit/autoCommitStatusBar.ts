/**
 * The always-on display that says whether auto-commit is on (issue #254).
 *
 * Auto-commit changes what every other action MEANS — with it armed, Abort stops being a
 * way back — so the one thing this feature must never do is be on, or off, without the
 * user knowing. That rules out a state you have to open a menu to read. It lives in the
 * status bar rather than on the Explorer's button row for the same reason: the Explorer
 * pane can be collapsed, hidden, or in another view container, and the status bar cannot.
 *
 * Three states, each with its own colour, following the same reading Jadeite's
 * Auto Commit button has always had:
 *
 *   off     plain, quiet — the default, and nothing surprising is happening;
 *   on      the WARNING background, because it is the state that changes the rules;
 *   failed  the ERROR background — auto-commit is armed and NOT committing, which is
 *           the one state where the user could lose work while believing they cannot.
 *
 * It shows the SELECTED session, because that is the session the toolbar's Commit and
 * Abort act on, and follows the selection. The per-session truth is on each session's row
 * in the Logins view — see `loginTreeProvider`.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import { AutoCommitStatus, getAutoCommitStatus, onAutoCommitChanged } from './autoCommitState';

export const AUTO_COMMIT_STATUS_COMMAND = 'gemstone.autoCommit.statusBarClicked';

/** The status-bar face of each state: text, tooltip and background. */
export function autoCommitStatusBarFace(
  status: AutoCommitStatus,
  sessionId: number,
): { text: string; tooltip: string; background?: string } {
  switch (status) {
    case 'on':
      return {
        text: '$(sync) Auto-Commit: On',
        tooltip:
          `Session ${sessionId}: every change is committed as soon as it is made.\n\n` +
          'Abort will not take those changes back — they are already in the repository. ' +
          'Undo still works: it reverses a change by making the opposite one.\n\n' +
          'Click to turn auto-commit off for this session.',
        background: 'statusBarItem.warningBackground',
      };
    case 'failed':
      return {
        text: '$(error) Auto-Commit: FAILED',
        tooltip:
          `Session ${sessionId}: auto-commit tried to commit and could not — almost always a ` +
          'conflict with another session.\n\n' +
          'Your changes are NOT in the repository, and auto-commit has stopped trying so it ' +
          'does not fail on every keystroke.\n\n' +
          'Click for the ways out: abort, see the conflicts, or turn auto-commit off.',
        background: 'statusBarItem.errorBackground',
      };
    default:
      return {
        text: '$(circle-slash) Auto-Commit: Off',
        tooltip:
          `Session ${sessionId}: changes stay in this session's transaction until you commit.\n\n` +
          'Click to turn auto-commit on — every change from then on is committed as it is made.',
      };
  }
}

/**
 * Put the indicator in the status bar and keep it in step with the selected session.
 *
 * Hidden when there is no session at all: there is nothing for auto-commit to be on or
 * off FOR, and an indicator over no session would be the first thing to mislead.
 */
export function registerAutoCommitStatusBar(
  context: vscode.ExtensionContext,
  sessionManager: SessionManager,
): void {
  // Priority just under Commit/Abort's neighbourhood on the right, so the reading of the
  // transaction's state sits together rather than scattered across the bar.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = AUTO_COMMIT_STATUS_COMMAND;

  const refresh = (): void => {
    const session = sessionManager.getSelectedSession();
    if (!session) {
      item.hide();
      return;
    }
    const face = autoCommitStatusBarFace(getAutoCommitStatus(session.id), session.id);
    item.text = face.text;
    item.tooltip = face.tooltip;
    item.backgroundColor = face.background ? new vscode.ThemeColor(face.background) : undefined;
    item.show();
  };
  refresh();

  context.subscriptions.push(
    item,
    onAutoCommitChanged(refresh),
    sessionManager.onDidChangeSelection(refresh),
    sessionManager.onDidAddSession(refresh),
    sessionManager.onDidRemoveSession(refresh),
  );
}
