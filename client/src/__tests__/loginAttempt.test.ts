import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../bundledGci', () => ({
  bundledWindowsClientGciPath: vi.fn(() => undefined),
  bundledGciArchSupported: vi.fn(() => true),
}));

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
const GCI = '/gs/lib/libgcits-3.7.5-64.dylib';
const SESSION = { id: 1, stoneVersion: '3.7.5' } as ActiveSession;

function makeDeps(overrides: Partial<LoginAttemptDeps> = {}): LoginAttemptDeps {
  return {
    keychainPassword: vi.fn(async () => undefined),
    getGciLibraryPath: vi.fn(() => GCI),
    setGciLibraryPath: vi.fn(async () => {}),
    getGemstonePath: vi.fn(() => undefined),
    getWindowsClientGciPath: vi.fn(() => undefined),
    getRootPath: vi.fn(() => '/root'),
    downloadAndExtractWindowsClient: vi.fn(async () => {}),
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
  vi.mocked(vscode.window.showWarningMessage).mockReset();
  vi.mocked(vscode.window.showInformationMessage).mockReset();
  vi.mocked(vscode.window.showErrorMessage).mockReset();
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

  it('reports that no client library was available when the library picker is dismissed', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce(undefined);
    const deps = makeDeps({ getGciLibraryPath: vi.fn(() => undefined) });

    expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('reports that no client library was available when a misnamed library is not confirmed', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce([
      vscode.Uri.file('/tmp/not-a-gci.dylib'),
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(
      'No' as unknown as vscode.MessageItem,
    );
    const deps = makeDeps({ getGciLibraryPath: vi.fn(() => undefined) });

    expect(await attemptLogin(LOGIN, deps)).toBe('noClientLibrary');
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
    expect(deps.connected).toHaveBeenCalledWith(
      expect.objectContaining({ stone: 'alpha' }),
      SESSION,
    );
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
        downloadAndExtractWindowsClient: vi.fn(async () => {
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
