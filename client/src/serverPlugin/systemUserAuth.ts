/**
 * Interactive SystemUser elevation shared by the two install command drivers
 * (`refactoringInstallCommand.ts`, `enhancedInspectorCommand.ts`). Separate
 * from `installHelpers.ts` because it needs `vscode` (the password prompt),
 * while `installHelpers.ts` stays free of it so the CI provisioning script
 * (`install-server-plugin.mjs`, which runs outside the extension host) can
 * import `loginAsSystemUser` without dragging `vscode` in.
 *
 * Also owns `refreshWorkingSessionAfterInstall`, the post-install working
 * session refresh shared by the same two callers, for the same vscode-needing
 * reason (it shows the confirmation prompt via
 * `vscode.window.showInformationMessage`).
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../sessionManager';
import { sessionNeedsCommit } from '../browserQueries';
import { DEFAULT_SYSTEMUSER_PW, loginAsSystemUser, messageOf } from './installHelpers';

/**
 * Obtain a SystemUser session on `base`'s connection. Tries the stock default
 * password first. When `interactive` is false (the auto-install path), a
 * rejected default is a silent miss — the caller decides how to surface it —
 * rather than a password prompt the user never asked for.
 *
 * @param featureLabel  human-readable feature name, used only in the prompt
 *                       text (e.g. "the refactoring engine").
 */
export async function obtainSystemUserSession(
  base: ActiveSession,
  interactive: boolean,
  featureLabel: string,
): Promise<ActiveSession | undefined> {
  try {
    return loginAsSystemUser(base, DEFAULT_SYSTEMUSER_PW);
  } catch {
    // Default password rejected — fall through and ask for it.
  }
  if (!interactive) return undefined;
  const password = await vscode.window.showInputBox({
    prompt: `SystemUser password for "${base.login.stone}" (required to install ${featureLabel})`,
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return undefined; // user cancelled
  try {
    return loginAsSystemUser(base, password);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(`Could not log in as SystemUser: ${messageOf(e)}`);
    return undefined;
  }
}

/**
 * The working session won't see the newly-committed classes until its view is
 * refreshed (an abort). When it has no uncommitted work — always the case right
 * after a login — refresh silently. Only when there ARE uncommitted changes do
 * we ask first, since the abort would discard them.
 *
 * @param doneMessage  lead sentence of the confirmation prompt, naming what was
 *                       just installed (e.g. "Refactoring engine installed.").
 */
export async function refreshWorkingSessionAfterInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  doneMessage: string,
): Promise<boolean> {
  const needsCommit = sessionNeedsCommit(base);
  if (needsCommit === false) {
    return safeAbortWorkingSession(base, sessionManager);
  }
  const detail = needsCommit
    ? 'This discards this session’s uncommitted changes.'
    : 'Any uncommitted changes in this session will be discarded.';
  const choice = await vscode.window.showInformationMessage(
    `${doneMessage} Refresh this session to load it? ${detail}`,
    'Refresh',
    'Later',
  );
  if (choice === 'Refresh') {
    return safeAbortWorkingSession(base, sessionManager);
  }
  return false;
}

/** Abort (refresh) the working session, tolerating a session that was logged out
 *  while the install ran. Returns true only when the view was actually refreshed. */
function safeAbortWorkingSession(base: ActiveSession, sessionManager: SessionManager): boolean {
  try {
    return sessionManager.abort(base.id).success;
  } catch {
    return false;
  }
}
