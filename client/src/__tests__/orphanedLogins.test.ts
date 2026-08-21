import { describe, it, expect } from 'vitest';
import { loginsTargetingStone, buildDataCuratorLogin, loginLabel } from '../loginTypes';
import { defaultDatabaseNames } from '../sysadminTypes';
import type { GemStoneLogin } from '../loginTypes';

// Creating a database auto-creates a DataCurator login for its stone, but
// deleting one used to leave that login behind — an entry Jasper made itself,
// pointing at a stone that no longer exists, whose only outcome is a failed
// connection. These pin which logins a delete has to take with it.

const CONFIG = { stoneName: 'devKit', version: '3.7.5', ldiName: 'devKit_ldi' };
const versionsMatch = (a: string, b: string) => a === b;

function login(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return {
    label: '',
    version: '3.7.5',
    gem_host: 'localhost',
    stone: 'devKit',
    gs_user: 'DataCurator',
    gs_password: 'swordfish',
    netldi: 'devKit_ldi',
    host_user: '',
    host_password: '',
    ...overrides,
  };
}

describe('logins orphaned by deleting a database', () => {
  it('claims the login the database created for itself', () => {
    const auto = buildDataCuratorLogin(CONFIG);

    const orphans = loginsTargetingStone([auto], CONFIG, versionsMatch);

    expect(orphans.map(loginLabel)).toEqual([loginLabel(auto)]);
  });

  it('claims every user added for the same stone, not just DataCurator', () => {
    const logins = [login(), login({ gs_user: 'SystemUser' })];

    const orphans = loginsTargetingStone(logins, CONFIG, versionsMatch);

    expect(orphans.map((l) => l.gs_user).sort()).toEqual(['DataCurator', 'SystemUser']);
  });

  it('leaves logins for other stones alone', () => {
    const logins = [login(), login({ stone: 'otherStone' })];

    const orphans = loginsTargetingStone(logins, CONFIG, versionsMatch);

    expect(orphans).toHaveLength(1);
    expect(orphans[0].stone).toBe('devKit');
  });

  it('leaves a same-named stone on a different version alone', () => {
    const logins = [login({ version: '3.6.8' })];

    expect(loginsTargetingStone(logins, CONFIG, versionsMatch)).toEqual([]);
  });

  it('finds nothing to remove when no login pointed at it', () => {
    expect(loginsTargetingStone([], CONFIG, versionsMatch)).toEqual([]);
  });
});

// The default database is named against what already exists: a stone and a
// NetLDI are identified by name, so a second gs64stone would contend with the
// first over locks and registration.
describe('naming a default database', () => {
  const nextNames = defaultDatabaseNames;

  it('uses the plain names on a machine with no databases', () => {
    expect(nextNames([])).toEqual({ stoneName: 'gs64stone', ldiName: 'gs64ldi' });
  });

  it('steps past a name already in use', () => {
    expect(nextNames(['gs64stone', 'gs64ldi'])).toEqual({
      stoneName: 'gs64stone2',
      ldiName: 'gs64ldi2',
    });
  });

  it('keeps the stone and its NetLDI on the same number', () => {
    const { stoneName, ldiName } = nextNames(['gs64stone', 'gs64ldi', 'gs64stone2', 'gs64ldi2']);

    expect(stoneName).toBe('gs64stone3');
    expect(ldiName).toBe('gs64ldi3');
  });

  it('steps past a clash on either half of the pair', () => {
    expect(nextNames(['gs64ldi']).stoneName).toBe('gs64stone2');
  });
});
