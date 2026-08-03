import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { __resetConfig, __setConfig } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { GemStoneLogin, DEFAULT_LOGIN, loginLabel } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, ...overrides };
}

describe('LoginStorage', () => {
  let storage: LoginStorage;

  beforeEach(() => {
    __resetConfig();
    storage = new LoginStorage();
  });

  describe('getLogins', () => {
    it('returns empty array when no logins configured', () => {
      expect(storage.getLogins()).toEqual([]);
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
});
