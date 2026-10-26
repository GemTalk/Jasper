import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminStorage');
vi.mock('../bundledGci', () => ({
  bundledWindowsClientVersions: vi.fn(() => []),
  bundledGciArchSupported: vi.fn(() => true),
}));

import type * as vscode from 'vscode';
import { window, commands, __resetConfig, __setConfig } from '../__mocks__/vscode';
import { LoginEditorPanel } from '../loginEditorPanel';
import { bundledWindowsClientVersions, bundledGciArchSupported } from '../bundledGci';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider } from '../loginTreeProvider';
import { SysadminStorage } from '../sysadminStorage';
import {
  DEFAULT_LOGIN,
  GemStoneLogin,
  buildDataCuratorLogin,
  duplicateOf,
  loginLabel,
} from '../loginTypes';
import { fakeSecretStorage } from './support/secretStorage';

function makeLogin(overrides: Partial<GemStoneLogin> = {}): GemStoneLogin {
  return { ...DEFAULT_LOGIN, label: 'Test', ...overrides };
}

function makeSysadminStorage(extractedVersions: string[] = []): SysadminStorage {
  return {
    getExtractedVersions: vi.fn(() => extractedVersions),
    getExtractedClientVersions: vi.fn(() => []),
  } as unknown as SysadminStorage;
}

const realPlatform = process.platform;

