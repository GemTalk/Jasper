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

/**
 * Which session the user meant, for a command contributed both on a session row
 * and in the Command Palette.
 *
 * A row names one session, but by id rather than by the `ActiveSession` hanging
 * off the tree item: a tree item outlives the session it was built from, so a row
 * left over from a logged-out session would otherwise act over a dead handle —
 * the GCI call fails, and the user meets a warning modal followed by "Session not
 * found". Same rule `showConfigurationCommand` writes down, and the same one the
 * Databases & Versions panel applies on its side.
 *
 * The palette names no session, so it acts in the current one. While anything is
 * logged in there is always a current session, so the only way to arrive there
 * empty is with nothing logged in at all — which the palette's
 * `gemstone.hasActiveSession` clause already withholds these commands for.
 *
 * `fromRow` is what the caller needs to decide whether to put the session in a
 * modal first: a row already showed which session this is, the palette did not.
 * Callers supply their own wording for the two misses, because a message that
 * names the action ("nothing to abort") reads better than a generic one.
 */
export function resolveCommandSession(
  sessionManager: Pick<SessionManager, 'getSession' | 'getSelectedSession'>,
  item: GemStoneSessionItem | undefined,
  messages: { gone: (id: number) => string; none: string },
): { session: ActiveSession; fromRow: boolean } | undefined {
  if (item) {
    const session = sessionManager.getSession(item.activeSession.id);
    if (!session) {
      vscode.window.showErrorMessage(messages.gone(item.activeSession.id));
      return undefined;
    }
    return { session, fromRow: true };
  }
  const session = sessionManager.getSelectedSession();
  if (!session) {
    vscode.window.showErrorMessage(messages.none);
    return undefined;
  }
  return { session, fromRow: false };
}

export async function sessionTransactionCommand(
  deps: SessionTransactionDeps,
  action: SessionTransaction,
  item?: GemStoneSessionItem,
): Promise<void> {
  const { sessionManager } = deps;
  const run = action === 'Commit' ? deps.commit : deps.abort;

  const resolved = resolveCommandSession(sessionManager, item, {
    gone: (id) =>
      `Session ${id} is no longer logged in, so there is nothing to ${action.toLowerCase()}.`,
    none: `No active GemStone session to ${action.toLowerCase()}.`,
  });
  if (!resolved) return;
  // `ask` puts the session in a modal first, and only the palette needs it: a row
  // already showed which session this is, so only a warning (uncommitted work,
  // unsaved editors) can raise a modal from there. The palette shows nothing
  // about which session is current, and "whichever one is current" is how work
  // lands in the wrong stone.
  return run(resolved.session, { ask: !resolved.fromRow });
}
