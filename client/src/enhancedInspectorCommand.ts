/**
 * Server-side install driver for Enhanced Inspector support.
 *
 * The payload installs persistent classes (into Published) plus extension
 * methods on kernel classes, which requires write access to those kernel
 * classes — i.e. SystemUser. The user is normally logged in as DataCurator, so
 * this opens a short-lived, unregistered SystemUser session on the same
 * connection, runs the install over it, commits, logs it out, and then offers to
 * refresh the working session so the new code becomes visible.
 *
 * The entry point is `installEnhancedInspectorFeature`, called by the unified
 * optional-support offer (optionalSupportOffer.ts) as one leg of the bundle
 * install. The Enhanced Inspector feature itself (views, availability latch,
 * payload) lives elsewhere and is unaffected. The SystemUser-session helpers
 * are shared with refactoringInstallCommand.ts via
 * serverPlugin/systemUserAuth.ts.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession, SessionManager } from './sessionManager';
import { sessionNeedsCommit } from './browserQueries';
import { refreshEnhancedInspectorAvailable } from './enhancedInspectorAvailability';
import {
  installEnhancedInspectorSupport,
  isEnhancedInspectorInstalled,
  ENHANCED_INSPECTOR_FILES,
} from './enhancedInspectorInstall';
import { obtainSystemUserSession } from './serverPlugin/systemUserAuth';

// Payload location relative to the extension root. `resources/` ships in the
// packaged VSIX (unlike `docs/`, which is .vscodeignore'd), so the same path
// resolves in both the F5 dev host and an installed extension.
const PAYLOAD_SUBDIR = path.join('resources', 'enhancedInspector');

/**
 * The working session won't see the newly-committed classes until its view is
 * refreshed (an abort). When the session has no uncommitted work — always the
 * case right after a login, which is when the offer fires — there is nothing to
 * lose, so refresh silently. Only when there ARE uncommitted changes do we ask
 * first, since the abort would discard them.
 */
async function refreshWorkingSessionAfterInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
): Promise<boolean> {
  const needsCommit = sessionNeedsCommit(base);

  if (needsCommit === false) {
    return safeAbortWorkingSession(base, sessionManager);
  }

  const detail = needsCommit
    ? 'This discards this session’s uncommitted changes.'
    : 'Any uncommitted changes in this session will be discarded.';
  const choice = await vscode.window.showInformationMessage(
    `Enhanced inspector installed. Refresh this session to load it? ${detail}`,
    'Refresh',
    'Later',
  );
  if (choice === 'Refresh') {
    return safeAbortWorkingSession(base, sessionManager);
  }
  return false;
}

/**
 * Abort (refresh) the working session, tolerating a session that was logged out
 * while the install ran (the progress notification is non-modal). Returns true
 * only when the view was actually refreshed, so the caller relatches
 * `enhancedInspectorAvailable` only on a real refresh.
 */
function safeAbortWorkingSession(base: ActiveSession, sessionManager: SessionManager): boolean {
  try {
    return sessionManager.abort(base.id).success;
  } catch {
    // The session is gone (sessionManager.abort throws for an unknown id) — there
    // is nothing to refresh, and nothing to fail over.
    return false;
  }
}

/**
 * Install (or reinstall) Enhanced Inspector support into the stone reached by
 * `base`, over a transient SystemUser session on the same connection. Always
 * re-files-in — presence is not a gate.
 *
 * When `interactive` is false (the auto-install path), a missing SystemUser
 * default password is reported as a non-blocking notification rather than a
 * password prompt.
 */
async function performInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
): Promise<void> {
  const payloadDir = path.join(extensionPath, PAYLOAD_SUBDIR);
  const missing = ENHANCED_INSPECTOR_FILES.filter((f) => !fs.existsSync(path.join(payloadDir, f)));
  if (missing.length > 0) {
    vscode.window.showErrorMessage(
      `Enhanced inspector payload not found in ${payloadDir} (missing: ${missing.join(', ')}).`,
    );
    return;
  }

  const reinstall = isEnhancedInspectorInstalled(base);

  const sys = await obtainSystemUserSession(base, interactive, 'enhanced inspector support');
  if (!sys) {
    // Interactive: the user cancelled or the failure was already reported.
    // Auto: the default password was not accepted — explain how to proceed
    // manually rather than failing silently.
    if (!interactive) {
      vscode.window.showWarningMessage(
        'Enhanced inspector support was not auto-installed: the SystemUser default password was ' +
          'not accepted. Run "GemStone: Install Server Support" to install it.',
      );
    }
    return;
  }

  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: reinstall
          ? 'Reinstalling enhanced inspector support…'
          : 'Installing enhanced inspector support…',
        cancellable: false,
      },
      async (progress) =>
        installEnhancedInspectorSupport(sys, payloadDir, (message, increment) =>
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
    vscode.window.showErrorMessage(`Enhanced inspector install failed: ${result.message}`);
    return;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(base, sessionManager);
  if (refreshed) refreshEnhancedInspectorAvailable(base);
}

/**
 * Install (or reinstall) Enhanced Inspector support once. `interactive` = may
 * prompt for the SystemUser password if the default is rejected; non-interactive
 * = silent, warning if the default is unavailable. Returns whether the support is
 * available afterward. Called by the unified optional-support bundle offer.
 */
export async function installEnhancedInspectorFeature(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
): Promise<boolean> {
  await performInstall(base, sessionManager, extensionPath, interactive);
  return base.enhancedInspectorAvailable === true;
}
