import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOGIN,
  GemStoneLogin,
  buildDataCuratorLogin,
  dataCuratorLoginToCreate,
  gemNrsFor,
  loginLabel,
  loginTargetKey,
  netldiNameFromGemNrs,
  parseStoneNrs,
  sameLoginTarget,
  sessionsForLogin,
  shouldSyncClasses,
  stoneNrsFor,
} from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, ...overrides };
}

function makeSession(login: GemStoneLogin, id: number): { id: number; login: GemStoneLogin } {
  return { id, login };
}

describe('loginLabel', () => {
  it('formats user, stone, and host', () => {
    expect(loginLabel(makeLogin({ gs_user: 'Admin', stone: 'prod', gem_host: 'db' }))).toBe(
      'Admin on prod (db)',
    );
  });
});

describe('sameLoginTarget', () => {
  it('is true for identical targets', () => {
    expect(sameLoginTarget(makeLogin(), makeLogin())).toBe(true);
  });

  it('ignores fields that do not identify the connection (label, password, version)', () => {
    const a = makeLogin({ label: 'Dev', gs_password: 'x', version: '3.7.2' });
    const b = makeLogin({ label: 'Prod', gs_password: 'y', version: '3.6.0' });
    expect(sameLoginTarget(a, b)).toBe(true);
  });

  it.each(['gem_host', 'stone', 'gs_user', 'netldi'] as const)(
    'is false when %s differs',
    (field) => {
      expect(sameLoginTarget(makeLogin(), makeLogin({ [field]: 'different' }))).toBe(false);
    },
  );
});

describe('loginTargetKey', () => {
  it('is equal for two logins with the same connection target', () => {
    const a = makeLogin({ label: 'Dev', gs_password: 'x', version: '3.7.2' });
    const b = makeLogin({ label: 'Prod', gs_password: 'y', version: '3.6.0' });

    expect(loginTargetKey(a)).toBe(loginTargetKey(b));
  });

  it.each(['gem_host', 'stone', 'gs_user', 'netldi'] as const)(
    'differs when %s differs',
    (field) => {
      expect(loginTargetKey(makeLogin())).not.toBe(
        loginTargetKey(makeLogin({ [field]: 'different' })),
      );
    },
  );

  it('agrees with sameLoginTarget on whether two logins share a target', () => {
    const base = makeLogin();
    const sameTarget = makeLogin({ label: 'other', gs_password: 'other' });
    const otherTarget = makeLogin({ stone: 'another' });

    expect(loginTargetKey(base) === loginTargetKey(sameTarget)).toBe(
      sameLoginTarget(base, sameTarget),
    );
    expect(loginTargetKey(base) === loginTargetKey(otherTarget)).toBe(
      sameLoginTarget(base, otherTarget),
    );
  });
});

describe('sessionsForLogin', () => {
  const dev = makeLogin({ label: 'Dev', stone: 'devstone' });
  const prod = makeLogin({ label: 'Prod', stone: 'prodstone' });
  const logins = [dev, prod]; // dev = index 0, prod = index 1

  it('nests each session under the login whose target it matches', () => {
    const sessions = [makeSession(prod, 1), makeSession(dev, 2)];
    expect(sessionsForLogin(0, logins, sessions).map((s) => s.id)).toEqual([2]);
    expect(sessionsForLogin(1, logins, sessions).map((s) => s.id)).toEqual([1]);
  });

  it('returns an empty array for a login with no matching session', () => {
    expect(sessionsForLogin(0, logins, [makeSession(prod, 1)])).toEqual([]);
  });

  it('matches by position, not object identity (logins re-fetched as fresh copies)', () => {
    const sessions = [makeSession(dev, 2)];
    // Simulate a separate getLogins() call returning value-equal but distinct objects.
    const freshLogins = [{ ...dev }, { ...prod }];
    expect(sessionsForLogin(0, freshLogins, sessions).map((s) => s.id)).toEqual([2]);
  });

  it('assigns a session to the first matching login when two configs share a target', () => {
    const a = makeLogin({ label: 'A' });
    const b = makeLogin({ label: 'B' }); // same target tuple as A
    const dupLogins = [a, b];
    const sessions = [makeSession(b, 7)];
    expect(sessionsForLogin(0, dupLogins, sessions).map((s) => s.id)).toEqual([7]);
    expect(sessionsForLogin(1, dupLogins, sessions)).toEqual([]);
  });
});

