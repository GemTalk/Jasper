import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../wslBridge', () => ({
  isWindows: () => false,
  needsWsl: () => false,
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
}));
vi.mock('../wslFs');

import { wslReadFileSync } from '../wslFs';
import { SysadminStorage } from '../sysadminStorage';

/** The record a database is read back from — the only thing on disk that says
 *  which kind of database this is. */
function yamlSays(content: string) {
  vi.mocked(wslReadFileSync).mockReturnValue(content);
  return new SysadminStorage().readDatabaseYaml('/root/db-1');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reading a created database back', () => {
  it('reads the four fields it was written with', () => {
    expect(
      yamlSays(
        '---\nbaseExtent: "extent0.dbf"\nldiName: "gs64ldi"\n' +
          'stoneName: "gs64stone"\nversion: "3.7.5"\n',
      ),
    ).toEqual({
      version: '3.7.5',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
    });
  });

  it('ignores a record with no base extent, which is incomplete rather than registered', () => {
    // Half-read is worse than unread: the extent is what a created database is
    // defined by, and the panel would offer to replace one that is not named.
    expect(
      yamlSays('---\nldiName: "gs64ldi"\nstoneName: "gs64stone"\nversion: "3.7.5"\n'),
    ).toBeUndefined();
  });

  it('ignores a record missing a name it cannot work without', () => {
    expect(yamlSays('---\nbaseExtent: "extent0.dbf"\nversion: "3.7.5"\n')).toBeUndefined();
  });
});

describe('reading a registered database back', () => {
  const record =
    '---\nregistered: true\nversion: "3.7.5.1"\nstoneName: "theirstone"\n' +
    'ldiName: "theirldi"\nnetldiPort: 46717\nproductPath: "/opt/theirs/product"\n' +
    'confPath: "/opt/theirs/product/data"\nglobalDir: "/opt/gemstone"\n';

  it('reads where the installation lives, and asks for no base extent', () => {
    expect(yamlSays(record)).toEqual({
      version: '3.7.5.1',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      registered: true,
      productPath: '/opt/theirs/product',
      confPath: '/opt/theirs/product/data',
      globalDir: '/opt/gemstone',
      netldiPort: 46717,
    });
  });

  it('is still read when only the product tree was recorded', () => {
    // The paths a running server supplies are optional; registeredDatabase.ts
    // falls back to GemStone's own conventions for the rest.
    const sparse = yamlSays(
      '---\nregistered: true\nversion: "3.7.5.1"\nstoneName: "theirstone"\nldiName: "theirldi"\n' +
        'productPath: "/opt/theirs/product"\n',
    );
    expect(sparse?.registered).toBe(true);
    expect(sparse?.netldiPort).toBeUndefined();
    expect(sparse?.confPath).toBeUndefined();
  });

  it('drops a port that is not a number rather than reading NaN into a login', () => {
    const odd = yamlSays(
      '---\nregistered: true\nversion: "3.7.5.1"\nstoneName: "theirstone"\n' +
        'ldiName: "theirldi"\nnetldiPort: "gregldi"\nproductPath: "/opt/theirs/product"\n',
    );
    expect(odd?.netldiPort).toBeUndefined();
  });

  it('treats anything but a true flag as a created database', () => {
    // `registered: false` must not exempt a record from needing its extent.
    expect(
      yamlSays(
        '---\nregistered: false\nversion: "3.7.5"\nstoneName: "gs64stone"\nldiName: "gs64ldi"\n',
      ),
    ).toBeUndefined();
  });
});
