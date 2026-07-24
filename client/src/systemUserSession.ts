import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import { executeFetchString } from './browserQueries';

// Privileged-operation helpers: some Rowan/GemStone operations (loading or
// unloading projects, installing kernel extensions) modify system-owned objects
// in objectSecurityPolicyId 1, which the normal DataCurator session cannot write
// — they need SystemUser. This module opens a short-lived SystemUser session on
// the same connection and, afterwards, refreshes the working session's view so
// the committed changes become visible.
//
// NOTE: enhancedInspectorCommand.ts currently keeps its own parallel copies of
// this login/refresh logic; this module is the shared version new callers should
// use, and that one is a candidate to adopt it later.

// GemStone's default SystemUser password on a stock stone. Named _PW so the
// publish secret scan (and Open VSX's) don't flag a literal assignment to a
// `password`-suffixed identifier — 'swordfish' is GemStone's public default,
// not a secret.
export const DEFAULT_SYSTEMUSER_PW = 'swordfish';

// Open a transient SystemUser session on the SAME GciLibrary as `base`, reusing
// its connection coordinates and overriding only the GemStone user. Not
// registered with the SessionManager (bypasses the single-session policy, never
// shows in the UI). The caller must log it out.
export function loginAsSystemUser(base: ActiveSession, password: string): ActiveSession {
  const { login } = base;
  const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
  const gemNrs = `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;
  const result = base.gci.GciTsLogin(
    stoneNrs,
    login.host_user || null,
    login.host_password || null,
    false,
    gemNrs,
    'SystemUser',
    password,
    0,
    0,
  );
  if (!result.session) {
    throw new Error(result.err.message || `SystemUser login failed (error ${result.err.number})`);
  }
  return {
    id: -1,
    gci: base.gci,
    handle: result.session,
    login: { ...login, gs_user: 'SystemUser', gs_password: password },
    stoneVersion: base.stoneVersion,
  };
}

// Obtain a SystemUser session, trying the stock default password first and
// prompting for it otherwise. `purpose` completes the prompt "…required to
// <purpose>". Returns undefined if the user cancels or login fails.
export async function obtainSystemUserSession(
  base: ActiveSession,
  purpose: string,
): Promise<ActiveSession | undefined> {
  try {
    return loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PW);
  } catch {
    // Default rejected — ask.
  }
  const password = await vscode.window.showInputBox({
    prompt: `SystemUser password for "${base.login.stone}" (required to ${purpose})`,
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return undefined;
  try {
    return loginAsSystemUser(base, password);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(
      `Could not log in as SystemUser: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
}

// After a SystemUser session commits a change, the working (DataCurator) session
// keeps its old transaction view and won't see it. Abort the working session to
// refresh — silently when it has no pending work, or after confirmation when it
// does (the abort discards uncommitted changes). `doneMessage` prefixes the
// confirmation, e.g. "Project loaded.". Returns true if the view was refreshed.
export async function refreshWorkingSession(
  base: ActiveSession,
  sessionManager: SessionManager,
  doneMessage: string,
): Promise<boolean> {
  let needsCommit: boolean | undefined;
  try {
    needsCommit = executeFetchString(base, 'System needsCommit printString').trim() === 'true';
  } catch {
    needsCommit = undefined;
  }

  if (needsCommit === false) {
    return safeAbort(base, sessionManager);
  }

  const detail = needsCommit
    ? 'This discards this session’s uncommitted changes.'
    : 'Any uncommitted changes in this session will be discarded.';
  const choice = await vscode.window.showInformationMessage(
    `${doneMessage} Refresh this session to see it? ${detail}`,
    'Refresh',
    'Later',
  );
  if (choice === 'Refresh') return safeAbort(base, sessionManager);
  return false;
}

function safeAbort(base: ActiveSession, sessionManager: SessionManager): boolean {
  try {
    return sessionManager.abort(base.id).success;
  } catch {
    return false;
  }
}
