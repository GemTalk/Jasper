import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../bundledGci', () => ({
  bundledWindowsClientGciPath: vi.fn(() => undefined),
  bundledGciArchSupported: vi.fn(() => true),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { attemptLogin, LoginAttemptDeps } from '../loginAttempt';
import { bundledGciArchSupported, bundledWindowsClientGciPath } from '../bundledGci';
import { DEFAULT_LOGIN, GemStoneLogin } from '../loginTypes';
import type { ActiveSession } from '../sessionManager';

const LOGIN: GemStoneLogin = {
  ...DEFAULT_LOGIN,
  stone: 'alpha',
  version: '3.7.5',
  gs_password: 'swordfish',
  host_user: '',
  host_password: '',
};
// Real files: the saved library path is used only when its file is on disk.
let scratch: string;
let GCI: string;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-login-'));
  GCI = path.join(scratch, 'gs', 'lib', 'libgcits-3.7.5-64.dylib');
  fs.mkdirSync(path.dirname(GCI), { recursive: true });
  fs.writeFileSync(GCI, '');
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** Writes an empty file at `relative` under the scratch directory and answers its path. */
function realFile(relative: string): string {
  const file = path.join(scratch, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return file;
}

const SESSION = { id: 1, stoneVersion: '3.7.5' } as ActiveSession;

function makeDeps(overrides: Partial<LoginAttemptDeps> = {}): LoginAttemptDeps {
  return {
    keychainPasswords: vi.fn(async () => ({ gs_password: '', host_password: '' })),
    getGciLibraryPath: vi.fn(() => GCI),
    setGciLibraryPath: vi.fn(async () => {}),
    removeGciLibraryPath: vi.fn(async () => {}),
    getGemstonePath: vi.fn(() => undefined),
    getClientGciPath: vi.fn(() => undefined),
    getRootPath: vi.fn(() => '/root'),
    downloadAndExtractClient: vi.fn(async () => {}),
    refreshVersions: vi.fn(),
    connect: vi.fn(async () => SESSION),
    connected: vi.fn(),
    ...overrides,
  };
}

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  vi.mocked(vscode.window.showInputBox).mockReset();
  vi.mocked(vscode.window.showOpenDialog).mockReset();
  vi.mocked(vscode.window.showWarningMessage).mockReset().mockResolvedValue(undefined);
  vi.mocked(vscode.window.showInformationMessage).mockReset();
  vi.mocked(vscode.window.showErrorMessage).mockReset();
  vi.mocked(vscode.commands.executeCommand).mockReset();
  vi.mocked(bundledWindowsClientGciPath).mockReset();
  vi.mocked(bundledGciArchSupported).mockReset().mockReturnValue(true);
  onPlatform('darwin');
});

afterEach(() => {
  onPlatform(originalPlatform);
  process.env.GEMSTONE = originalEnv.GEMSTONE;
  process.env.GEMSTONE_GLOBAL_DIR = originalEnv.GEMSTONE_GLOBAL_DIR;
  if (originalEnv.GEMSTONE === undefined) delete process.env.GEMSTONE;
  if (originalEnv.GEMSTONE_GLOBAL_DIR === undefined) delete process.env.GEMSTONE_GLOBAL_DIR;
});