describe('LoginEditorPanel', () => {
  let storage: LoginStorage;
  let treeProvider: LoginTreeProvider;
  let secrets: ReturnType<typeof fakeSecretStorage>;
  // `secrets` keeps its mock type so tests can assert on `.get`/`.store`/`.delete`;
  // this is the same mock, cast once for handing to `show()`.
  let secretsArg: vscode.SecretStorage;

  beforeEach(() => {
    __resetConfig();
    secrets = fakeSecretStorage();
    secretsArg = secrets;
    storage = new LoginStorage(secretsArg);
    treeProvider = new LoginTreeProvider(storage);
    // Reset the static currentPanel between tests
    (LoginEditorPanel as unknown as { currentPanel: unknown }).currentPanel = undefined;
    vi.clearAllMocks();
    (bundledWindowsClientVersions as Mock).mockReturnValue([]);
    (bundledGciArchSupported as Mock).mockReturnValue(true);
    // Linux unless a test says otherwise: on Windows a server install in WSL is
    // not a version a login can use, and these tests count one.
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
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
        notDownloaded: [],
        readOnly: false,
        keychainUnreadable: false,
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
        notDownloaded: [],
        readOnly: false,
        keychainUnreadable: false,
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

    it('on Windows, does not count a server install in WSL, which a Windows login cannot load', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const sysadmin = makeSysadminStorage(['3.7.5', '3.7.4']);
        vi.mocked(sysadmin.getExtractedClientVersions).mockReturnValue(['3.7.4']);
        await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
        const panel = window.createWebviewPanel.mock.results[0].value;
        expect(panel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ versions: ['3.7.4'] }),
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

  describe('versions not on this machine yet', () => {
    function catalog(versions: string[], size: number | null = 18_000_000) {
      return {
        supportedVersions: vi.fn(async () => versions),
        downloadSize: vi.fn(async (_v: string) => size),
      };
    }

    afterEach(() => LoginEditorPanel.setVersionCatalog(undefined));

    async function openWith(local: string[], supported: string[], size?: number | null) {
      const source = catalog(supported, size);
      LoginEditorPanel.setVersionCatalog(source);
      const sysadmin = makeSysadminStorage(local);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      await vi.waitFor(() =>
        expect(panel.webview.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ command: 'versions' }),
        ),
      );
      return { panel, source, sysadmin };
    }

    it('lists every supported version and says which are not downloaded', async () => {
      const { panel } = await openWith(['3.7.5'], ['3.7.5', '3.7.4', '3.6.2']);
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'versions',
        versions: ['3.7.5', '3.7.4', '3.6.2'],
        notDownloaded: ['3.7.4', '3.6.2'],
      });
    });

    it('keeps a version on disk that the download site no longer lists', async () => {
      const { panel } = await openWith(['4.0.0'], ['3.7.5']);
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'versions',
        versions: ['4.0.0', '3.7.5'],
        notDownloaded: ['3.7.5'],
      });
    });

    it('answers how big a version’s download is', async () => {
      const { panel, source } = await openWith([], ['3.7.4']);
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];
      await handler({ command: 'checkVersion', version: '3.7.4' });
      expect(source.downloadSize).toHaveBeenCalledWith('3.7.4');
      expect(panel.webview.postMessage).toHaveBeenCalledWith({
        command: 'versionInfo',
        version: '3.7.4',
        size: 18_000_000,
      });
    });

    it('downloading runs the same command as the GemStone manager, then refreshes the list', async () => {
      const { panel, sysadmin } = await openWith([], ['3.7.4']);
      vi.mocked(sysadmin.getExtractedClientVersions).mockReturnValue(['3.7.4']);
      panel.webview.postMessage.mockClear();
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await handler({ command: 'downloadVersion', version: '3.7.4' });

      expect(commands.executeCommand).toHaveBeenCalledWith('gemstone.downloadClient', {
        version: expect.objectContaining({ version: '3.7.4' }),
      });
      await vi.waitFor(() =>
        expect(panel.webview.postMessage).toHaveBeenCalledWith({
          command: 'versions',
          versions: ['3.7.4'],
          notDownloaded: [],
          downloaded: '3.7.4',
        }),
      );
    });

    it('names the version whose download ended even when the command throws', async () => {
      const { panel } = await openWith([], ['3.7.4']);
      panel.webview.postMessage.mockClear();
      vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error('boom'));
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];

      await expect(handler({ command: 'downloadVersion', version: '3.7.4' })).rejects.toThrow(
        'boom',
      );

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'versions', downloaded: '3.7.4' }),
      );
    });

    it('still lists what is on disk when the download site cannot be reached', async () => {
      const source = catalog([]);
      source.supportedVersions.mockRejectedValue(new Error('offline'));
      LoginEditorPanel.setVersionCatalog(source);
      await LoginEditorPanel.show(
        storage,
        secretsArg,
        treeProvider,
        undefined,
        makeSysadminStorage(['3.7.5']),
      );
      const panel = window.createWebviewPanel.mock.results[0].value;
      await vi.waitFor(() =>
        expect(panel.webview.postMessage).toHaveBeenCalledWith({
          command: 'versions',
          versions: ['3.7.5'],
          notDownloaded: [],
        }),
      );
    });

    it('counts client files on any platform as downloaded', async () => {
      const sysadmin = makeSysadminStorage([]);
      vi.mocked(sysadmin.getExtractedClientVersions).mockReturnValue(['3.7.4']);
      await LoginEditorPanel.show(storage, secretsArg, treeProvider, undefined, sysadmin);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ versions: ['3.7.4'], notDownloaded: [] }),
      );
    });
  });

  describe('OS keychain option', () => {
    it('renders a "Keep saved passwords in the OS keychain" checkbox in the HTML', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const html = panel.webview.html;

      expect(html).toContain('id="password_in_keychain"');
      expect(html).toContain('Keep saved passwords in the OS keychain');
    });

    // A hint rather than field help, which is hidden while an existing login is edited.
    it('always explains what the checkbox and a blank password each do', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);
      const panel = window.createWebviewPanel.mock.results[0].value;
      expect(panel.webview.html).toMatch(
        /<div class="hint">For both passwords above\.[^<]*A password left blank is never saved/,
      );
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

    it('pre-fills both passwords from SecretStorage when editing a keychain-backed login', async () => {
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone', 'kc-secret');
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone#host', 'kc-host');
      const login = makeLogin({
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: '',
        password_in_keychain: true,
      });

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login);

      const panel = window.createWebviewPanel.mock.results[0].value;
      const loadCall = panel.webview.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { command?: string })?.command === 'loadData',
      );
      expect((loadCall?.[0] as { data: GemStoneLogin }).data).toMatchObject({
        gs_password: 'kc-secret',
        host_password: 'kc-host',
      });
    });

    it("opens a Duplicate with the original's passwords, not a stale entry under its name", async () => {
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone', 'stale');
      const original = makeLogin({ gs_password: '', password_in_keychain: true });

      await LoginEditorPanel.show(
        storage,
        secretsArg,
        treeProvider,
        duplicateOf(original, { gs_password: 'original-gs', host_password: 'original-host' }),
      );

      const panel = window.createWebviewPanel.mock.results[0].value;
      const loadCall = panel.webview.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { command?: string })?.command === 'loadData',
      );
      expect((loadCall?.[0] as { data: GemStoneLogin }).data).toMatchObject({
        gs_password: 'original-gs',
        host_password: 'original-host',
        password_in_keychain: true,
      });
    });

    it('does not fill a login not saved yet from a keychain entry under its name', async () => {
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone', 'stale');
      const unsaved = makeLogin({ label: '', gs_password: '', password_in_keychain: true });

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, unsaved);

      expect(secrets.get).not.toHaveBeenCalled();
    });

    it('fills the passwords of a login the Databases panel created, so a Save keeps them', async () => {
      await storage.saveLogin(
        buildDataCuratorLogin({ version: '3.7.5', stoneName: 'gs64stone', ldiName: 'gs64ldi' }),
      );

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, storage.getLogins()[0]);

      const panel = window.createWebviewPanel.mock.results[0].value;
      const loadCall = panel.webview.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { command?: string })?.command === 'loadData',
      );
      expect((loadCall?.[0] as { data: GemStoneLogin }).data.gs_password).toBe(
        DEFAULT_LOGIN.gs_password,
      );
    });

    it('fills the passwords of a login already stored without a label, and saves its edit', async () => {
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone', 'kc-secret');
      __setConfig('gemstone', 'logins', [
        makeLogin({ label: '', gs_password: '', password_in_keychain: true }),
      ]);

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, storage.getLogins()[0]);
      const panel = window.createWebviewPanel.mock.results[0].value;
      const loadCall = panel.webview.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { command?: string })?.command === 'loadData',
      );
      const data = (loadCall?.[0] as { data: GemStoneLogin }).data;
      await panel.webview.onDidReceiveMessage.mock.calls[0][0]({
        command: 'save',
        data: { ...data, version: '3.7.5' },
        originalLabel: data.label,
      });

      expect(data.gs_password).toBe('kc-secret');
      expect(window.showErrorMessage).not.toHaveBeenCalled();
      expect(storage.getLogins()).toEqual([expect.objectContaining({ version: '3.7.5' })]);
      expect(secrets.entries.get('jasper-gemstone-login:DataCurator@localhost/gs64stone')).toBe(
        'kc-secret',
      );
    });

    it('opens read-only, and keeps the entries, when the keychain cannot be read', async () => {
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone', 'kc-secret');
      secrets.get.mockRejectedValue(new Error('keyring locked'));
      const login = makeLogin({ gs_password: '', password_in_keychain: true });

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login);
      const panel = window.createWebviewPanel.mock.results[0].value;
      await panel.webview.onDidReceiveMessage.mock.calls[0][0]({
        command: 'save',
        data: login,
        originalLabel: loginLabel(login),
      });

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadData', readOnly: true, keychainUnreadable: true }),
      );
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('keyring locked'),
      );
      expect(secrets.entries.get('jasper-gemstone-login:DataCurator@localhost/gs64stone')).toBe(
        'kc-secret',
      );
    });

    it('lets the user edit anyway, with the passwords to type again, when the keychain cannot be read', async () => {
      secrets.get.mockRejectedValue(new Error('keyring locked'));
      const login = makeLogin({ gs_password: '', password_in_keychain: true });

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login);
      const panel = window.createWebviewPanel.mock.results[0].value;
      panel.webview.postMessage.mockClear();
      await panel.webview.onDidReceiveMessage.mock.calls[0][0]({ command: 'editAnyway' });

      expect(panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'loadData',
          readOnly: false,
          keychainUnreadable: false,
        }),
      );
      expect(panel.title).toBe(`Edit: ${loginLabel(login)}`);
    });

    it('keeps a login with an active session read-only when the keychain cannot be read', async () => {
      secrets.get.mockRejectedValue(new Error('keyring locked'));
      const login = makeLogin({ gs_password: '', password_in_keychain: true });

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, login, undefined, true);
      const panel = window.createWebviewPanel.mock.results[0].value;
      panel.webview.postMessage.mockClear();
      await panel.webview.onDidReceiveMessage.mock.calls[0][0]({ command: 'editAnyway' });

      expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ command: 'loadData', readOnly: false }),
      );
    });

    it('starts a new login with the keychain box checked', async () => {
      await LoginEditorPanel.show(storage, secretsArg, treeProvider);

      const panel = window.createWebviewPanel.mock.results[0].value;
      const loadCall = panel.webview.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { command?: string })?.command === 'loadData',
      );
      expect((loadCall?.[0] as { data: GemStoneLogin }).data.password_in_keychain).toBe(true);
    });

    it('does not call SecretStorage when editing a non-keychain login', async () => {
      const login = makeLogin({ gs_password: 'plain', password_in_keychain: false });

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

    it('keeps both passwords out of the settings file when the box is checked', async () => {
      await simulateSave(undefined, {
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: 'newpw',
        host_user: 'gs',
        host_password: 'hostpw',
        password_in_keychain: true,
      });

      expect(secrets.entries.get('jasper-gemstone-login:DataCurator@localhost/gs64stone')).toBe(
        'newpw',
      );
      expect(
        secrets.entries.get('jasper-gemstone-login:DataCurator@localhost/gs64stone#host'),
      ).toBe('hostpw');
      expect(storage.getLogins()[0]).toMatchObject({
        gs_password: '',
        host_password: '',
        password_in_keychain: true,
      });
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

    it('moves both passwords back to the settings file when unchecking the box', async () => {
      const existing = makeLogin({
        gs_user: 'DataCurator',
        gem_host: 'localhost',
        stone: 'gs64stone',
        gs_password: '',
        password_in_keychain: true,
      });
      __setConfig('gemstone', 'logins', [{ ...existing, label: loginLabel(existing) }]);
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone', 'kc-gs');
      secrets.entries.set('jasper-gemstone-login:DataCurator@localhost/gs64stone#host', 'kc-host');

      await LoginEditorPanel.show(storage, secretsArg, treeProvider, {
        ...existing,
        label: loginLabel(existing),
      });
      const panel = window.createWebviewPanel.mock.results[0].value;
      const loaded = panel.webview.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { command?: string })?.command === 'loadData',
      )?.[0] as { data: GemStoneLogin };
      const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0];
      await handler({
        command: 'save',
        data: { ...loaded.data, password_in_keychain: false },
        originalLabel: loginLabel(existing),
      });

      expect(secrets.entries.size).toBe(0);
      expect(storage.getLogins()).toEqual([
        expect.objectContaining({ gs_password: 'kc-gs', host_password: 'kc-host' }),
      ]);
    });

    it('does not touch SecretStorage when saving a plain-password login', async () => {
      await simulateSave(undefined, {
        gs_password: 'plainpw',
        password_in_keychain: false,
      });

      expect(secrets.store).not.toHaveBeenCalled();
      expect(secrets.delete).not.toHaveBeenCalled();
    });
  });
});
