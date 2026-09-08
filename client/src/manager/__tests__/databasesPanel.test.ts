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
// Windows takes a branch Linux does not: Refresh re-probes WSL before rebuilding,
// and on a real Windows runner that shells out to wsl.exe and takes seconds — long
// enough that a test driving two refreshes measures the probe rather than the panel.
// Held to "no WSL here" so every platform exercises the same path.
// POSIX by default, so every other test takes the ordinary path. The Windows
// tests flip this — a suite that pins it to false can never see a Windows-only
// mistake, which is how the product-tree discovery shipped comparing a UNC
// prefix against a Linux path.
vi.mock('../../wslBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../wslBridge')>()),
  needsWsl: vi.fn(() => false),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseManager } from '../databaseManager';
import { DatabasesPanel } from '../databasesPanel';
import type { GemStoneVersion } from '../../sysadminTypes';
import { SysadminStorage } from '../../sysadminStorage';
import { needsWsl } from '../../wslBridge';

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
/** What DatabaseManager reports about NFS, and the create it performs. */
let nfsRisk: { rootPath: string; fsType: string } | undefined;
let createDatabaseDirect: ReturnType<typeof vi.fn>;
/** Databases the storage reports; empty unless a test makes one on disk. */
let registerExistingDatabase: ReturnType<typeof vi.fn>;
let recordNetldiPort: ReturnType<typeof vi.fn>;
let databases: {
  dirName: string;
  path: string;
  config: Record<string, string | number | boolean>;
}[];
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
      // Read for every row: nothing is running here, so no version disagrees.
      versionMismatchRefusal: () => undefined,
      discoverServersUnder: () => [],
      netldiPortFor: () => undefined,
    },
    databaseManager: {
      nfsRiskForNextDatabase: () => nfsRisk,
      createDatabaseDirect,
      registerExistingDatabase,
      recordNetldiPort,
    },
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
  vi.mocked(needsWsl).mockReturnValue(false);
  vi.mocked(vscode.window.createWebviewPanel).mockClear();
  vi.mocked(vscode.commands.executeCommand).mockClear();
  onDisk = [{ ...RELEASE }];
  databases = [];
  nfsRisk = undefined;
  // Answers the config as it now stands, the way the real one does.
  recordNetldiPort = vi.fn((db: { config: Record<string, unknown> }, port: number) => ({
    ...db.config,
    netldiPort: port,
  }));
  registerExistingDatabase = vi.fn(async () => ({
    dirName: 'db-2',
    path: '/root/db-2',
    config: {
      version: '3.7.5.1',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      registered: true,
      productPath: '/opt/theirs/product',
    },
  }));
  createDatabaseDirect = vi.fn(async () => ({
    dirName: 'db-1',
    path: '/root/db-1',
    config: {
      version: '3.7.6',
      stoneName: 'demoStone',
      ldiName: 'demoLdi',
      baseExtent: 'extent0.dbf',
    },
  }));
});

