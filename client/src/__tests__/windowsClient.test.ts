import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../wslBridge', () => ({
  needsWsl: vi.fn(() => false),
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
  wslSpawn: vi.fn(),
}));
vi.mock('child_process');

import { execSync, spawn, type ChildProcess } from 'child_process';

import type * as vscode from 'vscode';
import { needsWsl, wslSpawn } from '../wslBridge';
import { __setConfig, __resetConfig, CancellationTokenSource } from '../__mocks__/vscode';
import { SysadminStorage } from '../sysadminStorage';
import { InstallCancelledError, VersionManager } from '../manager/versionManager';
import { GemStoneVersion } from '../sysadminTypes';

/** VersionManager's private download helpers, exposed as a narrow surface for spying. */
type PrivateDownloadHost = {
  fetchUrl(url: string): Promise<string>;
  downloadFile(
    url: string,
    targetPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void>;
};

// ── Helpers ────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  __resetConfig();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-winclient-'));
  __setConfig('gemstone', 'rootPath', tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createWindowsClientDir(version: string): string {
  const dirName = `GemStone64BitClient${version}-x86.Windows_NT`;
  const dirPath = path.join(tmpDir, dirName);
  fs.mkdirSync(dirPath);
  return dirPath;
}

function createWindowsClientWithLib(version: string): string {
  const dirPath = createWindowsClientDir(version);
  // Windows client distributions place DLLs in bin/, not lib/
  const binDir = path.join(dirPath, 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, `libgcits-${version}-64.dll`), '');
  return dirPath;
}

function createWindowsClientZip(version: string, size: number = 1000): void {
  const fileName = `GemStone64BitClient${version}-x86.Windows_NT.zip`;
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, Buffer.alloc(size));
}

// ── SysadminStorage.getNativeRootPath ─────────────────────

describe('SysadminStorage.getNativeRootPath', () => {
  it('resolves ~ via os.homedir() not WSL', () => {
    __setConfig('gemstone', 'rootPath', '~/Documents/GemStone');
    const storage = new SysadminStorage();
    const result = storage.getNativeRootPath();
    // The config uses forward slashes; getNativeRootPath does string replacement
    expect(result).toBe(os.homedir() + '/Documents/GemStone');
    expect(result).not.toContain('wsl');
  });

  it('uses configured rootPath when absolute', () => {
    const storage = new SysadminStorage();
    // tmpDir is set as rootPath in beforeEach
    expect(storage.getNativeRootPath()).toBe(tmpDir);
  });
});

// ── SysadminStorage.ensureNativeRootPath ───────────────────

