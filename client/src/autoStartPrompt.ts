import * as vscode from 'vscode';
import { AutoStartMode, StartAnswer } from './autoStartDatabase';

const AUTO_START_SETTING = 'autoStartDatabase';

export function getAutoStartMode(): AutoStartMode {
  return vscode.workspace
    .getConfiguration('gemstone')
    .get<AutoStartMode>(AUTO_START_SETTING, 'ask');
}

/** Persisted globally: whether to start a stopped database is a property of how
 *  the user likes to work, not of whichever folder happens to be open. */
export function setAutoStartMode(mode: AutoStartMode): Thenable<void> {
  return vscode.workspace
    .getConfiguration('gemstone')
    .update(AUTO_START_SETTING, mode, vscode.ConfigurationTarget.Global);
}

const YES = 'Yes';
const NO = 'No';
const ALWAYS = 'Always';
const NEVER = 'Never';

/**
 * Ask whether to start a stopped database, following the login that just failed
 * because of it.
 *
 * Modal, matching the enhanced-inspector install prompt: this interrupts a
 * connect the user is actively waiting on, and a toast would be missed (it
 * auto-hides, and is suppressed entirely under Do Not Disturb).
 */
export async function confirmStartDatabase(stoneName: string): Promise<StartAnswer> {
  const choice = await vscode.window.showInformationMessage(
    `Start the database "${stoneName}"?`,
    {
      modal: true,
      detail:
        `The login failed because "${stoneName}" is not running. Jasper can start it — both ` +
        'its stone and its NetLDI — and then connect.\n\n' +
        '"Yes" and "No" apply to this connect only. Choose "Always" or "Never" to remember ' +
        'the choice; you can change it later with "GemStone: Configure Database Auto-Start".',
    },
    YES,
    NO,
    ALWAYS,
    NEVER,
  );

  if (choice === YES) return 'yes';
  if (choice === NO) return 'no';
  if (choice === ALWAYS) return 'always';
  if (choice === NEVER) return 'never';
  return undefined;
}

interface ModePick extends vscode.QuickPickItem {
  mode: AutoStartMode;
}

const AUTO_START_MODES: { mode: AutoStartMode; label: string; detail: string }[] = [
  {
    mode: 'ask',
    label: 'Ask',
    detail: 'Offer to start the database when a login fails because it is stopped (default).',
  },
  {
    mode: 'always',
    label: 'Always start',
    detail: 'Start a stopped database and connect, without asking.',
  },
  {
    mode: 'never',
    label: 'Never',
    detail: 'Never start a database; report the login failure as-is.',
  },
];

/**
 * Command Palette entry point for the preference, so someone who chose "Always"
 * or "Never" at the prompt can change their mind later without hunting through
 * Settings.
 */
export async function configureAutoStartDatabase(): Promise<void> {
  const current = getAutoStartMode();
  const picked = await vscode.window.showQuickPick<ModePick>(
    AUTO_START_MODES.map((m) => ({
      label: m.mode === current ? `$(check) ${m.label}` : m.label,
      detail: m.detail,
      mode: m.mode,
    })),
    { title: 'Start a stopped database when connecting?' },
  );
  if (!picked || picked.mode === current) return;
  await setAutoStartMode(picked.mode);
}
