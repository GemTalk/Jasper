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

  // Everything on this screen is a name from somewhere else — a stone, a user, a
  // file on disk, a version's own description of itself — and the panel builds
  // its markup as a string. A name carrying markup has to arrive as the name.
  it('shows a name containing markup as text rather than building it', () => {
    const nasty = database({ dirName: '<img src=x onerror=alert(1)>db' });

    const { root } = open(state({ databases: [nasty] }));

    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>db');
  });

  it('shows a login label containing markup as text rather than building it', () => {
    const nasty = {
      label: '</button><img src=x onerror=alert(1)>',
      user: '<b>DataCurator</b>',
      stone: 'devKit',
      version: '3.7.5',
      running: true,
      connected: false,
    };

    const { root } = open(state({ logins: [nasty] }));

    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.login-user b')).toBeNull();
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

// ── Getting set up ──────────────────────────────────────────────────────────
// The sections are ordered by what needs attention, which tells a new user what
// is wrong but not what to do first. These cover the steps that name the order,
// the header that reports where the user is, and the tour that points at each
// section in turn.

type TourStep = {
  section: string;
  title: string;
  body: string;
  action: string;
  done: boolean;
  lines?: string[];
  note?: string;
};
type TourApi = {
  tourSteps(state: unknown): TourStep[];
  firstTodo(steps: TourStep[]): number;
};

function tour(): TourApi {
  return (globalThis as unknown as { GemstoneManager: TourApi }).GemstoneManager;
}

const NOTHING_INSTALLED = {
  ...INSTALLED_VERSION,
  extracted: false,
  downloaded: false,
};

const LOGIN = {
  label: 'DataCurator@devKit',
  user: 'DataCurator',
  stone: 'devKit',
  version: '3.7.5',
  dirName: 'devKit',
  running: true,
  connected: false,
  current: false,
};

describe('setup steps', () => {
  it('names the four steps in the order they have to happen', () => {
    const steps = tour().tourSteps(state());

    expect(steps.map((s) => s.section)).toEqual(['os', 'versions', 'databases', 'connect']);
  });

  it('drops the operating system step where no prerequisites are surfaced', () => {
    const steps = tour().tourSteps(state({ os: { supported: false, platformLabel: 'AIX' } }));

    expect(steps.map((s) => s.section)).toEqual(['versions', 'databases', 'connect']);
  });

  it('counts a version step done only once one is on disk', () => {
    const without = tour().tourSteps(state({ versions: [NOTHING_INSTALLED] }));
    const with_ = tour().tourSteps(state({ versions: [INSTALLED_VERSION] }));

    expect(without.find((s) => s.section === 'versions')?.done).toBe(false);
    expect(with_.find((s) => s.section === 'versions')?.done).toBe(true);
  });

  it('counts a database step done only once one exists', () => {
    const without = tour().tourSteps(state({ databases: [] }));
    const with_ = tour().tourSteps(state({ databases: [database()] }));

    expect(without.find((s) => s.section === 'databases')?.done).toBe(false);
    expect(with_.find((s) => s.section === 'databases')?.done).toBe(true);
  });

  it('counts connecting done only once a login exists', () => {
    const without = tour().tourSteps(state({ logins: [] }));
    const with_ = tour().tourSteps(state({ logins: [LOGIN] }));

    expect(without.find((s) => s.section === 'connect')?.done).toBe(false);
    expect(with_.find((s) => s.section === 'connect')?.done).toBe(true);
  });

  it('counts the operating system step against its own warning', () => {
    const short = { ...HEALTHY_OS, sharedMemoryConfigured: false, gbLabel: '0' };

    expect(tour().tourSteps(state({ os: short }))[0].done).toBe(false);
    expect(tour().tourSteps(state())[0].done).toBe(true);
  });

  it('points at the first unfinished step', () => {
    const steps = tour().tourSteps(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    expect(tour().firstTodo(steps)).toBe(1);
  });

  it('points at the last step when everything is done, rather than off the end', () => {
    const steps = tour().tourSteps(state({ logins: [LOGIN] }));

    expect(steps.every((s) => s.done)).toBe(true);
    expect(tour().firstTodo(steps)).toBe(steps.length - 1);
  });
});

describe('setup header', () => {
  it('says which step is next, so the order is readable without starting a tour', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    expect(root.querySelector('.gm-head-lead')?.textContent).toContain('install a version');
  });

  it('reports how many steps are done', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    expect(root.querySelector('.gm-head-text')?.textContent).toContain('1 of 4 done');
  });

  it('says the environment is ready when nothing is left', () => {
    const { root } = open(state({ logins: [LOGIN] }));

    expect(root.querySelector('.gm-head-lead')?.textContent).toContain('Ready to connect');
  });

  it('offers Quick Setup on a machine with nothing installed and no database', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    expect(root.querySelector('[data-action="quickSetup"]')).not.toBeNull();
  });

  it('does not offer Quick Setup once there is something to lose', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [database()] }));

    expect(root.querySelector('[data-action="quickSetup"]')).toBeNull();
  });

  it('runs Quick Setup through the host', () => {
    const { root, host } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    root.querySelector<HTMLElement>('[data-action="quickSetup"]')?.click();

    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'quickSetup' }),
    );
  });
});

