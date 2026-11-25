/**
 * The optional server-side supports Jasper can install into a stone — the
 * Enhanced Inspector, the refactoring engine and regex support — offered and
 * installed as ONE bundle (all or none), governed by a single `gemstone.serverSupport.autoInstall`
 * setting.
 *
 * On connect (`maybeOfferServerSupport`), per that setting:
 *  - `never`  → do nothing.
 *  - `always` → install whatever is missing, silently. When SystemUser can't log
 *               in with the default password, one warning instead, offering to
 *               install with a password prompt, or to stop asking for this stone.
 *  - `ask`    → show one modal (Install / Not Now / Always / Never) that installs
 *               the missing supports, or none. "Always"/"Never" remember the
 *               choice; "Not Now" (also Escape / the window-close control) asks
 *               again next connect.
 * The Command Palette entry (`runInstallServerSupport`) installs/reinstalls every
 * support applicable to the stone's version. A support that is installed but not
 * the one this Jasper ships is offered for reinstall by a separate notice,
 * `noticeDifferentServerSupport` (serverSupportStatus.ts).
 *
 * A feature is *applicable* when the stone's version supports it (the Enhanced
 * Inspector needs 3.7.5+; the refactoring engine and regex support load on any release) and
 * *missing* when it is not yet installed (per the cached availability flag on
 * `ActiveSession`). The connect offer targets applicable-and-missing supports;
 * the command targets all applicable ones so it doubles as a reinstall.
 * `probe` is a separate, uncached presence check against the live session —
 * used by test gating helpers, which can't rely on a flag latched at connect
 * time.
 *
 * The actual per-feature install pipelines (transient SystemUser session, file-in,
 * commit, verify, relatch) live in enhancedInspectorCommand.ts,
 * refactoringInstallCommand.ts and regexInstallCommand.ts; this module only orchestrates the bundle and the
 * single setting.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import { pluginFeatures } from './serverPlugin/pluginFeatures';
import { installEnhancedInspectorFeature } from './enhancedInspector/enhancedInspectorCommand';
import { installRefactoringFeature } from './refactoring/refactoringInstallCommand';
import { uninstallEnhancedInspectorFeature } from './enhancedInspector/enhancedInspectorUninstallCommand';
import { uninstallRefactoringFeature } from './refactoring/refactoringUninstallCommand';
import { installRegexFeature } from './regex/regexInstallCommand';
import { uninstallRegexFeature } from './regex/regexUninstallCommand';
import { SEARCH_RESYNC_COMMAND } from './undo/afterUndo';
import { defaultSystemUserLoginRefusal } from './serverPlugin/systemUserAuth';
import { stoneNrsFor } from './loginTypes';
import { logInfo, logWarning } from './gciLog';
import { messageOf } from './serverPlugin/installHelpers';

export type AutoInstallMode = 'ask' | 'always' | 'never';

const AUTO_INSTALL_SETTING = 'serverSupport.autoInstall';

export function getAutoInstallMode(): AutoInstallMode {
  return vscode.workspace
    .getConfiguration('gemstone')
    .get<AutoInstallMode>(AUTO_INSTALL_SETTING, 'ask');
}

function setAutoInstallMode(mode: AutoInstallMode): Thenable<void> {
  return vscode.workspace
    .getConfiguration('gemstone')
    .update(AUTO_INSTALL_SETTING, mode, vscode.ConfigurationTarget.Global);
}

export interface ServerSupportFeature {
  id: string;
  label: string;
  /** Does this stone's version support the feature at all? */
  isApplicable(base: ActiveSession): boolean;
  /** Is it not yet installed in this stone? */
  isMissing(base: ActiveSession): boolean;
  /** Live presence check against the session, distinct from the cached
   *  `isMissing` flag — used where a fresh answer matters (e.g. test gating)
   *  rather than the availability latch set at connect time. */
  probe(session: ActiveSession): boolean;
  /** Install once (interactive = may prompt for the SystemUser password). */
  install(
    base: ActiveSession,
    sessionManager: SessionManager,
    extensionPath: string,
    interactive: boolean,
  ): Promise<boolean>;
  /** Remove once (interactive = may prompt for the SystemUser password). No
   *  `extensionPath`: removal is inline Smalltalk and needs nothing from disk.
   *  Returns whether the feature is gone afterward. */
  uninstall(
    base: ActiveSession,
    sessionManager: SessionManager,
    interactive: boolean,
  ): Promise<boolean>;
}

