import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../wslFs');
vi.mock('../../sysadminChannel');

import * as vscode from 'vscode';
import {
  wslExistsSync,
  wslImportFileSync,
  wslCopyFileSync,
  wslReaddirSync,
  wslUnlinkSync,
  wslChmodSync,
  wslWriteFileSync,
  wslMkdirSync,
  wslRmSync,
} from '../../wslFs';
import { DatabaseManager } from '../databaseManager';
import { GemStoneDatabase } from '../../sysadminTypes';
import { SysadminStorage } from '../../sysadminStorage';
import { ProcessManager } from '../processManager';
import { uriFsPath } from '../../__tests__/support/uri';

// ── Helpers ────────────────────────────────────────────────

const DB_DATA_DIR = path.join('/root/db-1', 'data');

function makeDb(overrides?: Partial<GemStoneDatabase['config']>): GemStoneDatabase {
  return {
    dirName: 'db-1',
    path: '/root/db-1',
    config: {
      version: '3.7.4',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
      ...overrides,
    },
  };
}

function makeManager(overrides?: {
  storage?: Partial<Record<string, unknown>>;
  processManager?: Partial<Record<string, unknown>>;
}): DatabaseManager {
  const storage = {
    getAvailableExtents: vi.fn(() => ['extent0']),
    getGemstonePath: vi.fn(() => '/gs'),
    ensureRootPath: vi.fn(),
    getRootPath: vi.fn(() => '/root'),
    getNextDbNumber: vi.fn(() => 2),
    getDatabases: vi.fn(() => []),
    ...overrides?.storage,
  } as unknown as SysadminStorage;
  const processManager = {
    refreshProcesses: vi.fn(() => []),
    isServerAlive: vi.fn(() => false),
    getExternalServers: vi.fn(() => ({})),
    ...overrides?.processManager,
  } as unknown as ProcessManager;
  return new DatabaseManager(storage, processManager);
}

/** Pick the QuickPick item at `index` (preserving object identity). */
function pickItem(index: number): void {
  vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (await items)[index]);
}

