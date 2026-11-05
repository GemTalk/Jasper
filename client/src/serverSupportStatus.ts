/**
 * "Show Server Support Status": which server-side supports the selected stone
 * has, and whether each is the one this Jasper ships. Read-only and safe on any
 * stone, so it is the thing to point at in a support conversation. Also the
 * login-time notice that offers to reinstall them.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { ActiveSession, SessionManager } from './sessionManager';
import { stoneNrsFor } from './loginTypes';
import { PLUGIN_FEATURES, PluginFeature } from './serverPlugin/pluginFeatures';
import { PluginStatus, pluginStatus, readJasperVersion } from './serverPlugin/pluginFingerprint';

const INSTALL_COMMAND = '"GemStone: Install Server Support"';

let channel: vscode.OutputChannel | undefined;

export function describePlugin(
  label: string,
  status: PluginStatus,
  jasperVersion: string,
): string[] {
  const by = status.installedBy ? `Jasper ${status.installedBy}` : 'an unrecorded Jasper version';
  switch (status.state) {
    case 'missing':
      return [`${label}: not installed`, `  Install it with ${INSTALL_COMMAND}.`];
    case 'current':
      return [
        `${label}: current`,
        `  Installed by ${by}; the same one this Jasper (${jasperVersion}) ships.`,
        '  This describes what was filed in. Later edits to its methods in the stone are ' +
          'not detected.',
      ];
    case 'different':
      return [
        `${label}: not this Jasper's`,
        `  Installed by ${by}; this Jasper (${jasperVersion}) ships a different one, so ` +
          'it may not behave as this Jasper expects.',
        `  ${INSTALL_COMMAND} replaces it with this Jasper's, for everyone using this stone.`,
      ];
    case 'unknown':
      return status.unknownReason === 'noReceipt'
        ? [
            `${label}: installed, version unknown`,
            '  Jasper has no record of which version this is: it was installed before Jasper ' +
              'kept one, or loaded by hand from topaz.',
            `  Reinstall with ${INSTALL_COMMAND} to enable this check.`,
          ]
        : [
            `${label}: installed, could not check its version`,
            `  ${status.detail ?? 'The stone did not answer.'}`,
          ];
  }
}

function statusOf(
  base: ActiveSession,
  feature: PluginFeature,
  installed: boolean,
  extensionPath: string,
): PluginStatus {
  return pluginStatus(
    base,
    installed,
    path.join(extensionPath, feature.payloadSubdir),
    feature.receipt,
  );
}

export async function runShowServerSupportStatus(
  sessionManager: SessionManager,
  extensionPath: string,
): Promise<void> {
  const base = sessionManager.getSelectedSession();
  if (!base) {
    vscode.window.showErrorMessage('No active GemStone session — connect to a stone first.');
    return;
  }
  const jasperLabel = readJasperVersion(extensionPath) || 'version unknown';

  channel ??= vscode.window.createOutputChannel('GemStone Server Support');
  channel.clear();
  channel.appendLine(
    `Server support on "${base.login.stone}" (GemStone ${base.stoneVersion}), ` +
      `checked by Jasper ${jasperLabel}`,
  );
  for (const feature of PLUGIN_FEATURES) {
    channel.appendLine('');
    if (!feature.isApplicable(base.stoneVersion)) {
      channel.appendLine(`${feature.label}: not available on GemStone ${base.stoneVersion}`);
      continue;
    }
    const status = statusOf(base, feature, feature.probe(base), extensionPath);
    for (const line of describePlugin(feature.label, status, jasperLabel)) {
      channel.appendLine(line);
    }
  }
  channel.show(true);
}

/** The login-time availability latch for each feature, by id. */
function latchedInstalled(base: ActiveSession, feature: PluginFeature): boolean {
  return feature.id === 'refactoring'
    ? base.rbSupportAvailable === true
    : base.enhancedInspectorAvailable === true;
}

/**
 * After login, tell the user once if the stone's server support is not the one
 * this Jasper ships, and offer to reinstall it. The two features are installed
 * together, so one notice covers both. Never blocks or fails the login: someone
 * editing that code in the stone must still be able to work, and can decline.
 * Silent for every other state, including a read that failed.
 *
 * Shown once per stone and set of fingerprints, so a dismissed notice comes back
 * only when the stone's support or this Jasper's changes.
 */
export async function noticeDifferentServerSupport(
  base: ActiveSession,
  extensionPath: string,
  memento: vscode.Memento,
): Promise<void> {
  const different = PLUGIN_FEATURES.filter((f) => latchedInstalled(base, f))
    .map((feature) => ({ feature, status: statusOf(base, feature, true, extensionPath) }))
    .filter(({ status }) => status.state === 'different');
  if (different.length === 0) return;

  const key = `gemstone.differentServerSupportNoticed:${stoneNrsFor(base.login)}`;
  const seen = different
    .map(({ feature, status }) => `${feature.id}=${status.installedDigest}:${status.shippedDigest}`)
    .join(',');
  if (memento.get<string>(key) === seen) return;
  await memento.update(key, seen);

  const REINSTALL = 'Reinstall';
  const SHOW_STATUS = 'Show Status';
  const names = different.map(({ feature }) => feature.label).join(' and ');
  const choice = await vscode.window.showWarningMessage(
    `The server support on "${base.login.stone}" isn't the one this Jasper ships (${names}), ` +
      'so it may not behave as expected. Reinstalling replaces it for everyone using this stone.',
    REINSTALL,
    SHOW_STATUS,
  );
  if (choice === REINSTALL) {
    await vscode.commands.executeCommand('gemstone.installServerSupport');
  } else if (choice === SHOW_STATUS) {
    await vscode.commands.executeCommand('gemstone.showServerSupportStatus');
  }
}