/** The supports offered as a bundle. */
export const SERVER_SUPPORT_FEATURES: readonly ServerSupportFeature[] = [
  {
    id: 'enhancedInspector',
    label: 'Enhanced Inspector',
    isApplicable: (b) => pluginFeatures.enhancedInspector.isApplicable(b.stoneVersion),
    isMissing: (b) => !pluginFeatures.enhancedInspector.isAvailable(b),
    probe: pluginFeatures.enhancedInspector.probe,
    install: installEnhancedInspectorFeature,
    uninstall: uninstallEnhancedInspectorFeature,
  },
  {
    id: 'refactoring',
    label: 'Refactoring engine',
    isApplicable: (b) => pluginFeatures.refactoring.isApplicable(b.stoneVersion),
    isMissing: (b) => !pluginFeatures.refactoring.isAvailable(b),
    probe: pluginFeatures.refactoring.probe,
    install: installRefactoringFeature,
    uninstall: uninstallRefactoringFeature,
  },
  {
    id: 'regex',
    label: 'Regex support',
    isApplicable: (b) => pluginFeatures.regex.isApplicable(b.stoneVersion),
    isMissing: (b) => !pluginFeatures.regex.isAvailable(b),
    probe: pluginFeatures.regex.probe,
    install: installRegexFeature,
    uninstall: uninstallRegexFeature,
  },
];

function missingFeatures(
  base: ActiveSession,
  features: readonly ServerSupportFeature[],
): ServerSupportFeature[] {
  return features.filter((f) => f.isApplicable(base) && f.isMissing(base));
}

/** Refresh the `gemstone.serverSupportInstalled` context key from `base`'s
 *  latches, so the "Uninstall Server Support" menu appears/disappears right after
 *  an install or uninstall changes what's present (not only on reconnect). The
 *  install/uninstall drivers refresh the latches before this runs. */
function refreshServerSupportInstalledContext(base: ActiveSession): void {
  void vscode.commands.executeCommand(
    'setContext',
    'gemstone.serverSupportInstalled',
    base.rbSupportAvailable === true ||
      base.enhancedInspectorAvailable === true ||
      base.regexSupportAvailable === true,
  );
}

/**
 * Show ONE consolidated confirmation for the whole bundle — "GemStone server
 * support installed/uninstalled." — matching the command wording, instead of a
 * separate toast per feature. Shown only when every attempted feature succeeded;
 * a per-feature failure already surfaced its own error notification, so a
 * "succeeded" toast alongside it would be contradictory. The individual install/
 * uninstall drivers no longer show their own success toast — this is the single
 * source of the success message.
 */
function announceServerSupportChange(
  verb: 'installed' | 'uninstalled',
  outcomes: boolean[],
  message = `GemStone server support ${verb}.`,
): void {
  if (outcomes.length > 0 && outcomes.every((ok) => ok)) {
    vscode.window.showInformationMessage(message);
  }
}

/** Features applicable to this stone that ARE installed — the uninstall targets.
 *  The inverse of `missingFeatures`: applicable and not missing. */
function installedFeatures(
  base: ActiveSession,
  features: readonly ServerSupportFeature[],
): ServerSupportFeature[] {
  return features.filter((f) => f.isApplicable(base) && !f.isMissing(base));
}

async function installFeatures(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
  features: ServerSupportFeature[],
  successMessage?: string,
): Promise<void> {
  const outcomes: boolean[] = [];
  for (const f of features) {
    outcomes.push(await f.install(base, sessionManager, extensionPath, interactive));
  }
  // The refactoring-engine install adds a `GsRefactoring` dictionary (and refreshes
  // the working session so it's visible), but the Explorer loaded its dictionary
  // list on connect — before this install ran — so the new dictionary won't show
  // until the list is reloaded. Reload it now so the Explorer reflects the stone
  // without the user hitting Refresh. Unconditional: this only runs when a support
  // was missing and the user opted in, and a reload after a failed/cancelled
  // install just re-reads the unchanged list (retaining the selection) — harmless.
  // The command no-ops gracefully when the Explorer has no active session.
  await vscode.commands.executeCommand('gemstone.explorer.refresh');
  // GemStone Search too: the refresh after each install aborts the session directly, which does not
  // tell it, so a panel opened before the install finished kept .* greyed out.
  await vscode.commands.executeCommand(SEARCH_RESYNC_COMMAND, base.id);
  refreshServerSupportInstalledContext(base);
  announceServerSupportChange('installed', outcomes, successMessage);
}

/**
 * On connect, offer the missing optional supports as one bundle, per
 * `gemstone.serverSupport.autoInstall`. Fire-and-forget; no-ops when the stone
 * already has everything applicable to its version.
 */
