import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminStorage');
vi.mock('../bundledGci', () => ({
  bundledWindowsClientVersions: vi.fn(() => []),
  bundledGciArchSupported: vi.fn(() => true),
}));

import type * as vscode from 'vscode';
import { window, __resetConfig, __setConfig } from '../__mocks__/vscode';
import { LoginEditorPanel } from '../loginEditorPanel';
import { bundledWindowsClientVersions, bundledGciArchSupported } from '../bundledGci';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider } from '../loginTreeProvider';
import { SysadminStorage } from '../sysadminStorage';
import { DEFAULT_LOGIN, GemStoneLogin, loginLabel } from '../loginTypes';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, label: 'Test', ...overrides };
}

function makeSysadminStorage(extractedVersions: string[] = []): SysadminStorage {
  return {
    getExtractedVersions: vi.fn(() => extractedVersions),
    getExtractedWindowsClientVersions: vi.fn(() => []),
  } as unknown as SysadminStorage;
}

function makeSecrets() {
  return {
    get: vi.fn(async (_k: string) => undefined as string | undefined),
    store: vi.fn(async (_k: string, _v: string) => undefined),
    delete: vi.fn(async (_k: string) => undefined),
    onDidChange: vi.fn(),
  };
}

describe('LoginEditorPanel', () => {
  let storage: LoginStorage;
  let treeProvider: LoginTreeProvider;
  let secrets: ReturnType<typeof makeSecrets>;
  // `secrets` keeps its mock type so tests can assert on `.get`/`.store`/`.delete`;
  // this is the same mock, cast once for handing to `show()`.
  let secretsArg: vscode.SecretStorage;

  beforeEach(() => {
    __resetConfig();
    storage = new LoginStorage();
    treeProvider = new LoginTreeProvider(storage);
    secrets = makeSecrets();
    secretsArg = secrets;
    // Reset the static currentPanel between tests
    (LoginEditorPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
    vi.clearAllMocks();
    (bundledWindowsClientVersions as Mock).mockReturnValue([]);
    (bundledGciArchSupported as Mock).mockReturnValue(true);
  });

  describe('show', () => {
    it('creates a new webview panel for a new login', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneLoginEditor',
        'New GemStone Login',
        expect.any(Number),
        expect.objectContaining({ enableScripts: true }),
      );
    });

    it('creates a panel titled with login description when editing', async () => {
      const login = makeLogin({ gs_user: 'Admin', stone: 'prod', gem_host: 'db.example.com' });
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneLoginEditor',
        'Edit: Admin on prod (db.example.com)',
        expect.any(Number),
        expect.any(Object),
      );
    });

    it('reuses existing panel on subsequent calls', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const firstCallCount = window.createWebviewPanel.mock.calls.length;

      await LoginEditorPanel.show(
        storage,
        secretsArg,
        treeProvider,
        makeLogin({ label: 'Second' }),
      );
      expect(window.createWebviewPanel.mock.calls.length).toBe(firstCallCount);
    });

    it('reveals existing panel on subsequent calls', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;

      await LoginEditorPanel.show(
        storage,
        secretsArg,
        treeProvider,
        makeLogin({ label: 'Second' }),
      );
      expect(panel.reveal).toHaveBeenCalled();
    });
  });

  describe('webview HTML', () => {
    it('sets webview html with form fields', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('GemStone Login Parameters');
      expect(html).toContain('id="version"');
      expect(html).toContain('id="gem_host"');
      expect(html).toContain('id="stone"');
      expect(html).toContain('id="gs_user"');
      expect(html).toContain('id="gs_password"');
      expect(html).toContain('id="netldi"');
      expect(html).toContain('id="host_user"');
      expect(html).toContain('id="host_password"');
    });

    it('includes Content-Security-Policy with nonce', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('Content-Security-Policy');
      expect(html).toMatch(/nonce-[a-f0-9]{32}/);
    });

    it('includes save and cancel buttons', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('id="saveBtn"');
      expect(html).toContain('id="cancelBtn"');
    });
  });

  describe('message handling', () => {
    it('sends loadData message after creating panel', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadData',
        data: expect.objectContaining({ label: '' }),
        versions: [],
        readOnly: false,
      });
    });

    it('sends existing login data when editing', async () => {
      const login = makeLogin({ label: 'Server', gem_host: 'myhost' });
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'loadData',
        data: expect.objectContaining({ label: 'Server', gem_host: 'myhost' }),
        versions: [],
        readOnly: false,
      });
    });
  });

  describe('version dropdown', () => {
    it('includes extracted versions in loadData message', async () => {
      const sysadmin = makeSysadminStorage(['3.7.4', '3.6.4']);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.7.4', '3.6.4'] }),
      );
    });

    it('includes versions from gciLibraries config', async () => {
      __setConfig('gemstone', 'gciLibraries', { '3.5.0': '/path/to/lib' });
      const sysadmin = makeSysadminStorage([]);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.5.0'] }),
      );
    });

    it('deduplicates versions from both sources', async () => {
      __setConfig('gemstone', 'gciLibraries', { '3.7.4': '/path/to/lib' });
      const sysadmin = makeSysadminStorage(['3.7.4']);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.7.4'] }),
      );
    });

    it('sorts versions newest first', async () => {
      __setConfig('gemstone', 'gciLibraries', { '3.5.0': '/path/a' });
      const sysadmin = makeSysadminStorage(['3.6.4', '3.7.4']);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.7.4', '3.6.4', '3.5.0'] }),
      );
    });

    it('includes GCI versions bundled with the extension on Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      (bundledWindowsClientVersions as Mock).mockReturnValue(['3.6.2']);
      try {
        const sysadmin = makeSysadminStorage([]);
        await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
        const panel = window.createWebviewPanel.mock.results[0].value;
        expect(panel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ versions: ['3.6.2'] }),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });

    it('omits bundled versions when the arch cannot load them (e.g. ARM64)', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      (bundledWindowsClientVersions as Mock).mockReturnValue(['3.6.2']);
      (bundledGciArchSupported as Mock).mockReturnValue(false);
      try {
        const sysadmin = makeSysadminStorage([]);
        await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
        const panel = window.createWebviewPanel.mock.results[0].value;
        expect(panel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ versions: [] }),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });

    it('renders a select element for the version field', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.html).toContain('<select id="version">');
    });

    it('defaults new login version to the highest available version', async () => {
      const sysadmin = makeSysadminStorage(['3.6.4', '3.7.4']);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '3.7.4' }),
        }),
      );
    });

    it('defaults to empty version when no versions are available', async () => {
      const sysadmin = makeSysadminStorage([]);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '' }),
        }),
      );
    });

    it('preserves version from existing login rather than defaulting', async () => {
      const sysadmin = makeSysadminStorage(['3.7.4', '3.6.4']);
      const login = makeLogin({ version: '3.6.4' });
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '3.6.4' }),
        }),
      );
    });
  });

  describe('OS keychain option', () => {
    it('renders a "Store password in OS keychain" checkbox in the HTML', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('id="password_in_keychain"');
      expect(html).toContain('Store password in OS keychain');
    });

    it('renders a hint about leaving the password blank to be prompted', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.html).toContain('Leave it blank to be prompted on each login');
    });

    it('renders the "Help me login" toggle with per-field help', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const html = window.createWebviewPanel.mock.results[0].value.webview.html;
      expect(html).toContain('id="helpToggle"');
      expect(html).toContain('Help me login');
      expect(html).toContain('class="field-help"');
      // The Host User/Password guidance — the field this help exists for.
      expect(html).toContain('requires host authentication');
    });

    it('pre-fills password from SecretStorage when editing a keychain-backed login', async () => {
      secrets.get.mockResolvedValueOnce('kc-secret');
      const login = makeLogin({
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: '',
        password_in_keychain: true,
      });

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login);

      expect(secrets.get).toHaveBeenCalledWith(
        'jasper-gemstone-login:DataCurator@localhost/gs64stone',
      );
      const panel = window.createWebviewPanel.mock.results[0].value;
      const loadCall = panel.webview.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { command?: string })?.command === 'loadData',
      );
      expect((loadCall?.[0] as { data: { gs_password: string } }).data.gs_password).toBe(
        'kc-secret',
      );
    });

    it('does not call SecretStorage when editing a non-keychain login', async () => {
      const login = makeLogin({ gs_password: 'plain' });

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login);

      expect(secrets.get).not.toHaveBeenCalled();
    });
  });

  describe('class sync option', () => {
    it('renders a "Sync classes to local files" checkbox in the HTML', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const html = panel.webview.html;
      expect(html).toContain('id="sync_classes"');
      expect(html).toContain('Sync classes to local files');
    });
  });

  describe('read-only view', () => {
    it('renders the read-only banner element in the HTML', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.html).toContain('id="readOnlyBanner"');
    });

    it('marks the load data read-only when opened read-only', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin(), undefined, true);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadData', readOnly: true }),
      );
    });

    it('is not read-only by default', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin());
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadData', readOnly: false }),
      );
    });

    it('titles the panel "View:" when read-only', async () => {
      const login = makeLogin({ gs_user: 'Admin', stone: 'prod', gem_host: 'db' });
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login, undefined, true);
      expect(window.createWebviewPanel).toHaveBeenCalledWith(
        'gemstoneLoginEditor',
        'View: Admin on prod (db)',
        expect.any(Number),
        expect.any(Object),
      );
    });

    it('switches an open panel to read-only when reused for a connected login', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin({ label: 'A' }));
      const panel = window.createWebviewPanel.mock.results[0].value;
      panel.webview.postMessage.mockClear();

      await LoginEditorPanel.show(
        storage,
        secretsArg,
        treeProvider,
        makeLogin({ label: 'A' }),
        undefined,
        true,
      );

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadData', readOnly: true }),
      );
    });

    it('ignores a save message while read-only', async () => {
      const saveSpy = vi.spyOn(storage, 'saveLogin').mockResolvedValue();
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin(), undefined, true);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({
        command: 'save',
        data: makeLogin({ stone: 'edited' }),
        originalLabel: 'Test',
      });

      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  // Pressing New Login on a database that already has its DataCurator login
  // prefills the form from that database, so every answer matches the login
  // already stored. Saving that used to overwrite the existing login with itself:
  // no row appeared, nothing changed, and the panel looked untouched.
  describe('saving a new login whose identity already exists', () => {
    it('refuses it and says why, rather than overwriting the existing one', async () => {
      const existing = makeLogin();
      storage.getLogins = vi.fn(() => [existing]);
      storage.saveLogin = vi.fn(async () => {});
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, existing);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      // No originalLabel: this is the "new login" path, not an edit.
      await handler({ command: 'save', data: { ...existing } });

      expect(storage.saveLogin).not.toHaveBeenCalled();
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('already exists'),
      );
    });

    it('leaves the form open on the answer that has to change', async () => {
      const existing = makeLogin();
      storage.getLogins = vi.fn(() => [existing]);
      storage.saveLogin = vi.fn(async () => {});
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, existing);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({ command: 'save', data: { ...existing } });

      expect(panel.dispose).not.toHaveBeenCalled();
    });

    it('still saves a new login that differs, and one being edited', async () => {
      const existing = makeLogin();
      storage.getLogins = vi.fn(() => [existing]);
      storage.saveLogin = vi.fn(async () => {});
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, existing);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      // A different user is a different login.
      await handler({ command: 'save', data: { ...existing, gs_user: 'SystemUser' } });
      expect(storage.saveLogin).toHaveBeenCalled();

      // ...and an edit carries the original label, so the clash is itself.
      vi.mocked(storage.saveLogin).mockClear();
      await handler({
        command: 'save',
        data: { ...existing },
        originalLabel: loginLabel(existing),
      });
      expect(storage.saveLogin).toHaveBeenCalled();
    });

    it('refuses an EDIT that turns one login into another that already exists', async () => {
      // The same silent overwrite, reached the other way: changing the user,
      // stone or host of an existing login into another row's identity makes
      // `saveLogin` replace that other row, which vanishes from the list.
      const existing = makeLogin({ gs_user: 'DataCurator' });
      const other = makeLogin({ gs_user: 'SystemUser' });
      storage.getLogins = vi.fn(() => [existing, other]);
      storage.saveLogin = vi.fn(async () => {});
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, existing);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({
        command: 'save',
        data: { ...existing, gs_user: 'SystemUser' },
        originalLabel: loginLabel(existing),
      });

      expect(storage.saveLogin).not.toHaveBeenCalled();
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('already exists'),
      );
      expect(panel.dispose).not.toHaveBeenCalled();
    });

    it('still saves an edit that changes only what does not identify the login', async () => {
      // Password, tags and NetLDI are not part of the label, so the row being
      // edited must not be read as a clash with itself.
      const existing = makeLogin({ gs_user: 'DataCurator' });
      storage.getLogins = vi.fn(() => [existing]);
      storage.saveLogin = vi.fn(async () => {});
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, existing);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({
        command: 'save',
        data: { ...existing, netldi: 'someotherldi' },
        originalLabel: loginLabel(existing),
      });

      expect(storage.saveLogin).toHaveBeenCalled();
    });
  });

  describe('what Save and Cancel do with the panel', () => {
    it('closes it, because a Save/Cancel form ends its editing session on Save', async () => {
      // The toast used to be the only sign the work had landed: the form stayed
      // up, submitted, and had to be closed by hand.
      vi.spyOn(storage, 'saveLogin').mockResolvedValue();
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin());
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({
        command: 'save',
        data: makeLogin({ stone: 'edited' }),
        originalLabel: 'Test',
      });

      expect(panel.dispose).toHaveBeenCalled();
    });

    it('closes it on Cancel too, so the pair agrees about what finishes', async () => {
      // Cancel used to post `requestData`, which reverted the form in place and
      // left the panel up — one button that finished the editing session and one
      // that did not.
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin());
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({ command: 'cancel' });

      expect(panel.dispose).toHaveBeenCalled();
    });

    it('still answers requestData without closing, since the form loads with it', async () => {
      // The webview asks for its data on load; only the Cancel button was
      // rerouted, so this must stay a plain reply.
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin());
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({ command: 'requestData' });

      expect(panel.dispose).not.toHaveBeenCalled();
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadData' }),
      );
    });

    it('leaves it open when the save was refused as read-only', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, makeLogin(), undefined, true);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({ command: 'save', data: makeLogin(), originalLabel: 'Test' });

      expect(panel.dispose).not.toHaveBeenCalled();
    });
  });

  describe('save with keychain checkbox', () => {
    async function simulateSave(
      existingLogin: GemStoneLogin | undefined,
      saveData: Partial<GemStoneLogin> & { password_in_keychain?: boolean; sync_classes?: boolean },
    ) {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, existingLogin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];
      const data = { ...makeLogin(), ...saveData };
      await handler({ command: 'save', data, originalLabel: existingLogin?.label ?? null });
    }

    it('stores the password in SecretStorage and saves with empty gs_password', async () => {
      const saveSpy = vi.spyOn(storage, 'saveLogin').mockResolvedValue();

      await simulateSave(undefined, {
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: 'newpw',
        password_in_keychain: true,
      });

      expect(secrets.store).toHaveBeenCalledWith(
        'jasper-gemstone-login:DataCurator@localhost/gs64stone',
        'newpw',
      );
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.gs_password).toBe('');
      expect(saved.password_in_keychain).toBe(true);
    });

    it('persists the sync_classes flag from the form', async () => {
      const saveSpy = vi.spyOn(storage, 'saveLogin').mockResolvedValue();
      await simulateSave(undefined, {
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: 'pw',
        sync_classes: false,
      });
      expect(saveSpy.mock.calls[0][0].sync_classes).toBe(false);
    });

    it('deletes the SecretStorage entry when unchecking the box', async () => {
      const existing = makeLogin({
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: '',
        password_in_keychain: true,
      });
      vi.spyOn(storage, 'saveLogin').mockResolvedValue();

      await simulateSave(existing, {
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: 'plain-now',
        password_in_keychain: false,
      });

      expect(secrets.delete).toHaveBeenCalledWith(
        'jasper-gemstone-login:DataCurator@localhost/gs64stone',
      );
    });

    it('does not touch SecretStorage when saving a plain-password login', async () => {
      vi.spyOn(storage, 'saveLogin').mockResolvedValue();

      await simulateSave(undefined, {
        gs_password: 'plainpw',
        password_in_keychain: false,
      });

      expect(secrets.store).not.toHaveBeenCalled();
      expect(secrets.delete).not.toHaveBeenCalled();
    });
  });
});
