import { describe, it, expect } from 'vitest';

import {
  DEFAULT_GLOBAL_DIR,
  REGISTERED_REASON,
  defaultConfDir,
  isRegisteredDatabase,
  registeredPaths,
  registeredRefusal,
  versionMismatchNote,
} from '../registeredDatabase';
import { DatabaseYaml, GemStoneDatabase } from '../../sysadminTypes';

function created(): GemStoneDatabase {
  return {
    dirName: 'db-1',
    path: '/root/db-1',
    config: {
      version: '3.7.5',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
    },
  };
}

function registered(config: Partial<DatabaseYaml> = {}): GemStoneDatabase {
  return {
    dirName: 'db-2',
    path: '/root/db-2',
    config: {
      version: '3.7.5',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      registered: true,
      productPath: '/opt/theirs/product',
      ...config,
    },
  };
}

describe('isRegisteredDatabase', () => {
  it('is false for a database Jasper created', () => {
    expect(isRegisteredDatabase(created())).toBe(false);
  });

  it('is true only for the explicit flag', () => {
    expect(isRegisteredDatabase(registered())).toBe(true);
    expect(isRegisteredDatabase(registered({ registered: undefined }))).toBe(false);
  });
});

describe('registeredPaths', () => {
  it('answers undefined for a created database, so it can never be treated as registered', () => {
    expect(registeredPaths(created().config)).toBeUndefined();
  });

  it('answers undefined when the record has no product tree to run from', () => {
    // A half-written record must not resolve: every path below would be a guess.
    expect(registeredPaths(registered({ productPath: undefined }).config)).toBeUndefined();
  });

  it("falls back to GemStone's own conventions when nothing better was recorded", () => {
    const paths = registeredPaths(registered().config);
    expect(paths).toEqual({
      productPath: '/opt/theirs/product',
      confDir: '/opt/theirs/product/data',
      globalDir: DEFAULT_GLOBAL_DIR,
      identityDir: '/opt/theirs/product',
      netldiPort: undefined,
    });
    expect(defaultConfDir('/opt/theirs/product')).toBe('/opt/theirs/product/data');
  });

  it('prefers what was recorded off a running server', () => {
    const paths = registeredPaths(
      registered({
        confPath: '/srv/db/conf',
        globalDir: '/srv/locksroot',
        netldiPort: 46717,
      }).config,
    );
    expect(paths?.confDir).toBe('/srv/db/conf');
    expect(paths?.globalDir).toBe('/srv/locksroot');
    expect(paths?.netldiPort).toBe(46717);
  });

  it('trims trailing slashes, so a joined path never doubles one', () => {
    const paths = registeredPaths(
      registered({ productPath: '/opt/theirs/product/', globalDir: '/srv/locks/' }).config,
    );
    expect(paths?.productPath).toBe('/opt/theirs/product');
    expect(paths?.confDir).toBe('/opt/theirs/product/data');
    expect(paths?.globalDir).toBe('/srv/locks');
  });
});

describe('registeredRefusal', () => {
  it('names the action and carries the one reason every disabled control shows', () => {
    const refusal = registeredRefusal('delete', 'theirstone');
    expect(refusal).toContain('Cannot delete "theirstone"');
    expect(refusal).toContain(REGISTERED_REASON);
  });
});

describe('versionMismatchNote', () => {
  it('says nothing when nothing is running under the name', () => {
    expect(versionMismatchNote('3.7.5', undefined, 'stone')).toBeUndefined();
  });

  it('says nothing when the versions agree to the precision both were given', () => {
    // gslist and a product directory spell a version at different precisions,
    // which is why a prefix counts as agreement (see versionMatch.ts).
    expect(versionMismatchNote('3.7.5', '3.7.5', 'stone')).toBeUndefined();
    expect(versionMismatchNote('3.7.5', '3.7.5.1', 'stone')).toBeUndefined();
  });

  it('names both versions and the server when they genuinely differ', () => {
    const note = versionMismatchNote('3.7.5', '3.6.2', 'NetLDI');
    expect(note).toContain('NetLDI running under this name is GemStone 3.6.2');
    expect(note).toContain('registered as 3.7.5');
    expect(note).toContain('will not start or stop it');
  });
});
