/**
 * Secret storage for Jasper login passwords, backed by VS Code's
 * SecretStorage API (which delegates to the OS keychain on each platform).
 *
 * Keys are namespaced with `KEYCHAIN_SERVICE` so they don't collide with
 * other secrets the extension might store in the future.
 */

import * as vscode from 'vscode';
import { GemStoneLogin, loginLabel } from './loginTypes';

export const KEYCHAIN_SERVICE = 'jasper-gemstone-login';

type LoginIdentity = Pick<GemStoneLogin, 'gs_user' | 'gem_host' | 'stone'>;

export type LoginPasswords = Pick<GemStoneLogin, 'gs_password' | 'host_password'>;

/** Build a unique account identifier for a login. */
export function loginCredentialAccount(login: LoginIdentity): string {
  return `${login.gs_user}@${login.gem_host}/${login.stone}`;
}

// The GemStone password's key has no suffix: entries saved before the host
// password could be kept here must still be found.
function secretKeys(login: LoginIdentity): Record<keyof LoginPasswords, string> {
  const base = `${KEYCHAIN_SERVICE}:${loginCredentialAccount(login)}`;
  return { gs_password: base, host_password: `${base}#host` };
}

/** An empty password deletes its entry. Throws when SecretStorage can't be written. */
export async function storeLoginPasswords(
  secrets: vscode.SecretStorage,
  login: GemStoneLogin,
): Promise<void> {
  const keys = secretKeys(login);
  for (const field of ['gs_password', 'host_password'] as const) {
    if (login[field]) {
      await secrets.store(keys[field], login[field]);
    } else {
      await secrets.delete(keys[field]);
    }
  }
}

/**
 * A password missing comes back ''; throws when SecretStorage can't be read.
 * For a caller that writes the passwords back, where '' would delete the entry.
 */
export async function readLoginPasswords(
  secrets: vscode.SecretStorage,
  login: LoginIdentity,
): Promise<LoginPasswords> {
  const keys = secretKeys(login);
  const [gs_password, host_password] = await Promise.all([
    secrets.get(keys.gs_password),
    secrets.get(keys.host_password),
  ]);
  return { gs_password: gs_password ?? '', host_password: host_password ?? '' };
}

/**
 * For a caller that asks for a password it doesn't have: a password missing
 * comes back '', and so do both when SecretStorage can't be read, after telling
 * the user so and what happens instead (`ifUnreadable`).
 */
export async function getLoginPasswords(
  secrets: vscode.SecretStorage,
  login: LoginIdentity,
  ifUnreadable: string,
): Promise<LoginPasswords> {
  try {
    return await readLoginPasswords(secrets, login);
  } catch (e) {
    void vscode.window.showWarningMessage(
      `Couldn't read the passwords for "${loginLabel(login)}" from the OS keychain ` +
        `(${e instanceof Error ? e.message : String(e)}). ${ifUnreadable}`,
    );
    return { gs_password: '', host_password: '' };
  }
}

/** Best effort: each entry is tried on its own, and a failure is ignored. */
export async function deleteLoginPasswords(
  secrets: vscode.SecretStorage,
  login: LoginIdentity,
): Promise<void> {
  const keys = secretKeys(login);
  await Promise.allSettled([secrets.delete(keys.gs_password), secrets.delete(keys.host_password)]);
}