/** The last state the panel posted, which is what the view would have drawn. */
function lastState(): {
  databases: {
    dirName: string;
    logFiles: { name: string }[];
    registered?: boolean;
    registeredReason?: string;
    productPath?: string;
    netldiPort?: number;
    availableExtents: string[];
    backupFiles: unknown[];
    extentBackupFiles: unknown[];
  }[];
  create: { nfsWarning: boolean; rootPath: string; ldiNames: string[]; dbLdiNames: string[] };
} {
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

describe('creating a database that the form asked for', () => {
  const FORM = {
    command: 'createDatabase',
    version: '3.7.6',
    extent: 'extent0',
    stoneName: 'demoStone',
    ldiName: 'demoLdi',
    allowNfs: false,
  };

  it('passes every answer through, in order', async () => {
    await openPanel();
    await sendMessage(FORM);

    expect(createDatabaseDirect).toHaveBeenCalledTimes(1);
    const [version, extent, stoneName, ldiName, , parentDir, allowNfs] =
      createDatabaseDirect.mock.calls[0];
    expect([version, extent, stoneName, ldiName]).toEqual([
      '3.7.6',
      'extent0',
      'demoStone',
      'demoLdi',
    ]);
    expect(parentDir).toBeUndefined();
    expect(allowNfs).toBe(false);
  });

  // The same thing the command path does, so a database made here is not subtly
  // different from one made anywhere else.
  it('adds the stone its DataCurator login, and refreshes the sidebar', async () => {
    const deps = makeDeps() as unknown as {
      saveLogin: ReturnType<typeof vi.fn>;
      refreshAdminViews: ReturnType<typeof vi.fn>;
    };
    DatabasesPanel.show(deps as never);
    await sendMessage({ command: 'ready' });

    await sendMessage(FORM);

    expect(deps.saveLogin).toHaveBeenCalledTimes(1);
    expect(deps.refreshAdminViews).toHaveBeenCalled();
  });

  it('carries the NFS override through when the form set it', async () => {
    nfsRisk = { rootPath: '/root', fsType: 'nfs4' };
    await openPanel();

    await sendMessage({ ...FORM, allowNfs: true });

    expect(createDatabaseDirect.mock.calls[0][6]).toBe(true);
  });

  it('refuses a stone name that is already taken, without creating anything', async () => {
    databases = [
      {
        dirName: 'db-9',
        path: '/root/db-9',
        config: {
          version: '3.7.6',
          stoneName: 'demoStone',
          ldiName: 'other',
          baseExtent: 'extent0.dbf',
        },
      },
    ];
    await openPanel();

    await sendMessage(FORM);

    expect(createDatabaseDirect).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});

describe('what the New Database form is offered', () => {
  it('warns about network storage only when the root is on it', async () => {
    await openPanel();
    expect(lastState().create.nfsWarning).toBe(false);

    nfsRisk = { rootPath: '/root', fsType: 'nfs4' };
    DatabasesPanel.close();
    await openPanel();
    expect(lastState().create.nfsWarning).toBe(true);
    expect(lastState().create.rootPath).toBe('/root');
  });

  // The name has to be free on the machine, not just among databases Jasper
  // made — a NetLDI someone started by hand holds it just as well.
  it('lists NetLDI names in use by anything, not only by its own databases', async () => {
    const deps = makeDeps() as unknown as {
      processManager: { getProcesses: () => unknown[] };
      storage: { getDatabases: () => unknown[] };
    };
    deps.processManager.getProcesses = () => [
      { type: 'netldi', name: 'handStartedLdi', pid: 1, status: 'OK', responding: true },
    ];
    DatabasesPanel.show(deps as never);
    await sendMessage({ command: 'ready' });

    expect(lastState().create.ldiNames).toContain('handStartedLdi');
  });
});

describe('opening straight into the New Database form', () => {
  // It used to be posted the instant the panel object was made — before the
  // webview had loaded its script, let alone registered a message listener, and
  // init() resets the form state when it does. The message was lost twice over.
  it('waits until the webview says it is listening', async () => {
    DatabasesPanel.show(makeDeps(), false, true);
    const posted = () =>
      vi
        .mocked(lastPanel().webview.postMessage)
        .mock.calls.filter((c) => (c[0] as { command?: string })?.command === 'beginCreate');

    expect(posted()).toHaveLength(0);

    await sendMessage({ command: 'ready' });

    expect(posted()).toHaveLength(1);
  });

  // Ahead of the state, not behind it. postState ends by asking the download
  // site for the catalogue, and waiting for that put a whole network round trip
  // between the button and the form: the panel opened on the lists, sat there,
  // and only then swapped over.
  it('sends it before the first state, so the form is what gets drawn', async () => {
    DatabasesPanel.show(makeDeps(), false, true);
    await sendMessage({ command: 'ready' });

    const commands = vi
      .mocked(lastPanel().webview.postMessage)
      .mock.calls.map((c) => (c[0] as { command?: string })?.command);

    expect(commands.indexOf('beginCreate')).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('beginCreate')).toBeLessThan(commands.indexOf('state'));
  });

  it('does not send it when the panel was opened on the lists', async () => {
    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });
    expect(
      vi
        .mocked(lastPanel().webview.postMessage)
        .mock.calls.filter((c) => (c[0] as { command?: string })?.command === 'beginCreate'),
    ).toHaveLength(0);
  });
});

