// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate databasesView.js in jsdom so it registers the global
// GemstoneDatabases, exactly as the panel does when it injects the file as a
// <script> tag.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../databasesView.js'), 'utf8');
  new Function(source)();
});

type Host = { postMessage: ReturnType<typeof vi.fn> };

type Api = {
  init(refs: { root: HTMLElement }, api: Host): void;
  render(state: unknown): void;
};

function api(): Api {
  return (globalThis as unknown as { GemstoneDatabases: Api }).GemstoneDatabases;
}

const INSTALLED = {
  version: '3.7.5',
  fileName: '',
  url: '',
  size: 0,
  date: '2026-03-24',
  downloaded: false,
  extracted: true,
};

const LOCAL_BUILD = {
  version: '3.7.6',
  fileName: '',
  url: '',
  size: 0,
  date: '2026-08-01',
  downloaded: false,
  extracted: true,
  local: true,
  buildDescription: 'my own build',
};

function database(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dirName: 'db-1',
    version: '3.7.5',
    stoneName: 'gs64stone',
    ldiName: 'gs64ldi',
    baseExtent: 'extent0.dbf',
    path: '/root/db-1',
    stoneRunning: false,
    netldiRunning: false,
    processes: [],
    logins: [],
    availableExtents: ['extent0'],
    external: [],
    logFiles: [],
    confFiles: [],
    backupFiles: [],
    extentBackupFiles: [],
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: 'linux',
    windows: false,
    rootPath: '/root',
    versions: [INSTALLED],
    databases: [],
    logins: [],
    create: {
      versions: [{ version: '3.7.5', extents: ['extent0', 'extent1'] }],
      stoneNames: [],
      ldiNames: [],
      nfsWarning: false,
      rootPath: '/root',
    },
    ...overrides,
  };
}

let root: HTMLElement;
let host: Host;

function mount(s: Record<string, unknown> = state()): void {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root') as HTMLElement;
  host = { postMessage: vi.fn() };
  api().init({ root }, host);
  api().render(s);
}

/** Click the first element carrying this action, as a user would. */
function click(action: string): void {
  const el = root.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (!el) throw new Error(`no ${action} button on screen`);
  el.click();
}

function typeInto(field: string, value: string): void {
  const el = root.querySelector<HTMLInputElement>(`[data-create-field="${field}"]`);
  if (!el) throw new Error(`no ${field} field on screen`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function typeIntoRegister(field: string, value: string): void {
  const el = root.querySelector<HTMLInputElement>(`[data-register-field="${field}"]`);
  if (!el) throw new Error(`no ${field} field on screen`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A message from the host, as VS Code relays it into the webview. */
function fromHost(msg: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: msg }));
}

/** A database registered from an installation Jasper did not create. */
function registeredDatabase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return database({
    dirName: 'db-2',
    stoneName: 'theirstone',
    ldiName: 'theirldi',
    baseExtent: undefined,
    availableExtents: [],
    registered: true,
    registeredReason:
      'Jasper did not create this database \u2014 it was registered from an existing ' +
      'installation, so Jasper does not modify its files.',
    productPath: '/opt/theirs/product',
    netldiPort: 46717,
    ...overrides,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('what leads the panel', () => {
  function sectionOrder(): (string | undefined)[] {
    return Array.from(root.querySelectorAll('details.section')).map(
      (d) => (d as HTMLElement).dataset.section,
    );
  }

  it('puts databases first once something is installed', () => {
    mount(state({ databases: [database()] }));
    const sections = sectionOrder();
    expect(sections.indexOf('databases')).toBeLessThan(sections.indexOf('versions'));
  });

  // Versions used to lead here, on the reasoning that a machine with nothing
  // installed had no database to make yet. Register Existing… adopts an
  // installation from anywhere, so this machine can hold databases and no
  // installed release at once.
  it('puts databases first when nothing is installed too', () => {
    mount(state({ versions: [], create: { ...(state().create as object), versions: [] } }));
    const sections = sectionOrder();
    expect(sections.indexOf('databases')).toBeLessThan(sections.indexOf('versions'));
  });

  it('leads with a registered database rather than burying it under Versions', () => {
    mount(
      state({
        versions: [],
        databases: [registeredDatabase()],
        create: { ...(state().create as object), versions: [] },
      }),
    );
    expect(sectionOrder()[0]).toBe('databases');
    expect(root.querySelector('details.db-item[data-db]')).not.toBeNull();
  });
});

describe('when the host says an action failed', () => {
  // The message was posted and dropped: the panel cleared its busy flag and
  // redrew the unchanged state, so a refused action looked like one that had
  // simply done nothing at all.
  it('shows the reason rather than absorbing it', () => {
    mount();
    fromHost({ command: 'actionFailed', message: "EACCES: permission denied, mkdir '/nope'" });
    expect(root.querySelector('.gm-blocked')?.textContent).toContain('permission denied');
  });

  it('keeps it through the unchanged state that follows', () => {
    mount();
    fromHost({ command: 'actionFailed', message: 'could not register' });
    // The host always posts state after a failure; it is the same state as before.
    api().render(state());
    expect(root.textContent).toContain('could not register');
  });

  it('lets it be dismissed', () => {
    mount();
    fromHost({ command: 'actionFailed', message: 'could not register' });
    click('dismissFailure');
    expect(root.querySelector('.gm-blocked')).toBeNull();
  });
});

describe('a login with no database of its own', () => {
  // Logins are drawn under the database they target, matched by stone name, so a
  // login to a stone this machine has no database for matched no row and was
  // shown nowhere — it had saved, it was in the settings, and the panel simply
  // had no place to put it.
  function remoteLogin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      label: 'DataCurator on gs64stone (berlin)',
      user: 'DataCurator',
      stone: 'gs64stone',
      version: '3.7.5.1',
      host: 'berlin',
      netldi: '50377',
      running: false,
      connected: false,
      current: false,
      sessions: [],
      ...overrides,
    };
  }

  it('is shown, rather than dropped for want of a row to sit under', () => {
    mount(state({ databases: [database()], logins: [remoteLogin()] }));
    const other = root.querySelector('details.section[data-section="otherLogins"]');
    expect(other).not.toBeNull();
    expect(other?.textContent).toContain('DataCurator');
  });

  it('says what makes it different, since no database above it does', () => {
    mount(state({ databases: [database()], logins: [remoteLogin()] }));
    const text = root.querySelector('details.section[data-section="otherLogins"]')?.textContent;
    // The label carries user, stone and host; the NetLDI and release follow it,
    // because no database row above supplies them here.
    expect(text).toContain('DataCurator on gs64stone (berlin)');
    expect(text).toContain('50377');
    expect(text).toContain('3.7.5.1');
  });

  it('offers the same actions the per-database rows do', () => {
    mount(state({ databases: [database()], logins: [remoteLogin()] }));
    const other = root.querySelector('details.section[data-section="otherLogins"]');
    for (const action of ['editLogin', 'deleteLogin', 'connectLogin']) {
      expect(other?.querySelector(`[data-action="${action}"]`)).not.toBeNull();
    }
  });

  it('offers its own New Login, since the per-database one prefills from a database', () => {
    mount(state({ databases: [database()], logins: [remoteLogin()] }));
    const add = root.querySelector(
      'details.section[data-section="otherLogins"] [data-action="addLogin"]',
    );
    expect(add).not.toBeNull();
    add?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'addLogin' }));
  });

  // Its sessions can only appear on the row itself: there is no database above it
  // carrying them, so without this a connected login here showed nothing for it.
  it('shows the sessions opened from it', () => {
    mount(
      state({
        databases: [database()],
        logins: [remoteLogin({ connected: true, sessions: [{ id: 7, current: true }] })],
      }),
    );
    const other = root.querySelector('details.section[data-section="otherLogins"]');
    expect(other?.querySelector('.session-block')).not.toBeNull();
    expect(other?.textContent).toContain('session 7');
  });

  it('captions one session and several differently', () => {
    mount(
      state({
        databases: [database()],
        logins: [
          remoteLogin({
            connected: true,
            sessions: [
              { id: 7, current: true },
              { id: 8, current: false },
            ],
          }),
        ],
      }),
    );
    const caption = root.querySelector(
      'details.section[data-section="otherLogins"] .session-caption',
    );
    expect(caption?.textContent).toBe('Sessions');
  });

  it('shows no session block when nothing is open', () => {
    mount(state({ databases: [database()], logins: [remoteLogin()] }));
    const other = root.querySelector('details.section[data-section="otherLogins"]');
    expect(other?.querySelector('.session-block')).toBeNull();
  });

  it('stays absent when every login already has a database', () => {
    mount(state({ databases: [database()], logins: [remoteLogin({ dirName: 'db-1' })] }));
    expect(root.querySelector('details.section[data-section="otherLogins"]')).toBeNull();
  });
});

