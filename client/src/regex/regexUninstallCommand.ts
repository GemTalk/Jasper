/**
 * Uninstall driver for the server plugin's regex support, the counterpart to
 * `regexInstallCommand.ts`: a short-lived SystemUser session, progress, then a
 * refresh of the working session so the support disappears from its view.
 * Mirrors `refactoringUninstallCommand.ts`.
 *
 * The entry point, `uninstallRegexFeature`, is one leg of the bundle uninstall in
 * optionalSupportOffer.ts.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager, logOutOrFindGone } from '../sessionManager';
import { refreshRegexSupportAvailable } from './regexAvailability';
import { uninstallRegexSupport } from './regexUninstall';
import {
  obtainSystemUserSession,
  refreshWorkingSessionAfterInstall,
} from '../serverPlugin/systemUserAuth';

async function performUninstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  interactive: boolean,
): Promise<boolean> {
  const sys = await obtainSystemUserSession(base, interactive, 'regex support');
  if (!sys) {
    if (!interactive) {
      vscode.window.showWarningMessage(
        'Regex support was not auto-uninstalled: the SystemUser default password was not ' +
          'accepted. Run "GemStone: Uninstall Server Support" to remove it.',
      );
    }
    return false;
  }

  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Uninstalling regex support…',
        cancellable: false,
      },
      async (progress) =>
        await uninstallRegexSupport(sys, (message, increment) =>
          progress.report({ message, increment }),
        ),
    );
  } finally {
    logOutOrFindGone(sys);
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Regex support uninstall failed: ${result.message}`);
    return false;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(
    base,
    sessionManager,
    'Regex support uninstalled.',
  );
  if (refreshed) refreshRegexSupportAvailable(base);
  // True because the removal landed on the stone; see refactoringUninstallCommand.ts.
  return true;
}

/**
 * Uninstall the regex support once. `interactive` = may prompt for the SystemUser
 * password if the default is rejected. Returns whether it is gone.
 */
export function uninstallRegexFeature(
  base: ActiveSession,
  sessionManager: SessionManager,
  interactive: boolean,
): Promise<boolean> {
  return performUninstall(base, sessionManager, interactive);
}
