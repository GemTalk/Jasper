import { describe, it, expect, vi } from 'vitest';
// databaseForLogin now imports versionsMatch from processManager, which pulls
// in vscode; mock it so this pure-logic test still runs headless.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { findDatabaseForLogin } from '../databaseForLogin';
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

  it('returns undefined when no database has that stone name', () => {
    expect(
      findDatabaseForLogin(makeLogin({ stone: 'nope' }), [makeDb('db-1', { stoneName: 'alpha' })]),
    ).toBeUndefined();
  });

  it('returns undefined when there are no databases at all', () => {
    expect(findDatabaseForLogin(makeLogin(), [])).toBeUndefined();
  });
});