describe('what the header says this machine has', () => {
  // The header said "No GemStone release on this machine yet" whenever nothing
  // was installed — denying the registered database listed directly beneath it,
  // which read as the registration not having landed.
  it('counts registered databases even with no release installed here', () => {
    mount(
      state({
        versions: [],
        databases: [registeredDatabase()],
        create: { ...(state().create as object), versions: [] },
      }),
    );
    const lead = root.querySelector('.gm-head-lead')?.textContent;
    expect(lead).toContain('1 database');
    expect(lead).not.toContain('No GemStone release on this machine yet');
  });

  it('still says the machine is bare when it holds nothing at all', () => {
    mount(
      state({
        versions: [],
        databases: [],
        create: { ...(state().create as object), versions: [] },
      }),
    );
    const lead = root.querySelector('.gm-head-lead')?.textContent;
    expect(lead).toContain('No GemStone release on this machine yet');
    // ...and names registering as a way forward, not only installing.
    expect(lead).toContain('register a database that already exists');
  });

  it('offers Register Existing with nothing installed, since it needs nothing installed', () => {
    mount(
      state({
        versions: [],
        databases: [],
        create: { ...(state().create as object), versions: [] },
      }),
    );
    expect(root.querySelector('[data-action="beginRegister"]')).not.toBeNull();
  });
});

describe('a version you built yourself', () => {
  // The Versions tree used to say this with a row icon and a tooltip. The panel
  // says it in the table, so the same facts have to survive the move.
  it('is marked Local rather than Installed', () => {
    mount(state({ versions: [LOCAL_BUILD] }));
    const row = root.querySelector('.versions-table tbody tr');
    expect(row?.textContent).toContain('3.7.6');
    expect(row?.querySelector('.badge-state')?.textContent).toBe('Local');
  });

  it('is removed by unregistering, so the folder you built is left alone', () => {
    mount(state({ versions: [LOCAL_BUILD] }));
    click('unregisterLocalVersion');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'unregisterLocalVersion', version: '3.7.6' }),
    );
  });

  it('says Remove for an installed release too, and deletes the product tree', () => {
    mount(state({ versions: [INSTALLED] }));
    const remove = root.querySelector('[data-action="uninstallVersion"]');
    expect(remove?.textContent).toContain('Remove');
    click('uninstallVersion');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'uninstallVersion', version: '3.7.5' }),
    );
  });
});

describe('getting a release in the first place', () => {
  // The one question the panel has to answer before any of the rest matters.
  it('offers a labelled way to install a new release, not a bare icon', () => {
    mount();
    const install = root.querySelector('[data-action="installNewVersion"]');
    expect(install).not.toBeNull();
    expect(install?.textContent).toContain('Install Version');
  });

  // The walkthrough belongs with the Quick Start panel that is coming, not with
  // the section for managing releases.
  it('does not carry the walkthrough button', () => {
    mount();
    expect(root.querySelector('[data-action="openWalkthrough"]')).toBeNull();
  });

  // Registering a link to a tree you built has gone. A tree put in the versions
  // folder is recognised on its own, and a stone already running from one is
  // adopted by Register Existing Database, which records where it really lives.
  it('does not offer to register a local build', () => {
    mount();
    expect(root.querySelector('[data-action="registerLocalVersion"]')).toBeNull();
  });

  it('puts the install button in the body when nothing is installed, beside the sentence saying so', () => {
    mount(state({ versions: [], create: { ...(state().create as object), versions: [] } }));
    // Scoped to Versions: Databases leads the panel now, so its own empty block
    // is the first `.empty` on screen.
    const empty = root.querySelector('details.section[data-section="versions"] .empty');
    expect(empty?.textContent).toContain('No GemStone release on this machine yet');
    expect(empty?.querySelector('[data-action="installNewVersion"]')).not.toBeNull();
    // ...and says where to put one you already have, since no button does that now.
    expect(empty?.textContent).toContain('/root');
  });

  it('asks the host to install when the button is pressed', () => {
    mount(state({ versions: [], create: { ...(state().create as object), versions: [] } }));
    click('installNewVersion');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'installNewVersion' }),
    );
  });
});

