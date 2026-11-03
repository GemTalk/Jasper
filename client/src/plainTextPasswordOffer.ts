import * as vscode from 'vscode';
import { loginLabel } from './loginTypes';
import { LoginStorage, hasPlainTextPassword } from './loginStorage';

export const OFFERED_KEY = 'gemstone.plainTextPasswordsOffered';
export const MOVE = 'Move to keychain';

/**
 * Asks once per login, and moves only the logins it asked about, so one kept in
 * plain text on purpose is left alone.
 */
export async function offerToMovePlainTextPasswords(
  storage: LoginStorage,
  state: vscode.Memento,
): Promise<void> {
  const offered = new Set(state.get<string[]>(OFFERED_KEY, []));
  const fresh = storage
    .getLogins()
    .filter(hasPlainTextPassword)
    .map(loginLabel)
    .filter((label) => !offered.has(label));
  if (fresh.length === 0) return;
  await state.update(OFFERED_KEY, [...offered, ...fresh]);

  const which =
    fresh.length === 1
      ? `The GemStone login "${fresh[0]}" keeps its password`
      : `${fresh.length} GemStone logins keep their passwords`;
  const choice = await vscode.window.showInformationMessage(
    `${which} as plain text in your VS Code settings.`,
    MOVE,
  );
  if (choice !== MOVE) return;
  try {
    if (await storage.movePasswordsToKeychain(new Set(fresh))) {
      vscode.window.showInformationMessage('Login passwords moved to the OS keychain.');
    }
  } catch (e) {
    vscode.window.showErrorMessage(
      `Couldn't move the login passwords to the OS keychain: ${e instanceof Error ? e.message : e}`,
    );
  }
}
