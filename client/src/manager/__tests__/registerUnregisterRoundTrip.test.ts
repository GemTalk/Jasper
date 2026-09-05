// Register and unregister against a real directory, not a mocked filesystem.
//
// The sibling suites stub `wslFs`, which is right for asserting *what* Jasper was
// asked to write — but a stub answers every call happily, so it cannot tell a
// remove that works from one that dies on its own subdirectory. Unregister shipped
// broken for exactly that reason: its test pinned `wslRmSync(path)` with no
// options, and the real call raised EISDIR on the `log/` directory registering had
// just made. These tests use the real thing end to end: what is written is read
// back by the same storage the panel reads, and what is removed has to actually go.
//
// "Real" has to mean the same filesystem the manager writes to, which is not the
// one this process runs on. GemStone has no Windows build, so on Windows it runs
// inside WSL and `gemstone.rootPath` names a directory in the guest — the setting
// holds a Linux path on every platform. `getRootPath` resolves it to a
// \\wsl$\... UNC there, and `wslFs` runs the operation inside WSL. So the root
// here is made in the guest on Windows, and every check below goes through the
// same `wsl*` helpers the manager uses, landing on the side it actually wrote to.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { needsWsl, windowsPathToWsl, wslExecSync, wslPathToWindows } from '../../wslBridge';
import {
  wslExistsSync,
  wslMkdirSync,
  wslReaddirSync,
  wslRmSync,
  wslWriteFileSync,
} from '../../wslFs';

// The configured setting: a Linux path, as a user's would be.
const ROOT = needsWsl()
  ? wslExecSync('mktemp -d /tmp/jasper-register-XXXXXX').trim()
  : fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-register-'));

// The same directory as this process must address it — a UNC into the guest on
// Windows, the path itself elsewhere. This is what `getRootPath` answers, and
// what every path the manager hands back is built from.
const HOST_ROOT = needsWsl() ? wslPathToWindows(ROOT) : ROOT;

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

afterAll(() => wslRmSync(HOST_ROOT, { recursive: true, force: true }));

/**
 * A product tree with the version.txt shape `readVersionTxt` parses. Addressed
 * host-side, which is what a real pick answers: `showOpenDialog` on Windows
 * hands back a \\wsl$\... path for a tree inside the guest.
 */
function productTree(name = 'their-product'): string {
  const tree = path.join(HOST_ROOT, name);
  wslMkdirSync(path.join(tree, 'bin'), { recursive: true });
  wslWriteFileSync(
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

describe('registering and unregistering an existing installation', () => {
  beforeEach(() => {
    for (const entry of wslReaddirSync(HOST_ROOT)) {
      if (entry.startsWith('db-')) {
        wslRmSync(path.join(HOST_ROOT, entry), { recursive: true, force: true });
      }
    }
  });

  it('resolves the configured Linux root to the directory it actually writes', () => {
    // The setting names a place in the guest; the record has to land there and
    // not somewhere the host invented from it. A root that resolves wrong writes
    // a real directory to a real place, so nothing throws.
    //
    // Deliberately NOT compared against `wslPathToWindows(ROOT)`: HOST_ROOT is
    // that call over that input, so the two are the same function over the same
    // argument and agree however wrong the conversion becomes. What is asserted
    // instead is that the resolved path names the directory `mktemp` just made
    // in the guest, and that it converts back to the setting.
    const { storage } = makeManager();
    const root = storage.getRootPath();

    expect(wslExistsSync(root)).toBe(true);
    expect(needsWsl() ? windowsPathToWsl(root) : root).toBe(ROOT);
  });

  // Only on Windows is there a conversion to get wrong. The shape is pinned
  // separately from the round trip above so a change to `wslPathToWindows` that
  // still round-trips — a different distro segment, `wsl.localhost` for `wsl$` —
  // shows up as this test rather than as a silent behaviour change.
  it.runIf(needsWsl())('answers that root as a UNC into the guest', () => {
    expect(makeManager().storage.getRootPath()).toMatch(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+\\/i);
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

  it('writes the record under the configured root, not beside it', async () => {
    const { manager } = makeManager();
    const db = await manager.registerExistingDatabase({
      productPath: productTree(),
      stoneName: 'theirstone',
      ldiName: 'theirldi',
    });

    expect(db.path).toBe(path.join(HOST_ROOT, db.dirName));
    expect(wslExistsSync(path.join(db.path, 'database.yaml'))).toBe(true);
  });

  it('removes the whole record directory, log subdirectory and all', async () => {
    const { storage, manager } = makeManager();
    const db = await manager.registerExistingDatabase({
      productPath: productTree(),
      stoneName: 'theirstone',
      ldiName: 'theirldi',
    });
    // Registering makes this; a non-recursive remove fails on it with EISDIR.
    expect(wslExistsSync(path.join(db.path, 'log'))).toBe(true);

    await expect(manager.unregisterDatabase(db)).resolves.toBe(true);

    expect(wslExistsSync(db.path)).toBe(false);
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

    expect(wslExistsSync(path.join(tree, 'version.txt'))).toBe(true);
    expect(wslExistsSync(path.join(tree, 'bin'))).toBe(true);
  });
});