describe('the New Database form', () => {
  it('is not offered while there is no release to create from', () => {
    mount(state({ versions: [], create: { ...(state().create as object), versions: [] } }));
    expect(root.querySelector('[data-action="beginCreate"]')).toBeNull();
  });

  it('opens with the answers already filled in, so the common case is one press', () => {
    mount();
    click('beginCreate');
    expect(root.querySelector<HTMLSelectElement>('[data-create-field="version"]')?.value).toBe(
      '3.7.5',
    );
    expect(root.querySelector<HTMLSelectElement>('[data-create-field="extent"]')?.value).toBe(
      'extent0',
    );
    expect(root.querySelector<HTMLInputElement>('[data-create-field="stoneName"]')?.value).toBe(
      'gs64stone',
    );
    expect(root.querySelector<HTMLInputElement>('[data-create-field="ldiName"]')?.value).toBe(
      'gs64ldi',
    );
  });

  it('steps past names that are taken instead of proposing a clash', () => {
    mount(
      state({
        create: {
          ...(state().create as object),
          stoneNames: ['gs64stone', 'gs64stone2'],
          ldiNames: ['gs64ldi'],
        },
      }),
    );
    click('beginCreate');
    expect(root.querySelector<HTMLInputElement>('[data-create-field="stoneName"]')?.value).toBe(
      'gs64stone3',
    );
    expect(root.querySelector<HTMLInputElement>('[data-create-field="ldiName"]')?.value).toBe(
      'gs64ldi2',
    );
  });

  it('refuses a name that is already in use, and says which', () => {
    mount(state({ create: { ...(state().create as object), stoneNames: ['taken'] } }));
    click('beginCreate');
    typeInto('stoneName', 'taken');
    const wrap = root.querySelector('[data-cf-field="stoneName"]');
    expect(wrap?.classList.contains('cf-bad')).toBe(true);
    expect(wrap?.querySelector('.cf-problem')?.textContent).toContain('already exists');
    expect(root.querySelector<HTMLButtonElement>('[data-action="submitCreate"]')?.disabled).toBe(
      true,
    );
  });

  it('refuses a name with characters a stone name cannot carry', () => {
    mount();
    click('beginCreate');
    typeInto('stoneName', 'my stone');
    expect(root.querySelector('[data-cf-field="stoneName"] .cf-problem')?.textContent).toContain(
      'Letters, digits and underscore only',
    );
  });

  it('sends every answer at once when Create is pressed', () => {
    mount();
    click('beginCreate');
    typeInto('stoneName', 'demoStone');
    typeInto('ldiName', 'demoLdi');
    click('submitCreate');
    expect(host.postMessage).toHaveBeenCalledWith({
      command: 'createDatabase',
      version: '3.7.5',
      extent: 'extent0',
      stoneName: 'demoStone',
      ldiName: 'demoLdi',
      allowNfs: false,
    });
  });

  it('asks nothing of the host until Create is pressed', () => {
    mount();
    click('beginCreate');
    typeInto('stoneName', 'demoStone');
    expect(host.postMessage).not.toHaveBeenCalled();
  });

  // The whole reason the form replaced four Quick Picks: leaving VS Code to look
  // up a free NetLDI name used to throw away the three answers already given.
  it('keeps what has been typed when fresh state arrives mid-form', () => {
    mount();
    click('beginCreate');
    typeInto('stoneName', 'halfTyped');
    api().render(state({ databases: [database({ dirName: 'db-2', stoneName: 'other' })] }));
    expect(root.querySelector<HTMLInputElement>('[data-create-field="stoneName"]')?.value).toBe(
      'halfTyped',
    );
  });

  it('goes back to the lists on Cancel', () => {
    mount();
    click('beginCreate');
    expect(root.querySelector('[data-cf-field="stoneName"]')).not.toBeNull();
    click('cancelCreate');
    expect(root.querySelector('[data-cf-field="stoneName"]')).toBeNull();
    expect(root.querySelector('details.section[data-section="databases"]')).not.toBeNull();
  });

  it('warns about network storage in the form rather than in a modal', () => {
    mount(state({ create: { ...(state().create as object), nfsWarning: true } }));
    click('beginCreate');
    expect(root.querySelector('.cf-warn')?.textContent).toContain('network storage');
    click('submitCreate');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'createDatabase', allowNfs: false }),
    );
  });

  it('carries the override through when the warning is accepted', () => {
    mount(state({ create: { ...(state().create as object), nfsWarning: true } }));
    click('beginCreate');
    const box = root.querySelector<HTMLInputElement>('[data-create-field="allowNfs"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    click('submitCreate');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'createDatabase', allowNfs: true }),
    );
  });

  it('opens straight into the form when the host asks it to', () => {
    mount();
    expect(root.querySelector('[data-cf-field="stoneName"]')).toBeNull();
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'beginCreate' } }));
    expect(root.querySelector('[data-cf-field="stoneName"]')).not.toBeNull();
  });
});

describe('cancelling a form the panel was opened for', () => {
  it('closes the panel, because the user never asked to see it', () => {
    mount();
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'beginCreate' } }));
    click('cancelCreate');
    expect(host.postMessage).toHaveBeenCalledWith({ command: 'closePanel' });
  });

  it('goes back to the lists instead when the form was chosen from inside the panel', () => {
    mount();
    click('beginCreate');
    click('cancelCreate');
    expect(host.postMessage).not.toHaveBeenCalledWith({ command: 'closePanel' });
    expect(root.querySelector('details.section[data-section="databases"]')).not.toBeNull();
  });

  it('stays open after a database is actually created, so the new row can be seen', () => {
    mount();
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'beginCreate' } }));
    click('submitCreate');
    expect(host.postMessage).not.toHaveBeenCalledWith({ command: 'closePanel' });
  });
});