export async function maybeOfferServerSupport(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  memento: vscode.Memento,
  features: readonly ServerSupportFeature[] = SERVER_SUPPORT_FEATURES,
): Promise<void> {
  const missing = missingFeatures(base, features);
  if (missing.length === 0) return;

  const mode = getAutoInstallMode();
  if (mode === 'never') return;
  if (mode === 'always') {
    const refusal = defaultSystemUserLoginRefusal(base);
    if (refusal === undefined) {
      await installFeatures(base, sessionManager, extensionPath, false, missing);
    } else {
      warnNotAutoInstalled(base, sessionManager, extensionPath, memento, missing, refusal);
    }
    return;
  }

  const INSTALL: vscode.MessageItem = { title: 'Install' };
  const ALWAYS: vscode.MessageItem = { title: 'Always' };
  const NEVER: vscode.MessageItem = { title: 'Never' };
  // "Not Now" IS the modal's close affordance (isCloseAffordance) — Escape and the
  // window-close control resolve to it — so declining reads as an explicit, labeled
  // choice instead of a generic "Cancel" that looks like it aborts the login. It
  // declines this connect only: the setting stays at "ask", so the offer returns
  // next time (that is why it is "Not Now" and not "Never").
  const NOT_NOW: vscode.MessageItem = { title: 'Not Now', isCloseAffordance: true };
  const names = missing.map((f) => f.label).join(' and ');
  // Modal (not a toast): a one-time setup decision that is too easily missed as a
  // notification. Order mirrors the choices' permanence: install once, decline once,
  // then the two sticky "remember this" options.
  const choice = await vscode.window.showInformationMessage(
    `Install recommended GemStone support on "${base.login.stone}"?`,
    {
      modal: true,
      detail:
        `Adds ${names} to this stone.\n\n` +
        'Installing requires a SystemUser login and commits the supporting classes to the ' +
        'database.\n' +
        'Choose "Always" or "Never" to remember your choice for stones without it.',
    },
    INSTALL,
    NOT_NOW,
    ALWAYS,
    NEVER,
  );
  if (choice === NEVER) {
    await setAutoInstallMode('never');
    return;
  }
  if (choice === ALWAYS) {
    await setAutoInstallMode('always');
  }
  if (choice === INSTALL || choice === ALWAYS) {
    await installFeatures(base, sessionManager, extensionPath, true, missing);
  }
  // "Not Now" / dismissed: leave the setting at "ask" and do nothing.
}

/**
 * `always` could not install the missing support: SystemUser can't log in with the default
 * password, usually because it has another. Without this, each feature warned on its own at
 * every login, with no way to stop it. Not awaited: a toast left open must not hold up the
 * rest of the login.
 */
function warnNotAutoInstalled(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  memento: vscode.Memento,
  missing: ServerSupportFeature[],
  refusal: string,
): void {
  const key = `gemstone.serverSupportNotAutoInstalled:${stoneNrsFor(base.login)}`;
  const ids = missing.map((f) => f.id).join(',');
  if (memento.get<string>(key) === ids) return;

  const INSTALL = 'Install…';
  const DONT_ASK = "Don't Ask Again";
  const names = missing.map((f) => f.label).join(' and ');
  void vscode.window
    .showWarningMessage(
      `${names} could not be installed on "${base.login.stone}" automatically: SystemUser ` +
        `could not log in with the default password (${refusal}). Install asks for the password.`,
      INSTALL,
      DONT_ASK,
    )
    .then(async (choice) => {
      if (choice === INSTALL) {
        await installFeatures(base, sessionManager, extensionPath, true, missing);
      } else if (choice === DONT_ASK) {
        await memento.update(key, ids);
      }
    })
    .then(undefined, (e: unknown) =>
      logWarning(`Installing the missing server support failed: ${messageOf(e)}`),
    );
}

/**
 * Command Palette entry: install (or reinstall) every optional support that
 * applies to the selected stone's version. Returns the session so callers can
 * read the refreshed availability flags (e.g. the Explorer's rename pencil).
 */
export async function runInstallServerSupport(
  sessionManager: SessionManager,
  extensionPath: string,
): Promise<void> {
  const base = sessionManager.getSelectedSession();
  if (!base) {
    vscode.window.showErrorMessage('No active GemStone session — connect to a stone first.');
    return;
  }
  const applicable = SERVER_SUPPORT_FEATURES.filter((f) => f.isApplicable(base));
  if (applicable.length === 0) {
    vscode.window.showInformationMessage(
      `No recommended GemStone support applies to ${base.stoneVersion}.`,
    );
    return;
  }
  await installFeatures(base, sessionManager, extensionPath, true, applicable);
}

