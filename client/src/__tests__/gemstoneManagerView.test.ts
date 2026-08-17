// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate gemstoneManagerView.js in jsdom so it registers the global
// GemstoneManager, exactly as the panel does when it injects the file as a
// <script> tag.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../gemstoneManagerView.js'), 'utf8');
  new Function(source)();
});

type Host = { postMessage: ReturnType<typeof vi.fn> };

type GemstoneManagerApi = {
  init(refs: { root: HTMLElement }, api: Host): void;
  render(state: unknown): void;
};

function api(): GemstoneManagerApi {
  return (globalThis as unknown as { GemstoneManager: GemstoneManagerApi }).GemstoneManager;
}

const HEALTHY_OS = {
  supported: true,
  platformLabel: 'macOS',
  sharedMemoryConfigured: true,
  gbLabel: '2.0',
  unknown: false,
};

const INSTALLED_VERSION = {
  version: '3.7.5',
  fileName: '',
  size: 0,
  date: '2026-03-24',
  downloaded: false,
  extracted: true,
};

function database(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dirName: 'devKit',
    version: '3.7.5',
    stoneName: 'devKit',
    ldiName: 'devKit_ldi',
    baseExtent: 'extent0.dbf',
    path: '/gs/devKit',
    stoneRunning: false,
    netldiRunning: false,
    processes: [],
    logins: [],
    availableExtents: ['extent0.dbf'],
    logFiles: [],
    confFiles: [],
    backupFiles: [],
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: 'x86_64.Darwin',
    rootPath: '/Users/gem/Documents/GemStone',
    os: HEALTHY_OS,
    versions: [INSTALLED_VERSION],
    databases: [database()],
    logins: [],
    ...overrides,
  };
}

/** A panel showing `state`, plus the host it reports back to. */
function open(managerState: Record<string, unknown>): { root: HTMLElement; host: Host } {
  const root = document.createElement('main');
  document.body.appendChild(root);
  const host: Host = { postMessage: vi.fn() };

  api().init({ root }, host);
  api().render(managerState);

  return { root, host };
}