describe('attempting a login', () => {
  it('reports the login as cancelled when the GemStone password prompt is dismissed', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);
    const deps = makeDeps();

    expect(await attemptLogin({ ...LOGIN, gs_password: '' }, deps)).toBe('cancelled');
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('reports the login as cancelled when the host password prompt is dismissed', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);
    const deps = makeDeps();

    expect(await attemptLogin({ ...LOGIN, host_user: 'gs' }, deps)).toBe('cancelled');
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('logs in with both passwords from the keychain, without asking for either', async () => {
    const deps = makeDeps({
      keychainPasswords: vi.fn(async () => ({ gs_password: 'kc-gs', host_password: 'kc-host' })),
    });
    const login = { ...LOGIN, gs_password: '', host_user: 'gs', password_in_keychain: true };

    expect(await attemptLogin(login, deps)).toBe('connected');
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(deps.connect).toHaveBeenCalledWith(
      expect.objectContaining({ gs_password: 'kc-gs', host_password: 'kc-host' }),
      GCI,
    );
  });

  it('asks for a password the keychain does not have', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('typed-host');
    const deps = makeDeps({
      keychainPasswords: vi.fn(async () => ({ gs_password: 'kc-gs', host_password: '' })),
    });
    const login = { ...LOGIN, gs_password: '', host_user: 'gs', password_in_keychain: true };

    expect(await attemptLogin(login, deps)).toBe('connected');
    expect(vscode.window.showInputBox).toHaveBeenCalledTimes(1);
    expect(deps.connect).toHaveBeenCalledWith(
      expect.objectContaining({ gs_password: 'kc-gs', host_password: 'typed-host' }),
      GCI,
    );
  });

  it('reports that no client library was available when the library picker is dismissed', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      'Browse...' as unknown as vscode.MessageItem,
    );
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce(undefined);
    const deps = makeDeps({ getGciLibraryPath: vi.fn(() => undefined) });

    expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultUri: undefined }),
    );
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('reports that no client library was available when a misnamed library is not confirmed', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
      'Browse...' as unknown as vscode.MessageItem,
    );
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce([
      vscode.Uri.file('/tmp/not-a-gci.dylib'),
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(
      'No' as unknown as vscode.MessageItem,
    );
    const deps = makeDeps({ getGciLibraryPath: vi.fn(() => undefined) });

    expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
    expect(vscode.window.showOpenDialog).toHaveBeenCalled();
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('reports a failure when connecting yields no session', async () => {
    const deps = makeDeps({ connect: vi.fn(async () => undefined) });

    expect(await attemptLogin(LOGIN, deps)).toBe('failed');
    expect(deps.connected).not.toHaveBeenCalled();
  });

  it('lets a connection error propagate, for the caller to report as a failure', async () => {
    const deps = makeDeps({
      connect: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await expect(attemptLogin(LOGIN, deps)).rejects.toThrow('boom');
    expect(deps.connected).not.toHaveBeenCalled();
  });

  it('reports success and hands the new session on', async () => {
    const deps = makeDeps();

    expect(await attemptLogin(LOGIN, deps)).toBe('connected');
    expect(deps.connect).toHaveBeenCalledWith(expect.objectContaining({ stone: 'alpha' }), GCI);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.connected).toHaveBeenCalledWith(
      expect.objectContaining({ stone: 'alpha' }),
      SESSION,
    );
  });

  describe('a saved library path whose file is unusable', () => {
    const USE = 'Use Suggested Library';
    const EDIT = 'Edit Setting';
    const answer = (choice: string | undefined) =>
      vi
        .mocked(vscode.window.showWarningMessage)
        .mockResolvedValueOnce(choice as unknown as vscode.MessageItem);

    it('asks before using the full install it found in place of a saved path that is not on disk', async () => {
      const missing = path.join(scratch, 'gone', 'lib', 'libgcits-3.7.5-64.dylib');
      const found = realFile('product/lib/libgcits-3.7.5-64.dylib');
      answer(USE);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => missing),
        getGemstonePath: vi.fn(() => path.dirname(path.dirname(found))),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'The GCI library saved for GemStone 3.7.5 is not on disk.',
        {
          modal: true,
          detail: `Saved path: ${missing}\n\nJasper found a GemStone 3.7.5 library at:\n${found}`,
        },
        USE,
        'Browse...',
        EDIT,
      );
      expect(deps.removeGciLibraryPath).toHaveBeenCalledWith('3.7.5');
      expect(deps.setGciLibraryPath).not.toHaveBeenCalled();
      expect(deps.connect).toHaveBeenCalledWith(expect.anything(), found);
    });

    it('asks before using client files in place of a library for another platform (a Linux .so on a Mac)', async () => {
      const linux = realFile('linux/lib/libgcits-3.7.5-64.so');
      const client = realFile('client/lib/libgcits-3.7.5-64.dylib');
      answer(USE);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => linux),
        getClientGciPath: vi.fn(() => client),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'The GCI library saved for GemStone 3.7.5 is not a macOS library (.dylib).',
        expect.objectContaining({ modal: true }),
        USE,
        'Browse...',
        EDIT,
      );
      expect(deps.removeGciLibraryPath).toHaveBeenCalledWith('3.7.5');
      expect(deps.setGciLibraryPath).not.toHaveBeenCalled();
      expect(deps.connect).toHaveBeenCalledWith(expect.anything(), client);
    });

    it('does not ask again after an extension update moves the suggested bundled library', async () => {
      onPlatform('win32');
      // The bundled folder's path carries the extension version.
      let bundled = 'C:\\ext-1.15.0\\resources\\gci\\libgcits-3.7.5-64.dll';
      vi.mocked(bundledWindowsClientGciPath).mockImplementation(() => bundled);
      const saved = new Map([['3.7.5', path.join(scratch, 'gone', 'libgcits-3.7.5-64.dll')]]);
      answer(USE);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn((version: string) => saved.get(version)),
        setGciLibraryPath: vi.fn(async (version: string, gciPath: string) => {
          saved.set(version, gciPath);
        }),
        removeGciLibraryPath: vi.fn(async (version: string) => {
          saved.delete(version);
        }),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      bundled = 'C:\\ext-1.16.0\\resources\\gci\\libgcits-3.7.5-64.dll';
      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
      expect(deps.connect).toHaveBeenLastCalledWith(expect.anything(), bundled);
    });

    it('does not log in, and leaves the setting alone, when the question is cancelled', async () => {
      answer(undefined);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => path.join(scratch, 'gone', 'libgcits-3.7.5-64.dylib')),
        getClientGciPath: vi.fn(() => GCI),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(deps.connect).not.toHaveBeenCalled();
      expect(deps.setGciLibraryPath).not.toHaveBeenCalled();
      expect(deps.removeGciLibraryPath).not.toHaveBeenCalled();
    });

    it('offers the download when nothing else for the version is on this machine, then drops the saved path', async () => {
      const linux = realFile('linux/lib/libgcits-3.7.5-64.so');
      answer('Download');
      let downloaded = false;
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => linux),
        getClientGciPath: vi.fn(() => (downloaded ? GCI : undefined)),
        downloadAndExtractClient: vi.fn(async () => {
          downloaded = true;
        }),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'The GCI library saved for GemStone 3.7.5 is not a macOS library (.dylib).',
        {
          modal: true,
          detail: `Saved path: ${linux}\n\nJasper found no other GemStone 3.7.5 library on this machine.`,
        },
        'Download',
        'Browse...',
        EDIT,
      );
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      // Like any download, found again through getClientGciPath rather than saved.
      expect(deps.removeGciLibraryPath).toHaveBeenCalledWith('3.7.5');
      expect(deps.setGciLibraryPath).not.toHaveBeenCalled();
      expect(deps.connect).toHaveBeenCalledWith(expect.anything(), GCI);
    });

    it('stops the login and opens the setting, for the user to fix the entry themselves', async () => {
      answer(EDIT);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => path.join(scratch, 'gone', 'libgcits-3.7.5-64.dylib')),
        getClientGciPath: vi.fn(() => GCI),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'workbench.action.openSettings',
        'gemstone.gciLibraries',
      );
      expect(deps.connect).not.toHaveBeenCalled();
      expect(deps.setGciLibraryPath).not.toHaveBeenCalled();
      expect(deps.removeGciLibraryPath).not.toHaveBeenCalled();
    });

    it('saves a library browsed to in place of the saved path', async () => {
      // As the picker reports it: on Windows, Uri.fsPath lowercases the drive letter.
      const picked = vscode.Uri.file(realFile('picked/lib/libgcits-3.7.5-64.dylib')).fsPath;
      answer('Browse...');
      vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce([vscode.Uri.file(picked)]);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => path.join(scratch, 'gone', 'libgcits-3.7.5-64.dylib')),
        getClientGciPath: vi.fn(() => GCI),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(deps.setGciLibraryPath).toHaveBeenCalledWith('3.7.5', picked);
      expect(deps.connect).toHaveBeenCalledWith(expect.anything(), picked);
    });

    it('opens the file picker in the nearest folder of the saved path that still exists', async () => {
      const lib = path.dirname(realFile('kept/lib/libgcits-3.7.5-64.so'));
      answer('Browse...');
      vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce(undefined);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => path.join(lib, 'gone', 'libgcits-3.7.5-64.dylib')),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultUri: vscode.Uri.file(lib) }),
      );
    });

    it('opens the file picker in the folder of a saved library that exists but is for another platform', async () => {
      const linux = realFile('linux-only/lib/libgcits-3.7.5-64.so');
      answer('Browse...');
      vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce(undefined);
      const deps = makeDeps({ getGciLibraryPath: vi.fn(() => linux) });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({ defaultUri: vscode.Uri.file(path.dirname(linux)) }),
      );
    });

    it('keeps the saved path when the download offered in its place fails', async () => {
      answer('Download');
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => path.join(scratch, 'gone', 'libgcits-3.7.5-64.dylib')),
        downloadAndExtractClient: vi.fn(async () => {
          throw new Error('offline');
        }),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Downloading the files for GemStone 3.7.5 failed: offline',
      );
      expect(deps.removeGciLibraryPath).not.toHaveBeenCalled();
      expect(deps.connect).not.toHaveBeenCalled();
    });

    for (const [platform, saved, problem] of [
      ['linux', 'mac/lib/libgcits-3.7.5-64.dylib', 'is not a Linux library (.so)'],
      ['win32', 'linux/lib/libgcits-3.7.5-64.so', 'is not a Windows library (.dll)'],
    ] as const) {
      it(`on ${platform}, names the library this platform needs`, async () => {
        onPlatform(platform);
        const deps = makeDeps({ getGciLibraryPath: vi.fn(() => realFile(saved)) });

        expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
          `The GCI library saved for GemStone 3.7.5 ${problem}.`,
          expect.objectContaining({ modal: true }),
          'Download',
          'Browse...',
          EDIT,
        );
      });
    }

    it('on Windows, suggests the library bundled with Jasper', async () => {
      onPlatform('win32');
      const bundled = 'C:\\bundled\\libgcits-3.7.5-64.dll';
      vi.mocked(bundledWindowsClientGciPath).mockReturnValue(bundled);
      answer(USE);
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => path.join(scratch, 'gone', 'libgcits-3.7.5-64.dll')),
        getClientGciPath: vi.fn(() => 'C:\\client\\libgcits-3.7.5-64.dll'),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ detail: expect.stringContaining(bundled) }),
        USE,
        'Browse...',
        EDIT,
      );
      expect(deps.removeGciLibraryPath).toHaveBeenCalledWith('3.7.5');
      expect(deps.setGciLibraryPath).not.toHaveBeenCalled();
      expect(deps.connect).toHaveBeenCalledWith(expect.anything(), bundled);
    });

    it('on Windows, says to run x64 VS Code rather than suggest an x64 library this one cannot load', async () => {
      onPlatform('win32');
      vi.mocked(bundledWindowsClientGciPath).mockReturnValue('C:\\bundled\\libgcits-3.7.5-64.dll');
      vi.mocked(bundledGciArchSupported).mockReturnValue(false);
      // The client files' DLL is x64 too, so it is no way out.
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => path.join(scratch, 'gone', 'libgcits-3.7.5-64.dll')),
        getClientGciPath: vi.fn(() => 'C:\\client\\libgcits-3.7.5-64.dll'),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Install and run the x64 build of VS Code'),
      );
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(deps.connect).not.toHaveBeenCalled();
      expect(deps.removeGciLibraryPath).not.toHaveBeenCalled();
    });

    it('on Windows, accepts a saved library whatever the case of its extension', async () => {
      onPlatform('win32');
      const dll = realFile('win/libgcits-3.7.5-64.DLL');
      const deps = makeDeps({ getGciLibraryPath: vi.fn(() => dll) });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(deps.connect).toHaveBeenCalledWith(expect.anything(), dll);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });
  });

  describe('a version with nothing on this machine yet', () => {
    const OFFER = 'Jasper needs a few files to talk to GemStone 3.7.5. Download them now?';

    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      it(`on ${platform}, offers to download them, then logs in with what arrived without registering it`, async () => {
        onPlatform(platform);
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
          'Download' as unknown as vscode.MessageItem,
        );
        let downloaded = false;
        const deps = makeDeps({
          getGciLibraryPath: vi.fn(() => undefined),
          getClientGciPath: vi.fn(() =>
            downloaded ? '/root/client/libgcits-3.7.5-64.so' : undefined,
          ),
          downloadAndExtractClient: vi.fn(async () => {
            downloaded = true;
          }),
        });

        expect(await attemptLogin(LOGIN, deps)).toBe('connected');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
          OFFER,
          'Download',
          'Browse...',
        );
        expect(deps.downloadAndExtractClient).toHaveBeenCalledWith(
          '3.7.5',
          expect.anything(),
          expect.anything(),
        );
        // Found through getClientGciPath next time, so a later full install still wins.
        expect(deps.setGciLibraryPath).not.toHaveBeenCalled();
        expect(deps.connect).toHaveBeenCalledWith(
          expect.anything(),
          '/root/client/libgcits-3.7.5-64.so',
        );
      });
    }

    it('uses client files already on disk without asking', async () => {
      onPlatform('linux');
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => undefined),
        getClientGciPath: vi.fn(() => '/root/client/libgcits-3.7.5-64.so'),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('connected');
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('prefers a full install of the version over client files', async () => {
      onPlatform('linux');
      const product = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-product-'));
      const lib = path.join(product, 'lib', 'libgcits-3.7.5-64.so');
      fs.mkdirSync(path.dirname(lib));
      fs.writeFileSync(lib, '');
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => undefined),
        getGemstonePath: vi.fn(() => product),
        getClientGciPath: vi.fn(() => '/root/client/libgcits-3.7.5-64.so'),
      });
      try {
        expect(await attemptLogin(LOGIN, deps)).toBe('connected');
        expect(deps.connect).toHaveBeenCalledWith(expect.anything(), lib);
      } finally {
        fs.rmSync(product, { recursive: true, force: true });
      }
    });

    it('says what went wrong with the download, starting from the version', async () => {
      onPlatform('linux');
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
        'Download' as unknown as vscode.MessageItem,
      );
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => undefined),
        downloadAndExtractClient: vi.fn(async () => {
          throw new Error('offline');
        }),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Downloading the files for GemStone 3.7.5 failed: offline',
      );
    });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      onPlatform('win32');
    });

    const noLibrary = () => makeDeps({ getGciLibraryPath: vi.fn(() => undefined) });

    it('reports that no client library was available when the bundled library does not match the architecture', async () => {
      vi.mocked(bundledWindowsClientGciPath).mockReturnValue('C:\\bundled\\libgcits-3.7.5-64.dll');
      vi.mocked(bundledGciArchSupported).mockReturnValue(false);
      const deps = noLibrary();

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(deps.connect).not.toHaveBeenCalled();
    });

    it('reports that no client library was available when the login has no version to download', async () => {
      const deps = noLibrary();

      expect(await attemptLogin({ ...LOGIN, version: ' ' }, deps)).toBe('noClientLibrary');
      expect(deps.connect).not.toHaveBeenCalled();
    });

    it('reports that no client library was available when the client download fails', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(
        'Download' as unknown as vscode.MessageItem,
      );
      const deps = makeDeps({
        getGciLibraryPath: vi.fn(() => undefined),
        downloadAndExtractClient: vi.fn(async () => {
          throw new Error('offline');
        }),
      });

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(deps.connect).not.toHaveBeenCalled();
    });

    it('reports that no client library was available when the download offer is dismissed', async () => {
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce(undefined);
      const deps = noLibrary();

      expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
      expect(deps.connect).not.toHaveBeenCalled();
    });
  });
});
