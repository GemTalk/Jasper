// Register and unregister against a real directory, not a mocked filesystem.
//
// The sibling suites stub `wslFs`, which is right for asserting *what* Jasper was
// asked to write — but a stub answers every call happily, so it cannot tell a
// remove that works from one that dies on its own subdirectory. Unregister shipped
// broken for exactly that reason: its test pinned `wslRmSync(path)` with no
// options, and the real call raised EISDIR on the `log/` directory registering had
// just made. These tests use the real thing end to end: what is written is read
// back by the same storage the panel reads, and what is removed has to actually go.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-register-'));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => (key === 'rootPath' ? ROOT : fallback),
    }),
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    // Unregister asks before it removes anything.
    showWarningMessage: vi.fn(async () => 'Unregister'),
  },
}));
vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn() }));

import { SysadminStorage } from '../../sysadminStorage';
import { DatabaseManager } from '../databaseManager';
import type { ProcessManager } from '../processManager';

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

/** A product tree with the version.txt shape `readVersionTxt` parses. */
function productTree(name = 'their-product'): string {
  const tree = path.join(ROOT, name);
  fs.mkdirSync(path.join(tree, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(tree, 'version.txt'),
    'GemStone/S 64 Bit\n3.7.5.1 Build: 2026-06-25T10:00:00-07:00\nbranch 3.7.5.1\n',
  );
  return tree;
}

function makeManager(): { storage: SysadminStorage; manager: DatabaseManager } {
  const storage = new SysadminStorage();
  const processManager = { discoverServersUnder: () => [] } as unknown as ProcessManager;
  return { storage, manager: new DatabaseManager(storage, processManager) };
}

// POSIX-only. On Windows `getRootPath` treats the configured rootPath as a path
// on the WSL side and rewrites it into a \\wsl$\... UNC, which `wslFs` then
// routes through `wsl.exe` — so a Windows temp directory handed to these mocks
// is never the directory the manager writes to, and there is no real filesystem
// left to test end to end. The behaviour these tests pin is the same on every
// platform; the Linux runners cover it.
const NOT_POSIX = process.platform === 'win32';

describe.skipIf(NOT_POSIX)('registering and unregistering an existing installation', () => {
  beforeEach(() => {
    for (const entry of fs.readdirSync(ROOT)) {
      if (entry.startsWith('db-')) {
        fs.rmSync(path.join(ROOT, entry), { recursive: true, force: true });
      }
    }
  });

  it('is listed by the storage the panel reads, once registered', async () => {
    const { storage, manager } = makeManager();
    expect(storage.getDatabases()).toHaveLength(0);

    await manager.registerExistingDatabase({
      productPath: productTree(),
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      netldiPort: 46717,
    });

    const listed = storage.getDatabases();
    expect(listed).toHaveLength(1);
    expect(listed[0].config).toMatchObject({
      stoneName: 'theirstone',
      version: '3.7.5.1',
      registered: true,
      netldiPort: 46717,
    });
  });

  it('removes the whole record directory, log subdirectory and all', async () => {
    const { storage, manager } = makeManager();
    const db = await manager.registerExistingDatabase({
      productPath: productTree(),
      stoneName: 'theirstone',
      ldiName: 'theirldi',
    });
    // Registering makes this; a non-recursive remove fails on it with EISDIR.
    expect(fs.existsSync(path.join(db.path, 'log'))).toBe(true);

    await expect(manager.unregisterDatabase(db)).resolves.toBe(true);

    expect(fs.existsSync(db.path)).toBe(false);
    expect(storage.getDatabases()).toHaveLength(0);
  });

  it('leaves the installation itself untouched', async () => {
    const { manager } = makeManager();
    const tree = productTree('keep-me');
    const db = await manager.registerExistingDatabase({
      productPath: tree,
      stoneName: 'theirstone',
      ldiName: 'theirldi',
    });

    await manager.unregisterDatabase(db);

    expect(fs.existsSync(path.join(tree, 'version.txt'))).toBe(true);
    expect(fs.existsSync(path.join(tree, 'bin'))).toBe(true);
  });
});