describe('the right-click menu', () => {
  // VS Code hands a webview the browser's Cut/Copy/Paste menu. Over a login name
  // or a database row those verbs do nothing, so the menu is noise.
  it('is suppressed over rows and buttons', () => {
    mount(state({ databases: [database()] }));
    const row = root.querySelector('.db-head') as HTMLElement;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('is left alone in the form, where those verbs are real', () => {
    mount();
    click('beginCreate');
    const box = root.querySelector('[data-create-field="stoneName"]') as HTMLElement;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('a database row', () => {
  it('offers what can be done without logging in', () => {
    mount(state({ databases: [database()] }));
    const toolbar = root.querySelector('.db-toolbar');
    expect(toolbar?.querySelector('[data-action="openDbInFinder"]')).not.toBeNull();
    expect(toolbar?.querySelector('[data-action="openDbTerminal"]')).not.toBeNull();
  });

  // Installing server support resolves a live session before it can do anything,
  // so a button for it on a row about a database on disk could only ever say
  // "log in first".
  it('does not offer installing server support, which needs a session', () => {
    mount(state({ databases: [database({ stoneRunning: true })] }));
    expect(root.querySelector('[data-action="installServerSupport"]')).toBeNull();
  });

  // The online backup belongs to the stone, not the database — that is where the
  // sidebar puts it, and it is only possible while the stone is up. The database
  // row carries the offline copy, which is only possible while it is down.
  it('keeps the online backup on the stone row and the offline one on its own', () => {
    mount(state({ databases: [database({ stoneRunning: false })] }));
    const toolbar = root.querySelector('.db-toolbar');
    expect(toolbar?.querySelector('[data-action="backupDatabase"]')).toBeNull();
    expect(toolbar?.querySelector('[data-action="offlineExtentBackup"]')).not.toBeNull();
  });

  it('lists log files newest first, each saying when it was written', () => {
    const march = Date.UTC(2026, 2, 18, 14, 32);
    mount(
      state({
        databases: [
          database({
            logFiles: [
              {
                name: 'older.log',
                path: '/root/db-1/log/older.log',
                modifiedMs: march - 86_400_000,
              },
              { name: 'newest.log', path: '/root/db-1/log/newest.log', modifiedMs: march },
            ],
          }),
        ],
      }),
    );
    const names = Array.from(root.querySelectorAll('.file-name')).map((n) => n.textContent);
    // The host hands them over already ordered; the view must not reorder them.
    expect(names[0]).toBe('older.log');
    const when = root.querySelector('.file-when')?.textContent ?? '';
    expect(when).toMatch(/\d{2} \w{3}/);
  });
});

describe('a login row', () => {
  function withLogin(overrides: Record<string, unknown>) {
    return state({
      databases: [
        database({
          logins: [
            {
              label: 'DataCurator on gs64stone (localhost)',
              user: 'DataCurator',
              stone: 'gs64stone',
              host: 'localhost',
              sessions: [],
              ...overrides,
            },
          ],
        }),
      ],
    });
  }

  // The row used to print the GemStone user alone, which says nothing about which
  // login it is once a database has more than one, and nothing at all in a list.
  it('is named by its full label — user, stone and host', () => {
    mount(withLogin({}));
    const row = root.querySelector('.db-login .db-login-user');
    expect(row?.textContent).toBe('DataCurator on gs64stone (localhost)');
  });

  it('offers Log in and shows no session row while none is open', () => {
    mount(withLogin({}));
    expect(root.querySelector('[data-action="connectLogin"]')).not.toBeNull();
    expect(root.querySelector('.db-session')).toBeNull();
  });

  // Saying "Log in" for a login that is already connected was the panel
  // disagreeing with the Logins & Sessions tree about the same fact.
  it('shows a session row with Log out once one is open', () => {
    mount(withLogin({ sessions: [{ id: 7, current: false }] }));
    expect(root.querySelector('.db-session')).not.toBeNull();
    click('logoutSession');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'logoutSession', sessionId: 7 }),
    );
  });

  it('offers that session its configuration, named by session', () => {
    mount(withLogin({ sessions: [{ id: 7, current: false }] }));
    click('showSessionConfiguration');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'showSessionConfiguration', sessionId: 7 }),
    );
  });

  // Colour alone says it to some readers and not others, so the current session
  // is called out three ways.
  it('marks the session the rest of Jasper is working in', () => {
    mount(withLogin({ sessions: [{ id: 7, current: true }] }));
    const row = root.querySelector('.db-session-current');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.session-current-mark')).not.toBeNull();
    expect(row?.getAttribute('data-tip')).toContain('Display It');
  });

  it('leaves the login row offering Log in, so another session can be opened', () => {
    mount(withLogin({ sessions: [{ id: 7, current: true }] }));
    expect(root.querySelector('[data-action="connectLogin"]')).not.toBeNull();
  });

  it('shows every session a login has, not just the first', () => {
    mount(
      withLogin({
        sessions: [
          { id: 7, current: true },
          { id: 8, current: false },
        ],
      }),
    );
    expect(root.querySelectorAll('.db-session')).toHaveLength(2);
  });
});

describe('folder and terminal actions', () => {
  // Two rows offering the same pair of actions should not need reading twice.
  it('use the same icons in the same order on a version and on a database', () => {
    mount(state({ databases: [database()] }));
    const order = (root_: Element | null) =>
      Array.from(root_?.querySelectorAll('[data-action]') ?? [])
        .map((b) => b.getAttribute('data-action'))
        .filter((a) => a && /Folder|Finder|Terminal/.test(a));
    expect(order(root.querySelector('.db-toolbar'))).toEqual(['openDbInFinder', 'openDbTerminal']);
    expect(order(root.querySelector('.versions-table tbody tr'))).toEqual([
      'openVersionFolder',
      'openVersionTerminal',
    ]);
    const glyph = (sel: string) => root.querySelector(`[data-action="${sel}"] .codicon`)?.className;
    expect(glyph('openDbInFinder')).toBe(glyph('openVersionFolder'));
    expect(glyph('openDbTerminal')).toBe(glyph('openVersionTerminal'));
  });
});

describe('backing up a stopped database', () => {
  // The one backup that needs no session, so it is the one that belongs on a row
  // about a database on disk.
  it('is offered while the stone is down', () => {
    mount(state({ databases: [database({ stoneRunning: false })] }));
    click('offlineExtentBackup');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'offlineExtentBackup', dirName: 'db-1' }),
    );
  });

  // Copying a live extent without suspending checkpoints produces a file that
  // looks like a backup and is not one.
  it('is not offered while the stone is running', () => {
    mount(state({ databases: [database({ stoneRunning: true })] }));
    expect(root.querySelector('[data-action="offlineExtentBackup"]')).toBeNull();
  });

  // Both kinds are .dbf files restored in completely different ways. One list
  // offering one restore over both is how you destroy a database.
  it('lists extent copies apart from logical backups, with no restore action', () => {
    mount(
      state({
        databases: [
          database({
            backupFiles: [{ name: 'logical.dbf', path: '/b/logical.dbf', modifiedMs: 1 }],
            extentBackupFiles: [
              { name: 'extent0-20260831-153000.dbf', path: '/e/extent0.dbf', modifiedMs: 2 },
            ],
          }),
        ],
      }),
    );
    const groups = Array.from(root.querySelectorAll('.file-root')).map((g) => ({
      title: g.querySelector('.file-root-name')?.textContent,
      restores: g.querySelectorAll('[data-action="restoreBackup"]').length,
    }));
    const logical = groups.find((g) => g.title === 'Backups');
    const extents = groups.find((g) => g.title === 'Extent backups');
    expect(logical?.restores).toBe(1);
    expect(extents?.restores).toBe(0);
  });
});

