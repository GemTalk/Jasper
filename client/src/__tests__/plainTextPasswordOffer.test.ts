import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import type * as vscode from 'vscode';
import { __resetConfig, __setConfig, __setConfigLayers, window } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { DEFAULT_LOGIN, GemStoneLogin, loginLabel } from '../loginTypes';
import { MOVE, offerToMovePlainTextPasswords } from '../plainTextPasswordOffer';
import { fakeSecretStorage } from './support/secretStorage';

// Labelled, as `getLogins` reads every login.
function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  const login = { ...DEFAULT_LOGIN, password_in_keychain: false, ...overrides };
  return { ...login, label: loginLabel(login) };
}

function fakeMemento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: <T>(key: string, fallback?: T) => (values.has(key) ? values.get(key) : fallback),
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

describe('offering to move plain-text passwords to the keychain', () => {
  let secrets: ReturnType<typeof fakeSecretStorage>;
  let storage: LoginStorage;
  let state: vscode.Memento;

  beforeEach(() => {
    __resetConfig();
    vi.clearAllMocks();
    secrets = fakeSecretStorage();
    storage = new LoginStorage(secrets);
    state = fakeMemento();
  });

  it('moves the passwords, and says so, when the button is clicked', async () => {
    __setConfig('gemstone', 'logins', [makeLogin()]);
    vi.mocked(window.showInformationMessage).mockResolvedValueOnce(MOVE);

    await offerToMovePlainTextPasswords(storage, state);

    expect(storage.getLogins()[0]).toMatchObject({ gs_password: '', password_in_keychain: true });
    expect(secrets.entries.size).toBe(1);
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      'Login passwords moved to the OS keychain.',
    );
  });

  it('says why, and leaves the login as it was, when the keychain cannot be written', async () => {
    const plain = makeLogin();
    __setConfig('gemstone', 'logins', [plain]);
    vi.mocked(window.showInformationMessage).mockResolvedValueOnce(MOVE);
    secrets.store.mockRejectedValueOnce(new Error('no keyring'));

    await offerToMovePlainTextPasswords(storage, state);

    expect(storage.getLogins()).toEqual([plain]);
    expect(window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('no keyring'));
    expect(window.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('leaves the login alone when the toast is dismissed, and does not ask about it again', async () => {
    const plain = makeLogin();
    __setConfig('gemstone', 'logins', [plain]);

    await offerToMovePlainTextPasswords(storage, state);
    await offerToMovePlainTextPasswords(storage, state);

    expect(window.showInformationMessage).toHaveBeenCalledTimes(1);
    expect(storage.getLogins()).toEqual([plain]);
  });

  it('asks about a new plain-text login alone, and moves only that one', async () => {
    const declined = makeLogin();
    __setConfig('gemstone', 'logins', [declined]);
    await offerToMovePlainTextPasswords(storage, state);
    const added = makeLogin({ stone: 'other' });
    __setConfig('gemstone', 'logins', [declined, added]);
    vi.mocked(window.showInformationMessage).mockResolvedValueOnce(MOVE);

    await offerToMovePlainTextPasswords(storage, state);

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'The GemStone login "DataCurator on other (localhost)" keeps its password as plain text in your VS Code settings.',
      MOVE,
    );
    expect(storage.getLogins()).toEqual([
      declined,
      { ...added, gs_password: '', password_in_keychain: true },
    ]);
  });

  it('asks only about the logins in effect, not a user-settings copy the workspace hides', async () => {
    const hidden = makeLogin({ gs_password: 'old-pw' });
    const inUse = makeLogin({ gs_password: '', password_in_keychain: true });
    secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone', 'current-pw');
    __setConfigLayers('gemstone', 'logins', { global: [hidden], workspace: [inUse] });

    await offerToMovePlainTextPasswords(storage, state);

    expect(window.showInformationMessage).not.toHaveBeenCalled();
    expect(secrets.entries.get('jasper-gemstone-login:DataCurator@localhost/gs64stone')).toBe(
      'current-pw',
    );
  });

  it('says nothing when no login keeps a password in plain text', async () => {
    __setConfig('gemstone', 'logins', [makeLogin({ gs_password: '', password_in_keychain: true })]);

    await offerToMovePlainTextPasswords(storage, state);

    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
