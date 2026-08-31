// The `gemstone.showSessionConfiguration` command: open (or reveal) the Session
// Configuration panel for the session the user asked about.
//
// Configuration is per session, so the command is registered on session rows
// only — a session row names exactly one session, by an id the session manager
// hands out and never reuses. A login row is deliberately not a source: it is
// the parent of its session rows, so it names no one session, and the panel
// reads and *writes* configuration over whichever session it is given.
//
// With no row at all (the Command Palette) it falls back to the session the
// rest of Jasper is working with.

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
  item?: GemStoneSessionItem,
): Promise<void> {
  const { sessionManager } = deps;
  let session: ActiveSession | undefined;

  if (item instanceof GemStoneSessionItem) {
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
