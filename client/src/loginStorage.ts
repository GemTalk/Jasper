import * as vscode from 'vscode';
import { DEFAULT_GS_PW, GemStoneLogin, loginLabel } from './loginTypes';
import {
  deleteLoginPasswords,
  LoginPasswords,
  loginCredentialAccount,
  readLoginPasswords,
  storeLoginPasswords,
} from './loginCredentials';

export const SAVE_AS_PLAIN_TEXT = 'Save as plain text';
export const ASK_AT_LOGIN = "Don't save — ask at login";

export function hasPlainTextPassword(login: GemStoneLogin): boolean {
  return Boolean(login.gs_password || login.host_password);
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class LoginStorage {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** Each with its label, which Quick Setup and the Databases panel used to save empty. */
  getLogins(): GemStoneLogin[] {
    const config = vscode.workspace.getConfiguration('gemstone');
    return config
      .get<GemStoneLogin[]>('logins', [])
      .map((login) => ({ ...login, label: loginLabel(login) }));
  }

  /**
   * A keychain-backed login must carry both passwords, as the editor's form
   * does: an empty one clears its keychain entry.
   */
  async saveLogin(login: GemStoneLogin, originalLabel?: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const logins = [...this.getLogins()];
    // The editor reads an empty label as a login not saved yet.
    login = { ...login, label: loginLabel(login) };
    const matchLabel = originalLabel ?? loginLabel(login);
    const index = logins.findIndex((l) => loginLabel(l) === matchLabel);
    const replaced = index >= 0 ? logins[index] : undefined;

    if (login.password_in_keychain) {
      const error = await this.keychainWriteError(login);
      login = error
        ? await this.afterKeychainFailure(login, error)
        : { ...login, gs_password: '', host_password: '' };
    }
    // Keychain entries are keyed by user, host and stone, so a rename or an
    // unchecked box leaves the old entry behind unless it is removed.
    const stale =
      replaced?.password_in_keychain &&
      (!login.password_in_keychain ||
        loginCredentialAccount(replaced) !== loginCredentialAccount(login))
        ? replaced
        : undefined;

    if (index >= 0) {
      logins[index] = login;
    } else {
      logins.push(login);
    }

    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
    // Only once settings are written: if that throws, they still name the old entry.
    if (stale) await deleteLoginPasswords(this.secrets, stale);
  }

  async deleteLogin(label: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const all = this.getLogins();
    const doomed = all.find((l) => loginLabel(l) === label);
    const logins = all.filter((l) => loginLabel(l) !== label);
    await config.update('logins', logins, vscode.ConfigurationTarget.Global);
    if (doomed?.password_in_keychain) await deleteLoginPasswords(this.secrets, doomed);
  }

  /**
   * Moves the plain-text passwords of the logins named in `labels`, among the
   * logins in effect: the workspace's when it has its own, else the user's. A
   * copy in the other file is left alone, so a stale one can't overwrite the
   * password the login in use keeps in the keychain. Every password is stored
   * before the file is written, so a keychain failure leaves it as it was.
   */
  async movePasswordsToKeychain(labels: ReadonlySet<string>): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const inspected = config.inspect<GemStoneLogin[]>('logins');
    const [target, logins] =
      inspected?.workspaceValue !== undefined
        ? [vscode.ConfigurationTarget.Workspace, inspected.workspaceValue]
        : [vscode.ConfigurationTarget.Global, inspected?.globalValue ?? []];
    const everywhere = [...(inspected?.globalValue ?? []), ...(inspected?.workspaceValue ?? [])];
    const toMove = (l: GemStoneLogin) => hasPlainTextPassword(l) && labels.has(loginLabel(l));

    for (const login of logins.filter(toMove)) {
      // A login already keychain-backed, in either file, may have only its host
      // password in plain text; storing it must not clear the GemStone password
      // beside it, nor go ahead when that password can't be read.
      const keychainBacked = everywhere.some(
        (l) =>
          l.password_in_keychain && loginCredentialAccount(l) === loginCredentialAccount(login),
      );
      let stored: LoginPasswords = { gs_password: '', host_password: '' };
      if (keychainBacked) {
        try {
          stored = await readLoginPasswords(this.secrets, login);
        } catch (e) {
          vscode.window.showErrorMessage(
            `Couldn't read the passwords for "${loginLabel(login)}" from the OS keychain ` +
              `(${errorText(e)}). They are still in your settings file.`,
          );
          return false;
        }
      }
      const error = await this.keychainWriteError({
        ...login,
        gs_password: login.gs_password || stored.gs_password,
        host_password: login.host_password || stored.host_password,
      });
      if (error) {
        vscode.window.showErrorMessage(
          `Couldn't save the passwords for "${loginLabel(login)}" in the OS keychain ` +
            `(${error}). They are still in your settings file.`,
        );
        return false;
      }
    }

    if (!logins.some(toMove)) return true;
    const moved = logins.map((l) =>
      toMove(l) ? { ...l, gs_password: '', host_password: '', password_in_keychain: true } : l,
    );
    await config.update('logins', moved, target);
    return true;
  }

  /** Undefined when both passwords were stored. */
  private async keychainWriteError(login: GemStoneLogin): Promise<string | undefined> {
    try {
      await storeLoginPasswords(this.secrets, login);
      return undefined;
    } catch (e) {
      return errorText(e);
    }
  }

  /** Lets the user choose plain text or no saved passwords; closing the dialog chooses the latter. */
  private async afterKeychainFailure(login: GemStoneLogin, error: string): Promise<GemStoneLogin> {
    const choice = hasPlainTextPassword(login)
      ? await vscode.window.showWarningMessage(
          `Couldn't save the passwords for "${loginLabel(login)}" in the OS keychain (${error}).`,
          {
            modal: true,
            detail:
              'Save them as plain text in your VS Code settings, or leave them unsaved and ' +
              'be asked for them when you log in.' +
              (login.gs_password === DEFAULT_GS_PW
                ? ` The GemStone password is GemStone's default, ${DEFAULT_GS_PW}.`
                : ''),
          },
          SAVE_AS_PLAIN_TEXT,
          ASK_AT_LOGIN,
        )
      : undefined;
    // The failed write may have stored one of the two, and an older entry may
    // still be there; either would be used at login without asking.
    await deleteLoginPasswords(this.secrets, login);
    return choice === SAVE_AS_PLAIN_TEXT
      ? { ...login, password_in_keychain: false }
      : { ...login, gs_password: '', host_password: '' };
  }

  getGciLibraryPath(version: string): string | undefined {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = config.get<Record<string, string>>('gciLibraries', {});
    return libraries[version];
  }

  async setGciLibraryPath(version: string, libraryPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = { ...config.get<Record<string, string>>('gciLibraries', {}) };
    libraries[version] = libraryPath;
    await config.update('gciLibraries', libraries, vscode.ConfigurationTarget.Global);
  }

  async removeGciLibraryPath(version: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gemstone');
    const libraries = { ...config.get<Record<string, string>>('gciLibraries', {}) };
    delete libraries[version];
    await config.update('gciLibraries', libraries, vscode.ConfigurationTarget.Global);
  }
}
