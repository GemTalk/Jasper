import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { DatabaseTreeProvider, DatabaseNode } from '../databaseTreeProvider';
import { GemStoneDatabase, GemStoneProcess } from '../sysadminTypes';
import { ExternalServer, ExternalServerFinding, HostServerProcess } from '../externalServerScan';

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
    getRootPath: vi.fn(() => '/home/user/gemstone'),
  };
}

function makeProcessManager(
  processes: GemStoneProcess[] = [],
  external: ExternalServerFinding = {},
) {
  return {
    getProcesses: vi.fn(() => processes),
    getExternalServers: vi.fn(() => external),
  };
}

function proc(overrides: Partial<GemStoneProcess> = {}): GemStoneProcess {
  return {
    type: 'stone',
    name: 'gs64stone',
    version: '3.7.4',
    pid: 11,
    status: 'OK',
    responding: true,
    ...overrides,
  };
}

const STONE_UP = proc();
const LDI_UP = proc({ type: 'netldi', name: 'gs64ldi', pid: 12, port: 50378 });

function hostServer(overrides: Partial<HostServerProcess> = {}): ExternalServer {
  return {
    process: {
      pid: 9001,
      type: 'stone',
      name: 'gs64stone',
      version: '3.7.4',
      globalDir: '/somewhere/else',
      dbPathHints: ['/home/user/gemstone/db-1/conf/gs64stone.conf'],
      command: '/gs/sys/stoned gs64stone',
      ...overrides,
    },
    identity: 'confirmed',
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

    it('ignores a same-named stone belonging to a different version', () => {
      const db = makeDatabase({ config: { ...makeDatabase().config, version: '3.6.2' } });
      const pm = makeProcessManager([STONE_UP, LDI_UP]);
      const provider = new DatabaseTreeProvider(makeStorage([db]) as never, pm as never);

      const children = provider.getChildren({ kind: 'database', db });

      expect(children[0]).toMatchObject({ kind: 'stone', status: 'stopped' });
      expect(children[1]).toMatchObject({ kind: 'netldi', status: 'stopped' });
    });

    it('shows a healthy database as running on both rows', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager([STONE_UP, LDI_UP]) as never,
      );

      const children = provider.getChildren({ kind: 'database', db });

      expect(children[0]).toMatchObject({ kind: 'stone', status: 'running' });
      expect(children[1]).toMatchObject({ kind: 'netldi', status: 'running' });
    });

    it('does not call a stone running when nothing can reach it', () => {
      const db = makeDatabase();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager([STONE_UP]) as never,
      );

      const children = provider.getChildren({ kind: 'database', db });

      expect(children[0]).toMatchObject({ kind: 'stone', status: 'unreachable' });
    });

    it('does not call a server stopped when it is alive but started outside Jasper', () => {
      const db = makeDatabase();
      const external = hostServer();
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager([], { stone: external }) as never,
      );

      const children = provider.getChildren({ kind: 'database', db });

      expect(children[0]).toMatchObject({ kind: 'stone', status: 'external', external });
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
      const node: DatabaseNode = { kind: 'stone', db, status: 'running' };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('Stone: gs64stone');
      expect(item.description).toBe('Running');
      expect(item.contextValue).toBe('gemstoneDbStoneRunning');
    });

    it('renders netldi node', () => {
      const node: DatabaseNode = { kind: 'netldi', db, status: 'stopped' };
      const item = provider.getTreeItem(node);

      expect(item.label).toBe('NetLDI: gs64ldi');
      expect(item.description).toBe('Stopped');
      expect(item.contextValue).toBe('gemstoneDbNetldiStopped');
    });

    it('says a stone is not connectable rather than plainly running', () => {
      const node: DatabaseNode = { kind: 'stone', db, status: 'unreachable' };
      const item = provider.getTreeItem(node);

      expect(item.description).toBe('Running — not connectable');
      expect(String(item.tooltip)).toContain('a connect will fail');
    });

    it('keeps the stop action available on a stone that is not responding', () => {
      // The row needs its Stop button most in this state, so the context value
      // has to stay the one the menu is bound to.
      const node: DatabaseNode = { kind: 'stone', db, status: 'not-responding' };
      const item = provider.getTreeItem(node);

      expect(item.description).toBe('Running — not responding');
      expect(item.contextValue).toBe('gemstoneDbStoneRunning');
    });

    it('offers its own action for a server started outside Jasper', () => {
      const node: DatabaseNode = { kind: 'stone', db, status: 'external', external: hostServer() };

      const item = provider.getTreeItem(node);

      expect(item.description).toBe('Running outside Jasper');
      expect(item.contextValue).toBe('gemstoneDbStoneExternal');
    });

    it('offers the same action on a netldi started outside Jasper', () => {
      const node: DatabaseNode = {
        kind: 'netldi',
        db,
        status: 'external',
        external: hostServer({ type: 'netldi', name: 'gs64ldi' }),
      };

      const item = provider.getTreeItem(node);

      expect(item.description).toBe('Running outside Jasper');
      expect(item.contextValue).toBe('gemstoneDbNetldiExternal');
    });

    it('tells the reader where an externally started server is registered', () => {
      // Without this the row says a process is alive somewhere and gives the
      // reader no way to go find it.
      const node: DatabaseNode = { kind: 'stone', db, status: 'external', external: hostServer() };

      const item = provider.getTreeItem(node);

      expect(String(item.tooltip)).toContain('PID 9001');
      expect(String(item.tooltip)).toContain('/somewhere/else');
    });

    it('shows the port of a healthy netldi', () => {
      const provider = new DatabaseTreeProvider(
        makeStorage([db]) as never,
        makeProcessManager([STONE_UP, LDI_UP]) as never,
      );

      const item = provider.getTreeItem({ kind: 'netldi', db, status: 'running' });

      expect(item.description).toBe('Running (port 50378)');
    });
  });
});
