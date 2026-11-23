/**
 * Install driver for the server plugin's regex support: the VS Code plumbing
 * around `regexInstall.ts`. It opens a short-lived SystemUser session on the same
 * connection, runs the install over it with progress, logs it out, shows the
 * loader's report, and offers to refresh the working session so the new classes
 * become visible. Mirrors `refactoringInstallCommand.ts`.
 *
 * The entry point, `installRegexFeature`, is one leg of the bundle install in
 * optionalSupportOffer.ts.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ActiveSession, SessionManager, logOutOrFindGone } from '../sessionManager';
import { refreshRegexSupportAvailable } from './regexAvailability';
import { installRegexSupport, isRegexSupportInstalled } from './regexInstall';
import { REGEX_PAYLOAD_FILES } from './regexPayload';
import {
  obtainSystemUserSession,
  refreshWorkingSessionAfterInstall,
} from '../serverPlugin/systemUserAuth';
import { pluginFeatures } from '../serverPlugin/pluginFeatures';

let reportChannel: vscode.OutputChannel | undefined;
function getReportChannel(): vscode.OutputChannel {
  if (!reportChannel) reportChannel = vscode.window.createOutputChannel('GemStone Regex Support');
  return reportChannel;
}

async function performInstall(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
): Promise<boolean> {
  const payloadDir = path.join(extensionPath, pluginFeatures.regex.payloadSubdir);
  const missing = REGEX_PAYLOAD_FILES.filter((f) => !fs.existsSync(path.join(payloadDir, f)));
  if (missing.length > 0) {
    vscode.window.showErrorMessage(
      `Regex support payload not found in ${payloadDir} (missing: ${missing.join(', ')}).`,
    );
    return false;
  }

  const reinstall = isRegexSupportInstalled(base);

  const sys = await obtainSystemUserSession(base, interactive, 'regex support');
  if (!sys) {
    if (!interactive) {
      vscode.window.showWarningMessage(
        'Regex support was not auto-installed: the SystemUser default password was not ' +
          'accepted. Run "GemStone: Install Server Support" to install it.',
      );
    }
    return false;
  }

  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: reinstall ? 'Reinstalling regex support…' : 'Installing regex support…',
        cancellable: false,
      },
      async (progress) =>
        await installRegexSupport(sys, payloadDir, (message, increment) =>
          progress.report({ message, increment }),
        ),
    );
  } finally {
    logOutOrFindGone(sys);
  }

  if (result.report) {
    const channel = getReportChannel();
    channel.appendLine(result.report);
    if (!result.success) channel.show(true);
  }

  if (!result.success) {
    vscode.window.showErrorMessage(`Regex support install failed: ${result.message}`);
    return false;
  }

  const refreshed = await refreshWorkingSessionAfterInstall(
    base,
    sessionManager,
    'Regex support installed.',
  );
  if (refreshed) refreshRegexSupportAvailable(base);
  // True because the install landed on the stone, whether or not this session has
  // caught up yet; see the note at the end of refactoringInstallCommand.ts.
  return true;
}

/**
 * Install (or reinstall) the regex support once. `interactive` = may prompt for the
 * SystemUser password if the default is rejected. Returns whether it installed.
 */
export function installRegexFeature(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
): Promise<boolean> {
  return performInstall(base, sessionManager, extensionPath, interactive);
}