describe('session actions', () => {
  function mountSession(current = false) {
    mount(
      state({
        databases: [
          database({
            logins: [
              {
                label: 'DataCurator on gs64stone',
                user: 'DataCurator',
                stone: 'gs64stone',
                host: 'localhost',
                sessions: [{ id: 3, current }],
              },
            ],
          }),
        ],
      }),
    );
  }

  // A session is a session: someone who found Commit in the sidebar should not
  // have to wonder whether the panel can do it.
  // Export Classes is deliberately absent: the sidebar's session row does not
  // show it as a button either (it is right-click only there).
  it('offers the actions the Logins & Sessions row shows, and no more', () => {
    mountSession();
    const row = root.querySelector('.db-session')!;
    const commands = Array.from(row.querySelectorAll('[data-cmd]')).map((b) =>
      b.getAttribute('data-cmd'),
    );
    expect(commands).toEqual([
      'gemstone.selectSession',
      'gemstone.sessionCommit',
      'gemstone.sessionAbort',
      'gemstone.fullLogicalBackup',
      'gemstone.fullLogicalRestore',
    ]);
    expect(row.querySelector('[data-action="showSessionConfiguration"]')).not.toBeNull();
    expect(row.querySelector('[data-action="logoutSession"]')).not.toBeNull();
  });

  it('sends the command name and the session together', () => {
    mountSession();
    const commit = root.querySelector<HTMLElement>('[data-cmd="gemstone.sessionCommit"]')!;
    commit.click();
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'sessionAction',
        action: 'gemstone.sessionCommit',
        sessionId: 3,
      }),
    );
  });

  // Making the current session active again does nothing.
  it('does not offer Make Active on the session that already is', () => {
    mountSession(true);
    expect(root.querySelector('[data-cmd="gemstone.selectSession"]')).toBeNull();
  });

  it('indents sessions under their login and says what they are', () => {
    mountSession();
    const block = root.querySelector('.session-block');
    expect(block).not.toBeNull();
    expect(block?.querySelector('.session-caption')?.textContent?.trim()).toBe('Session');
    expect(block?.querySelector('.db-session')).not.toBeNull();
  });
});

describe('a database summary row', () => {
  // The version belongs to the name, not stranded at the other end of the row.
  it('puts the version next to the stone name', () => {
    mount(state({ databases: [database()] }));
    const parts = Array.from(root.querySelectorAll('.db-head > span')).map((n) => n.className);
    expect(parts.indexOf('db-version mono')).toBe(parts.indexOf('db-name') + 1);
  });
});

describe('the stone and NetLDI rows', () => {
  const proc = (type: string, name: string) => ({
    type,
    name,
    pid: 111,
    status: 'OK',
    responding: true,
  });

  // The sidebar puts it on a running stone; the panel must not disagree about
  // what can be done to a server.
  it('offers an online extent backup on a running stone', () => {
    mount(
      state({
        databases: [database({ stoneRunning: true, processes: [proc('stone', 'gs64stone')] })],
      }),
    );
    click('backupDatabase');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'backupDatabase', dirName: 'db-1' }),
    );
  });

  // Its offline counterpart is the database-row button, for a stone that is down.
  it('does not offer it on a stopped stone', () => {
    mount(state({ databases: [database({ stoneRunning: false })] }));
    expect(root.querySelector('[data-action="backupDatabase"]')).toBeNull();
  });

  it('offers to restart a server that was started outside Jasper', () => {
    mount(
      state({
        databases: [
          database({
            stoneRunning: true,
            processes: [proc('stone', 'gs64stone')],
            external: [{ type: 'stone', pid: 111 }],
          }),
        ],
      }),
    );
    click('restartExternalServers');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'restartExternalServers', dirName: 'db-1' }),
    );
  });

  // Jasper cannot stop what it did not start, so a Stop that would fail is not
  // offered — the restart above is the action that actually helps.
  it('does not offer Stop for a server it cannot stop', () => {
    mount(
      state({
        databases: [
          database({
            stoneRunning: true,
            processes: [proc('stone', 'gs64stone')],
            external: [{ type: 'stone', pid: 111 }],
          }),
        ],
      }),
    );
    expect(root.querySelector('[data-action="stopStone"]')).toBeNull();
  });
});