describe('the tour', () => {
  const start = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-tour="start"]')?.click();
  const callout = () => document.querySelector('.gm-call');

  it('offers to walk the user through it', () => {
    const { root } = open(state());

    expect(root.querySelector('[data-tour="start"]')).not.toBeNull();
  });

  it('opens on the step the user is actually stuck on', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    start(root);

    expect(callout()?.querySelector('.gm-call-title')?.textContent).toBe('Install a version');
    expect(callout()?.querySelector('.gm-call-step')?.textContent).toBe('Step 2 of 4');
  });

  it('marks a step the machine has already satisfied', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    start(root);
    callout()?.querySelector<HTMLElement>('[data-tour="prev"]')?.click();

    expect(callout()?.querySelector('.gm-call-mark')?.textContent).toBe('Already done');
  });

  it('opens the section it is pointing at, so the step is not describing a closed box', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    start(root);

    const versions = root.querySelector<HTMLDetailsElement>('details[data-section="versions"]');
    expect(versions?.open).toBe(true);
  });

  it('walks forward and back through the steps', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    start(root);
    callout()?.querySelector<HTMLElement>('[data-tour="next"]')?.click();
    expect(callout()?.querySelector('.gm-call-step')?.textContent).toBe('Step 3 of 4');

    callout()?.querySelector<HTMLElement>('[data-tour="prev"]')?.click();
    expect(callout()?.querySelector('.gm-call-step')?.textContent).toBe('Step 2 of 4');
  });

  it('cannot walk back off the front', () => {
    const { root } = open(state({ os: { supported: false }, versions: [NOTHING_INSTALLED] }));

    start(root);

    expect(callout()?.querySelector<HTMLButtonElement>('[data-tour="prev"]')?.disabled).toBe(true);
  });

  it('offers Done rather than Next on the last step', () => {
    const { root } = open(state({ logins: [LOGIN] }));

    start(root);

    expect(callout()?.querySelector<HTMLElement>('[data-tour="next"]')?.hidden).toBe(true);
    expect(callout()?.querySelector('[data-tour="end"]')?.textContent).toBe('Done');
  });

  it('closes when dismissed', () => {
    const { root } = open(state());

    start(root);
    callout()?.querySelector<HTMLElement>('[data-tour="end"]')?.click();

    expect(callout()).toBeNull();
  });

  it('closes on Escape', () => {
    const { root } = open(state());

    start(root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(callout()).toBeNull();
  });

  it('steps with the arrow keys', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    start(root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(callout()?.querySelector('.gm-call-step')?.textContent).toBe('Step 3 of 4');
  });

  // The panel rebuilds itself on every admin change, replacing every section
  // element. A tour anchored to the old ones has to find the new ones.
  it('survives the panel redrawing under it', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    start(root);
    api().render(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    expect(callout()).not.toBeNull();
    expect(root.querySelector<HTMLDetailsElement>('details[data-section="versions"]')?.open).toBe(
      true,
    );
  });

  it('builds the overlay outside the panel root, so a redraw cannot take it', () => {
    const { root } = open(state());

    start(root);

    const overlay = document.querySelector('.gm-tour');
    expect(overlay).not.toBeNull();
    expect(root.contains(overlay as Node)).toBe(false);
  });

  // The point of the spotlight is to explain a control while it stays usable, so
  // the dim must not swallow clicks. The styles live in the host file (injected
  // into the panel's <style>), not here, so this is pinned at the source.
  it('does not block the page it is pointing at', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'gemstoneManager.ts'), 'utf8');

    expect(css).toMatch(/\.gm-tour \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.gm-call \{[^}]*pointer-events: auto/);
  });
});

