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
/** What DatabaseManager reports about NFS, and the create it performs. */
let nfsRisk: { rootPath: string; fsType: string } | undefined;
let createDatabaseDirect: ReturnType<typeof vi.fn>;
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
    databaseManager: { nfsRiskForNextDatabase: () => nfsRisk, createDatabaseDirect },
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
  nfsRisk = undefined;
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
  databases: { logFiles: { name: string }[] }[];
  create: { nfsWarning: boolean; rootPath: string; ldiNames: string[] };
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
    ['../../etc', 'log'],
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
