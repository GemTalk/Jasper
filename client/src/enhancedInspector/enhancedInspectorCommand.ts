/**
 * Server-side install driver for Enhanced Inspector support.
 *
 * The payload installs persistent classes (into the dedicated
 * `GsEnhancedInspector` dictionary) plus extension methods on kernel classes,
 * which requires write access to those kernel classes — i.e. SystemUser. The user is normally logged in as DataCurator, so
 * this opens a short-lived, unregistered SystemUser session on the same
 * connection, runs the install over it, commits, logs it out, and then offers to
 * refresh the working session so the new code becomes visible.
 *
 * The entry point is `installEnhancedInspectorFeature`, called by the unified
 * optional-support offer (optionalSupportOffer.ts) as one leg of the bundle
 * install. The Enhanced Inspector feature itself (views, availability latch,
 * payload) lives elsewhere and is unaffected. The SystemUser-session helpers
 * already come from serverPlugin/systemUserAuth.ts, shared with
 * refactoringInstallCommand.ts.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession, SessionManager } from '../sessionManager';
import { refreshEnhancedInspectorAvailable } from './enhancedInspectorAvailability';
import {
  installEnhancedInspectorSupport,
  isEnhancedInspectorInstalled,
  ENHANCED_INSPECTOR_FILES,
} from './enhancedInspectorInstall';
import {
  obtainSystemUserSession,
  refreshWorkingSessionAfterInstall,
} from '../serverPlugin/systemUserAuth';
import { pluginFeatures } from '../serverPlugin/pluginFeatures';

// Payload location relative to the extension root, from the shared feature
// registry (the single source of truth). `resources/` ships in the packaged
// VSIX (unlike `docs/`, which is .vscodeignore'd), so the same path resolves in
// both the F5 dev host and an installed extension.
const PAYLOAD_SUBDIR = pluginFeatures.enhancedInspector.payloadSubdir;

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
): Promise<boolean> {
  const payloadDir = path.join(extensionPath, PAYLOAD_SUBDIR);
  const missing = ENHANCED_INSPECTOR_FILES.filter((f) => !fs.existsSync(path.join(payloadDir, f)));
  if (missing.length > 0) {
    vscode.window.showErrorMessage(
      `Enhanced inspector payload not found in ${payloadDir} (missing: ${missing.join(', ')}).`,
    );
    return false;
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
    return false;
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
    return false;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(
    base,
    sessionManager,
    'Enhanced inspector installed.',
  );
  if (refreshed) refreshEnhancedInspectorAvailable(base);
  // Report the verified server-side result, not the refresh latch: a deferred ("Later") refresh
  // leaves `enhancedInspectorAvailable` stale, and keying the answer on it would suppress the
  // success toast for a completed install. The latch still governs whether THIS session sees it.
  return true;
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
  // See performInstall / the uninstall note: return whether the change LANDED ON THE STONE (its
  // verified server-side result), not whether this session's latch has caught up — otherwise a
  // deferred ("Later") refresh would suppress the success toast for a completed install.
  return performInstall(base, sessionManager, extensionPath, interactive);
}
