import { describe, it, expect, beforeEach, onTestFinished, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  __configUpdates,
  __resetConfig,
  __setConfig,
  __setConfigLayers,
  ConfigurationTarget,
  window,
  workspace,
} from '../__mocks__/vscode';
import { ASK_AT_LOGIN, LoginStorage, SAVE_AS_PLAIN_TEXT } from '../loginStorage';
import { fakeSecretStorage } from './support/secretStorage';
import { GemStoneLogin, DEFAULT_LOGIN, buildDataCuratorLogin, loginLabel } from '../loginTypes';

// Plain text by default: most tests here are about the list, not the keychain.
// Labelled, as `saveLogin` stores every login.
function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  const login = { ...DEFAULT_LOGIN, password_in_keychain: false, ...overrides };
  return { ...login, label: loginLabel(login) };
}

const GS_KEY = 'jasper-gemstone-login:DataCurator@localhost/gs64stone';
const HOST_KEY = `${GS_KEY}#host`;

describe('LoginStorage', () => {
  let storage: LoginStorage;
  let secrets: ReturnType<typeof fakeSecretStorage>;

  beforeEach(() => {
    __resetConfig();
    vi.clearAllMocks();
    secrets = fakeSecretStorage();
    storage = new LoginStorage(secrets);
  });

  describe('getLogins', () => {
    it('returns empty array when no logins configured', () => {
      expect(storage.getLogins()).toEqual([]);
    });

    it('gives a login stored without a label, as Quick Setup used to save one, its label', () => {
      __setConfig('gemstone', 'logins', [{ ...makeLogin(), label: '' }]);

      expect(storage.getLogins()[0].label).toBe(loginLabel(makeLogin()));
    });

    it('returns configured logins', () => {
      const logins = [makeLogin({ stone: 'stoneA' }), makeLogin({ stone: 'stoneB' })];
      __setConfig('gemstone', 'logins', logins);
      expect(storage.getLogins()).toEqual(logins);
    });
  });

  describe('saveLogin', () => {
    it('adds a new login to empty list', async () => {
      const login = makeLogin({ stone: 'mystone' });
      await storage.saveLogin(login);
      expect(storage.getLogins()).toEqual([login]);
    });

    it('adds a new login to existing list', async () => {
      const existing = makeLogin({ stone: 'stoneA' });
      __setConfig('gemstone', 'logins', [existing]);

      const newLogin = makeLogin({ stone: 'stoneB' });
      await storage.saveLogin(newLogin);

      expect(storage.getLogins()).toEqual([existing, newLogin]);
    });

    it('updates an existing login by matching generated label', async () => {
      const login = makeLogin({ stone: 'prod', gem_host: 'old-host' });
      __setConfig('gemstone', 'logins', [login]);

      const updated = makeLogin({ stone: 'prod', gem_host: 'old-host', gs_password: 'newpass' });
      await storage.saveLogin(updated);

      const result = storage.getLogins();
      expect(result).toHaveLength(1);
      expect(result[0].gs_password).toBe('newpass');
    });

    it('gives a login saved without a label, as the Databases panel makes one, its label', async () => {
      const created = buildDataCuratorLogin({
        version: '3.7.5',
        stoneName: 'devStone',
        ldiName: 'devLdi',
      });

      await storage.saveLogin(created);

      expect(storage.getLogins()[0].label).toBe(loginLabel(created));
    });

    it('supports renaming via originalLabel', async () => {
      const login = makeLogin({ stone: 'old-stone' });
      __setConfig('gemstone', 'logins', [login]);

      const updated = makeLogin({ stone: 'new-stone' });
      await storage.saveLogin(updated, loginLabel(login));

      const result = storage.getLogins();
      expect(result).toHaveLength(1);
      expect(result[0].stone).toBe('new-stone');
    });

    it('adds as new if originalLabel not found', async () => {
      const existing = makeLogin({ stone: 'stoneA' });
      __setConfig('gemstone', 'logins', [existing]);

      const newLogin = makeLogin({ stone: 'stoneB' });
      await storage.saveLogin(newLogin, 'Nonexistent');

      expect(storage.getLogins()).toHaveLength(2);
    });
  });

  describe('deleteLogin', () => {
    it('removes a login by generated label', async () => {
      __setConfig('gemstone', 'logins', [
        makeLogin({ stone: 'stoneA' }),
        makeLogin({ stone: 'stoneB' }),
        makeLogin({ stone: 'stoneC' }),
      ]);

      await storage.deleteLogin(loginLabel(makeLogin({ stone: 'stoneB' })));

      const result = storage.getLogins();
      expect(result).toHaveLength(2);
      expect(result.map((l) => l.stone)).toEqual(['stoneA', 'stoneC']);
    });

    it('does nothing when label not found', async () => {
      __setConfig('gemstone', 'logins', [makeLogin({ stone: 'stoneA' })]);
      await storage.deleteLogin('Nonexistent');
      expect(storage.getLogins()).toHaveLength(1);
    });

    it('handles deleting from empty list', async () => {
      await storage.deleteLogin('Anything');
      expect(storage.getLogins()).toEqual([]);
    });
  });

  describe('removeGciLibraryPath', () => {
    it('forgets one version and keeps the rest', async () => {
      __setConfig('gemstone', 'gciLibraries', { '3.7.5': '/a.so', '3.7.4': '/b.so' });
      await storage.removeGciLibraryPath('3.7.5');
      expect(storage.getGciLibraryPath('3.7.5')).toBeUndefined();
      expect(storage.getGciLibraryPath('3.7.4')).toBe('/b.so');
    });
  });

  describe('passwords in the keychain', () => {
    const keychainLogin = (overrides: Partial<GemStoneLogin> = {}) =>
      makeLogin({ password_in_keychain: true, host_password: 'hostpw', ...overrides });

    it('stores both passwords in the keychain and saves the login without them', async () => {
      await storage.saveLogin(keychainLogin());

      expect(secrets.entries.get(GS_KEY)).toBe(DEFAULT_LOGIN.gs_password);
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
      expect(storage.getLogins()[0]).toMatchObject({ gs_password: '', host_password: '' });
    });

    it('keeps both passwords when the login is saved again under the same name', async () => {
      const before = keychainLogin();
      await storage.saveLogin(before);

      await storage.saveLogin({ ...before, version: '3.7.5' }, loginLabel(before));

      expect(secrets.entries.get(GS_KEY)).toBe(DEFAULT_LOGIN.gs_password);
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
    });

    it('moves the entry to the new name when the user, host or stone changes', async () => {
      const before = keychainLogin();
      await storage.saveLogin(before);

      await storage.saveLogin(keychainLogin({ stone: 'renamed' }), loginLabel(before));

      expect([...secrets.entries.keys()].sort()).toEqual([
        'jasper-gemstone-login:DataCurator@localhost/renamed',
        'jasper-gemstone-login:DataCurator@localhost/renamed#host',
      ]);
    });

    it('keeps the old entries when the settings cannot be written', async () => {
      const before = keychainLogin();
      await storage.saveLogin(before);
      const real = workspace.getConfiguration;
      const failingWrites = vi.spyOn(workspace, 'getConfiguration');
      onTestFinished(() => failingWrites.mockRestore());
      failingWrites.mockImplementation((section: string) => ({
        ...real(section),
        update: vi.fn(async () => {
          throw new Error('settings.json is invalid');
        }),
      }));

      await expect(
        storage.saveLogin(keychainLogin({ stone: 'renamed' }), loginLabel(before)),
      ).rejects.toThrow('settings.json is invalid');
      await expect(storage.deleteLogin(loginLabel(before))).rejects.toThrow();

      expect(secrets.entries.get(GS_KEY)).toBe(DEFAULT_LOGIN.gs_password);
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
    });

    it('deletes the entries when the box is unchecked', async () => {
      await storage.saveLogin(keychainLogin());

      await storage.saveLogin(makeLogin({ gs_password: 'plain' }));

      expect(secrets.entries.size).toBe(0);
      expect(storage.getLogins()[0].gs_password).toBe('plain');
    });

    it('deletes the entries with the login', async () => {
      const login = keychainLogin();
      await storage.saveLogin(login);

      await storage.deleteLogin(loginLabel(login));

      expect(secrets.entries.size).toBe(0);
    });

    describe('when the keychain cannot be written', () => {
      beforeEach(() => {
        // An older entry under the same name, which must not be used at login.
        secrets.entries.set(GS_KEY, 'old-gs');
        secrets.entries.set(HOST_KEY, 'old-host');
        secrets.store.mockRejectedValueOnce(new Error('no keyring'));
      });

      it('asks whether to save the passwords as plain text or not at all', async () => {
        await storage.saveLogin(keychainLogin());

        expect(window.showWarningMessage).toHaveBeenCalledWith(
          expect.stringContaining('no keyring'),
          expect.objectContaining({ modal: true }),
          SAVE_AS_PLAIN_TEXT,
          ASK_AT_LOGIN,
        );
      });

      it("names GemStone's default password, so a login left unsaved can still be answered", async () => {
        await storage.saveLogin(keychainLogin());

        expect(window.showWarningMessage).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            detail: expect.stringContaining(`default, ${DEFAULT_LOGIN.gs_password}.`),
          }),
          SAVE_AS_PLAIN_TEXT,
          ASK_AT_LOGIN,
        );
      });

      it('saves them as plain text, with the box unchecked, when the user chooses that', async () => {
        vi.mocked(window.showWarningMessage).mockResolvedValueOnce(SAVE_AS_PLAIN_TEXT);

        await storage.saveLogin(keychainLogin());

        expect(storage.getLogins()[0]).toMatchObject({
          gs_password: DEFAULT_LOGIN.gs_password,
          host_password: 'hostpw',
          password_in_keychain: false,
        });
        expect(secrets.entries.size).toBe(0);
      });

      it('saves no passwords, so they are asked for at login, when the dialog is closed', async () => {
        await storage.saveLogin(keychainLogin());

        expect(storage.getLogins()[0]).toMatchObject({
          gs_password: '',
          host_password: '',
          password_in_keychain: true,
        });
        expect(secrets.entries.size).toBe(0);
      });
    });
  });

  describe('movePasswordsToKeychain', () => {
    it('moves plain-text passwords into the keychain, in the settings file that held them', async () => {
      const plain = makeLogin({ host_password: 'hostpw' });
      const empty = makeLogin({ stone: 'other', gs_password: '' });
      __setConfig('gemstone', 'logins', [plain, empty], 'workspace');

      expect(await storage.movePasswordsToKeychain(new Set([loginLabel(plain)]))).toBe(true);

      expect(secrets.entries.get(GS_KEY)).toBe(DEFAULT_LOGIN.gs_password);
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
      expect(__configUpdates.at(-1)).toMatchObject({
        key: 'logins',
        target: ConfigurationTarget.Workspace,
      });
      expect(storage.getLogins()).toEqual([
        { ...plain, gs_password: '', host_password: '', password_in_keychain: true },
        empty,
      ]);
    });

    it('keeps a GemStone password already in the keychain when moving the host password beside it', async () => {
      secrets.entries.set(GS_KEY, 'kc-gs');
      const login = makeLogin({
        gs_password: '',
        host_password: 'hostpw',
        password_in_keychain: true,
      });
      __setConfig('gemstone', 'logins', [login]);

      await storage.movePasswordsToKeychain(new Set([loginLabel(login)]));

      expect(secrets.entries.get(GS_KEY)).toBe('kc-gs');
      expect(secrets.entries.get(HOST_KEY)).toBe('hostpw');
    });

    it('leaves everything as it was when the GemStone password beside it cannot be read', async () => {
      secrets.entries.set(GS_KEY, 'kc-gs');
      secrets.get.mockRejectedValue(new Error('keyring locked'));
      const login = makeLogin({
        gs_password: '',
        host_password: 'hostpw',
        password_in_keychain: true,
      });
      __setConfig('gemstone', 'logins', [login]);

      expect(await storage.movePasswordsToKeychain(new Set([loginLabel(login)]))).toBe(false);

      expect(secrets.entries.get(GS_KEY)).toBe('kc-gs');
      expect(secrets.entries.has(HOST_KEY)).toBe(false);
      expect(storage.getLogins()).toEqual([login]);
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('keyring locked'),
      );
    });

    it('moves only the login in effect, leaving a copy the workspace hides as it is', async () => {
      const hidden = makeLogin({ gs_password: 'old-pw' });
      const inUse = makeLogin({ gs_password: 'new-pw' });
      __setConfigLayers('gemstone', 'logins', { global: [hidden], workspace: [inUse] });

      await storage.movePasswordsToKeychain(new Set([loginLabel(inUse)]));

      expect(secrets.entries.get(GS_KEY)).toBe('new-pw');
      expect(workspace.getConfiguration('gemstone').inspect('logins')).toMatchObject({
        globalValue: [hidden],
        workspaceValue: [{ ...inUse, gs_password: '', password_in_keychain: true }],
      });
    });

    it('never lets a hidden plain-text copy overwrite the password the login in use keeps', async () => {
      secrets.entries.set(GS_KEY, 'current-pw');
      const hidden = makeLogin({ gs_password: 'old-pw' });
      const inUse = makeLogin({ gs_password: '', password_in_keychain: true });
      __setConfigLayers('gemstone', 'logins', { global: [hidden], workspace: [inUse] });

      await storage.movePasswordsToKeychain(new Set([loginLabel(hidden)]));

      expect(secrets.entries.get(GS_KEY)).toBe('current-pw');
    });

    it('leaves a plain-text login it was not given where it is', async () => {
      const moved = makeLogin();
      const kept = makeLogin({ stone: 'kept', host_password: 'kept-host' });
      __setConfig('gemstone', 'logins', [moved, kept]);

      await storage.movePasswordsToKeychain(new Set([loginLabel(moved)]));

      expect(storage.getLogins()[1]).toEqual(kept);
      expect([...secrets.entries.keys()]).toEqual([GS_KEY]);
    });

    it('leaves the settings file alone when the keychain cannot be written', async () => {
      secrets.store.mockRejectedValueOnce(new Error('no keyring'));
      const plain = makeLogin();
      __setConfig('gemstone', 'logins', [plain]);

      expect(await storage.movePasswordsToKeychain(new Set([loginLabel(plain)]))).toBe(false);

      expect(storage.getLogins()).toEqual([plain]);
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('still in your settings file'),
      );
    });
  });
});
