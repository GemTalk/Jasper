import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../wslFs');

import { DatabaseTreeProvider, DatabaseNode } from '../databaseTreeProvider';
import { GemStoneDatabase } from '../sysadminTypes';
import { wslExistsSync, wslReaddirSync, wslIsFile } from '../wslFs';

function makeDatabase(): GemStoneDatabase {
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

function makeProvider(): DatabaseTreeProvider {
  const storage = { getDatabases: vi.fn(() => [makeDatabase()]) };
  const processManager = {
    isStoneRunning: vi.fn(() => false),
    isNetldiRunning: vi.fn(() => false),
    getProcesses: vi.fn(() => []),
  };
  return new DatabaseTreeProvider(storage as never, processManager as never);
}

const db = makeDatabase();
const dbNode: DatabaseNode = { kind: 'database', db };

describe('DatabaseTreeProvider backups node', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wslIsFile).mockReturnValue(true);
  });

  it('hides the Backups node when the backups folder does not exist', () => {
    vi.mocked(wslExistsSync).mockReturnValue(false);

    const kinds = makeProvider()
      .getChildren(dbNode)
      .map((c) => c.kind);

    expect(kinds).toEqual(['stone', 'netldi', 'logs', 'config']);
  });

  it('hides the Backups node when the folder holds no .dbf files', () => {
    vi.mocked(wslExistsSync).mockReturnValue(true);
    vi.mocked(wslReaddirSync).mockReturnValue(['README.txt']);

    const kinds = makeProvider()
      .getChildren(dbNode)
      .map((c) => c.kind);

    expect(kinds).not.toContain('backups');
  });

  it('shows the Backups node once at least one backup exists', () => {
    vi.mocked(wslExistsSync).mockReturnValue(true);
    vi.mocked(wslReaddirSync).mockReturnValue(['gs64stone_2026-07-10_20-00-00.dbf']);

    const kinds = makeProvider()
      .getChildren(dbNode)
      .map((c) => c.kind);

    expect(kinds).toContain('backups');
  });

  it('lists only .dbf backups, newest first', () => {
    vi.mocked(wslExistsSync).mockReturnValue(true);
    vi.mocked(wslReaddirSync).mockReturnValue([
      'gs64stone_2026-01-01_00-00-00.dbf',
      'gs64stone_2026-03-01_00-00-00.dbf',
      'notes.txt',
    ]);

    const children = makeProvider().getChildren({ kind: 'backups', db });

    expect(children.map((c) => c.kind === 'backupFile' && c.filePath)).toEqual([
      '/root/db-1/backups/gs64stone_2026-03-01_00-00-00.dbf',
      '/root/db-1/backups/gs64stone_2026-01-01_00-00-00.dbf',
    ]);
  });

  it('renders a backup file to reveal in the OS rather than open in an editor', () => {
    const item = makeProvider().getTreeItem({
      kind: 'backupFile',
      filePath: '/root/db-1/backups/gs64stone_2026-03-01.dbf',
      db,
    });

    expect(item.contextValue).toBe('gemstoneDbBackupFile');
    expect(item.command?.command).toBe('revealFileInOS');
  });

  it('explains in a tooltip what the Backups node can show', () => {
    const item = makeProvider().getTreeItem({ kind: 'backups', db });

    expect(item.label).toBe('Backups');
    expect(String(item.tooltip)).toContain('backups/');
  });
});
