import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../wslFs');
vi.mock('../sysadminChannel');

import * as vscode from 'vscode';
import {
  wslExistsSync,
  wslImportFileSync,
  wslCopyFileSync,
  wslReaddirSync,
  wslUnlinkSync,
  wslChmodSync,
  wslWriteFileSync,
} from '../wslFs';
import { DatabaseManager } from '../databaseManager';
import { GemStoneDatabase } from '../sysadminTypes';
import { SysadminStorage } from '../sysadminStorage';
import { ProcessManager } from '../processManager';

// ── Helpers ────────────────────────────────────────────────

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
    ...overrides?.storage,
  } as unknown as SysadminStorage;
  const processManager = {
    isStoneRunning: vi.fn(() => false),
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
      '/seed/mydata.dbf',
      '/root/db-1/data/extent0.dbf',
    );
    expect(wslChmodSync).toHaveBeenCalledWith('/root/db-1/data/extent0.dbf', 0o644);
    // Only .dbf files are removed; README.txt is left alone.
    expect(wslUnlinkSync).toHaveBeenCalledWith('/root/db-1/data/extent0.dbf');
    expect(wslUnlinkSync).toHaveBeenCalledWith('/root/db-1/data/tranlog1.dbf');
    expect(wslUnlinkSync).not.toHaveBeenCalledWith('/root/db-1/data/README.txt');
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
      '/gs/bin/extent0.dbf',
      '/root/db-1/data/extent0.dbf',
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
      '/seed/mydata.dbf',
      '/root/db-1/data/extent0.dbf',
    );
  });

  it('refuses to replace while the stone is running', async () => {
    const ok = await makeManager({
      processManager: { isStoneRunning: vi.fn(() => true) },
    }).replaceExtent(makeDb());

    expect(ok).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
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
      '/gs/data/system.conf',
      '/root/db-1/conf/default.conf',
    );
  });

  it('points the generated system.conf at the local default.conf copy', async () => {
    await makeCreateManager().createDatabaseDirect('3.7.4', 'extent0', 'gs64stone', 'gs64ldi');

    const systemConf = vi
      .mocked(wslWriteFileSync)
      .mock.calls.find((c) => String(c[0]).endsWith('conf/system.conf'))![1];
    expect(systemConf).toContain('conf/default.conf');
  });

  it('gives gems a temp-object cache large enough for big Rowan project loads', async () => {
    await makeCreateManager().createDatabaseDirect('3.7.4', 'extent0', 'gs64stone', 'gs64ldi');

    const gemConf = vi
      .mocked(wslWriteFileSync)
      .mock.calls.find((c) => String(c[0]).endsWith('conf/gem.conf'))![1];
    expect(gemConf).toContain('GEM_TEMPOBJ_CACHE_SIZE = 500000;');
  });

  it('skips default.conf and still creates the database when the source is absent', async () => {
    vi.mocked(wslExistsSync).mockImplementation((p: string) => p !== '/gs/data/system.conf');

    const db = await makeCreateManager().createDatabaseDirect(
      '3.7.4',
      'extent0',
      'gs64stone',
      'gs64ldi',
    );

    expect(wslCopyFileSync).not.toHaveBeenCalledWith(
      '/gs/data/system.conf',
      '/root/db-1/conf/default.conf',
    );
    expect(db.dirName).toBe('db-1');
  });
});