describe('pinging a session', () => {
  function mountSession() {
    mount(
      state({
        databases: [
          database({
            logins: [
              {
                label: 'DataCurator on gs64stone',
                user: 'DataCurator',
                stone: 'gs64stone',
                host: 'localhost',
                sessions: [{ id: 1, current: true }],
              },
            ],
          }),
        ],
      }),
    );
  }

  it('asks the host to ping the session the button belongs to', () => {
    mountSession();
    click('pingSession');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pingSession', sessionId: 1 }),
    );
  });

  // A success needs no dismissing — it says so and gets out of the way.
  it('shows a positive result beside the row, and clears it after 5s', () => {
    vi.useFakeTimers();
    try {
      mountSession();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            command: 'pingResult',
            sessionId: 1,
            tone: 'ok',
            message: 'Session 1 is active.',
          },
        }),
      );
      const notice = root.querySelector('.db-session .ping-result.ok');
      expect(notice).not.toBeNull();
      expect(notice!.textContent).toContain('active');
      expect(notice!.querySelector('[data-action="dismissPing"]')).toBeNull();

      vi.advanceTimersByTime(5000);
      expect(root.querySelector('.ping-result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // A failure carries the stone's own words, so it stays until read — and can be
  // copied, because those words are what you paste into a bug report.
  it('keeps a failure up with Copy and Dismiss, and does not clear it', () => {
    vi.useFakeTimers();
    try {
      mountSession();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            command: 'pingResult',
            sessionId: 1,
            tone: 'warn',
            message: 'Session 1 did not respond — session is busy.',
          },
        }),
      );
      const notice = root.querySelector('.ping-result.warn');
      expect(notice!.querySelector('[data-action="copyNotice"]')).not.toBeNull();

      vi.advanceTimersByTime(10000);
      expect(root.querySelector('.ping-result.warn')).not.toBeNull();

      click('dismissPing');
      expect(root.querySelector('.ping-result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Two sessions, one answer: it has to land on the row that asked.
  it('shows the result only on the session it belongs to', () => {
    mount(
      state({
        databases: [
          database({
            logins: [
              {
                label: 'DataCurator on gs64stone',
                user: 'DataCurator',
                stone: 'gs64stone',
                host: 'localhost',
                sessions: [
                  { id: 1, current: true },
                  { id: 2, current: false },
                ],
              },
            ],
          }),
        ],
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { command: 'pingResult', sessionId: 2, tone: 'ok', message: 'Session 2 is active.' },
      }),
    );
    const rows = root.querySelectorAll('.db-session');
    expect(rows[0].querySelector('.ping-result')).toBeNull();
    expect(rows[1].querySelector('.ping-result')).not.toBeNull();
  });
});

describe('every way into the New Database form', () => {
  // All three openings must show the form. Two of them used to post a bare
  // `createDatabase` message, which the host reads as a filled-in form — every
  // field arrived undefined and a database directory was written describing a
  // version of "undefined".
  it.each([
    ['the panel header', () => mount(state({ databases: [database()] }))],
    ['the Databases section header', () => mount(state({ databases: [database()] }))],
    ['the empty state', () => mount(state({ databases: [] }))],
  ])('opens the form and asks the host for nothing — %s', (_where, setup) => {
    setup();
    const buttons = root.querySelectorAll<HTMLElement>('[data-action="beginCreate"]');
    expect(buttons.length).toBeGreaterThan(0);
    buttons[buttons.length - 1].click();
    expect(root.querySelector('[data-cf-field="stoneName"]')).not.toBeNull();
    expect(host.postMessage).not.toHaveBeenCalled();
  });

  // With nothing installed there is no version to pick, so New Database… is
  // withheld and the empty text names the two ways out instead.
  it('is not offered at all when no release is installed', () => {
    mount(
      state({
        versions: [],
        databases: [],
        create: { ...(state().create as object), versions: [] },
      }),
    );
    expect(root.querySelector('[data-action="beginCreate"]')).toBeNull();
    const databases = root.querySelector('details.section[data-section="databases"] .empty');
    expect(databases?.textContent).toContain('install a GemStone release to make one');
    // Registering needs nothing installed, so it is named here as the other way in.
    expect(databases?.textContent).toContain('Register Existing');
  });

  it('has no button left that posts a create without the answers', () => {
    mount(state({ databases: [database()] }));
    expect(root.querySelector('[data-action="createDatabase"]')).toBeNull();
    mount(state({ databases: [] }));
    expect(root.querySelector('[data-action="createDatabase"]')).toBeNull();
  });
});

describe('a Windows machine with no WSL', () => {
  // There is no local server there, so nothing is ever extracted, downloaded or
  // local — but a release can still have its Windows *client* installed. The
  // table was permanently empty, and the client actions, which only exist on a
  // rendered row, were unreachable.
  const CLIENT_ONLY = {
    version: '3.7.5',
    fileName: '',
    url: '',
    size: 0,
    date: '2026-03-24',
    downloaded: false,
    extracted: false,
    clientExtracted: true,
  };

  it('still lists a release whose Windows client is installed', () => {
    mount(state({ windows: true, versions: [CLIENT_ONLY] }));
    const row = root.querySelector('.versions-table tbody tr');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('3.7.5');
  });

  it('reaches the Windows client actions, which only exist on a row', () => {
    mount(state({ windows: true, versions: [CLIENT_ONLY] }));
    expect(root.querySelector('[data-action="openWindowsClientFolder"]')).not.toBeNull();
    expect(root.querySelector('[data-action="deleteWindowsClient"]')).not.toBeNull();
  });
});

describe('the form the host opens the panel into', () => {
  /** A panel whose script has loaded but which the host has not sent a state to yet. */
  function mountBare(): void {
    document.body.innerHTML = '<div id="root"></div>';
    root = document.getElementById('root') as HTMLElement;
    host = { postMessage: vi.fn() };
    api().init({ root }, host);
  }

  // The host posts `beginCreate` ahead of the first state now, so the form is not
  // held behind a call to the download site. Arriving first, it has nothing to
  // draw from — and a form built out of no state is a release dropdown with no
  // releases in it, briefly, before the real one replaces it.
  it('waits for a state rather than drawing itself out of nothing', () => {
    mountBare();
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'beginCreate' } }));
    expect(root.querySelector('.create-form')).toBeNull();
    expect(root.querySelector('.skeleton')).not.toBeNull();
  });

  it('is the first thing drawn when that state arrives — the lists never show', () => {
    mountBare();
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'beginCreate' } }));
    api().render(state({ databases: [database()] }));
    expect(root.querySelector('[data-cf-field="stoneName"]')).not.toBeNull();
    expect(root.querySelector('details.section[data-section="databases"]')).toBeNull();
  });
});

describe('asking for a database on a machine with no release', () => {
  /** A fresh install: nothing downloaded, nothing unpacked, nothing to copy. */
  function nothingInstalled(): Record<string, unknown> {
    return state({
      versions: [],
      databases: [],
      create: { ...(state().create as object), versions: [] },
    });
  }

  function openFormOnEmptyMachine(): void {
    mount(nothingInstalled());
    window.dispatchEvent(new MessageEvent('message', { data: { command: 'beginCreate' } }));
  }

  // The sidebar's + and its New Database… command do not know what is installed,
  // so they can ask for a form that has nothing to offer: an empty release
  // dropdown, an empty extent dropdown, a Create that can never be pressed, and
  // Cancel as the only way back to the panel that would have explained it.
  it('shows the lists and says why, instead of a form that cannot be filled in', () => {
    openFormOnEmptyMachine();
    expect(root.querySelector('.create-form')).toBeNull();
    expect(root.querySelector('details.section[data-section="versions"]')).not.toBeNull();
    expect(root.querySelector('.gm-blocked')?.textContent).toContain(
      'New Database needs a GemStone release to copy from',
    );
  });

  // The message is the sentence only. The Versions section is on screen below and
  // leads with the install button, so a copy in the message made two Install
  // Version… — three, with the one the section header also carried.
  it('offers the way of getting a release exactly once', () => {
    openFormOnEmptyMachine();
    expect(root.querySelectorAll('[data-action="installNewVersion"]')).toHaveLength(1);
  });

  it('puts that one pair beside the sentence explaining them', () => {
    openFormOnEmptyMachine();
    const install = root.querySelector<HTMLElement>(
      'details.section[data-section="versions"] .empty-acts [data-action="installNewVersion"]',
    );
    expect(install).not.toBeNull();
    install?.click();
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'installNewVersion' }),
    );
  });

  it('takes the message away once a release is installed', () => {
    openFormOnEmptyMachine();
    api().render(state());
    expect(root.querySelector('.gm-blocked')).toBeNull();
  });

  // Cancel used to be the only way out, and on a panel opened only for the form
  // it closes the panel outright — so the machine that most needed the Versions
  // list was the one that could not get to it. There is no form to cancel now.
  it('needs no Cancel, because there is no form to escape from', () => {
    openFormOnEmptyMachine();
    expect(root.querySelector('[data-action="cancelCreate"]')).toBeNull();
    expect(host.postMessage).not.toHaveBeenCalledWith({ command: 'closePanel' });
  });
});

