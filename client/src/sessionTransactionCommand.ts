// The `gemstone.sessionCommit` / `gemstone.sessionAbort` commands: commit or
// abort the session the user asked about.
//
// Both are contributed twice over — an inline icon on a session row in Logins &
// Sessions, and an entry in the Command Palette — and the two differ only in
// where the session comes from. A row names one session by where the click
// landed. The palette names none, so it acts in the current session and says
// which one that is before anything is committed or discarded: "whichever
// session is current" is how work lands in the wrong stone, and the palette
// shows nothing about which one that is.
//
// Extracted from extension.ts rather than written inline for the reason
// `configuration/showConfigurationCommand.ts` was: there is no activation
// harness in this repo, so a handler that lives inside `activate()` can only be
// pinned by its type. This dispatch — the exact thing
// https://github.com/GemTalk/Jasper/issues/455 was about — is testable here with
// plain fakes, and one function serves both commands instead of two that have to
// be kept in step by eye.

import * as vscode from 'vscode';

import { GemStoneSessionItem } from './loginTreeProvider';
import { ActiveSession, SessionManager } from './sessionManager';

export type SessionTransaction = 'Commit' | 'Abort';

export interface SessionTransactionDeps {
  sessionManager: Pick<SessionManager, 'getSession' | 'getSelectedSession'>;
  /** Commit the session. `ask` puts the session in a modal first. */
  commit: (session: ActiveSession, options?: { ask?: boolean }) => Promise<void>;
  /** Abort the session, under the same contract. */
  abort: (session: ActiveSession, options?: { ask?: boolean }) => Promise<void>;
}

export async function sessionTransactionCommand(
  deps: SessionTransactionDeps,
  action: SessionTransaction,
  item?: GemStoneSessionItem,
): Promise<void> {
  const { sessionManager } = deps;
  const run = action === 'Commit' ? deps.commit : deps.abort;

  if (item) {
    // Resolved by id rather than taken from the row: a tree item outlives the
    // session it was built from, so a row left over from a logged-out session
    // would otherwise commit or abort over a dead handle — the GCI call fails,
    // and the user meets a "may discard uncommitted changes" modal followed by
    // "Session not found". Same rule `showConfigurationCommand` writes down, and
    // the same one the Databases & Versions panel already applies on its side.
    const session = sessionManager.getSession(item.activeSession.id);
    if (!session) {
      vscode.window.showErrorMessage(
        `Session ${item.activeSession.id} is no longer logged in, so there is nothing to ` +
          `${action.toLowerCase()}.`,
      );
      return;
    }
    // The row named the session, so there is nothing to tell the user about
    // which one this is; only a warning (uncommitted work, unsaved editors) can
    // raise a modal from here.
    return run(session, { ask: false });
  }

  // The current session, with no picker behind it. While any session is logged
  // in there is always a current one — login selects the first, and logging out
  // of the current session hands the selection to the one worked in before it — so
  // the only way to arrive here empty is with nothing logged in at all, which
  // the palette's `gemstone.hasActiveSession` clause already withholds these
  // commands for. (`resolveSession` would put up a QuickPick in the middle of a
  // Commit; there is no state left where that question has an answer the current
  // session does not already give.)
  const session = sessionManager.getSelectedSession();
  if (!session) {
    vscode.window.showErrorMessage(`No active GemStone session to ${action.toLowerCase()}.`);
    return;
  }
  // `ask` puts the session in a modal first: the palette shows nothing about
  // which session is current, and "whichever one is current" is how work lands
  // in the wrong stone.
  return run(session, { ask: true });
}