function sectionOrder(root: HTMLElement): string[] {
  return [...root.querySelectorAll('details.section')].map(
    (s) => s.getAttribute('data-section') ?? '',
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GemStone Manager webview', () => {
  it('shows one section for each part of the GemStone environment', () => {
    const { root } = open(state());

    expect(sectionOrder(root).sort()).toEqual(['connect', 'databases', 'os', 'versions']);
  });

  it('leads with the operating system when the machine cannot run a stone', () => {
    const unconfigured = { ...HEALTHY_OS, sharedMemoryConfigured: false, gbLabel: '0' };

    const { root } = open(state({ os: unconfigured }));

    expect(sectionOrder(root)[0]).toBe('os');
  });

  it('leads with the versions when no release is installed', () => {
    const { root } = open(state({ versions: [] }));

    expect(sectionOrder(root)[0]).toBe('versions');
  });

  it('sinks a settled operating system below the sections in use', () => {
    const { root } = open(state());

    expect(sectionOrder(root)).toEqual(['connect', 'databases', 'versions', 'os']);
  });

  it('asks the host to start a database when its power control is used', () => {
    const { root, host } = open(state());

    root.querySelector<HTMLButtonElement>('.power-start')!.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'startDatabase', dirName: 'devKit' }),
    );
  });

  it('offers to stop a database whose stone is up', () => {
    const { root, host } = open(state({ databases: [database({ stoneRunning: true })] }));

    root.querySelector<HTMLButtonElement>('.power-stop')!.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'stopDatabase', dirName: 'devKit' }),
    );
  });

  it('offers to edit a login listed under its database', () => {
    const withLogin = database({
      logins: [
        {
          label: 'DataCurator on devKit (localhost)',
          user: 'DataCurator',
          stone: 'devKit',
          host: 'localhost',
        },
      ],
    });
    const { root, host } = open(state({ databases: [withLogin] }));

    root.querySelector<HTMLButtonElement>('[data-action="editLogin"]')!.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'editLogin',
        login: 'DataCurator on devKit (localhost)',
      }),
    );
  });

  it('says a stone just started rather than counting zero minutes', () => {
    const justNow = database({ stoneRunning: true, startedAtMs: Date.now() });

    const { root } = open(state({ databases: [justNow] }));

    const liveness = root.querySelector('.db-state')!.textContent;
    expect(liveness).toBe('just started');
  });
  it('counts the minutes once a stone has been up for some', () => {
    const forAWhile = database({ stoneRunning: true, startedAtMs: Date.now() - 20 * 60_000 });

    const { root } = open(state({ databases: [forAWhile] }));

    expect(root.querySelector('.db-state')!.textContent).toBe('running 20 min');
  });
  it('offers a remedy only for the prerequisite that failed', () => {
    const checks = [
      { key: 'sharedMemory', label: 'Shared memory', state: 'ok', detail: '2.0 GB' },
      {
        key: 'removeIpc',
        label: 'RemoveIPC',
        state: 'warn',
        detail: 'yes',
        remedy: {
          command: 'gemstone.runSetRemoveIPC',
          label: 'Run setup script',
          note: 'requires sudo',
        },
      },
    ];

    const { root, host } = open(state({ os: { ...HEALTHY_OS, checks } }));

    const buttons = [...root.querySelectorAll('[data-action="osRemedy"]')];
    expect(buttons).toHaveLength(1);
    (buttons[0] as HTMLButtonElement).click();
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'osRemedy', action: 'gemstone.runSetRemoveIPC' }),
    );
  });

  it('says what each prerequisite currently reports', () => {
    const checks = [
      { key: 'wslNetworking', label: 'WSL networking', state: 'warn', detail: 'NAT (172.20.1.5)' },
    ];

    const { root } = open(state({ os: { ...HEALTHY_OS, checks } }));

    expect(root.querySelector('[data-section="os"]')!.textContent).toContain('NAT (172.20.1.5)');
  });

  it('offers to clear the lock of a process that stopped responding', () => {
    const stale = database({
      stoneRunning: false,
      processes: [{ type: 'stone', name: 'devKit', pid: 42, status: 'killed', responding: false }],
    });
    const { root, host } = open(state({ databases: [stale] }));

    root.querySelector<HTMLButtonElement>('[data-action="deleteStaleLock"]')!.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'deleteStaleLock', dirName: 'devKit', name: 'devKit' }),
    );
  });

  it('keeps the Windows client actions off a machine that is not Windows', () => {
    const { root } = open(state());

    expect(root.querySelector('[data-action="installWindowsClient"]')).toBeNull();
    expect(root.querySelector('[data-action="copyNetldiHost"]')).toBeNull();
  });

  it('offers to install the Windows client on Windows', () => {
    const { root, host } = open(state({ windows: true }));

    root.querySelector<HTMLButtonElement>('[data-action="installWindowsClient"]')!.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'installWindowsClient', version: '3.7.5' }),
    );
  });

  it('warns when the machine has no room for another cache, even over the limit', () => {
    const noRoom = [
      {
        key: 'sharedMemory',
        label: 'Shared memory',
        state: 'warn',
        detail: '1 GB · 40 MB free — no room for another cache',
      },
    ];

    const { root } = open(state({ os: { ...HEALTHY_OS, checks: noRoom } }));

    expect(root.querySelector('[data-section="os"]')!.textContent).toContain(
      'no room for another cache',
    );
  });

  it('offers to back up a database whose stone is up', () => {
    const { root, host } = open(state({ databases: [database({ stoneRunning: true })] }));

    root.querySelector<HTMLButtonElement>('[data-action="backupDatabase"]')!.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'backupDatabase', dirName: 'devKit' }),
    );
  });

  it('does not offer to back up a database whose stone is down', () => {
    const { root } = open(state());

    expect(root.querySelector('[data-action="backupDatabase"]')).toBeNull();
  });

  it('offers to restore from a backup it lists', () => {
    const withBackup = database({
      backupFiles: [{ name: 'devKit-2026-08-06.dbf', path: '/gs/devKit/backups/devKit.dbf' }],
    });
    const { root, host } = open(state({ databases: [withBackup] }));

    root.querySelector<HTMLButtonElement>('[data-action="restoreBackup"]')!.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'restoreBackup',
        dirName: 'devKit',
        path: '/gs/devKit/backups/devKit.dbf',
      }),
    );
  });

  it('offers to log out of a live session, whatever it can tell about the stone', () => {
    // A stone Jasper did not make here is not in its process list, so it cannot
    // see the stone running — but a session on it is first-hand knowledge.
    const live = {
      label: 'DataCurator on devKit (localhost)',
      user: 'DataCurator',
      stone: 'devKit',
      version: '3.7.5',
      running: false,
      connected: true,
      sessionId: 7,
      current: true,
    };

    const { root, host } = open(state({ logins: [live] }));

    root.querySelector<HTMLButtonElement>('[data-cmd="gemstone.sessionLogout"]')!.click();
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'sessionAction', sessionId: 7 }),
    );
  });

  it('does not offer to start the stone of a session already open on it', () => {
    const live = {
      label: 'DataCurator on devKit (localhost)',
      user: 'DataCurator',
      stone: 'devKit',
      version: '3.7.5',
      running: false,
      connected: true,
      sessionId: 7,
      current: true,
    };

    const { root } = open(state({ logins: [live] }));

    expect(root.querySelector('[data-action="startAndConnect"]')).toBeNull();
  });

  it('keeps a section the user opened open across a re-render', () => {
    const { root } = open(state());
    const os = root.querySelector<HTMLDetailsElement>('details.section[data-section="os"]')!;
    os.open = true;
    os.dispatchEvent(new Event('toggle'));

    api().render(state({ databases: [database({ stoneRunning: true })] }));

    expect(root.querySelector<HTMLDetailsElement>('details.section[data-section="os"]')!.open).toBe(
      true,
    );
  });

  it('keeps a section the user closed shut across a re-render', () => {
    const { root } = open(state());
    const connect = root.querySelector<HTMLDetailsElement>(
      'details.section[data-section="connect"]',
    )!;
    connect.open = false;
    connect.dispatchEvent(new Event('toggle'));

    api().render(state({ databases: [database({ stoneRunning: true })] }));

    expect(
      root.querySelector<HTMLDetailsElement>('details.section[data-section="connect"]')!.open,
    ).toBe(false);
  });

  it('keeps an opened database open across a re-render', () => {
    const { root } = open(state());
    const item = root.querySelector<HTMLDetailsElement>('details.db-item[data-db="devKit"]')!;
    item.open = true;
    item.dispatchEvent(new Event('toggle'));

    api().render(state({ databases: [database({ stoneRunning: true })] }));

    expect(root.querySelector<HTMLDetailsElement>('details.db-item[data-db="devKit"]')!.open).toBe(
      true,
    );
  });
});