describe('what a server button looks like', () => {
  const RUNNING = database({
    stoneRunning: true,
    processes: [{ type: 'stone', name: 'gs64stone', pid: 111, status: 'OK', responding: true }],
  });

  // Red stops, green starts — the same colouring the database's own power button
  // carries. Beside a coloured button, an uncoloured pair of glyphs reads as
  // decoration rather than the two controls that actually run the servers.
  it('colours Stop the way the database power button is coloured', () => {
    mount(state({ databases: [RUNNING] }));
    const stop = root.querySelector('[data-action="stopStone"]');
    expect(stop?.className).toContain('power-stop');
  });

  it('colours Start the same way', () => {
    mount(state({ databases: [database()] }));
    const start = root.querySelector('[data-action="startStone"]');
    expect(start?.className).toContain('power-start');
  });
});

describe('the whole-database power control', () => {
  it('offers Start on a stopped database and Stop on a running one', () => {
    mount(state({ databases: [database()] }));
    expect(root.querySelector('[data-action="startDatabase"]')).not.toBeNull();
    expect(root.querySelector('[data-action="stopDatabase"]')).toBeNull();

    mount(state({ databases: [database({ stoneRunning: true })] }));
    expect(root.querySelector('[data-action="stopDatabase"]')).not.toBeNull();
    expect(root.querySelector('[data-action="startDatabase"]')).toBeNull();
  });

  it('withholds it from a database with a server started outside Jasper', () => {
    // Jasper cannot stop that server, and starting the other half beside it
    // would only collide with it — the same reason the per-server rows withhold
    // their own toggles, so the two must not disagree.
    mount(
      state({
        databases: [database({ external: [{ type: 'stone', pid: 9001 }] })],
      }),
    );

    expect(root.querySelector('[data-action="startDatabase"]')).toBeNull();
    expect(root.querySelector('[data-action="stopDatabase"]')).toBeNull();
    expect(root.querySelector('[data-action="startStone"]')).toBeNull();
  });
});

