import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  KEYCHAIN_SERVICE,
  loginCredentialAccount,
  setLoginPassword,
  getLoginPassword,
  deleteLoginPassword,
} from '../loginCredentials';
import { GemStoneLogin } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return {
    label: 'Test',
    version: '3.7.4',
    gem_host: 'localhost',
    stone: 'gs64stone',
    gs_user: 'DataCurator',
    gs_password: 'swordfish',
    netldi: 'gs64ldi',
    host_user: '',
    host_password: '',
    ...overrides,
  };
}

function makeSecrets() {
  return {
    get: vi.fn(async (_k: string) => undefined as string | undefined),
    store: vi.fn(async (_k: string, _v: string) => undefined),
    delete: vi.fn(async (_k: string) => undefined),
    onDidChange: vi.fn(),
  };
}

describe('loginCredentials', () => {
  let secrets: ReturnType<typeof makeSecrets>;

  beforeEach(() => {
    secrets = makeSecrets();
  });

  describe('KEYCHAIN_SERVICE', () => {
    it('is distinct from the MCP service', () => {
      expect(KEYCHAIN_SERVICE).toBe('jasper-gemstone-login');
    });
  });

  describe('loginCredentialAccount', () => {
    it('combines user, host, and stone', () => {
      expect(loginCredentialAccount(makeLogin())).toBe('DataCurator@localhost/gs64stone');
    });

    it('differs for different users on the same stone', () => {
      const a = loginCredentialAccount(makeLogin({ gs_user: 'DataCurator' }));
      const b = loginCredentialAccount(makeLogin({ gs_user: 'SystemUser' }));
      expect(a).not.toBe(b);
    });

    it('differs for the same user on different stones', () => {
      const a = loginCredentialAccount(makeLogin({ stone: 'dev' }));
      const b = loginCredentialAccount(makeLogin({ stone: 'prod' }));
      expect(a).not.toBe(b);
    });
  });

  describe('setLoginPassword', () => {
    it('stores under a key namespaced by KEYCHAIN_SERVICE and the account identifier', async () => {
      await setLoginPassword(secrets, makeLogin());

      expect(secrets.store).toHaveBeenCalledWith(
        'jasper-gemstone-login:DataCurator@localhost/gs64stone',
        'swordfish',
      );
    });
  });

  describe('getLoginPassword', () => {
    it('returns the stored password from SecretStorage', async () => {
      secrets.get.mockResolvedValueOnce('stored-pw');
      const pw = await getLoginPassword(secrets, makeLogin());

      expect(secrets.get).toHaveBeenCalledWith(
        'jasper-gemstone-login:DataCurator@localhost/gs64stone',
      );
      expect(pw).toBe('stored-pw');
    });

    it('returns undefined when no password is stored', async () => {
      secrets.get.mockResolvedValueOnce(undefined);
      const pw = await getLoginPassword(secrets, makeLogin());
      expect(pw).toBeUndefined();
    });

    it('returns undefined when SecretStorage throws', async () => {
      secrets.get.mockRejectedValueOnce(new Error('SecretStorage unavailable'));
      const pw = await getLoginPassword(secrets, makeLogin());
      expect(pw).toBeUndefined();
    });
  });

  describe('deleteLoginPassword', () => {
    it('delegates to SecretStorage.delete and returns true on success', async () => {
      const ok = await deleteLoginPassword(secrets, makeLogin());

      expect(secrets.delete).toHaveBeenCalledWith(
        'jasper-gemstone-login:DataCurator@localhost/gs64stone',
      );
      expect(ok).toBe(true);
    });

    it('returns false when SecretStorage throws', async () => {
      secrets.delete.mockRejectedValueOnce(new Error('no entry'));
      const ok = await deleteLoginPassword(secrets, makeLogin());
      expect(ok).toBe(false);
    });
  });
});
