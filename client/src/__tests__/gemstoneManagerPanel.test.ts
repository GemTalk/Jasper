import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sharedMemoryTreeProvider', () => ({
  getSharedMemory: () => Promise.resolve({ shmmax: 2 ** 30, shmall: 2 ** 18 }),
  sharedMemoryStatus: () => ({ configured: true, gbLabel: '1' }),
}));

import * as vscode from 'vscode';

import { GemstoneManagerPanel, parseGslistStart } from '../gemstoneManager';
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

/** The managers the panel reads, stubbed down to what building a state needs. */
function fakeDeps(
  getLogins: () => GemStoneLogin[],
  running: { isStoneRunning?: () => boolean; isNetldiRunning?: () => boolean } = {},
): GemstoneManagerDeps {
  const noSubscription = () => ({ dispose: () => {} });
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
      getProcesses: () => [],
      isStoneRunning: running.isStoneRunning ?? (() => false),
      isNetldiRunning: running.isNetldiRunning ?? (() => false),
    },
    getLogins,
    sessionManager: {
      onDidChangeSelection: noSubscription,
      onDidRemoveSession: noSubscription,
      getSessions: () => [],
      getSelectedSession: () => undefined,
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
  running: { isStoneRunning?: () => boolean; isNetldiRunning?: () => boolean } = {},
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

/** The states the panel has pushed to its webview, oldest first. */
function postedStates(panel: MockPanel): { logins: { label: string }[] }[] {
  return panel.webview.postMessage.mock.calls
    .map(([msg]) => msg as { command: string; state?: { logins: { label: string }[] } })
    .filter((msg) => msg.command === 'state')
    .map((msg) => msg.state!);
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