describe('stoneNrsFor / parseStoneNrs', () => {
  it('parses back the gem_host and stone that built the NRS', () => {
    const login = makeLogin({ gem_host: 'db.example.com', stone: 'prodstone' });

    const parsed = parseStoneNrs(stoneNrsFor(login));

    expect(parsed).toEqual({ gem_host: 'db.example.com', stone: 'prodstone' });
  });

  it('returns undefined for a string that is not a stone NRS', () => {
    expect(parseStoneNrs('not a stone nrs')).toBeUndefined();
  });

  it('returns undefined for a gem NRS (wrong NRS shape)', () => {
    const login = makeLogin({ gem_host: 'db.example.com', netldi: 'gs64ldi' });

    expect(parseStoneNrs(gemNrsFor(login))).toBeUndefined();
  });
});

describe('netldiNameFromGemNrs', () => {
  it('extracts the netldi name that built the NRS', () => {
    const login = makeLogin({ gem_host: 'db.example.com', netldi: 'jasper-test-ldi' });

    expect(netldiNameFromGemNrs(gemNrsFor(login))).toBe('jasper-test-ldi');
  });

  it('returns undefined for a string with no #netldi: segment', () => {
    expect(netldiNameFromGemNrs('!tcp@localhost#server!gs64stone')).toBeUndefined();
  });
});

describe('shouldSyncClasses', () => {
  it('defaults to true when unset (existing logins keep syncing)', () => {
    expect(shouldSyncClasses({})).toBe(true);
    expect(shouldSyncClasses({ sync_classes: undefined })).toBe(true);
  });

  it('is true when explicitly enabled', () => {
    expect(shouldSyncClasses({ sync_classes: true })).toBe(true);
  });

  it('is false only when explicitly disabled', () => {
    expect(shouldSyncClasses({ sync_classes: false })).toBe(false);
  });
});

describe('buildDataCuratorLogin', () => {
  const config = { version: '3.7.5', stoneName: 'devStone', ldiName: 'devLdi' };

  it('targets the DataCurator account on the given stone and NetLDI', () => {
    const login = buildDataCuratorLogin(config);

    expect(login.gs_user).toBe('DataCurator');
    expect(login.stone).toBe('devStone');
    expect(login.netldi).toBe('devLdi');
    expect(login.version).toBe('3.7.5');
    expect(login.gem_host).toBe('localhost');
  });

  it('prefills the stock DataCurator password for a freshly-created stone', () => {
    const login = buildDataCuratorLogin(config);

    expect(login.gs_password).toBe('swordfish');
  });
});

describe('dataCuratorLoginToCreate', () => {
  const config = { version: '3.7.5', stoneName: 'devStone', ldiName: 'devLdi' };

  it('proposes a DataCurator login when none targets the new stone', () => {
    const created = dataCuratorLoginToCreate([], config);

    expect(created?.gs_user).toBe('DataCurator');
    expect(created?.stone).toBe('devStone');
  });

  it('proposes nothing when a login already targets the stone', () => {
    const existing = [buildDataCuratorLogin(config)];

    const created = dataCuratorLoginToCreate(existing, config);

    expect(created).toBeUndefined();
  });

  it('still proposes one when an existing login is for a different user on the stone', () => {
    const otherUser: GemStoneLogin = { ...buildDataCuratorLogin(config), gs_user: 'SystemUser' };

    const created = dataCuratorLoginToCreate([otherUser], config);

    expect(created?.gs_user).toBe('DataCurator');
  });
});