describe('creating a database from a message', () => {
  // This path writes a database directory and a database.yaml describing it. A
  // message missing a field is a bug in whatever sent it, not a user mistake —
  // half-honouring it left a database whose recorded version was "undefined".
  it.each(['version', 'extent', 'stoneName', 'ldiName'])(
    'refuses outright when %s is missing',
    async (missing) => {
      await openPanel();
      const full: Record<string, unknown> = {
        command: 'createDatabase',
        version: '3.7.6',
        extent: 'extent0',
        stoneName: 'demoStone',
        ldiName: 'demoLdi',
        allowNfs: false,
      };
      delete full[missing];

      await sendMessage(full);

      expect(createDatabaseDirect).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    },
  );
});

describe("opening one of a database's folders", () => {
  // `folder` arrives from the webview, so it is whitelisted rather than joined
  // blindly — and the Extent backups root sends a nested path, which fell
  // through the old whitelist and opened the log directory instead.
  it.each([
    ['log', 'log'],
    ['conf', 'conf'],
    ['backups', 'backups'],
    ['backups/extents', 'backups/extents'],
  ])('opens %s as %s', async (asked, expected) => {
    databases = [
      {
        dirName: 'db-1',
        path: '/root/db-1',
        config: {
          version: '3.7.6',
          stoneName: 'gs64stone',
          ldiName: 'gs64ldi',
          baseExtent: 'extent0.dbf',
        },
      },
    ];
    await openPanel();
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await sendMessage({ command: 'openDbSubfolder', dirName: 'db-1', folder: asked });

    const call = vi
      .mocked(vscode.commands.executeCommand)
      .mock.calls.find((c) => c[0] === 'revealFileInOS');
    // Built with path.join, not a literal: the code joins too, and Windows joins
    // with backslashes. A hardcoded '/root/db-1/log' passes on Linux and fails
    // every Windows leg of CI.
    expect(String((call?.[1] as { fsPath?: string })?.fsPath)).toBe(
      path.join('/root/db-1', expected),
    );
  });

  // An off-list folder means the view and the host have drifted. Opening some
  // other folder makes a broken button look like it worked; opening nothing
  // makes it obvious.
  it('opens nothing at all when the folder is not on the list', async () => {
    databases = [
      {
        dirName: 'db-1',
        path: '/root/db-1',
        config: {
          version: '3.7.6',
          stoneName: 'gs64stone',
          ldiName: 'gs64ldi',
          baseExtent: 'extent0.dbf',
        },
      },
    ];
    await openPanel();
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await sendMessage({ command: 'openDbSubfolder', dirName: 'db-1', folder: '../../etc' });

    expect(
      vi.mocked(vscode.commands.executeCommand).mock.calls.filter((c) => c[0] === 'revealFileInOS'),
    ).toHaveLength(0);
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

    // Through the button the panel actually has: Install Version… fetches the
    // catalogue, offers what is not installed, and installs what was picked.
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.6' });
    await sendMessage({ command: 'installNewVersion' });

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

    // Through the button the panel actually has: Install Version… fetches the
    // catalogue, offers what is not installed, and installs what was picked.
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({ label: '3.7.6' });
    await sendMessage({ command: 'installNewVersion' });

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

describe('overlapping state passes', () => {
  /** A database row, distinguishable by its directory name. */
  function db(dirName: string) {
    return {
      dirName,
      path: `/root/${dirName}`,
      config: {
        version: '3.7.6',
        stoneName: 'gs64stone',
        ldiName: 'gs64ldi',
        baseExtent: 'extent0.dbf',
      },
    };
  }

  function lastPostedState(): { databases: { dirName: string }[] } | undefined {
    const posted = vi.mocked(lastPanel().webview.postMessage).mock.calls;
    for (let i = posted.length - 1; i >= 0; i -= 1) {
      const m = posted[i][0] as { command?: string; state?: { databases: { dirName: string }[] } };
      if (m?.command === 'state') return m.state;
    }
    return undefined;
  }

  /**
   * A pass that has been overtaken must not repaint the panel.
   *
   * Each pass renders from disk, then again once the download catalog answers.
   * Two actions in quick succession leave two passes in flight, and the network
   * decides which finishes last — so the older pass could post rows built
   * before the newer action happened, leaving the panel stale until something
   * else redrew it. Held catalog answers here are the real shape of that race,
   * not a contrived delay.
   */
  it('ignores a pass the user has already overtaken', async () => {
    const answerCatalog: ((v: GemStoneVersion[]) => void)[] = [];
    const deps = makeDeps();
    (
      deps as unknown as { versionManager: { fetchCatalog: () => Promise<GemStoneVersion[]> } }
    ).versionManager.fetchCatalog = () =>
      new Promise<GemStoneVersion[]>((resolve) => answerCatalog.push(resolve));
    const drain = async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    };

    onDisk = [];
    databases = [db('db-before')];
    DatabasesPanel.show(deps);
    await sendMessage({ command: 'ready' });
    // Let the opening pass finish, so only the two passes under test are left.
    answerCatalog.shift()?.([]);
    await drain();

    // The first action's pass stalls on the catalog...
    await sendMessage({ command: 'refresh' });
    // ...and the user acts again, against a database list that has since changed.
    databases = [db('db-after')];
    await sendMessage({ command: 'refresh' });

    // The second pass answers first, the first pass last — the losing order.
    answerCatalog.pop()?.([]);
    await drain();
    answerCatalog.pop()?.([]);
    await drain();

    expect(lastPostedState()?.databases.map((d) => d.dirName)).toEqual(['db-after']);
  });
});

// ── Registering an existing installation ──────────────────────────────────
// The host half of Register Existing: reading the chosen directory, and writing
// the record. See registeredDatabase.ts for the rule these keep.

describe('registering an existing database', () => {
  it('answers the folder picker with the version it read and what is running there', async () => {
    const deps = makeDeps() as unknown as {
      processManager: { discoverServersUnder: () => unknown[] };
    };
    deps.processManager.discoverServersUnder = () => [
      { type: 'stone', name: 'theirstone', pid: 7, globalDir: '/opt/gemstone' },
    ];
    vi.spyOn(SysadminStorage, 'readVersionTxt').mockReturnValue({
      version: '3.7.5.1',
      date: '2026-06-25',
      description: 'branch 3.7.5.1',
    });
    // Through the Uri, because that is how the pick reaches the panel: on
    // Windows `fsPath` answers a separator-normalized path, so the literal the
    // dialog was handed is not the string the panel posts back.
    const productUri = vscode.Uri.file('/opt/theirs/product');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([productUri] as never);

    DatabasesPanel.show(deps as never);
    await sendMessage({ command: 'ready' });
    await sendMessage({ command: 'pickProductDirectory' });

    const picked = vi
      .mocked(lastPanel().webview.postMessage)
      .mock.calls.map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.command === 'productPicked');
    expect(picked).toMatchObject({
      productPath: productUri.fsPath,
      version: '3.7.5.1',
      description: 'branch 3.7.5.1',
    });
    expect(picked?.servers).toHaveLength(1);
  });

  it('tells the form when the chosen folder is not a product tree, rather than failing silently', async () => {
    vi.spyOn(SysadminStorage, 'readVersionTxt').mockReturnValue(undefined);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      vscode.Uri.file('/home/me/Documents'),
    ] as never);

    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });
    await sendMessage({ command: 'pickProductDirectory' });

    const picked = vi
      .mocked(lastPanel().webview.postMessage)
      .mock.calls.map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.command === 'productPicked');
    expect(String(picked?.problem)).toContain('version.txt');
    expect(picked?.version).toBeUndefined();
  });

  it('passes the form\u2019s answers straight to the register call', async () => {
    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });

    await sendMessage({
      command: 'registerDatabase',
      productPath: '/opt/theirs/product',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      netldiPort: 46717,
      confPath: '/opt/theirs/product/data',
      globalDir: '/opt/gemstone',
    });

    // The wire message's own `command` is not part of the record.
    expect(registerExistingDatabase).toHaveBeenCalledWith({
      productPath: '/opt/theirs/product',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      netldiPort: 46717,
      confPath: '/opt/theirs/product/data',
      globalDir: '/opt/gemstone',
    });
  });

  it('refuses a stone name that is already on the list, without writing a record', async () => {
    databases = [
      {
        dirName: 'db-1',
        path: '/root/db-1',
        config: {
          version: '3.7.5',
          stoneName: 'theirstone',
          ldiName: 'gs64ldi',
          baseExtent: 'extent0.dbf',
        },
      },
    ];
    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });

    await sendMessage({
      command: 'registerDatabase',
      productPath: '/opt/theirs/product',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
    });

    expect(registerExistingDatabase).not.toHaveBeenCalled();
  });

  it('refuses a product directory that is on the Windows side, not in WSL', async () => {
    // GemStone has no Windows build: everything Jasper runs for a database runs
    // inside the guest, under a path the guest can resolve. A tree picked on the
    // Windows side would register happily and then fail on every command, so it
    // is refused while the folder that has to change is still on screen.
    vi.mocked(needsWsl).mockReturnValue(true);
    vi.spyOn(SysadminStorage, 'readVersionTxt').mockReturnValue({
      version: '3.7.5.1',
      date: '2026-06-25',
      description: 'branch 3.7.5.1',
    });
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      { fsPath: 'C:\\gemstone\\product' },
    ] as never);

    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });
    await sendMessage({ command: 'pickProductDirectory' });

    const picked = vi
      .mocked(lastPanel().webview.postMessage)
      .mock.calls.map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.command === 'productPicked');
    expect(String(picked?.problem)).toContain('WSL');
    expect(picked?.version).toBeUndefined();
  });

  it('accepts a product directory inside the guest, addressed as a UNC path', async () => {
    vi.mocked(needsWsl).mockReturnValue(true);
    vi.spyOn(SysadminStorage, 'readVersionTxt').mockReturnValue({
      version: '3.7.5.1',
      date: '2026-06-25',
      description: 'branch 3.7.5.1',
    });
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      { fsPath: '\\\\wsl$\\Ubuntu\\opt\\theirs\\product' },
    ] as never);

    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });
    await sendMessage({ command: 'pickProductDirectory' });

    const picked = vi
      .mocked(lastPanel().webview.postMessage)
      .mock.calls.map((c) => c[0] as Record<string, unknown>)
      .find((m) => m.command === 'productPicked');
    expect(picked?.problem).toBeUndefined();
    expect(picked?.version).toBe('3.7.5.1');
  });

  it('refuses a NetLDI name another database already carries', async () => {
    // Two databases sharing an ldiName both match the same gslist row
    // (`isNetldiRunning` matches on name + version), so each reports the other's
    // NetLDI as its own and `netldiPortFor` can hand one database's port to the
    // other's login.
    databases = [
      {
        dirName: 'db-1',
        path: '/root/db-1',
        config: {
          version: '3.7.5',
          stoneName: 'ourstone',
          ldiName: 'theirldi',
          baseExtent: 'extent0.dbf',
        },
      },
    ];
    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });

    await sendMessage({
      command: 'registerDatabase',
      productPath: '/opt/theirs/product',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
    });

    expect(registerExistingDatabase).not.toHaveBeenCalled();
  });

  it('offers the form the databases\u2019 own NetLDI names, not every one running', async () => {
    // The name being registered is normally already held by the running NetLDI
    // being adopted, so the create form's list — which counts a live NetLDI as
    // taken — would refuse every ordinary registration. The register form checks
    // the narrower list instead.
    const deps = makeDeps() as unknown as {
      processManager: { getProcesses: () => unknown[] };
    };
    deps.processManager.getProcesses = () => [
      { type: 'netldi', name: 'theirldi', pid: 9, version: '3.7.5', status: 'OK' },
    ];
    databases = [
      {
        dirName: 'db-1',
        path: '/root/db-1',
        config: {
          version: '3.7.5',
          stoneName: 'ourstone',
          ldiName: 'gs64ldi',
          baseExtent: 'extent0.dbf',
        },
      },
    ];
    DatabasesPanel.show(deps as never);
    await sendMessage({ command: 'ready' });

    const create = lastState().create;
    expect(create.dbLdiNames).toEqual(['gs64ldi']);
    expect(create.ldiNames).toContain('theirldi');
  });

  it('draws a registered row as registered, with nothing extent-shaped on it', async () => {
    databases = [
      {
        dirName: 'db-2',
        path: '/root/db-2',
        config: {
          version: '3.7.5',
          stoneName: 'theirstone',
          ldiName: 'theirldi',
          registered: true,
          productPath: '/opt/theirs/product',
          netldiPort: 46717,
        },
      },
    ];
    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });

    const row = lastState().databases[0];
    expect(row.registered).toBe(true);
    expect(row.registeredReason).toContain('Jasper did not create this database');
    expect(row.productPath).toBe('/opt/theirs/product');
    expect(row.netldiPort).toBe(46717);
    // Nothing that would offer to write inside the installation.
    expect(row.availableExtents).toEqual([]);
    expect(row.backupFiles).toEqual([]);
    expect(row.extentBackupFiles).toEqual([]);
  });
});

