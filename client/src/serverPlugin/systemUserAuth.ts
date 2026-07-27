/**
 * Interactive SystemUser elevation shared by the two install command drivers
 * (`refactoringInstallCommand.ts`, `enhancedInspectorCommand.ts`). Separate
 * from `installHelpers.ts` because it needs `vscode` (the password prompt),
 * while `installHelpers.ts` stays free of it so the CI provisioning script
 * (`install-server-plugin.mjs`, which runs outside the extension host) can
 * import `loginAsSystemUser` without dragging `vscode` in.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
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