describe('DatabaseManager.replaceExtent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wslExistsSync).mockReturnValue(true);
    vi.mocked(wslReaddirSync).mockReturnValue(['extent0.dbf', 'tranlog1.dbf', 'README.txt']);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Replace' as unknown as vscode.MessageItem,
    );
  });

  it('copies a browsed extent into extent0.dbf and records its basename', async () => {
    pickItem(0); // the "Browse for extent file…" item is always first
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      vscode.Uri.file('/seed/mydata.dbf'),
    ]);

    const ok = await makeManager().replaceExtent(makeDb());

    expect(ok).toBe(true);
    expect(vscode.window.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(wslImportFileSync).toHaveBeenCalledWith(
      uriFsPath('/seed/mydata.dbf'),
      path.join(DB_DATA_DIR, 'extent0.dbf'),
    );
    expect(wslChmodSync).toHaveBeenCalledWith(path.join(DB_DATA_DIR, 'extent0.dbf'), 0o644);
    // Only .dbf files are removed; README.txt is left alone.
    expect(wslUnlinkSync).toHaveBeenCalledWith(path.join(DB_DATA_DIR, 'extent0.dbf'));
    expect(wslUnlinkSync).toHaveBeenCalledWith(path.join(DB_DATA_DIR, 'tranlog1.dbf'));
    expect(wslUnlinkSync).not.toHaveBeenCalledWith(path.join(DB_DATA_DIR, 'README.txt'));
    const yaml = vi.mocked(wslWriteFileSync).mock.calls[0][1];
    expect(yaml).toContain('baseExtent: "mydata.dbf"');
  });

  it('still copies a vendor extent from the product bin directory', async () => {
    // items = [browse, separator, extent0] → last item is the vendor extent.
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const r = await items;
      return r[r.length - 1];
    });

    const ok = await makeManager().replaceExtent(makeDb());

    expect(ok).toBe(true);
    expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();
    expect(wslImportFileSync).toHaveBeenCalledWith(
      path.join('/gs', 'bin', 'extent0.dbf'),
      path.join(DB_DATA_DIR, 'extent0.dbf'),
    );
    const yaml = vi.mocked(wslWriteFileSync).mock.calls[0][1];
    expect(yaml).toContain('baseExtent: "extent0.dbf"');
  });

  it('offers Browse even when no vendor extents are available', async () => {
    pickItem(0);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      vscode.Uri.file('/seed/mydata.dbf'),
    ]);

    const ok = await makeManager({
      storage: { getAvailableExtents: vi.fn(() => []) },
    }).replaceExtent(makeDb());

    expect(ok).toBe(true);
    expect(wslImportFileSync).toHaveBeenCalledWith(
      uriFsPath('/seed/mydata.dbf'),
      path.join(DB_DATA_DIR, 'extent0.dbf'),
    );
  });

  it('refuses to replace while the stone is running', async () => {
    const ok = await makeManager({
      processManager: { isServerAlive: vi.fn(() => true) },
    }).replaceExtent(makeDb());

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(wslImportFileSync).not.toHaveBeenCalled();
  });

  it('refuses to replace under a stone that was started outside Jasper', async () => {
    // Such a stone is absent from Jasper's own gslist but has the extent open,
    // so replacing it would pull the files out from under a live database.
    const isServerAlive = vi.fn((_db, type: 'stone' | 'netldi') => type === 'stone');

    const ok = await makeManager({ processManager: { isServerAlive } }).replaceExtent(makeDb());

    expect(ok).toBe(false);
    expect(wslImportFileSync).not.toHaveBeenCalled();
  });

  it('re-reads gslist before the guard, catching a stone started since the last refresh', async () => {
    // A stone the user started by hand is invisible in the memoized verdict
    // until we refresh. The guard has to refresh first, or it would replace the
    // extent under a live database it never saw.
    let refreshed = false;
    const refreshProcesses = vi.fn(() => {
      refreshed = true;
      return [];
    });
    const isServerAlive = vi.fn(() => refreshed);

    const ok = await makeManager({
      processManager: { refreshProcesses, isServerAlive },
    }).replaceExtent(makeDb());

    expect(refreshProcesses).toHaveBeenCalled();
    expect(ok).toBe(false);
    expect(wslImportFileSync).not.toHaveBeenCalled();
  });

  it('does nothing when the browse dialog is cancelled', async () => {
    pickItem(0);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);

    const ok = await makeManager().replaceExtent(makeDb());

    expect(ok).toBe(false);
    expect(wslUnlinkSync).not.toHaveBeenCalled();
    expect(wslImportFileSync).not.toHaveBeenCalled();
  });

  it('aborts before deleting anything when the source is missing', async () => {
    pickItem(0);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([vscode.Uri.file('/seed/gone.dbf')]);
    vi.mocked(wslExistsSync).mockReturnValue(false);

    const ok = await makeManager().replaceExtent(makeDb());

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(wslUnlinkSync).not.toHaveBeenCalled();
    expect(wslImportFileSync).not.toHaveBeenCalled();
  });

  it('does not proceed when the confirmation is dismissed', async () => {
    pickItem(0);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      vscode.Uri.file('/seed/mydata.dbf'),
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    const ok = await makeManager().replaceExtent(makeDb());

    expect(ok).toBe(false);
    expect(wslUnlinkSync).not.toHaveBeenCalled();
    expect(wslImportFileSync).not.toHaveBeenCalled();
  });
});

// Keep the unused wslCopyFileSync import meaningful: confirm the new code path
// uses the cross-filesystem import rather than the same-fs copy.
describe('DatabaseManager.replaceExtent (copy helper choice)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wslExistsSync).mockReturnValue(true);
    vi.mocked(wslReaddirSync).mockReturnValue(['extent0.dbf']);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Replace' as unknown as vscode.MessageItem,
    );
  });

  it('uses wslImportFileSync, not wslCopyFileSync', async () => {
    pickItem(0);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      vscode.Uri.file('/seed/mydata.dbf'),
    ]);

    await makeManager().replaceExtent(makeDb());

    expect(wslImportFileSync).toHaveBeenCalled();
    expect(wslCopyFileSync).not.toHaveBeenCalled();
  });
});

