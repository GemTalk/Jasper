import { describe, it, expect, vi } from 'vitest';
// databaseForLogin now imports versionsMatch from processManager, which pulls
// in vscode; mock it so this pure-logic test still runs headless.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { findDatabaseForLogin, sessionsOnDatabase } from '../databaseForLogin';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';
import { GemStoneDatabase } from '../sysadminTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, ...overrides };
}

function makeDb(
  dirName: string,
  config: Partial<GemStoneDatabase['config']> = {},
): GemStoneDatabase {
  return {
    dirName,
    path: `/root/${dirName}`,
    config: {
      version: '3.7.5',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
      ...config,
    },
  };
}

describe('findDatabaseForLogin', () => {
  it('finds the database whose stone and version match the login', () => {
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.7.5' });
    const others = [makeDb('db-2', { stoneName: 'beta' })];

    const found = findDatabaseForLogin(makeLogin({ stone: 'alpha', version: '3.7.5' }), [
      ...others,
      db,
    ]);

    expect(found).toBe(db);
  });

  it('matches when one version is a dotted prefix of the other', () => {
    // gslist and database.yaml disagree on precision; versionsMatch treats
    // "3.7.4" and "3.7.4.3" as the same install.
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.7.4.3' });

    expect(findDatabaseForLogin(makeLogin({ stone: 'alpha', version: '3.7.4' }), [db])).toBe(db);
  });

  it('does not match a different version of the same stone name', () => {
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.6.2' });

    expect(
      findDatabaseForLogin(makeLogin({ stone: 'alpha', version: '3.7.5' }), [db]),
    ).toBeUndefined();
  });

  it('picks the right database when the stone name is reused across versions', () => {
    const older = makeDb('db-1', { stoneName: 'alpha', version: '3.6.2' });
    const newer = makeDb('db-2', { stoneName: 'alpha', version: '3.7.5' });

    expect(
      findDatabaseForLogin(makeLogin({ stone: 'alpha', version: '3.7.5' }), [older, newer]),
    ).toBe(newer);
  });

  it('returns undefined for a remote login — Jasper can only start local databases', () => {
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.7.5' });

    expect(
      findDatabaseForLogin(
        makeLogin({ stone: 'alpha', version: '3.7.5', gem_host: 'db.example.com' }),
        [db],
      ),
    ).toBeUndefined();
  });

  it('treats 127.0.0.1 as local', () => {
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.7.5' });

    expect(
      findDatabaseForLogin(makeLogin({ stone: 'alpha', version: '3.7.5', gem_host: '127.0.0.1' }), [
        db,
      ]),
    ).toBe(db);
  });

  it('treats the IPv6 loopback as local', () => {
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.7.5' });

    expect(
      findDatabaseForLogin(makeLogin({ stone: 'alpha', version: '3.7.5', gem_host: '::1' }), [db]),
    ).toBe(db);
  });

  it('treats a bracketed IPv6 loopback as local', () => {
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.7.5' });

    expect(
      findDatabaseForLogin(makeLogin({ stone: 'alpha', version: '3.7.5', gem_host: '[::1]' }), [
        db,
      ]),
    ).toBe(db);
  });

  it('returns undefined when no database has that stone name', () => {
    expect(
      findDatabaseForLogin(makeLogin({ stone: 'nope' }), [makeDb('db-1', { stoneName: 'alpha' })]),
    ).toBeUndefined();
  });

  it('returns undefined when there are no databases at all', () => {
    expect(findDatabaseForLogin(makeLogin(), [])).toBeUndefined();
  });
});

describe('sessionsOnDatabase', () => {
  // A login pairs to a database on stone name *and* version, so every session
  // here carries the version its stone was made with.
  const session = (id: number, login: Partial<GemStoneLogin>) => ({
    id,
    login: makeLogin({ version: '3.7.5', ...login }),
  });

  it('finds the sessions logged into the database', () => {
    const db = makeDb('db-1', { stoneName: 'alpha' });
    const sessions = [
      session(1, { stone: 'alpha' }),
      session(2, { stone: 'beta' }),
      session(3, { stone: 'alpha' }),
    ];

    const found = sessionsOnDatabase(db, sessions, [db, makeDb('db-2', { stoneName: 'beta' })]);

    expect(found.map((s) => s.id)).toEqual([1, 3]);
  });

  it('leaves alone a session on a same-named stone of another version', () => {
    // Reaping this one would log a user out of a database that is still running.
    const db = makeDb('db-1', { stoneName: 'alpha', version: '3.7.5' });
    const other = makeDb('db-2', { stoneName: 'alpha', version: '3.6.2' });

    const found = sessionsOnDatabase(
      db,
      [session(1, { stone: 'alpha', version: '3.6.2' })],
      [db, other],
    );

    expect(found).toEqual([]);
  });

  it('leaves alone a session on a remote stone of the same name', () => {
    const db = makeDb('db-1', { stoneName: 'alpha' });

    const found = sessionsOnDatabase(
      db,
      [session(1, { stone: 'alpha', gem_host: 'elsewhere' })],
      [db],
    );

    expect(found).toEqual([]);
  });

  it('finds nothing when no session targets the database', () => {
    const db = makeDb('db-1', { stoneName: 'alpha' });

    expect(sessionsOnDatabase(db, [], [db])).toEqual([]);
  });
});