describe('a registered database whose NetLDI has moved', () => {
  const registered = {
    dirName: 'db-4',
    path: '/root/db-4',
    config: {
      version: '3.7.5',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      registered: true,
      productPath: '/opt/theirs/product',
      netldiPort: 46717,
    },
  };

  it('shows the port it is listening on now, and corrects the record', async () => {
    // The failure this closes: register while the NetLDI is up, restart it, and
    // every login built from the record dials the old port — an ECONNABORTED
    // that says nothing about ports.
    databases = [registered];
    const deps = makeDeps() as unknown as {
      processManager: { netldiPortFor: () => number | undefined };
    };
    deps.processManager.netldiPortFor = () => 34199;

    DatabasesPanel.show(deps as never);
    await sendMessage({ command: 'ready' });

    expect(lastState().databases[0].netldiPort).toBe(34199);
    expect(recordNetldiPort).toHaveBeenCalledWith(
      expect.objectContaining({ dirName: 'db-4' }),
      34199,
    );
  });

  it('keeps the recorded port while nothing is running to contradict it', async () => {
    databases = [registered];
    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });

    expect(lastState().databases[0].netldiPort).toBe(46717);
    expect(recordNetldiPort).not.toHaveBeenCalled();
  });
});

describe('deleting a login from the panel', () => {
  it('routes through the command, which is what confirms and clears the keychain', async () => {
    // Reaching for storage.deleteLogin here would skip the active-session
    // refusal and the confirmation, and orphan the keychain entry.
    const login = {
      label: 'DataCurator on gs64stone (localhost)',
      gs_user: 'DataCurator',
      stone: 'gs64stone',
      gem_host: 'localhost',
      version: '3.7.5',
      netldi: 'gs64ldi',
      gs_password: '',
      host_user: '',
      host_password: '',
    };
    const deps = {
      ...(makeDeps() as unknown as Record<string, unknown>),
      getLogins: () => [login],
    } as unknown as Parameters<typeof DatabasesPanel.show>[0];

    DatabasesPanel.show(deps);
    await sendMessage({ command: 'ready' });
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await sendMessage({ command: 'deleteLogin', login: login.label });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.deleteLogin', {
      login,
    });
  });

  it('does nothing for a label no login answers to', async () => {
    DatabasesPanel.show(makeDeps());
    await sendMessage({ command: 'ready' });
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await sendMessage({ command: 'deleteLogin', login: 'nobody on nowhere (localhost)' });

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'gemstone.deleteLogin',
      expect.anything(),
    );
  });
});