describe('what a step asks the user to do', () => {
  it('names the common action for every step', () => {
    const steps = tour().tourSteps(state());

    expect(steps.every((s) => typeof s.action === 'string' && s.action.length > 0)).toBe(true);
  });

  it('says outright that a configured machine needs nothing done to it', () => {
    const [os] = tour().tourSteps(state());

    expect(os.section).toBe('os');
    expect(os.action).toMatch(/nothing/i);
  });

  it('warns that creating a database asks four questions', () => {
    const steps = tour().tourSteps(state());
    const databases = steps.find((s) => s.section === 'databases');

    expect(databases?.body).toMatch(/four questions/i);
  });

  it('shows the action and how to get out of the way in the callout', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    root.querySelector<HTMLElement>('[data-tour="start"]')?.click();
    const call = document.querySelector('.gm-call');

    expect(call?.querySelector('.gm-call-do')?.textContent).toMatch(/^Usually/);
    expect(call?.querySelector('.gm-call-hint')?.textContent).toMatch(/Escape/);
  });
});

// The four questions behind + on Databases are asked through native quick-input
// widgets, which the webview cannot annotate — so each carries its own
// explanation. A bare "NetLDI name" tells a first-time user nothing.
describe('creating a database explains itself', () => {
  const source = () => fs.readFileSync(path.resolve(__dirname, '..', 'databaseManager.ts'), 'utf8');

  it('titles each of the four questions with what it is asking for', () => {
    const src = source();

    expect(src).toContain('New Database — 1 of 4: version');
    expect(src).toContain('New Database — 2 of 4: base extent');
    expect(src).toContain('New Database — 3 of 4: stone name');
    expect(src).toContain('New Database — 4 of 4: NetLDI name');
  });

  it('says what a stone and a NetLDI actually are', () => {
    const src = source();

    expect(src).toMatch(/Names the stone — the process that owns this repository/);
    expect(src).toMatch(/Names the NetLDI — the listener that starts a gem process/);
  });

  it('says which base extent to pick', () => {
    expect(source()).toMatch(/extent0\.dbf is the standard one/);
  });
});

describe('the four questions read one per line', () => {
  it('lists each question separately rather than running them into a sentence', () => {
    const databases = tour()
      .tourSteps(state())
      .find((s) => s.section === 'databases');

    expect(databases?.lines).toHaveLength(4);
    expect(databases?.lines?.[0]).toMatch(/^Version —/);
    expect(databases?.lines?.[1]).toMatch(/^Base extent —/);
    expect(databases?.lines?.[2]).toMatch(/^Stone name —/);
    expect(databases?.lines?.[3]).toMatch(/^NetLDI name —/);
  });

  it('renders them as list items in the callout', () => {
    const { root } = open(state({ databases: [] }));

    root.querySelector<HTMLElement>('[data-tour="start"]')?.click();
    const items = [...document.querySelectorAll('.gm-call-list li')].map((li) => li.textContent);

    expect(items).toHaveLength(4);
  });

  it('hides the list on steps that have none', () => {
    const { root } = open(state({ versions: [NOTHING_INSTALLED], databases: [] }));

    root.querySelector<HTMLElement>('[data-tour="start"]')?.click();

    expect(document.querySelector<HTMLElement>('.gm-call-list')?.hidden).toBe(true);
  });

  it('says the database can be opened on disk and its configuration changed', () => {
    const databases = tour()
      .tourSteps(state())
      .find((s) => s.section === 'databases');

    expect(databases?.note).toMatch(/configuration file opens in the editor/);
    expect(databases?.note).toMatch(/on disk/);
  });
});

// Replacing an extent rebuilds the database from a fresh one, which
// databaseManager.replaceExtent refuses outright while the stone is up. Offering
// the chooser anyway invited a click whose only outcome was an error.
describe('the extent chooser follows what the command will accept', () => {
  const chooser = (root: HTMLElement) => root.querySelector<HTMLSelectElement>('.extent-select');

  it('is available while the stone is stopped', () => {
    const { root } = open(state({ databases: [database({ stoneRunning: false })] }));
    root.querySelector<HTMLDetailsElement>('details.db-item')!.open = true;

    expect(chooser(root)?.disabled).toBe(false);
  });

  it('is unavailable while the stone is running', () => {
    const { root } = open(state({ databases: [database({ stoneRunning: true })] }));

    expect(chooser(root)?.disabled).toBe(true);
  });

  it('says why, rather than just refusing', () => {
    const { root } = open(state({ databases: [database({ stoneRunning: true })] }));

    expect(root.querySelector('.extent')?.getAttribute('title')).toContain('Stop the stone');
  });
});
