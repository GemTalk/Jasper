import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../wslBridge', () => ({
  needsWsl: () => false,
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
}));
vi.mock('child_process');

import { execSync } from 'child_process';

import type * as vscode from 'vscode';
import { __setConfig, __resetConfig } from '../__mocks__/vscode';
import { SysadminStorage } from '../sysadminStorage';
import { VersionManager } from '../manager/versionManager';
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

    await manager.downloadAndExtractWindowsClient('3.7.5', { report: vi.fn() }, noopToken);

    // Extraction used tar, not PowerShell
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('tar -xf'), expect.anything());
    for (const call of vi.mocked(execSync).mock.calls) {
      expect(String(call[0]).toLowerCase()).not.toContain('powershell');
    }
    // Zip cleaned up after extract
    expect(fs.existsSync(zipPath)).toBe(false);
  });
});
