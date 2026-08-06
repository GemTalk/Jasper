/**
 * Server-side uninstall driver for the Jasper refactoring engine — the
 * counterpart to `refactoringInstallCommand.ts`.
 *
 * Removing the engine edits the shared `GsRefactoring` dictionary out of every
 * user's symbol list and removes kernel-class compat backports, which requires
 * write access to those kernel classes — i.e. SystemUser. The user is normally
 * logged in as DataCurator, so this opens a short-lived, unregistered SystemUser
 * session on the same connection, runs the removal over it, logs it out, and
 * then refreshes the working session so the engine disappears from its view and
 * the `rbSupportAvailable` latch re-probes to false.
 *
 * The entry point is `uninstallRefactoringFeature`, called by the unified
 * optional-support offer (optionalSupportOffer.ts) as one leg of the bundle
 * uninstall. The SystemUser-session helpers come from
 * serverPlugin/systemUserAuth.ts, shared with the install drivers.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../sessionManager';
import { refreshRefactoringSupportAvailable } from './refactoringAvailability';
import { uninstallRefactoringSupport } from './refactoringUninstall';
import {
  obtainSystemUserSession,
  refreshWorkingSessionAfterInstall,
} from '../serverPlugin/systemUserAuth';

/**
 * Remove the refactoring engine from the stone reached by `base`, over a
 * transient SystemUser session on the same connection. The removal commits and
 * verifies on the server side; this module is the VS Code plumbing (obtain a
 * SystemUser session, show progress, relatch `rbSupportAvailable`).
 *
 * When `interactive` is false, a missing SystemUser default password is reported
 * as a non-blocking notification rather than a password prompt.
 *
 * Returns true when the engine is gone afterward.
 */
async function performUninstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  interactive: boolean,
): Promise<boolean> {
  const sys = await obtainSystemUserSession(base, interactive, 'the refactoring engine');
  if (!sys) {
    if (!interactive) {
      vscode.window.showWarningMessage(
        'The refactoring engine was not auto-uninstalled: the SystemUser default password was ' +
          'not accepted. Run "GemStone: Uninstall Server Support" to remove it.',
      );
    }
    return false;
  }

  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Uninstalling the refactoring engine…',
        cancellable: false,
      },
      async (progress) =>
        uninstallRefactoringSupport(sys, (message, increment) =>
          progress.report({ message, increment }),
        ),
    );
  } finally {
    try {
      base.gci.GciTsLogout(sys.handle);
    } catch {
      // The transient session is being discarded regardless.
    }
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Refactoring engine uninstall failed: ${result.message}`);
    return false;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(
    base,
    sessionManager,
    'Refactoring engine uninstalled.',
  );
  if (refreshed) {
    refreshRefactoringSupportAvailable(base);
    void vscode.commands.executeCommand(
      'setContext',
      'gemstone.rbSupportAvailable',
      base.rbSupportAvailable === true,
    );
  }
  return base.rbSupportAvailable !== true;
}

/**
 * Uninstall the refactoring engine once. `interactive` = may prompt for the
 * SystemUser password if the default is rejected; non-interactive = silent,
 * warning if the default is unavailable. Returns whether the engine is gone
 * afterward. Called by the unified optional-support bundle uninstall.
 */
export function uninstallRefactoringFeature(
  base: ActiveSession,
  sessionManager: SessionManager,
  interactive: boolean,
): Promise<boolean> {
  return performUninstall(base, sessionManager, interactive);
}
