/**
 * The optional server-side supports Jasper can install into a stone — the
 * Enhanced Inspector and the refactoring engine — offered and installed as ONE
 * bundle (both or none), governed by a single `gemstone.serverSupport.autoInstall`
 * setting.
 *
 * On connect (`maybeOfferServerSupport`), per that setting:
 *  - `never`  → do nothing.
 *  - `always` → install whatever is missing, silently.
 *  - `ask`    → show one modal (Install / Always / Never / dismiss) that installs
 *               the missing supports, or none. "Always"/"Never" remember the
 *               choice; dismiss asks again next connect.
 * The Command Palette entry (`runInstallServerSupport`) installs/reinstalls every
 * support applicable to the stone's version.
 *
 * A feature is *applicable* when the stone's version supports it (the Enhanced
 * Inspector needs 3.7.5+; the refactoring engine loads on any release) and
 * *missing* when it is not yet installed (per the cached availability flag on
 * `ActiveSession`). The connect offer targets applicable-and-missing supports;
 * the command targets all applicable ones so it doubles as a reinstall.
 * `probe` is a separate, uncached presence check against the live session —
 * used by test gating helpers, which can't rely on a flag latched at connect
 * time.
 *
 * The actual per-feature install pipelines (transient SystemUser session, file-in,
 * commit, verify, relatch) live in enhancedInspectorCommand.ts and
 * refactoringInstallCommand.ts; this module only orchestrates the bundle and the
 * single setting.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from './sessionManager';
import { checkRefactoringSupportAvailable } from './browserQueries';
import {
  supportsEnhancedInspector,
  isEnhancedInspectorInstalled,
} from './enhancedInspectorInstall';
import { installEnhancedInspectorFeature } from './enhancedInspectorCommand';
import { installRefactoringFeature } from './refactoring/refactoringInstallCommand';

export type AutoInstallMode = 'ask' | 'always' | 'never';

const AUTO_INSTALL_SETTING = 'serverSupport.autoInstall';

function getAutoInstallMode(): AutoInstallMode {
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
}

/** The supports offered as a bundle. */
export const SERVER_SUPPORT_FEATURES: readonly ServerSupportFeature[] = [
  {
    id: 'enhancedInspector',
    label: 'Enhanced Inspector',
    isApplicable: (b) => supportsEnhancedInspector(b.stoneVersion),
    isMissing: (b) => !b.enhancedInspectorAvailable,
    probe: isEnhancedInspectorInstalled,
    install: installEnhancedInspectorFeature,
  },
  {
    id: 'refactoring',
    label: 'Refactoring engine',
    isApplicable: () => true,
    isMissing: (b) => !b.rbSupportAvailable,
    probe: checkRefactoringSupportAvailable,
    install: installRefactoringFeature,
  },
];

function missingFeatures(
  base: ActiveSession,
  features: readonly ServerSupportFeature[],
): ServerSupportFeature[] {
  return features.filter((f) => f.isApplicable(base) && f.isMissing(base));
}

async function installFeatures(
  base: ActiveSession,
  sessionManager: SessionManager,
  extensionPath: string,
  interactive: boolean,
  features: ServerSupportFeature[],
): Promise<void> {
  for (const f of features) {
    await f.install(base, sessionManager, extensionPath, interactive);
  }
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
  features: readonly ServerSupportFeature[] = SERVER_SUPPORT_FEATURES,
): Promise<void> {
  const missing = missingFeatures(base, features);
  if (missing.length === 0) return;

  const mode = getAutoInstallMode();
  if (mode === 'never') return;
  if (mode === 'always') {
    await installFeatures(base, sessionManager, extensionPath, false, missing);
    return;
  }

  const INSTALL = 'Install';
  const ALWAYS = 'Always';
  const NEVER = 'Never';
  const names = missing.map((f) => f.label).join(' and ');
  // Modal (not a toast): a one-time setup decision that is too easily missed as a
  // notification. Buttons mirror the original Enhanced Inspector offer:
  // Install / Always / Never, plus the modal's implicit Cancel ("not now").
  const choice = await vscode.window.showInformationMessage(
    `Install optional GemStone support on "${base.login.stone}"?`,
    {
      modal: true,
      detail:
        `Adds ${names} to this stone.\n\n` +
        'Installing requires a SystemUser login and commits the supporting classes to the ' +
        'database.\n' +
        'Choose "Always" or "Never" to remember your choice for stones without it.',
    },
    INSTALL,
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
  // Cancelled/dismissed: leave the setting at "ask" and do nothing.
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
      `No optional GemStone support applies to ${base.stoneVersion}.`,
    );
    return;
  }
  await installFeatures(base, sessionManager, extensionPath, true, applicable);
}