describe('DatabaseManager.createDatabaseDirect', () => {
  function makeCreateManager(): DatabaseManager {
    return makeManager({
      storage: {
        ensureRootPath: vi.fn(),
        getRootPath: vi.fn(() => '/root'),
        getNextDbNumber: vi.fn(() => 1),
        getGemstonePath: vi.fn(() => '/gs'),
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wslExistsSync).mockReturnValue(true);
  });

  it("copies the product tree's system.conf into the database as default.conf", async () => {
    await makeCreateManager().createDatabaseDirect('3.7.4', 'extent0', 'gs64stone', 'gs64ldi');

    expect(wslCopyFileSync).toHaveBeenCalledWith(
      path.join('/gs', 'data', 'system.conf'),
      path.join('/root', 'db-1', 'conf', 'default.conf'),
    );
  });

  it('points the generated system.conf at the local default.conf copy', async () => {
    await makeCreateManager().createDatabaseDirect('3.7.4', 'extent0', 'gs64stone', 'gs64ldi');

    const systemConf = vi
      .mocked(wslWriteFileSync)
      .mock.calls.find((c) => String(c[0]).endsWith(path.join('conf', 'system.conf')))![1];
    expect(systemConf).toContain('conf/default.conf');
  });

  it('gives gems a temp-object cache large enough for big Rowan project loads', async () => {
    await makeCreateManager().createDatabaseDirect('3.7.4', 'extent0', 'gs64stone', 'gs64ldi');

    const gemConf = vi
      .mocked(wslWriteFileSync)
      .mock.calls.find((c) => String(c[0]).endsWith(path.join('conf', 'gem.conf')))![1];
    expect(gemConf).toContain('GEM_TEMPOBJ_CACHE_SIZE = 500000;');
  });

  it('skips default.conf and still creates the database when the source is absent', async () => {
    vi.mocked(wslExistsSync).mockImplementation(
      (p: string) => p !== path.join('/gs', 'data', 'system.conf'),
    );

    const db = await makeCreateManager().createDatabaseDirect(
      '3.7.4',
      'extent0',
      'gs64stone',
      'gs64ldi',
    );

    expect(wslCopyFileSync).not.toHaveBeenCalledWith(
      path.join('/gs', 'data', 'system.conf'),
      path.join('/root', 'db-1', 'conf', 'default.conf'),
    );
    expect(db.dirName).toBe('db-1');
  });
});

// ── Registering an existing installation ──────────────────────────────────
// The database Jasper did not create. The rule under every test here is the one
// in registeredDatabase.ts: Jasper writes nothing inside the installation.

describe('DatabaseManager.registerExistingDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wslExistsSync).mockReturnValue(true);
    // The version comes from the product tree itself, so the test stands in for
    // the tree rather than for the reader.
    vi.spyOn(SysadminStorage, 'readVersionTxt').mockReturnValue({
      version: '3.7.5.1',
      date: '2026-06-25',
      description: 'branch 3.7.5.1',
    });
  });

  it('records the version it read from the installation, not one it was told', async () => {
    const manager = makeManager();
    const db = await manager.registerExistingDatabase({
      productPath: '/opt/theirs/product',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      netldiPort: 46717,
    });

    expect(db.config.version).toBe('3.7.5.1');
    expect(db.config.registered).toBe(true);
    expect(db.config.netldiPort).toBe(46717);
    expect(db.dirName).toBe('db-2');
  });

  it('writes one record in Jasper\u2019s root and nothing inside the installation', async () => {
    const manager = makeManager();
    await manager.registerExistingDatabase({
      productPath: '/opt/theirs/product',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      confPath: '/opt/theirs/product/data',
      globalDir: '/opt/gemstone',
    });

    const written = vi.mocked(wslWriteFileSync).mock.calls.map(([target]) => target);
    expect(written).toEqual([path.join('/root/db-2', 'database.yaml')]);
    const yaml = vi.mocked(wslWriteFileSync).mock.calls[0][1];
    expect(yaml).toContain('registered: true');
    expect(yaml).toContain('productPath: "/opt/theirs/product"');
    expect(yaml).toContain('confPath: "/opt/theirs/product/data"');
    expect(yaml).toContain('globalDir: "/opt/gemstone"');
    // No extent copy, no key file, no default.conf: all of them would write
    // into a tree Jasper was only given to read.
    expect(wslCopyFileSync).not.toHaveBeenCalled();
    // The only directories made are Jasper's own record and the log it writes.
    const made = vi.mocked(wslMkdirSync).mock.calls.map(([dir]) => dir);
    expect(made).toEqual([path.join('/root', 'db-2'), path.join('/root', 'db-2', 'log')]);
  });

  it('falls back to GemStone\u2019s own conventions when nothing was discovered', async () => {
    const manager = makeManager();
    await manager.registerExistingDatabase({
      productPath: '/opt/theirs/product/',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
    });

    const yaml = vi.mocked(wslWriteFileSync).mock.calls[0][1];
    expect(yaml).toContain('confPath: "/opt/theirs/product/data"');
    expect(yaml).toContain('globalDir: "/opt/gemstone"');
    // A trailing slash on the chosen folder must not double in the joined paths.
    expect(yaml).not.toContain('//');
  });

  it('refuses a directory that is not a GemStone product tree', async () => {
    vi.spyOn(SysadminStorage, 'readVersionTxt').mockReturnValue(undefined);
    const manager = makeManager();

    await expect(
      manager.registerExistingDatabase({
        productPath: '/home/me/Documents',
        stoneName: 'theirstone',
        ldiName: 'theirldi',
      }),
    ).rejects.toThrow(/version.txt/);
    expect(wslWriteFileSync).not.toHaveBeenCalled();
  });
});

