/**
 * Server-side uninstall driver for Enhanced Inspector support — the counterpart
 * to `enhancedInspectorCommand.ts`.
 *
 * Removing the support drops the dedicated `GsEnhancedInspector` dictionary from
 * every user's symbol list and removes GToolkit extension methods from kernel
 * classes, which requires write access to those kernel classes — i.e.
 * SystemUser. The user is normally logged in as DataCurator, so this opens a
 * short-lived, unregistered SystemUser session on the same connection, runs the
 * removal over it, logs it out, and then refreshes the working session so the
 * support disappears from its view and the `enhancedInspectorAvailable` latch
 * re-probes to false (inspector routing falls back to the classic view).
 *
 * The entry point is `uninstallEnhancedInspectorFeature`, called by the unified
 * optional-support offer (optionalSupportOffer.ts) as one leg of the bundle
 * uninstall. The SystemUser-session helpers come from
 * serverPlugin/systemUserAuth.ts, shared with the install drivers.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../sessionManager';
import { refreshEnhancedInspectorAvailable } from './enhancedInspectorAvailability';
import { uninstallEnhancedInspectorSupport } from './enhancedInspectorUninstall';
import {
  obtainSystemUserSession,
  refreshWorkingSessionAfterInstall,
} from '../serverPlugin/systemUserAuth';

/**
 * Remove Enhanced Inspector support from the stone reached by `base`, over a
 * transient SystemUser session on the same connection. The removal commits and
 * verifies on the server side; this module is the VS Code plumbing (obtain a
 * SystemUser session, show progress, relatch `enhancedInspectorAvailable`).
 *
 * When `interactive` is false, a missing SystemUser default password is reported
 * as a non-blocking notification rather than a password prompt.
 */
async function performUninstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  interactive: boolean,
): Promise<boolean> {
  const sys = await obtainSystemUserSession(base, interactive, 'enhanced inspector support');
  if (!sys) {
    if (!interactive) {
      vscode.window.showWarningMessage(
        'Enhanced inspector support was not auto-uninstalled: the SystemUser default password was ' +
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
        title: 'Uninstalling enhanced inspector support…',
        cancellable: false,
      },
      async (progress) =>
        uninstallEnhancedInspectorSupport(sys, (message, increment) =>
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
    vscode.window.showErrorMessage(`Enhanced inspector uninstall failed: ${result.message}`);
    return false;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(
    base,
    sessionManager,
    'Enhanced inspector uninstalled.',
  );
  if (refreshed) refreshEnhancedInspectorAvailable(base);
  // See the note in refactoringUninstallCommand: the answer is "did the stone change", which the
  // verified `result.success` above already establishes. The refresh latch only governs whether
  // THIS session has noticed yet, which is a different question and must not suppress the toast.
  return true;
}

/**
 * Uninstall Enhanced Inspector support once. `interactive` = may prompt for the
 * SystemUser password if the default is rejected; non-interactive = silent,
 * warning if the default is unavailable. Returns whether the support is gone
 * afterward. Called by the unified optional-support bundle uninstall.
 */
export function uninstallEnhancedInspectorFeature(
  base: ActiveSession,
  sessionManager: SessionManager,
  interactive: boolean,
): Promise<boolean> {
  return performUninstall(base, sessionManager, interactive);
}