describe('hover explanations', () => {
  function hover(el: Element): void {
    el.dispatchEvent(new Event('pointerover', { bubbles: true }));
  }

  const withDatabase = () => mount(state({ databases: [database()] }));

  // The browser's own tooltip waits about a second and a half. On the pair of
  // unlabelled icons beside the Extent dropdown that reads as no tooltip at all,
  // so the panel carries its text in data-tip and draws the bubble itself.
  it('leaves no button explaining itself through a native title', () => {
    withDatabase();
    root.querySelector('details.db-item')?.setAttribute('open', '');
    expect(root.querySelector('[title]')).toBeNull();
    expect(
      root
        .querySelector('.db-toolbar-tools [data-action="openDbTerminal"]')
        ?.getAttribute('data-tip'),
    ).toBe('Open a terminal for this database');
  });

  it('draws its own bubble after a short beat', () => {
    vi.useFakeTimers();
    try {
      withDatabase();
      const button = root.querySelector('[data-action="refresh"]') as HTMLElement;
      hover(button);
      expect(document.querySelector('.gm-tip')).toBeNull();
      vi.advanceTimersByTime(200);
      expect(document.querySelector('.gm-tip')?.textContent).toContain('Read this machine again');
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes it away when the pointer moves off', () => {
    vi.useFakeTimers();
    try {
      withDatabase();
      hover(root.querySelector('[data-action="refresh"]') as HTMLElement);
      vi.advanceTimersByTime(200);
      expect(document.querySelector('.gm-tip')).not.toBeNull();
      root.dispatchEvent(new Event('pointerleave'));
      expect(document.querySelector('.gm-tip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // A redraw replaces the element the bubble was measured against, so a bubble
  // left behind would point at nothing.
  it('takes it away when the panel redraws', () => {
    vi.useFakeTimers();
    try {
      withDatabase();
      hover(root.querySelector('[data-action="refresh"]') as HTMLElement);
      vi.advanceTimersByTime(200);
      api().render(state({ databases: [database()] }));
      expect(document.querySelector('.gm-tip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Keyboard focus has already waited; there is no pointer drifting across rows
  // to protect the reader from.
  it('shows at once for a reader who tabbed to the button', () => {
    withDatabase();
    (root.querySelector('[data-action="refresh"]') as HTMLElement).dispatchEvent(
      new Event('focusin', { bubbles: true }),
    );
    expect(document.querySelector('.gm-tip')).not.toBeNull();
  });
});

describe('names with an ampersand in them', () => {
  // The button helper escapes the explanation it is handed, so a caller that
  // escapes first has it escaped twice and a stone called "A&B" explains itself
  // as "A&amp;B" — read out loud by a screen reader exactly as it is written.
  it('reads a stone name back as it was typed', () => {
    mount(
      state({
        databases: [
          database({
            stoneName: 'A&B',
            logins: [
              {
                label: 'DataCurator on A&B',
                user: 'Q&A',
                stone: 'A&B',
                host: 'localhost',
                sessions: [],
              },
            ],
          }),
        ],
      }),
    );

    const login = root.querySelector('[data-action="connectLogin"]');
    expect(login?.getAttribute('data-tip')).toBe('Log in to A&B as Q&A');
  });

  it('reads a process name back as it was typed', () => {
    mount(
      state({
        databases: [
          database({
            processes: [{ name: 'A&B', type: 'stone', pid: 111, status: 'OK', responding: false }],
          }),
        ],
      }),
    );

    const remove = root.querySelector('[data-action="deleteStaleLock"]');
    expect(remove?.getAttribute('data-tip')).toBe('Remove the stale lock file for A&B');
  });
});

// ── Registering an existing database ──────────────────────────────────────
// The other way a database gets onto the panel: it was already here. What these
// pin is the difference the user has to be able to see — and the actions that
// difference rules out.

describe('the Register Existing form', () => {
  it('cannot be submitted before a product directory has been chosen', () => {
    mount();
    click('beginRegister');
    const submit = root.querySelector<HTMLButtonElement>('[data-action="submitRegister"]');
    expect(submit?.disabled).toBe(true);
    // And it says which answer is missing, rather than a dead button.
    expect(root.textContent).toContain('Choose the GemStone product directory');
  });

  it('asks the host for the directory, since a webview cannot open one', () => {
    mount();
    click('beginRegister');
    click('pickProduct');
    expect(host.postMessage).toHaveBeenCalledWith({ command: 'pickProductDirectory' });
  });

  it('shows the version the host read from the tree, and never offers to type one', () => {
    mount();
    click('beginRegister');
    fromHost({
      command: 'productPicked',
      productPath: '/opt/theirs/product',
      version: '3.7.5.1',
      description: 'branch 3.7.5.1',
      servers: [],
    });
    expect(root.textContent).toContain('3.7.5.1');
    expect(root.querySelector('[data-register-field="version"]')).toBeNull();
    // Nothing of it is running, which the form says is still registerable.
    expect(root.textContent).toContain('Nothing of this installation is running');
  });

  it('fills the names, port and directories in from a server already running there', () => {
    mount();
    click('beginRegister');
    fromHost({
      command: 'productPicked',
      productPath: '/opt/theirs/product',
      version: '3.7.5.1',
      servers: [
        {
          type: 'stone',
          name: 'theirstone',
          pid: 2818260,
          globalDir: '/opt/gemstone',
          confPath: '/opt/theirs/product/data/system.conf',
        },
        { type: 'netldi', name: 'theirldi', pid: 2818359, port: 46717 },
      ],
    });

    expect(root.querySelector<HTMLInputElement>('[data-register-field="stoneName"]')?.value).toBe(
      'theirstone',
    );
    expect(root.querySelector<HTMLInputElement>('[data-register-field="ldiName"]')?.value).toBe(
      'theirldi',
    );
    expect(root.querySelector<HTMLInputElement>('[data-register-field="netldiPort"]')?.value).toBe(
      '46717',
    );
    expect(root.textContent).toContain('pid 2818260');

    click('submitRegister');
    // The directories go with it: they are what let Jasper stop the stone it
    // has just adopted, and only a running server could tell us them.
    expect(host.postMessage).toHaveBeenCalledWith({
      command: 'registerDatabase',
      productPath: '/opt/theirs/product',
      stoneName: 'theirstone',
      ldiName: 'theirldi',
      netldiPort: 46717,
      confPath: '/opt/theirs/product/data/system.conf',
      globalDir: '/opt/gemstone',
    });
  });

  it('relays the host\u2019s complaint about a folder that is not a product tree', () => {
    mount();
    click('beginRegister');
    fromHost({
      command: 'productPicked',
      productPath: '/home/me/Documents',
      problem: 'That folder is not a GemStone product directory.',
    });
    expect(root.textContent).toContain('not a GemStone product directory');
    expect(root.querySelector<HTMLButtonElement>('[data-action="submitRegister"]')?.disabled).toBe(
      true,
    );
  });

  it('rejects a port that is not a number, and keeps it optional', () => {
    mount();
    click('beginRegister');
    fromHost({
      command: 'productPicked',
      productPath: '/opt/theirs/product',
      version: '3.7.5.1',
      servers: [],
    });
    typeIntoRegister('stoneName', 'theirstone');
    typeIntoRegister('ldiName', 'theirldi');
    typeIntoRegister('netldiPort', 'forty-six');
    expect(root.querySelector<HTMLButtonElement>('[data-action="submitRegister"]')?.disabled).toBe(
      true,
    );

    typeIntoRegister('netldiPort', '');
    expect(root.querySelector<HTMLButtonElement>('[data-action="submitRegister"]')?.disabled).toBe(
      false,
    );
  });
});

describe('a registered database on the list', () => {
  it('is marked as registered and says where it came from', () => {
    mount(state({ databases: [registeredDatabase()] }));
    const row = root.querySelector('.db-item');
    expect(row?.textContent).toContain('registered');
    expect(row?.textContent).toContain('/opt/theirs/product');
    expect(row?.textContent).toContain('NetLDI port 46717');
  });

  it('shows Delete greyed out with the reason on hover, rather than hiding it', () => {
    mount(state({ databases: [registeredDatabase()] }));
    const del = root.querySelector<HTMLButtonElement>('[data-action="deleteDatabase"]');
    expect(del).not.toBeNull();
    expect(del?.disabled).toBe(true);
    // A disabled button receives no hover of its own, so the reason hangs on
    // the wrapper — which is what the tooltip layer reads.
    const wrap = del?.closest('.db-disabled-wrap');
    expect(wrap?.getAttribute('data-tip')).toContain('Jasper did not create this database');
  });

  it('offers Unregister instead, which drops only the record', () => {
    mount(state({ databases: [registeredDatabase()] }));
    click('unregisterDatabase');
    expect(host.postMessage).toHaveBeenCalledWith({
      command: 'unregisterDatabase',
      dirName: 'db-2',
      login: undefined,
      name: undefined,
      version: undefined,
      folder: undefined,
      path: undefined,
      sessionId: undefined,
      action: undefined,
    });
  });

  it('offers no extent chooser: the extent is the installation\u2019s own file', () => {
    mount(state({ databases: [registeredDatabase()] }));
    expect(root.querySelector('[data-select="replaceExtent"]')).toBeNull();
    // ...while a database Jasper created still has one.
    mount(state({ databases: [database()] }));
    expect(root.querySelector('[data-select="replaceExtent"]')).not.toBeNull();
  });

  it('offers no extent backup, which would copy files Jasper does not own', () => {
    mount(state({ databases: [registeredDatabase()] }));
    expect(root.querySelector('[data-action="offlineExtentBackup"]')).toBeNull();
    mount(state({ databases: [database()] }));
    expect(root.querySelector('[data-action="offlineExtentBackup"]')).not.toBeNull();
  });

  it('replaces the power button with the reason when another version holds the name', () => {
    mount(
      state({
        databases: [
          registeredDatabase({
            versionMismatch:
              'The stone running under this name is GemStone 3.6.2, but this database is registered as 3.7.5.',
          }),
        ],
      }),
    );
    expect(root.querySelector('[data-action="startDatabase"]')).toBeNull();
    expect(root.querySelector('[data-action="stopDatabase"]')).toBeNull();
    expect(root.textContent).toContain('version mismatch');
    expect(root.querySelector('[data-tip*="GemStone 3.6.2"]')).not.toBeNull();
  });
});

describe('a login row in the panel', () => {
  function mountLogin(): void {
    mount(
      state({
        databases: [
          database({
            logins: [
              {
                label: 'DataCurator on gs64stone',
                user: 'DataCurator',
                stone: 'gs64stone',
                host: 'localhost',
                sessions: [],
              },
            ],
          }),
        ],
      }),
    );
  }

  it('offers removal beside the edit, the way the rest of the panel does', () => {
    // The panel could create logins and not delete them: the only route to
    // deleting one was the Logins & Sessions tree.
    mountLogin();
    const row = root.querySelector('.db-login')!;
    const actions = Array.from(row.querySelectorAll('[data-action]')).map((b) =>
      b.getAttribute('data-action'),
    );
    expect(actions).toEqual(['editLogin', 'deleteLogin', 'connectLogin']);
  });

  it('says Delete Login, the same words the command uses', () => {
    mountLogin();
    const del = root.querySelector('[data-action="deleteLogin"]');
    expect(del?.getAttribute('data-tip')).toBe('Delete Login');
  });

  it('names the login it is deleting, since the host looks it up by label', () => {
    mountLogin();
    click('deleteLogin');
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'deleteLogin', login: 'DataCurator on gs64stone' }),
    );
  });
});
