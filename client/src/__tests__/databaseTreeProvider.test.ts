import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { DatabaseTreeProvider, DatabaseNode } from '../databaseTreeProvider';
import { GemStoneDatabase } from '../sysadminTypes';

function makeDatabase(overrides: Partial<GemStoneDatabase> = {}): GemStoneDatabase {
  return {
    dirName: 'db-1',
    path: '/home/user/gemstone/db-1',
    config: {
      version: '3.7.4',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
    },
    ...overrides,
  };
}

function makeStorage(databases: GemStoneDatabase[] = [makeDatabase()]) {
  return {
    getDatabases: vi.fn(() => databases),
  };
}

function makeProcessManager(stoneRunning = false, netldiRunning = false) {
  return {
    isStoneRunning: vi.fn(() => stoneRunning),
    isNetldiRunning: vi.fn(() => netldiRunning),
    getProcesses: vi.fn(() => []),
  };
}

describe('DatabaseTreeProvider', () => {
  describe('getChildren', () => {
    it('returns database nodes at the root', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
      );

      const children = provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].kind).toBe('database');
    });

    it('includes stone, netldi, logs, and config nodes under a database (no mcpServer)', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
      );

      const dbNode: DatabaseNode = { kind: 'database', db };
      const children = provider.getChildren(dbNode);
      const kinds = children.map((c) => c.kind);

      expect(kinds).toEqual(['stone', 'netldi', 'logs', 'config']);
    });

    it('queries running state with the database version so same-named stones stay distinct', () => {
      const db = makeDatabase({ config: { ...makeDatabase().config, version: '3.6.2' } });
      const pm = makeProcessManager();
      const provider = new DatabaseTreeProvider(makeStorage([db]) as never, pm as never);

      provider.getChildren({ kind: 'database', db });

      expect(pm.isStoneRunning).toHaveBeenCalledWith('gs64stone', '3.6.2');
      expect(pm.isNetldiRunning).toHaveBeenCalledWith('gs64ldi', '3.6.2');
    });
  });

  describe('getTreeItem', () => {
    let provider: DatabaseTreeProvider;
    const db = makeDatabase();

    beforeEach(() => {
      provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager() as never,
      );
    });

    it('renders database node', () => {
      const node: DatabaseNode = { kind: 'database', db };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('db-1');
      expect(item.contextValue).toBe('gemstoneDb');
    });

    it('renders stone node', () => {
      const node: DatabaseNode = { kind: 'stone', db, running: true };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('Stone: gs64stone');
      expect(item.contextValue).toBe('gemstoneDbStoneRunning');
    });

    it('renders netldi node', () => {
      const node: DatabaseNode = { kind: 'netldi', db, running: false };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('NetLDI: gs64ldi');
      expect(item.contextValue).toBe('gemstoneDbNetldiStopped');
    });
  });
});