describe('SysadminStorage.ensureNativeRootPath', () => {
  it('creates the directory if it does not exist', () => {
    const newDir = path.join(tmpDir, 'nested', 'path');
    __setConfig('gemstone', 'rootPath', newDir);
    const storage = new SysadminStorage();
    expect(fs.existsSync(newDir)).toBe(false);
    storage.ensureNativeRootPath();
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it('does nothing if directory already exists', () => {
    const storage = new SysadminStorage();
    storage.ensureNativeRootPath();
    expect(fs.existsSync(tmpDir)).toBe(true);
  });
});

// ── SysadminStorage.getWindowsClientPath ──────────────────

describe('SysadminStorage.getWindowsClientPath', () => {
  it('returns path when client directory exists', () => {
    const dirPath = createWindowsClientDir('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientPath('3.7.5')).toBe(dirPath);
  });

  it('returns undefined when client directory does not exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientPath('9.9.9')).toBeUndefined();
  });
});

// ── SysadminStorage.getWindowsClientGciPath ───────────────

describe('SysadminStorage.getWindowsClientGciPath', () => {
  it('returns DLL path from bin/ directory (not lib/)', () => {
    createWindowsClientWithLib('3.7.5');
    const storage = new SysadminStorage();
    const result = storage.getWindowsClientGciPath('3.7.5');
    expect(result).toBeDefined();
    expect(result).toContain(path.join('bin', 'libgcits-3.7.5-64.dll'));
  });

  it('does not look in lib/ for the DLL', () => {
    // Windows client distributions put DLLs in bin/, not lib/.
    // A lib/ directory with a DLL should NOT be found.
    const dirPath = createWindowsClientDir('3.7.5');
    const libDir = path.join(dirPath, 'lib');
    fs.mkdirSync(libDir);
    fs.writeFileSync(path.join(libDir, 'libgcits-3.7.5-64.dll'), '');
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientGciPath('3.7.5')).toBeUndefined();
  });

  it('returns undefined when client directory exists without bin', () => {
    createWindowsClientDir('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientGciPath('3.7.5')).toBeUndefined();
  });

  it('returns undefined when client directory does not exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getWindowsClientGciPath('9.9.9')).toBeUndefined();
  });
});

// ── SysadminStorage.getExtractedWindowsClientVersions ─────

describe('SysadminStorage.getExtractedWindowsClientVersions', () => {
  it('returns empty array when no client directories exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getExtractedWindowsClientVersions()).toEqual([]);
  });

  it('finds extracted client versions', () => {
    createWindowsClientDir('3.7.5');
    createWindowsClientDir('3.6.4');
    const storage = new SysadminStorage();
    const versions = storage.getExtractedWindowsClientVersions();
    expect(versions).toEqual(['3.7.5', '3.6.4']); // sorted newest first
  });

  it('ignores non-client directories', () => {
    createWindowsClientDir('3.7.5');
    fs.mkdirSync(path.join(tmpDir, 'GemStone64Bit3.7.5-x86_64.Linux'));
    const storage = new SysadminStorage();
    const versions = storage.getExtractedWindowsClientVersions();
    expect(versions).toEqual(['3.7.5']);
  });

  it('ignores zip files (not extracted)', () => {
    createWindowsClientZip('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getExtractedWindowsClientVersions()).toEqual([]);
  });
});

// ── SysadminStorage.getDownloadedWindowsClientFiles ───────

describe('SysadminStorage.getDownloadedWindowsClientFiles', () => {
  it('returns empty map when no zip files exist', () => {
    const storage = new SysadminStorage();
    expect(storage.getDownloadedWindowsClientFiles().size).toBe(0);
  });

  it('finds downloaded zip files with sizes', () => {
    createWindowsClientZip('3.7.5', 5000);
    createWindowsClientZip('3.6.4', 3000);
    const storage = new SysadminStorage();
    const files = storage.getDownloadedWindowsClientFiles();
    expect(files.size).toBe(2);
    expect(files.get('3.7.5')).toBe(5000);
    expect(files.get('3.6.4')).toBe(3000);
  });

  it('ignores extracted directories', () => {
    createWindowsClientDir('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getDownloadedWindowsClientFiles().size).toBe(0);
  });
});

// ── VersionManager.windowsClientArtifact ──────────────────

describe('VersionManager.windowsClientArtifact', () => {
  it('constructs the canonical filename and URL for a version', () => {
    const { fileName, url } = VersionManager.windowsClientArtifact('3.7.5');
    expect(fileName).toBe('GemStone64BitClient3.7.5-x86.Windows_NT.zip');
    expect(url).toBe(
      'https://downloads.gemtalksystems.com/pub/GemStone64/3.7.5/GemStone64BitClient3.7.5-x86.Windows_NT.zip',
    );
  });
});

// ── VersionManager.deleteWindowsClientExtracted ───────────

describe('VersionManager.deleteWindowsClientExtracted', () => {
  it('removes the extracted client directory', async () => {
    const dirPath = createWindowsClientWithLib('3.7.5');
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    expect(fs.existsSync(dirPath)).toBe(true);

    const version: GemStoneVersion = {
      version: '3.7.5',
      fileName: '',
      url: '',
      size: 0,
      date: '',
      downloaded: false,
      extracted: true,
    };
    await manager.deleteWindowsClientExtracted(version);
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it('does nothing when directory does not exist', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    const version: GemStoneVersion = {
      version: '9.9.9',
      fileName: '',
      url: '',
      size: 0,
      date: '',
      downloaded: false,
      extracted: false,
    };
    await manager.deleteWindowsClientExtracted(version); // should not throw
  });
});

// ── VersionManager.fetchAvailableVersions (client state) ──

describe('VersionManager.fetchAvailableVersions (client state)', () => {
  it('marks a version as clientExtracted when the client directory exists', async () => {
    // Set platform to win32 so the Windows-client scan kicks in
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      createWindowsClientDir('3.7.5');
      const storage = new SysadminStorage();
      const manager = new VersionManager(storage);
      const html =
        '<a href="GemStone64Bit3.7.5-x86_64.Linux.zip">file</a>  12-Mar-2026 10:00  100000000';
      vi.spyOn(manager as unknown as PrivateDownloadHost, 'fetchUrl').mockResolvedValue(html);

      const versions = await manager.fetchAvailableVersions();
      const v = versions.find((x) => x.version === '3.7.5');
      expect(v?.clientExtracted).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});

// ── VersionManager.downloadAndExtractWindowsClient ────────

describe('VersionManager.downloadAndExtractWindowsClient', () => {
  const noopToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
  } as unknown as vscode.CancellationToken;

  it('throws when version is empty', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    await expect(
      manager.downloadAndExtractWindowsClient('', { report: vi.fn() }, noopToken),
    ).rejects.toThrow(/no GemStone version/i);
  });

  it('throws when version is whitespace', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    await expect(
      manager.downloadAndExtractWindowsClient('   ', { report: vi.fn() }, noopToken),
    ).rejects.toThrow(/no GemStone version/i);
  });

  it('translates HTTP 404 into a friendly message pointing at the base URL', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockRejectedValue(
      new Error('HTTP 404 downloading https://example/'),
    );
    await expect(
      manager.downloadAndExtractWindowsClient('9.9.9', { report: vi.fn() }, noopToken),
    ).rejects.toThrow(/No Windows client distribution has been published for GemStone 9\.9\.9/);
  });

  it('does not mask non-404 download errors', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockRejectedValue(
      new Error('ECONNREFUSED'),
    );
    await expect(
      manager.downloadAndExtractWindowsClient('3.7.5', { report: vi.fn() }, noopToken),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  /** A stand-in for the tar child: exits with `code` at once, or when killed if `code` is null. */
  function fakeTar(code: number | null, onStart?: () => void): void {
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => {
          setImmediate(() => child.emit('close', null));
          return true;
        },
      });
      onStart?.();
      if (code !== null) setImmediate(() => child.emit('close', code));
      return child as unknown as ChildProcess;
    });
  }

  it('on cancel, stops tar and removes both the partial client and the zip', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
    const clientDir = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT');
    vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
      async () => fs.writeFileSync(zipPath, ''),
    );
    const source = new CancellationTokenSource();
    fakeTar(null, () => {
      fs.mkdirSync(path.join(clientDir, 'bin'), { recursive: true });
      setImmediate(() => source.cancel());
    });

    const error = await manager
      .downloadAndExtractWindowsClient(
        '3.7.5',
        { report: vi.fn() },
        source.token as unknown as vscode.CancellationToken,
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InstallCancelledError);
    expect((error as Error).message).toMatch(/Windows client install cancelled/);
    expect(fs.existsSync(clientDir)).toBe(false);
    expect(fs.existsSync(zipPath)).toBe(false);
  });

  describe('a client folder that was there before', () => {
    it('is left alone when the unpack fails', async () => {
      const manager = new VersionManager(new SysadminStorage());
      const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
      const clientDir = createWindowsClientDir('3.7.5');
      fs.writeFileSync(path.join(clientDir, 'mine'), '');
      vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
        async () => fs.writeFileSync(zipPath, ''),
      );
      fakeTar(2);

      await expect(
        manager.downloadAndExtractWindowsClient('3.7.5', { report: vi.fn() }, noopToken),
      ).rejects.toThrow('tar failed with exit code 2');

      expect(fs.existsSync(path.join(clientDir, 'mine'))).toBe(true);
    });

    it('is left alone when the unpack is cancelled, and the message says so', async () => {
      const manager = new VersionManager(new SysadminStorage());
      const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
      const clientDir = createWindowsClientDir('3.7.5');
      fs.writeFileSync(path.join(clientDir, 'mine'), '');
      vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
        async () => fs.writeFileSync(zipPath, ''),
      );
      const source = new CancellationTokenSource();
      fakeTar(null, () => setImmediate(() => source.cancel()));

      const error = await manager
        .downloadAndExtractWindowsClient(
          '3.7.5',
          { report: vi.fn() },
          source.token as unknown as vscode.CancellationToken,
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InstallCancelledError);
      expect((error as Error).message).toBe(
        `Windows client install cancelled. ${clientDir} was there before, so it was left as ` +
          'it is; the unpack may have replaced some of its files.',
      );
      expect(fs.existsSync(path.join(clientDir, 'mine'))).toBe(true);
    });
  });

  it('keeps the unpack’s own failure in the message when the partial client cannot be removed', async () => {
    const manager = new VersionManager(new SysadminStorage());
    const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
    const clientDir = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT');
    vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
      async () => fs.writeFileSync(zipPath, ''),
    );
    fakeTar(2, () => fs.mkdirSync(clientDir));
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockRejectedValueOnce(
        Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }),
      );

    try {
      await expect(
        manager.downloadAndExtractWindowsClient('3.7.5', { report: vi.fn() }, noopToken),
      ).rejects.toThrow(
        `The Windows client install failed (tar failed with exit code 2), and the partly ` +
          `unpacked files at ${clientDir} could not be removed (EBUSY: resource busy or locked). ` +
          'Remove that folder before installing again.',
      );
    } finally {
      rm.mockRestore();
    }
  });

  it('runs tar on Windows itself even when GemStone lives in WSL', async () => {
    vi.mocked(needsWsl).mockReturnValue(true);
    try {
      const manager = new VersionManager(new SysadminStorage());
      const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
      vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
        async () => fs.writeFileSync(zipPath, ''),
      );
      fakeTar(0);

      await manager.downloadAndExtractWindowsClient('3.7.5', { report: vi.fn() }, noopToken);

      expect(spawn).toHaveBeenCalledWith('tar', ['-xf', zipPath, '-C', tmpDir]);
      expect(wslSpawn).not.toHaveBeenCalled();
    } finally {
      vi.mocked(needsWsl).mockReturnValue(false);
    }
  });

  it('on a failed unpack, removes both the partial client and the zip', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
    const clientDir = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT');
    vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
      async () => fs.writeFileSync(zipPath, ''),
    );
    fakeTar(2, () => fs.mkdirSync(path.join(clientDir, 'bin'), { recursive: true }));

    await expect(
      manager.downloadAndExtractWindowsClient('3.7.5', { report: vi.fn() }, noopToken),
    ).rejects.toThrow('tar failed with exit code 2');

    expect(fs.existsSync(clientDir)).toBe(false);
    expect(fs.existsSync(zipPath)).toBe(false);
  });

  it('downloads, extracts with tar, and removes the zip on success', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    const zipPath = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT.zip');
    vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
      async () => {
        // Simulate the download by dropping a file at the expected location.
        fs.writeFileSync(zipPath, '');
      },
    );

    fakeTar(0);

    await manager.downloadAndExtractWindowsClient('3.7.5', { report: vi.fn() }, noopToken);

    // Extraction ran tar as its own process, argv form — not PowerShell, and not
    // a shell string a quote in the root path could break.
    expect(spawn).toHaveBeenCalledWith('tar', ['-xf', zipPath, '-C', tmpDir]);
    expect(execSync).not.toHaveBeenCalled();
    // Zip cleaned up after extract
    expect(fs.existsSync(zipPath)).toBe(false);
  });
});