describe('deleting versus unregistering', () => {
  const registeredDb = (): GemStoneDatabase => ({
    dirName: 'db-2',
    path: '/root/db-2',
    config: {
      version: '3.7.5',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      registered: true,
      productPath: '/opt/theirs/product',
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wslExistsSync).mockReturnValue(true);
  });

  it('refuses to delete a registered database, and says what to use instead', async () => {
    const manager = makeManager();

    expect(await manager.deleteDatabase(registeredDb())).toBe(false);
    const [message] = vi.mocked(vscode.window.showErrorMessage).mock.calls[0];
    expect(message).toContain('Jasper did not create this database');
    expect(message).toContain('Unregister Database');
    // Refused before anything is even read about the running state.
    expect(wslRmSync).not.toHaveBeenCalled();
  });

  it('unregisters by removing only Jasper\u2019s record', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Unregister' as unknown as vscode.MessageItem,
    );
    const manager = makeManager();

    expect(await manager.unregisterDatabase(registeredDb())).toBe(true);
    // Recursively: registering makes a log/ inside db-N, so a plain remove dies
    // on its own subdirectory with EISDIR and the record can never be dropped.
    expect(wslRmSync).toHaveBeenCalledExactlyOnceWith('/root/db-2', {
      recursive: true,
      force: true,
    });
  });

  it('does nothing when the unregister confirmation is declined', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const manager = makeManager();

    expect(await manager.unregisterDatabase(registeredDb())).toBe(false);
    expect(wslRmSync).not.toHaveBeenCalled();
  });

  it('will not unregister a database Jasper created — that is Delete\u2019s job', async () => {
    const manager = makeManager();

    expect(await manager.unregisterDatabase(makeDb())).toBe(false);
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toContain('Delete Database');
    expect(wslRmSync).not.toHaveBeenCalled();
  });
});

describe('DatabaseManager.recordNetldiPort', () => {
  const registeredDb = (netldiPort?: number): GemStoneDatabase => ({
    dirName: 'db-4',
    path: '/root/db-4',
    config: {
      version: '3.7.5',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      registered: true,
      productPath: '/opt/theirs/product',
      confPath: '/opt/theirs/product/data/system.conf',
      globalDir: '/opt/gemstone',
      ...(netldiPort ? { netldiPort } : {}),
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replaces a port that has moved, keeping the rest of the record', () => {
    // A NetLDI restarted outside Jasper takes a fresh ephemeral port. Leaving
    // the old one written down breaks both the logins built from it and the
    // `-P` a later start asks for.
    const updated = makeManager().recordNetldiPort(registeredDb(46717), 34199);

    expect(updated.netldiPort).toBe(34199);
    const [target, yaml] = vi.mocked(wslWriteFileSync).mock.calls[0];
    expect(target).toBe(path.join('/root/db-4', 'database.yaml'));
    expect(yaml).toContain('netldiPort: 34199');
    expect(yaml).toContain('productPath: "/opt/theirs/product"');
    expect(yaml).toContain('confPath: "/opt/theirs/product/data/system.conf"');
    expect(yaml).toContain('globalDir: "/opt/gemstone"');
  });

  it('writes nothing when the recorded port is already the live one', () => {
    makeManager().recordNetldiPort(registeredDb(34199), 34199);
    expect(wslWriteFileSync).not.toHaveBeenCalled();
  });

  it('records a port for a database registered while its NetLDI was down', () => {
    const updated = makeManager().recordNetldiPort(registeredDb(), 34199);
    expect(updated.netldiPort).toBe(34199);
    expect(wslWriteFileSync).toHaveBeenCalledOnce();
  });

  it('leaves a database Jasper created alone — its logins use the NetLDI name', () => {
    const updated = makeManager().recordNetldiPort(makeDb(), 34199);
    expect(updated.netldiPort).toBeUndefined();
    expect(wslWriteFileSync).not.toHaveBeenCalled();
  });
});
