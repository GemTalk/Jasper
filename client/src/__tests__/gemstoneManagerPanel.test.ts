import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

/** What this machine reports about shared memory; a test may say otherwise. */
const machine = vi.hoisted(() => ({ inUseBytes: 512 * 1024 * 1024 }));
const A_GIGABYTE = 2 ** 30;

// The 1 GB limit configured, expressed the way each probe reports it (shmall
// counts 4 KB pages). Spreading the real module keeps every other probe the
// panel reads present: an omitted one used to arrive as an OS section quietly
// saying it could not look, rather than as a failure here.
vi.mock('../sharedMemoryTreeProvider', async () => {
  const actual = await vi.importActual<typeof import('../sharedMemoryTreeProvider')>(
    '../sharedMemoryTreeProvider',
  );
  return {
    ...actual,
    getSharedMemory: () => Promise.resolve({ shmmax: 2 ** 30, shmall: 2 ** 18 }),
    getSharedMemoryInUse: () => Promise.resolve(machine.inUseBytes),
  };
});

import * as vscode from 'vscode';

import * as fs from 'fs';
import * as path from 'path';

import {
  GemstoneManagerPanel,
  parseGslistStart,
  SESSION_ACTIONS,
  OS_REMEDIES,
} from '../gemstoneManager';
import type { GemstoneManagerDeps } from '../gemstoneManager';
import { GemStoneLogin } from '../loginTypes';

describe('parseGslistStart', () => {
  it('reads a yearless start time as this year', () => {
    const started = parseGslistStart('Apr 22 10:00:00', new Date('2026-08-05T12:00:00'));

    expect(started).toBe(Date.parse('Apr 22 10:00:00 2026'));
  });

  it('reads the minute-resolution form gslist actually prints', () => {
    const started = parseGslistStart('Aug 06 17:40', new Date('2026-08-06T18:00:00'));

    expect(started).toBe(Date.parse('Aug 06 17:40 2026'));
  });

  it('rolls back a year when this year would put the start in the future', () => {
    const started = parseGslistStart('Dec 30 10:00:00', new Date('2026-01-02T12:00:00'));

    expect(started).toBe(Date.parse('Dec 30 10:00:00 2025'));
  });

  it('keeps a start time from the last day, which clock skew can place slightly ahead', () => {
    const started = parseGslistStart('Aug 05 23:00:00', new Date('2026-08-05T22:00:00'));

    expect(started).toBe(Date.parse('Aug 05 23:00:00 2026'));
  });

  it('has no answer when the process reports no start time', () => {
    expect(parseGslistStart(undefined)).toBeUndefined();
  });

  // gslist is being read for a field whose format has already changed once
  // between releases, so text that is not a date at all has to answer nothing
  // rather than an epoch or a NaN that renders as "running NaN min".
  it('has no answer when the start time is not a date', () => {
    expect(parseGslistStart('Zzz 99 99:99')).toBeUndefined();
  });
});

