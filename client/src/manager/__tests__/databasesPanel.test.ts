// Host-side tests for the Databases & Versions panel.
//
// Only the version lifecycle is covered here, because that is where the panel
// makes a decision of its own rather than delegating: Install downloads *and*
// unpacks, so Remove has to take away both — and getting that wrong is invisible
// until a removed release reappears offering to install itself again.
//
// The drawing half is covered in databasesView.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseManager } from '../../databaseManager';
import { DatabasesPanel } from '../databasesPanel';
import type { GemStoneVersion } from '../../sysadminTypes';

type MockPanel = ReturnType<typeof vscode.window.createWebviewPanel>;

function lastPanel(): MockPanel {
  const results = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  return results[results.length - 1].value as MockPanel;
}

/**
 * Open a panel and get it to the point a real one reaches once its webview has
 * loaded: the view announces itself with `ready`, and the host answers with the
 * first state. Until that has happened the panel knows of no versions, so a
 * version command finds no target and quietly does nothing.
 */
async function openPanel(): Promise<void> {
  DatabasesPanel.show(makeDeps());
  await sendMessage({ command: 'ready' });
  const posted = vi.mocked(lastPanel().webview.postMessage).mock.calls;
  if (!posted.some((c) => (c[0] as { command?: string } | undefined)?.command === 'state')) {
    throw new Error('the panel never posted its first state');
  }
}

/**
 * Hand the panel a message the way its webview would, then let it finish.
 *
 * The registered handler deliberately returns void — it fires the async work and
 * routes failures to the panel's own reporting — so awaiting the call itself
 * waits for nothing. Draining the queue is what actually waits.
 */
async function sendMessage(msg: unknown): Promise<void> {
  const handler = vi.mocked(lastPanel().webview.onDidReceiveMessage).mock.calls[0][0] as (
    m: unknown,
  ) => Promise<void> | void;
  // The handler routes its own failures to the panel; nothing here can await it.
  void handler(msg);
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

const RELEASE: GemStoneVersion = {
  version: '3.7.6',
  fileName: 'GemStone64Bit3.7.6-x86_64.Linux.tar.gz',
  url: 'https://example.invalid/GemStone64Bit3.7.6-x86_64.Linux.tar.gz',
  size: 2_000_000_000,
  date: '2026-08-01',
  downloaded: false,
  extracted: false,
};

/** The disk, as the version list reports it. Tests drive it between commands. */
let onDisk: GemStoneVersion[];
/** Databases the storage reports; empty unless a test makes one on disk. */
let databases: { dirName: string; path: string; config: Record<string, string> }[];
let deleteDownload: ReturnType<typeof vi.fn>;

function makeDeps() {
  deleteDownload = vi.fn(async () => {});
  return {
    storage: {
      getPlatformKey: () => 'x86_64.Linux',
      getRootPath: () => '/root',
      getDatabases: () => databases,
      getExtractedVersions: () => [],
      getAvailableExtents: () => [],
    },
    versionManager: {
      getInstalledVersions: () => onDisk,
      fetchCatalog: async () => [],
      versionsFrom: () => onDisk,
      deleteDownload,
    },
    processManager: {
      refreshProcesses: vi.fn(),
      getProcesses: () => [],
      isStoneRunning: () => false,
      isNetldiRunning: () => false,
      getExternalServers: () => ({}),
    },
    databaseManager: { nfsRiskForNextDatabase: () => undefined },
    getLogins: () => [],
    saveLogin: vi.fn(async () => {}),
    refreshAdminViews: vi.fn(),
    sessionManager: {
      onDidAddSession: vi.fn(),
      onDidChangeSelection: vi.fn(),
      onDidRemoveSession: vi.fn(),
      getSessions: () => [],
      getSession: () => undefined,
      getSelectedSession: () => undefined,
    },
    onAdminChange: [],
    extensionUri: vscode.Uri.file('/ext'),
  } as unknown as Parameters<typeof DatabasesPanel.show>[0];
}

beforeEach(() => {
  DatabasesPanel.close();
  vi.mocked(vscode.window.createWebviewPanel).mockClear();
  vi.mocked(vscode.commands.executeCommand).mockClear();
  onDisk = [{ ...RELEASE }];
  databases = [];
});

/** The last state the panel posted, which is what the view would have drawn. */
function lastState(): { databases: { logFiles: { name: string }[] }[] } {
  const posted = vi.mocked(lastPanel().webview.postMessage).mock.calls;
  const states = posted.filter(
    (c) => (c[0] as { command?: string } | undefined)?.command === 'state',
  );
  return (states[states.length - 1][0] as { state: ReturnType<typeof lastState> }).state;
}

describe('session commands', () => {
  const SESSION = { id: 3 } as unknown as ReturnType<typeof Object>;

  function withSession() {
    return {
      ...(makeDeps() as unknown as Record<string, unknown>),
      sessionManager: {
        onDidAddSession: vi.fn(),
        onDidChangeSelection: vi.fn(),
        onDidRemoveSession: vi.fn(),
        getSessions: () => [],
        getSession: (id: number) => (id === 3 ? SESSION : undefined),
        getSelectedSession: () => undefined,
      },
    } as unknown as Parameters<typeof DatabasesPanel.show>[0];
  }

  it('runs an allowed command against the live session record', async () => {
    DatabasesPanel.show(withSession());
    await sendMessage({ command: 'ready' });
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await sendMessage({
      command: 'sessionAction',
      sessionId: 3,
      action: 'gemstone.sessionCommit',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.sessionCommit', {
      activeSession: SESSION,
    });
  });

  // The message arrives from a webview. Passing its string straight to
  // executeCommand would let anything reachable by name be run with a session
  // handed to it.
  it('refuses a command that is not on the list', async () => {
    DatabasesPanel.show(withSession());
    await sendMessage({ command: 'ready' });
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await sendMessage({
      command: 'sessionAction',
      sessionId: 3,
      action: 'workbench.action.closeWindow',
    });

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'workbench.action.closeWindow',
      expect.anything(),
    );
  });
});