/**
 * Replace the server support named by `featureIds` with this Jasper's, without
 * asking: what `always` does for a stone whose support is not the one this Jasper
 * ships (`noticeDifferentServerSupport`). Says what it replaced, and why.
 * Answers false, having changed nothing, when SystemUser can't log in with the
 * default password: the caller then warns once, rather than each feature failing on its own.
 */
export async function updateServerSupport(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  featureIds: readonly string[],
): Promise<boolean> {
  const features = SERVER_SUPPORT_FEATURES.filter((f) => featureIds.includes(f.id));
  if (features.length === 0) return true;
  const refusal = defaultSystemUserLoginRefusal(base);
  if (refusal !== undefined) {
    logInfo(`Did not replace the server support on "${base.login.stone}": ${refusal}`);
    return false;
  }
  const names = features.map((f) => f.label).join(' and ');
  await installFeatures(
    base,
    sessionManager,
    extensionPath,
    false,
    features,
    `Updated the server support on "${base.login.stone}" (${names}) to the one this Jasper ships, ` +
      'because gemstone.serverSupport.autoInstall is "always".',
  );
  return true;
}

/**
 * The login's two server-support steps, one after the other so `always` never runs two
 * installs on the stone at once. A failure in the first is logged, and the second still runs.
 */
export async function checkServerSupportAtLogin(
  offerMissing: () => Promise<void>,
  noticeDifferent: () => Promise<void>,
): Promise<void> {
  try {
    await offerMissing();
  } catch (e: unknown) {
    logWarning(`Offering the missing server support failed: ${messageOf(e)}`);
  }
  try {
    await noticeDifferent();
  } catch (e: unknown) {
    logWarning(`Checking the installed server support failed: ${messageOf(e)}`);
  }
}

async function uninstallFeatures(
  base: ActiveSession,
  sessionManager: SessionManager,
  interactive: boolean,
  features: ServerSupportFeature[],
): Promise<void> {
  const outcomes: boolean[] = [];
  for (const f of features) {
    outcomes.push(await f.uninstall(base, sessionManager, interactive));
  }
  // The refactoring engine removed its `GsRefactoring` dictionary from the stone,
  // but the Explorer loaded its dictionary list on connect — before this ran — so
  // the now-gone dictionary will linger in the tree until the list is reloaded.
  // Reload it now so the Explorer reflects the stone without the user hitting
  // Refresh. Harmless when nothing dictionary-shaped changed, and the command
  // no-ops gracefully when the Explorer has no active session.
  await vscode.commands.executeCommand('gemstone.explorer.refresh');
  // And GemStone Search, for the same reason as after an install: .* must grey out again.
  await vscode.commands.executeCommand(SEARCH_RESYNC_COMMAND, base.id);
  refreshServerSupportInstalledContext(base);
  announceServerSupportChange('uninstalled', outcomes);
}

/**
 * Command Palette entry: uninstall every optional support currently installed on
 * the selected stone. Only offered when something is installed; always confirms
 * first (the removal commits and cannot be undone). Mirrors
 * `runInstallServerSupport` so the two read as a matched pair.
 */
export async function runUninstallServerSupport(sessionManager: SessionManager): Promise<void> {
  const base = sessionManager.getSelectedSession();
  if (!base) {
    vscode.window.showErrorMessage('No active GemStone session — connect to a stone first.');
    return;
  }
  const installed = installedFeatures(base, SERVER_SUPPORT_FEATURES);
  if (installed.length === 0) {
    vscode.window.showInformationMessage(
      `No recommended GemStone support is installed on "${base.login.stone}".`,
    );
    return;
  }

  const UNINSTALL = 'Uninstall';
  const names = installed.map((f) => f.label).join(' and ');
  // Modal (not a toast): a destructive, committed change the user must confirm.
  // Text mirrors the install offer so the two are recognizably a pair.
  const choice = await vscode.window.showWarningMessage(
    `Uninstall recommended GemStone support from "${base.login.stone}"?`,
    {
      modal: true,
      detail:
        `Removes ${names} from this stone.\n\n` +
        'Uninstalling requires a SystemUser login and commits the removal to the database. ' +
        'This cannot be undone (you can reinstall later).',
    },
    UNINSTALL,
  );
  if (choice !== UNINSTALL) return; // Cancelled/dismissed: do nothing.
  await uninstallFeatures(base, sessionManager, true, installed);
}