// The two allow-lists are the panel's whole defence against running a command
// name the webview made up, which also makes them hand-written copies of ids
// owned elsewhere. Nothing else would notice a rename: the id stops matching,
// the dispatch is dropped exactly as an invented one would be, and the button
// goes quiet with no error anywhere.
//
// Registration is the property that matters, not `contributes.commands` — three
// of the OS remedies are registered without being declared there, since they are
// reached from a tree node rather than the palette.
describe('the commands the panel will run on request', () => {
  const registered = new Set<string>();
  const sourcesUnder = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourcesUnder(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  for (const file of sourcesUnder(path.resolve(__dirname, '..'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/registerCommand\(\s*'([^']+)'/g)) {
      registered.add(match[1]);
    }
  }

  it('finds the registrations at all (guards against a broken scan)', () => {
    expect(registered).toContain('gemstone.openManager');
  });

  it.each([...SESSION_ACTIONS, ...OS_REMEDIES])(
    '%s is a command this extension registers',
    (id) => {
      expect(registered.has(id)).toBe(true);
    },
  );
});

function aLogin(user: string): GemStoneLogin {
  return {
    label: `${user}-login`,
    version: '3.7.5',
    gem_host: 'localhost',
    stone: 'db-1',
    gs_user: user,
    gs_password: '',
    netldi: 'gs64ldi',
    host_user: '',
    host_password: '',
  };
}

/** Every trip to the downloads page the panel has made. */
const fetchCatalog = vi.fn(() => Promise.resolve([]));

/** A session the panel can be asked to act on, as the session manager holds it. */
const A_SESSION = { id: 1, login: aLogin('DataCurator') };

/** The managers the panel reads, stubbed down to what building a state needs. */
function fakeDeps(
  getLogins: () => GemStoneLogin[],
  running: {
    isStoneRunning?: () => boolean;
    isNetldiRunning?: () => boolean;
    processes?: unknown[];
    selectionChanged?: (fire: () => void) => void;
    sessionAdded?: (fire: () => void) => void;
  } = {},
): GemstoneManagerDeps {
  const noSubscription = () => ({ dispose: () => {} });
  const onSelection = (handler: () => void) => {
    running.selectionChanged?.(handler);
    return { dispose: () => {} };
  };
  const onAdded = (handler: () => void) => {
    running.sessionAdded?.(handler);
    return { dispose: () => {} };
  };
  return {
    storage: {
      getPlatformKey: () => 'x86_64.Darwin',
      getRootPath: () => '/gs',
      getDatabases: () => [
        {
          dirName: 'db-1',
          path: '/gs/db-1',
          config: {
            stoneName: 'db-1',
            ldiName: 'db-1_ldi',
            version: '3.7.5',
            baseExtent: 'extent0.dbf',
          },
        },
      ],
      getAvailableExtents: () => ['extent0.dbf'],
    },
    versionManager: {
      getInstalledVersions: () => [],
      fetchCatalog,
      fetchAvailableVersions: () => Promise.resolve([]),
    },
    processManager: {
      refreshProcesses: () => {},
      getProcesses: () => running.processes ?? [],
      isStoneRunning: running.isStoneRunning ?? (() => false),
      isNetldiRunning: running.isNetldiRunning ?? (() => false),
    },
    getLogins,
    sessionManager: {
      onDidChangeSelection: onSelection,
      onDidRemoveSession: noSubscription,
      onDidAddSession: onAdded,
      getSessions: () => [A_SESSION],
      getSelectedSession: () => A_SESSION,
      getSession: (id: number) => (id === A_SESSION.id ? A_SESSION : undefined),
    },
    extensionUri: vscode.Uri.file('/ext'),
  } as unknown as GemstoneManagerDeps;
}

type MockPanel = {
  webview: {
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  onDidDispose: ReturnType<typeof vi.fn>;
  onDidChangeViewState: ReturnType<typeof vi.fn>;
  visible: boolean;
};

function lastPanel(): MockPanel {
  const created = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  return created[created.length - 1].value as MockPanel;
}

/**
 * Open a panel wired to a broadcaster standing in for the admin tree providers,
 * whose change events are what tell the panel its state is stale.
 */
function openPanel(
  getLogins: () => GemStoneLogin[] = () => [],
  running: {
    isStoneRunning?: () => boolean;
    isNetldiRunning?: () => boolean;
    processes?: unknown[];
    selectionChanged?: (fire: () => void) => void;
    sessionAdded?: (fire: () => void) => void;
  } = {},
): {
  panel: MockPanel;
  adminChanged: { fire(data: void): void };
} {
  const adminChanged = new vscode.EventEmitter<void>();
  GemstoneManagerPanel.show({
    ...fakeDeps(getLogins, running),
    onAdminChange: [adminChanged.event],
  });
  return { panel: lastPanel(), adminChanged };
}

/** Tell the panel its tab was shown or hidden, as VS Code would. */
function changeVisibility(panel: MockPanel, visible: boolean): void {
  panel.visible = visible;
  const [handler] = panel.onDidChangeViewState.mock.calls[0] as [() => void];
  handler();
}

/** Long enough for the panel's coalescing window to close and a rebuild to land. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

/** Deliver a message from the webview, as the panel's own handler would receive it. */
function send(panel: MockPanel, msg: unknown): void {
  const [handler] = panel.webview.onDidReceiveMessage.mock.calls[0] as [(m: unknown) => void];
  handler(msg);
}

type OsCheck = { key: string; state: string; detail: string };
type PostedState = {
  logins: { label: string; running: boolean }[];
  os: { checks: OsCheck[] };
  databases: { processes: unknown[] }[];
};

/** The states the panel has pushed to its webview, oldest first. */
function postedStates(panel: MockPanel): PostedState[] {
  return panel.webview.postMessage.mock.calls
    .map(([msg]) => msg as { command: string; state?: PostedState })
    .filter((msg) => msg.command === 'state')
    .map((msg) => msg.state!);
}

/** What the latest state says about one operating-system prerequisite. */
async function osCheck(panel: MockPanel, key: string): Promise<OsCheck> {
  await vi.waitFor(() => expect(postedStates(panel).length).toBeGreaterThan(0));

  return postedStates(panel)
    .at(-1)!
    .os.checks.find((c) => c.key === key)!;
}

/** Fire the handler the panel registered for configuration changes. */
function changeSetting(section: string): void {
  const calls = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls;
  for (const [handler] of calls) {
    (handler as (e: { affectsConfiguration(s: string): boolean }) => void)({
      affectsConfiguration: (s: string) => s === section,
    });
  }
}

describe('GemStone Manager panel', () => {
  afterEach(() => {
    // The panel is a singleton; fire its dispose handler so the next test opens
    // a fresh one rather than revealing this one.
    const [onDispose] = lastPanel().onDidDispose.mock.calls[0] as [() => void];
    onDispose();
    vi.clearAllMocks();
    machine.inUseBytes = 512 * 1024 * 1024;
  });

  it('says how much of the shared-memory limit is still free', async () => {
    const { panel, adminChanged } = openPanel();

    adminChanged.fire();

    expect(await osCheck(panel, 'sharedMemory')).toMatchObject({
      state: 'ok',
      detail: '1 GB · 512 MB free',
    });
  });

  it('warns when no room is left for another cache, however high the limit', async () => {
    machine.inUseBytes = A_GIGABYTE - 40 * 1024 * 1024;
    const { panel, adminChanged } = openPanel();

    adminChanged.fire();

    expect(await osCheck(panel, 'sharedMemory')).toMatchObject({
      state: 'warn',
      detail: '1 GB · 40 MB free — no room for another cache',
    });
  });

  it('says a stone is up even when no database here made it', async () => {
    const elsewhere = { ...aLogin('DataCurator'), stone: 'a-stone-made-elsewhere' };
    const { panel, adminChanged } = openPanel(() => [elsewhere], { isStoneRunning: () => true });

    adminChanged.fire();
    await vi.waitFor(() => expect(postedStates(panel).length).toBeGreaterThan(0));

    expect(postedStates(panel).at(-1)!.logins[0]).toMatchObject({ running: true });
  });

  it('asks the download site once, however often it rebuilds', async () => {
    const { panel, adminChanged } = openPanel();
    adminChanged.fire();
    await settle();

    adminChanged.fire();
    await settle();

    expect(postedStates(panel).length).toBeGreaterThan(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it('asks the download site again when the user refreshes', async () => {
    const { panel, adminChanged } = openPanel();
    adminChanged.fire();
    await settle();

    send(panel, { command: 'refresh' });
    await settle();

    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  // One manager, however many times it is asked for: a second panel would show
  // the same environment beside the first and drift from it as soon as either
  // acted, since each keeps its own state.
  it('reveals the manager already open rather than opening another', () => {
    const { panel } = openPanel();

    GemstoneManagerPanel.show({ ...fakeDeps(() => []), onAdminChange: [] });

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect((panel as unknown as { reveal: ReturnType<typeof vi.fn> }).reveal).toHaveBeenCalled();
  });

  it('opens a fresh manager once the last one was closed', () => {
    openPanel();
    const [onDispose] = lastPanel().onDidDispose.mock.calls[0] as [() => void];
    onDispose();

    GemstoneManagerPanel.show({ ...fakeDeps(() => []), onAdminChange: [] });

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  // A scan outlives its coalescing window, so changes keep arriving while one is
  // in flight. They have to collapse into exactly one more pass: run them
  // concurrently and two scans race to post, and the older one can land last.
  it('answers a burst arriving mid-scan with exactly one more pass', async () => {
    let releaseCatalog = (): void => {};
    fetchCatalog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCatalog = () => resolve([]);
        }),
    );
    const { panel, adminChanged } = openPanel();

    adminChanged.fire();
    await settle();
    adminChanged.fire();
    await settle();
    adminChanged.fire();
    await settle();
    releaseCatalog();
    await settle();

    expect(postedStates(panel)).toHaveLength(2);
  });

  // Being looked at is not the same as having something new to show. Rebuilding
  // on every view-state change would scan the disk each time the tab regained
  // focus, for a picture already on screen.
  it('does not rebuild when its tab is shown with nothing having changed', async () => {
    const { panel } = openPanel();

    changeVisibility(panel, true);
    await settle();

    expect(postedStates(panel)).toHaveLength(0);
  });

  it('runs a session action the webview asks for', async () => {
    const { panel } = openPanel();

    send(panel, { command: 'sessionAction', sessionId: 1, action: 'gemstone.sessionCommit' });
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.sessionCommit',
      expect.anything(),
    );
  });

  // The webview names the command to run, so the name is the untrusted part —
  // matched against the allow-list rather than executed on trust.
  it('refuses a session action that is not one it offers', async () => {
    const { panel } = openPanel();

    send(panel, { command: 'sessionAction', sessionId: 1, action: 'gemstone.deleteDatabase' });
    await settle();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'gemstone.deleteDatabase',
      expect.anything(),
    );
  });

  it('runs an operating-system remedy the webview asks for', async () => {
    const { panel } = openPanel();

    send(panel, { command: 'osRemedy', action: 'gemstone.runSetRemoveIPC' });
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.runSetRemoveIPC');
  });

  it('refuses a remedy that is not one it offers', async () => {
    const { panel } = openPanel();

    send(panel, { command: 'osRemedy', action: 'gemstone.deleteDatabase' });
    await settle();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('gemstone.deleteDatabase');
  });

  // Two databases can carry the same stone name under different versions, which
  // is the whole reason pairing goes through versionsMatch rather than the name.
  it('leaves a process of another version out of a database it does not belong to', async () => {
    const foreign = {
      type: 'stone',
      name: 'db-1',
      version: '3.6.2',
      pid: 42,
      status: 'running',
      responding: true,
    };
    const { panel, adminChanged } = openPanel(() => [], { processes: [foreign] });

    adminChanged.fire();
    await vi.waitFor(() => expect(postedStates(panel).length).toBeGreaterThan(0));

    expect(postedStates(panel).at(-1)!.databases[0].processes).toEqual([]);
  });

  it('redraws when the session being worked in changes', async () => {
    let fireSelection = (): void => {};
    const { panel } = openPanel(() => [], {
      selectionChanged: (fire) => {
        fireSelection = fire;
      },
    });

    fireSelection();

    await vi.waitFor(() => expect(postedStates(panel).length).toBeGreaterThan(0));
  });

  // Only the first session is auto-selected, so a second login changed no
  // selection and the panel never heard about it — the row for a login that had
  // just connected went on offering "Log in".
  it('redraws when another session is opened, not only the first', async () => {
    let fireAdded = (): void => {};
    const { panel } = openPanel(() => [], {
      sessionAdded: (fire) => {
        fireAdded = fire;
      },
    });

    fireAdded();

    await vi.waitFor(() => expect(postedStates(panel).length).toBeGreaterThan(0));
  });

  it('says so when a command it dispatched fails', async () => {
    const { panel } = openPanel(() => [aLogin('DataCurator')]);
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('NetLDI is down'));

    send(panel, { command: 'connectLogin', login: 'DataCurator on db-1 (localhost)' });
    await settle();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('NetLDI is down'),
    );
  });

  it('lists a login added while it is open', async () => {
    let logins: GemStoneLogin[] = [];
    const { panel } = openPanel(() => logins);

    logins = [aLogin('DataCurator')];
    changeSetting('gemstone.logins');
    await vi.waitFor(() => expect(postedStates(panel).length).toBeGreaterThan(0));

    const latest = postedStates(panel).at(-1)!;
    expect(latest.logins.map((l) => l.label)).toEqual(['DataCurator on db-1 (localhost)']);
  });

  it('rebuilds when the folder its databases live in is changed', async () => {
    const { panel } = openPanel();

    changeSetting('gemstone.rootPath');

    await vi.waitFor(() => expect(postedStates(panel)).toHaveLength(1));
  });

  it('ignores a setting it does not read', async () => {
    const { panel } = openPanel();

    changeSetting('editor.fontSize');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(postedStates(panel)).toHaveLength(0);
  });

  it('rebuilds when the admin views report a change', async () => {
    const { panel, adminChanged } = openPanel();

    adminChanged.fire();

    await vi.waitFor(() => expect(postedStates(panel)).toHaveLength(1));
  });

  it('rebuilds once for a burst of changes, not once per change', async () => {
    const { panel, adminChanged } = openPanel();

    adminChanged.fire();
    adminChanged.fire();
    adminChanged.fire();
    await settle();

    expect(postedStates(panel)).toHaveLength(1);
  });

  it('never flashes busy on a rebuild it started itself', async () => {
    const { panel, adminChanged } = openPanel();

    adminChanged.fire();
    await settle();

    const loading = panel.webview.postMessage.mock.calls.filter(
      ([msg]) => (msg as { command: string }).command === 'loading',
    );
    expect(loading).toHaveLength(0);
  });

  it('opens the login editor on the login it was asked about', async () => {
    const wanted = aLogin('DataCurator');
    const { panel } = openPanel(() => [aLogin('SystemUser'), wanted]);

    send(panel, { command: 'editLogin', login: 'DataCurator on db-1 (localhost)' });
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.editLogin', {
      login: wanted,
    });
  });

  it('starts only what is down when asked to start and log in', async () => {
    const { panel, adminChanged } = openPanel(() => [aLogin('DataCurator')], {
      isStoneRunning: () => false,
      isNetldiRunning: () => true,
    });
    adminChanged.fire();
    await settle();

    send(panel, { command: 'startAndConnect', login: 'DataCurator on db-1 (localhost)' });
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.startStone',
      expect.anything(),
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'gemstone.startNetldi',
      expect.anything(),
    );
  });

  it('starts both when neither is up', async () => {
    const { panel, adminChanged } = openPanel(() => [aLogin('DataCurator')], {
      isStoneRunning: () => false,
      isNetldiRunning: () => false,
    });
    adminChanged.fire();
    await settle();

    send(panel, { command: 'startAndConnect', login: 'DataCurator on db-1 (localhost)' });
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.startNetldi',
      expect.anything(),
    );
  });

  it('restores from a backup inside the database it belongs to', async () => {
    const { panel, adminChanged } = openPanel();
    adminChanged.fire();
    await settle();

    send(panel, {
      command: 'restoreBackup',
      dirName: 'db-1',
      path: '/gs/db-1/backups/db-1.dbf',
    });
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.fullLogicalRestore',
      expect.objectContaining({ kind: 'backupFile', filePath: '/gs/db-1/backups/db-1.dbf' }),
    );
  });

  it('refuses to restore a file from outside the database it belongs to', async () => {
    const { panel, adminChanged } = openPanel();
    adminChanged.fire();
    await settle();

    send(panel, { command: 'restoreBackup', dirName: 'db-1', path: '/etc/passwd' });
    await settle();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'gemstone.fullLogicalRestore',
      expect.anything(),
    );
  });

  it('holds a change made while hidden until the tab is shown again', async () => {
    const { panel, adminChanged } = openPanel();
    changeVisibility(panel, false);

    adminChanged.fire();
    await settle();
    expect(postedStates(panel)).toHaveLength(0);

    changeVisibility(panel, true);

    await vi.waitFor(() => expect(postedStates(panel)).toHaveLength(1));
  });
});