describe('backing up a stopped database', () => {
  function manager(dbPath: string, stoneAlive: boolean): DatabaseManager {
    type Args = ConstructorParameters<typeof DatabaseManager>;
    const storage = { getRootPath: () => dbPath } as unknown as Args[0];
    const processes = {
      refreshProcesses: () => {},
      isServerAlive: () => stoneAlive,
      getExternalServers: () => ({}),
    } as unknown as Args[1];
    return new DatabaseManager(storage, processes);
  }

  function makeDb(dbPath: string) {
    fs.mkdirSync(path.join(dbPath, 'data'));
    fs.writeFileSync(path.join(dbPath, 'data', 'extent0.dbf'), 'pretend extent');
    return {
      dirName: 'db-1',
      path: dbPath,
      config: {
        version: '3.7.6',
        stoneName: 'gs64stone',
        ldiName: 'gs64ldi',
        baseExtent: 'extent0.dbf',
      },
    } as never;
  }

  // The backups folder does not exist until something makes it — a database is
  // created without one, so a non-recursive mkdir failed with ENOENT the first
  // time anyone pressed the button.
  it('creates the backups folder, which nothing had made before', async () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-bk-'));
    const db = makeDb(dbPath);
    expect(fs.existsSync(path.join(dbPath, 'backups'))).toBe(false);

    const written = await manager(dbPath, false).offlineExtentBackup(db);

    expect(written).toBe(path.join(dbPath, 'backups', 'extents'));
    const copies = fs.readdirSync(String(written));
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^extent0-\d{8}-\d{6}\.dbf$/);
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  // Copying a live extent without suspending checkpoints yields a file that
  // looks like a backup and is not one.
  it('refuses while the stone is alive', async () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-bk-live-'));
    const db = makeDb(dbPath);

    const written = await manager(dbPath, true).offlineExtentBackup(db);

    expect(written).toBeUndefined();
    expect(fs.existsSync(path.join(dbPath, 'backups'))).toBe(false);
    fs.rmSync(dbPath, { recursive: true, force: true });
  });
});

describe("a database's files", () => {
  // Log directories accumulate, and the file anyone wants is nearly always the
  // most recent — an alphabetical list buries it among its own history.
  it('are listed newest first', async () => {
    const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-db-'));
    fs.mkdirSync(path.join(dbPath, 'log'));
    const write = (name: string, ageMs: number) => {
      const file = path.join(dbPath, 'log', name);
      fs.writeFileSync(file, 'x');
      const when = new Date(Date.parse('2026-08-31T12:00:00Z') - ageMs);
      fs.utimesSync(file, when, when);
    };
    write('aaa-oldest.log', 3 * 86_400_000);
    write('zzz-newest.log', 0);
    write('mmm-middle.log', 86_400_000);
    databases = [
      {
        dirName: 'db-1',
        path: dbPath,
        config: {
          version: '3.7.6',
          stoneName: 'gs64stone',
          ldiName: 'gs64ldi',
          baseExtent: 'extent0.dbf',
        },
      },
    ];

    await openPanel();

    expect(lastState().databases[0].logFiles.map((f) => f.name)).toEqual([
      'zzz-newest.log',
      'mmm-middle.log',
      'aaa-oldest.log',
    ]);
    fs.rmSync(dbPath, { recursive: true, force: true });
  });
});

describe('Install and Remove are inverses', () => {
  it('deletes the archive once the unpack has landed, so Install leaves one thing behind', async () => {
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
      if (command === 'gemstone.downloadVersion') onDisk = [{ ...RELEASE, downloaded: true }];
      if (command === 'gemstone.extractVersion')
        onDisk = [{ ...RELEASE, downloaded: true, extracted: true }];
      return undefined;
    });
    await openPanel();

    await sendMessage({ command: 'installVersion', version: '3.7.6' });

    expect(deleteDownload).toHaveBeenCalledWith(
      expect.objectContaining({ version: '3.7.6', fileName: RELEASE.fileName }),
    );
  });

  it('keeps the archive when the unpack did not happen, so a retry is not another 2 GB', async () => {
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
      if (command === 'gemstone.downloadVersion') onDisk = [{ ...RELEASE, downloaded: true }];
      // extractVersion does nothing — a cancelled or failed unpack.
      return undefined;
    });
    await openPanel();

    await sendMessage({ command: 'installVersion', version: '3.7.6' });

    expect(deleteDownload).not.toHaveBeenCalled();
  });

  it('takes the archive too, so a removed release does not come back offering to install', async () => {
    onDisk = [{ ...RELEASE, downloaded: true, extracted: true }];
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
      if (command === 'gemstone.deleteExtracted') onDisk = [{ ...RELEASE, downloaded: true }];
      return undefined;
    });
    await openPanel();

    await sendMessage({ command: 'uninstallVersion', version: '3.7.6' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.deleteExtracted',
      expect.objectContaining({ version: expect.objectContaining({ version: '3.7.6' }) }),
    );
    expect(deleteDownload).toHaveBeenCalled();
  });

  it('leaves the archive alone when the confirmation was declined', async () => {
    onDisk = [{ ...RELEASE, downloaded: true, extracted: true }];
    // deleteExtracted returns without removing anything — the user said no.
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async () => undefined);
    await openPanel();

    await sendMessage({ command: 'uninstallVersion', version: '3.7.6' });

    expect(deleteDownload).not.toHaveBeenCalled();
  });
});
