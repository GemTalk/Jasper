// The `gemstone.showSessionConfiguration` command: open (or reveal) the Session
// Configuration panel for the session the user asked about.
//
// Configuration is per session, so the command is registered on session rows
// only — a session row names exactly one session, by an id the session manager
// hands out and never reuses. A login row is deliberately not a source: it is
// the parent of its session rows, so it names no one session, and the panel
// reads and *writes* configuration over whichever session it is given.
//
// A caller with no tree row can name the session by id instead.
//
// With no row and no id at all (the Command Palette) it falls back to the
// session the rest of Jasper is working with.

import * as vscode from 'vscode';

import { GemStoneSessionItem } from '../loginTreeProvider';
import { ActiveSession, SessionManager } from '../sessionManager';
import { SysadminStorage } from '../sysadminStorage';
import { ConfigurationPanel } from './configurationPanel';

export interface ShowConfigurationDeps {
  sessionManager: SessionManager;
  /** Locates a version's product tree, for the parameter descriptions. */
  sysadminStorage: SysadminStorage;
}

export async function showConfigurationCommand(
  deps: ShowConfigurationDeps,
  item?: GemStoneSessionItem | { sessionId: number },
): Promise<void> {
  const { sessionManager } = deps;
  let session: ActiveSession | undefined;

  if (item && !(item instanceof GemStoneSessionItem) && typeof item.sessionId === 'number') {
    // A caller that is not a tree row — the Databases & Versions panel names the
    // session it means by id, because it has no tree item to hand over. Resolved
    // the same way as a row's: by id, so a session that has since gone answers
    // nothing rather than opening a panel onto a dead connection.
    session = sessionManager.getSession(item.sessionId);
  } else if (item instanceof GemStoneSessionItem) {
    // Resolved by id rather than taken from the row: a tree item outlives the
    // session it was built from, so a row left over from a logged-out session
    // must not open a panel onto a dead connection.
    session = sessionManager.getSession(item.activeSession.id);
  } else {
    session = await sessionManager.resolveSession();
    // resolveSession has already reported why (no sessions are active, or its
    // picker was dismissed) — saying it again would double the message.
    if (!session) return;
  }

  if (!session) {
    vscode.window.showInformationMessage('Log in to a GemStone session to view its configuration.');
    return;
  }
  ConfigurationPanel.show({ sessionManager, storage: deps.sysadminStorage }, session.id);
}
