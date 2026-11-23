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
import { logInfo, logWarning } from './gciLog';
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

/** Whether `installed` is a later version than `mine`, comparing the numbers of `1.15.0`-style
 *  versions in turn. A pre-release (`1.19.0-issue619.1`, as a hand-off build carries) is older
 *  than its release, as in semver. False when either is unknown, so an unrecorded installer
 *  counts as older. */
export function isNewerVersion(installed: string | undefined, mine: string): boolean {
  if (!installed || !mine) return false;
  return compareVersions(installed, mine) > 0;
}

function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = splitPreRelease(a);
  const [bCore, bPre] = splitPreRelease(b);
  const byCore = compareParts(aCore.split('.'), bCore.split('.'));
  if (byCore !== 0) return byCore;
  if (aPre === undefined || bPre === undefined) {
    return aPre === bPre ? 0 : aPre === undefined ? 1 : -1;
  }
  return compareParts(aPre.split('.'), bPre.split('.'));
}

function splitPreRelease(v: string): [string, string | undefined] {
  const dash = v.indexOf('-');
  return dash === -1 ? [v, undefined] : [v.slice(0, dash), v.slice(dash + 1)];
}

/** Part by part: numbers numerically, other text alphabetically; a missing part counts as 0. */
function compareParts(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? '0';
    const y = b[i] ?? '0';
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isInteger(nx) && Number.isInteger(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** How often, and how far apart, the login check asks again when the stone could not be read. */
export const UNREADABLE_RETRIES = 4;
export const UNREADABLE_RETRY_MS = 1500;

/**
 * The installed supports that are not this Jasper's. A login keeps its session busy for a moment,
 * and a read that fails then is `unknown`, which would leave a different support unreported; so a
 * failed read is asked again a few times, and logged if it never succeeds.
 */
async function differentSupports(base: ActiveSession, extensionPath: string) {
  for (let attempt = 0; ; attempt++) {
    const statuses = PLUGIN_FEATURES.filter((f) => f.isAvailable(base)).map((feature) => ({
      feature,
      status: statusOf(base, feature, true, extensionPath),
    }));
    const unreadable = statuses.filter(({ status }) => status.unknownReason === 'unreadable');
    if (unreadable.length === 0 || attempt >= UNREADABLE_RETRIES) {
      // One line per login, so a missing warning can be explained from the log.
      logInfo(
        `Server support on "${base.login.stone}": ` +
          (statuses.map(({ feature, status }) => `${feature.label} ${status.state}`).join(', ') ||
            'none installed'),
      );
      for (const { feature, status } of unreadable) {
        logWarning(
          `Could not check whether ${feature.label} on "${base.login.stone}" is the one this Jasper ships: ${status.detail ?? 'the stone did not answer'}`,
        );
      }
      return statuses.filter(({ status }) => status.state === 'different');
    }
    await new Promise((resolve) => setTimeout(resolve, UNREADABLE_RETRY_MS));
  }
}

/**
 * After login, when the stone's server support is not the one this Jasper ships:
 * with `autoUpdate` (the `always` setting), replace it and say so; otherwise warn
 * and offer to reinstall it. `autoUpdate` answers false when it could not try
 * (SystemUser can't log in with the default password), and the warning is shown
 * instead. The features are installed together, so one notice covers them all. Under `always`, any login replaces it, edits made to that code
 * in the stone included: always means always. Under `ask` and `never` the warning
 * never blocks or fails the login, so someone editing that code in the stone can
 * keep working and decline. Silent for every other state, including a read that
 * still fails after the retries below.
 *
 * Support installed by a newer Jasper is never replaced without asking, and the
 * warning says whose it is: two Jaspers sharing a stone would otherwise replace
 * each other's at every login, the older one downgrading the newer.
 *
 * The warning comes at every login until the support matches, since a toast at
 * login is easy to miss among the others. Don't Ask Again silences it for this
 * stone and set of fingerprints only, so it comes back when the stone's support
 * or this Jasper's changes.
 */
export async function noticeDifferentServerSupport(
  base: ActiveSession,
  extensionPath: string,
  memento: vscode.Memento,
  autoUpdate?: (featureIds: string[]) => Promise<boolean>,
): Promise<void> {
  const different = await differentSupports(base, extensionPath);
  if (different.length === 0) return;

  const jasperVersion = readJasperVersion(extensionPath);
  const newer = different.filter(({ status }) => isNewerVersion(status.installedBy, jasperVersion));
  if (autoUpdate && newer.length === 0) {
    if (await autoUpdate(different.map(({ feature }) => feature.id))) return;
  }

  const key = `gemstone.differentServerSupportDeclined:${stoneNrsFor(base.login)}`;
  const fingerprints = different
    .map(({ feature, status }) => `${feature.id}=${status.installedDigest}:${status.shippedDigest}`)
    .join(',');
  if (memento.get<string>(key) === fingerprints) return;

  const REINSTALL = 'Reinstall';
  const SHOW_STATUS = 'Show Status';
  const DONT_ASK = "Don't Ask Again";
  const names = different.map(({ feature }) => feature.label).join(' and ');
  const choice = await vscode.window.showWarningMessage(
    `The server support on "${base.login.stone}" isn't the one this Jasper ships (${names}), ` +
      'so it may not behave as expected. ' +
      newer
        .map(
          ({ feature, status }) =>
            `${feature.label} was installed by a newer Jasper (${status.installedBy}). `,
        )
        .join('') +
      'Reinstalling replaces it for everyone using this stone.',
    REINSTALL,
    SHOW_STATUS,
    DONT_ASK,
  );
  if (choice === REINSTALL) {
    await vscode.commands.executeCommand('gemstone.installServerSupport');
  } else if (choice === DONT_ASK) {
    await memento.update(key, fingerprints);
  } else if (choice === SHOW_STATUS) {
    await vscode.commands.executeCommand('gemstone.showServerSupportStatus');
  }
}
