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

import { spawn, type ChildProcess } from 'child_process';
import type * as vscode from 'vscode';
import { __setConfig, __resetConfig, CancellationTokenSource } from '../__mocks__/vscode';
import { SysadminStorage } from '../sysadminStorage';
import { InstallCancelledError, VersionManager } from '../manager/versionManager';
import { GemStoneVersion } from '../sysadminTypes';

// What a login needs from a version is a few client files, not the server: on
// Linux and macOS these come from GemTalk's GemStoneClientLibs package, kept in
// a folder of their own so they never touch a full install of the same version.

type PrivateDownloadHost = {
  fetchUrl(url: string): Promise<string>;
  downloadFile(
    url: string,
    targetPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void>;
};

const noopToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
} as unknown as vscode.CancellationToken;

let tmpDir: string;
const originalPlatform = process.platform;
const originalArch = process.arch;

function onPlatform(platform: NodeJS.Platform, arch: string = 'x64'): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
}

beforeEach(() => {
  __resetConfig();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-client-'));
  __setConfig('gemstone', 'rootPath', tmpDir);
  onPlatform('linux');
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  unlock(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.mocked(spawn).mockReset();
});

/** A client folder laid out the way GemStoneClientLibs unpacks: <version>/64bit/<libs>. */
function createClientLibs(version: string, key = 'x86_64.Linux', ext = 'so'): string {
  const dir = path.join(tmpDir, `GemStoneClientLibs${version}-${key}`);
  fs.mkdirSync(path.join(dir, version, '64bit'), { recursive: true });
  fs.writeFileSync(path.join(dir, version, '64bit', `libgcits-${version}-64.${ext}`), '');
  return dir;
}

function unlock(dir: string): void {
  if (!fs.existsSync(dir)) return;
  fs.chmodSync(dir, 0o755);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) unlock(path.join(dir, entry.name));
  }
}

/** Make a tree read-only, as GemTalk's client zip unpacks: every folder r-x, every file r--. */
function lockDown(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) lockDown(p);
    else fs.chmodSync(p, 0o444);
  }
  fs.chmodSync(dir, 0o555);
}

/** A full server product with its library in lib/. */
function createProduct(version: string, key = 'x86_64.Linux'): string {
  const dir = path.join(tmpDir, `GemStone64Bit${version}-${key}`);
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', `libgcits-${version}-64.so`), '');
  return dir;
}

function versionRow(version: string): GemStoneVersion {
  return { version, fileName: '', url: '', size: 0, date: '', downloaded: false, extracted: false };
}

describe('VersionManager.clientArtifact', () => {
  it('names the GemStoneClientLibs zip for x86_64 Linux', () => {
    expect(VersionManager.clientArtifact('3.7.4.3')).toEqual({
      fileName: 'GemStoneClientLibs3.7.4.3-x86_64.Linux.zip',
      url: 'https://downloads.gemtalksystems.com/pub/GemStone64/3.7.4.3/GemStoneClientLibs3.7.4.3-x86_64.Linux.zip',
      dirName: 'GemStoneClientLibs3.7.4.3-x86_64.Linux',
    });
  });

  it('names the arm64 Linux zip on an arm64 machine', () => {
    onPlatform('linux', 'arm64');
    expect(VersionManager.clientArtifact('3.7.5').fileName).toBe(
      'GemStoneClientLibs3.7.5-arm64.Linux.zip',
    );
  });

  it('names a dmg on macOS, with GemStone’s i386 spelling for Intel Macs', () => {
    onPlatform('darwin', 'arm64');
    expect(VersionManager.clientArtifact('3.7.5').fileName).toBe(
      'GemStoneClientLibs3.7.5-arm64.Darwin.dmg',
    );
    onPlatform('darwin', 'x64');
    expect(VersionManager.clientArtifact('3.7.5').fileName).toBe(
      'GemStoneClientLibs3.7.5-i386.Darwin.dmg',
    );
  });

  it('keeps the Windows client zip on Windows', () => {
    onPlatform('win32');
    expect(VersionManager.clientArtifact('3.7.5')).toEqual({
      fileName: 'GemStone64BitClient3.7.5-x86.Windows_NT.zip',
      url: 'https://downloads.gemtalksystems.com/pub/GemStone64/3.7.5/GemStone64BitClient3.7.5-x86.Windows_NT.zip',
      dirName: 'GemStone64BitClient3.7.5-x86.Windows_NT',
    });
  });
});

describe('SysadminStorage client files', () => {
  it('finds the library inside a GemStoneClientLibs folder', () => {
    const dir = createClientLibs('3.7.4.3');
    const storage = new SysadminStorage();
    expect(storage.getClientPath('3.7.4.3')).toBe(dir);
    expect(storage.getClientGciPath('3.7.4.3')).toBe(
      path.join(dir, '3.7.4.3', '64bit', 'libgcits-3.7.4.3-64.so'),
    );
  });

  it('finds a macOS dylib wherever the disk image put it', () => {
    onPlatform('darwin', 'arm64');
    const dir = path.join(tmpDir, 'GemStoneClientLibs3.7.5-arm64.Darwin');
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'lib', 'libgcits-3.7.5-64.dylib'), '');
    expect(new SysadminStorage().getClientGciPath('3.7.5')).toBe(
      path.join(dir, 'lib', 'libgcits-3.7.5-64.dylib'),
    );
  });

  it('does not mistake a full product for client files', () => {
    createProduct('3.7.5');
    const storage = new SysadminStorage();
    expect(storage.getClientPath('3.7.5')).toBeUndefined();
    expect(storage.getClientGciPath('3.7.5')).toBeUndefined();
    expect(storage.getExtractedClientVersions()).toEqual([]);
  });

  it('lists the versions with client files, newest first', () => {
    createClientLibs('3.7.2');
    createClientLibs('3.7.10');
    createClientLibs('3.7.5', 'arm64.Linux'); // another machine's files: not ours
    expect(new SysadminStorage().getExtractedClientVersions()).toEqual(['3.7.10', '3.7.2']);
  });

  it('on Windows, means the Windows client', () => {
    onPlatform('win32');
    const dir = path.join(tmpDir, 'GemStone64BitClient3.7.5-x86.Windows_NT');
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'libgcits-3.7.5-64.dll'), '');
    const storage = new SysadminStorage();
    expect(storage.getClientGciPath('3.7.5')).toBe(path.join(dir, 'bin', 'libgcits-3.7.5-64.dll'));
    expect(storage.getExtractedClientVersions()).toEqual(['3.7.5']);
  });
});

describe('VersionManager.downloadAndExtractClient on Linux', () => {
  /**
   * A stand-in for unzip: writes the GemStoneClientLibs layout into the -d
   * folder, for `version` or else the one the folder is named for.
   */
  function fakeUnzip(code: number, version?: string): void {
    vi.mocked(spawn).mockImplementation((cmd: string, args: readonly string[]) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => true,
      });
      if (cmd === 'unzip' && code === 0) {
        const dest = args[args.indexOf('-d') + 1];
        const v = version ?? /GemStoneClientLibs(.+)-x86_64\.Linux$/.exec(dest)![1];
        fs.mkdirSync(path.join(dest, v, '64bit'), { recursive: true });
        fs.writeFileSync(path.join(dest, v, '64bit', `libgcits-${v}-64.so`), '');
      }
      setImmediate(() => child.emit('close', cmd === 'unzip' ? code : 0));
      return child as unknown as ChildProcess;
    });
  }

  function setUp(version = '3.7.4.3') {
    const manager = new VersionManager(new SysadminStorage());
    const zipPath = path.join(tmpDir, `GemStoneClientLibs${version}-x86_64.Linux.zip`);
    const clientDir = path.join(tmpDir, `GemStoneClientLibs${version}-x86_64.Linux`);
    const download = vi
      .spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile')
      .mockImplementation(async () => fs.writeFileSync(zipPath, ''));
    const install = (token: unknown = noopToken) =>
      manager.downloadAndExtractClient(
        version,
        { report: vi.fn() },
        token as vscode.CancellationToken,
      );
    return { manager, zipPath, clientDir, download, install };
  }

  /** An unzip that never finishes on its own; cancelling the token kills it. */
  function hangingUnzip(onStart: () => void): void {
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => {
          setImmediate(() => child.emit('close', null));
          return true;
        },
      });
      onStart();
      return child as unknown as ChildProcess;
    });
  }

  it('downloads the client package, unpacks it into its own folder and drops the zip', async () => {
    const { zipPath, clientDir, download, install } = setUp();
    fakeUnzip(0);

    await install();

    expect(download).toHaveBeenCalledWith(
      'https://downloads.gemtalksystems.com/pub/GemStone64/3.7.4.3/GemStoneClientLibs3.7.4.3-x86_64.Linux.zip',
      zipPath,
      expect.anything(),
      noopToken,
    );
    expect(spawn).toHaveBeenCalledWith('unzip', ['-o', zipPath, '-d', clientDir]);
    expect(fs.existsSync(zipPath)).toBe(false);
    expect(new SysadminStorage().getClientGciPath('3.7.4.3')).toBe(
      path.join(clientDir, '3.7.4.3', '64bit', 'libgcits-3.7.4.3-64.so'),
    );
  });

  it('downloads again over an earlier, read-only copy', async () => {
    const { clientDir, install } = setUp();
    createClientLibs('3.7.4.3');
    lockDown(path.join(clientDir, '3.7.4.3'));
    fakeUnzip(0);
    // A real unzip -o cannot replace a file in a read-only folder.
    const realSpawn = vi.mocked(spawn).getMockImplementation() as unknown as (
      cmd: string,
      args: readonly string[],
    ) => ChildProcess;
    vi.mocked(spawn).mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd === 'unzip') {
        fs.accessSync(path.join(clientDir, '3.7.4.3', '64bit'), fs.constants.W_OK);
      }
      return realSpawn(cmd, args);
    });

    await install();

    expect(new SysadminStorage().getClientGciPath('3.7.4.3')).toBeDefined();
  });

  it('leaves a full install of the same version alone', async () => {
    const product = createProduct('3.7.4.3');
    const { install } = setUp();
    fakeUnzip(0);

    await install();

    expect(fs.existsSync(path.join(product, 'lib', 'libgcits-3.7.4.3-64.so'))).toBe(true);
  });

  it('on 404, says no small download exists and points at the full install', async () => {
    const { install, download } = setUp('3.6.2');
    download.mockRejectedValue(new Error('HTTP 404 downloading x'));

    await expect(install()).rejects.toThrow(
      'GemTalk has not published a client-only download of GemStone 3.6.2 for x86_64.Linux. ' +
        'Install the full version from the GemStone manager (Install Version…) instead.',
    );
  });

  it('on a failed unpack, removes a partial folder even when it is read-only', async () => {
    const { clientDir, install } = setUp();
    vi.mocked(spawn).mockImplementation(() => {
      createClientLibs('3.7.4.3');
      lockDown(path.join(clientDir, '3.7.4.3'));
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => true,
      });
      setImmediate(() => child.emit('close', 9));
      return child as unknown as ChildProcess;
    });

    await expect(install()).rejects.toThrow(/unzip failed with exit code 9/);

    expect(fs.existsSync(clientDir)).toBe(false);
  });

  it('on a failed unpack, removes the partial folder and the zip', async () => {
    const { zipPath, clientDir, install } = setUp();
    fakeUnzip(9);

    await expect(install()).rejects.toThrow(/unzip failed with exit code 9/);

    expect(fs.existsSync(clientDir)).toBe(false);
    expect(fs.existsSync(zipPath)).toBe(false);
  });

  it('fails, and cleans up, when the package held no library for the version', async () => {
    const { clientDir, install } = setUp('3.7.5');
    fakeUnzip(0, '3.7.4.3'); // unpacks some other version's files

    await expect(install()).rejects.toThrow(/held no libgcits-3\.7\.5-64\.so/);

    expect(fs.existsSync(clientDir)).toBe(false);
  });

  // Windows ignores the mode, and root reads any folder, so neither can make one unreadable.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'drops the zip even when an earlier copy cannot be opened up',
    async () => {
      const { zipPath, clientDir, install } = setUp();
      createClientLibs('3.7.4.3');
      // A folder that cannot be listed: opening up the copy fails partway.
      const unreadable = path.join(clientDir, 'unreadable');
      fs.mkdirSync(unreadable, { mode: 0o300 });
      fakeUnzip(0);

      try {
        await expect(install()).rejects.toThrow('EACCES');
      } finally {
        fs.chmodSync(unreadable, 0o700);
      }

      expect(fs.existsSync(zipPath)).toBe(false);
    },
  );

  it('keeps the unpack’s own failure in the message when the partial folder cannot be removed', async () => {
    const { clientDir, install } = setUp();
    vi.mocked(spawn).mockImplementation(() => {
      fs.mkdirSync(clientDir);
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => true,
      });
      setImmediate(() => child.emit('close', 9));
      return child as unknown as ChildProcess;
    });
    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockRejectedValueOnce(
        Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }),
      );

    try {
      await expect(install()).rejects.toThrow(
        'Downloading the files for GemStone 3.7.4.3 failed (unzip failed with exit code 9), and ' +
          `the partly unpacked files at ${clientDir} could not be removed (EBUSY: resource busy ` +
          'or locked). Remove that folder before installing again.',
      );
    } finally {
      rm.mockRestore();
    }
  });

  it('on cancel, says the partly unpacked files were removed', async () => {
    const { clientDir, install } = setUp();
    const source = new CancellationTokenSource();
    hangingUnzip(() => setImmediate(() => source.cancel()));

    const error = await install(source.token).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InstallCancelledError);
    expect((error as Error).message).toBe(
      'Downloading the files for GemStone 3.7.4.3 cancelled. The partly unpacked files were removed.',
    );
    expect(fs.existsSync(clientDir)).toBe(false);
  });

  it('on cancel over an earlier copy, keeps it and says so', async () => {
    const { clientDir, install } = setUp();
    createClientLibs('3.7.4.3');
    const source = new CancellationTokenSource();
    hangingUnzip(() => setImmediate(() => source.cancel()));

    const error = await install(source.token).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InstallCancelledError);
    expect((error as Error).message).toBe(
      `Downloading the files for GemStone 3.7.4.3 cancelled. ${clientDir} was there before, so ` +
        'it was not removed; the unpack may have replaced some of its files.',
    );
    expect(fs.existsSync(clientDir)).toBe(true);
  });

  it('rejects an empty version', async () => {
    const { install } = setUp('');
    await expect(install()).rejects.toThrow(/no GemStone version/);
  });

  describe('a second call while one for the version is running', () => {
    /** Holds the first download open until `release`, so a second call lands mid-run. */
    function setUpOverlap() {
      const first = setUp();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      first.download.mockImplementation(async () => {
        await gate;
        fs.writeFileSync(first.zipPath, '');
      });
      // Another manager over the same folder, as the login page and the manager command hold.
      const other = new VersionManager(new SysadminStorage());
      const otherDownload = vi.spyOn(other as unknown as PrivateDownloadHost, 'downloadFile');
      const otherProgress = { report: vi.fn() };
      const join = () => other.downloadAndExtractClient('3.7.4.3', otherProgress, noopToken);
      return { ...first, release, otherDownload, otherProgress, join };
    }

    it('joins it instead of downloading and unpacking again', async () => {
      const { zipPath, download, install, release, otherDownload, otherProgress, join } =
        setUpOverlap();
      fakeUnzip(0);

      const running = install();
      const joined = join();
      release();
      await Promise.all([running, joined]);

      expect(download).toHaveBeenCalledTimes(1);
      expect(otherDownload).not.toHaveBeenCalled();
      expect(vi.mocked(spawn).mock.calls.filter(([cmd]) => cmd === 'unzip')).toHaveLength(1);
      expect(otherProgress.report).toHaveBeenCalledWith({
        message: 'Waiting for the download of this version already running...',
      });
      expect(fs.existsSync(zipPath)).toBe(false);
      expect(new SysadminStorage().getClientGciPath('3.7.4.3')).toBeDefined();
    });

    it('shares its failure, and a call after it starts a fresh download', async () => {
      const { download, install, release, join } = setUpOverlap();
      fakeUnzip(9);

      const running = install();
      const joined = join();
      release();

      await expect(running).rejects.toThrow(/unzip failed with exit code 9/);
      await expect(joined).rejects.toThrow(/unzip failed with exit code 9/);
      fakeUnzip(0);
      await install();
      expect(download).toHaveBeenCalledTimes(2);
    });

    it('does not join a download of another version', async () => {
      const { install, release } = setUpOverlap();
      const other = setUp('3.7.5');
      fakeUnzip(0);

      const running = install();
      await other.install();
      release();
      await running;

      expect(other.download).toHaveBeenCalledTimes(1);
    });
  });
});

describe('VersionManager.fetchSupportedVersionNames', () => {
  it('names the catalog’s supported versions without reading the disk', async () => {
    const manager = new VersionManager(new SysadminStorage());
    vi.spyOn(manager, 'fetchCatalog').mockResolvedValue(
      ['3.5.0', '3.6.2', '3.7.6'].map((version) => ({
        version,
        fileName: `GemStone64Bit${version}-x86_64.Linux.zip`,
        url: '',
        date: '',
        size: 0,
      })),
    );
    const scan = vi.spyOn(SysadminStorage.prototype, 'getExtractedVersionInfos');

    expect(await manager.fetchSupportedVersionNames()).toEqual(['3.6.2', '3.7.6']);
    expect(scan).not.toHaveBeenCalled();
  });
});

describe('VersionManager.deleteClientExtracted', () => {
  it('removes client files unpacked read-only, as GemTalk ships them', async () => {
    const client = createClientLibs('3.7.5');
    lockDown(path.join(client, '3.7.5'));

    await new VersionManager(new SysadminStorage()).deleteClientExtracted(versionRow('3.7.5'));

    expect(fs.existsSync(client)).toBe(false);
  });

  it('removes the client files and leaves a full install of the same version', async () => {
    const client = createClientLibs('3.7.5');
    const product = createProduct('3.7.5');

    await new VersionManager(new SysadminStorage()).deleteClientExtracted(versionRow('3.7.5'));

    expect(fs.existsSync(client)).toBe(false);
    expect(fs.existsSync(product)).toBe(true);
  });

  it('removing the full install leaves the client files', async () => {
    const client = createClientLibs('3.7.5');
    createProduct('3.7.5');

    await new VersionManager(new SysadminStorage()).deleteExtracted(versionRow('3.7.5'));

    expect(fs.existsSync(path.join(client, '3.7.5', '64bit', 'libgcits-3.7.5-64.so'))).toBe(true);
  });
});

describe('VersionManager.versionsFrom (client files)', () => {
  it('marks a Linux version that has client files', () => {
    createClientLibs('3.7.5');
    const manager = new VersionManager(new SysadminStorage());
    const catalog = [
      { version: '3.7.5', fileName: 'f', url: 'u', date: 'd', size: 1 },
      { version: '3.7.4', fileName: 'f', url: 'u', date: 'd', size: 1 },
    ];
    const rows = manager.versionsFrom(catalog);
    expect(rows.find((v) => v.version === '3.7.5')?.clientExtracted).toBe(true);
    expect(rows.find((v) => v.version === '3.7.4')?.clientExtracted).toBe(false);
  });

  it('measures the client files rather than taking the catalog size, which is the full product', () => {
    const dir = createClientLibs('3.7.5');
    fs.writeFileSync(path.join(dir, '3.7.5', '64bit', 'libssl-3.7.5-64.so'), Buffer.alloc(1000));
    fs.writeFileSync(path.join(dir, 'README'), Buffer.alloc(24));
    const catalog = [{ version: '3.7.5', fileName: 'f', url: 'u', date: 'd', size: 472_000_000 }];
    const row = new VersionManager(new SysadminStorage()).versionsFrom(catalog)[0];
    expect(row.size).toBe(472_000_000);
    expect(row.clientSize).toBe(1024);
  });

  it('keeps a client-only version listed when the catalog is unreachable', () => {
    createClientLibs('3.7.5');
    const rows = new VersionManager(new SysadminStorage()).versionsFrom([]);
    expect(rows).toEqual([
      expect.objectContaining({ version: '3.7.5', clientExtracted: true, extracted: false }),
    ]);
  });
});

describe('VersionManager.downloadAndExtractClient on macOS', () => {
  const dmgPath = () => path.join(tmpDir, 'GemStoneClientLibs3.7.5-arm64.Darwin.dmg');
  const clientDir = () => path.join(tmpDir, 'GemStoneClientLibs3.7.5-arm64.Darwin');
  const mountPoint = '/Volumes/GemStoneClientLibs3.7.5-arm64.Darwin';

  /** Downloads 3.7.5 from a mounted image holding one 3.7.5 folder; returns the commands run. */
  async function downloadFromImage(): Promise<[string, readonly string[]][]> {
    onPlatform('darwin', 'arm64');
    const manager = new VersionManager(new SysadminStorage());
    vi.spyOn(manager as unknown as PrivateDownloadHost, 'downloadFile').mockImplementation(
      async () => fs.writeFileSync(dmgPath(), ''),
    );
    const realReaddir = fs.promises.readdir;
    const readdir = vi.spyOn(fs.promises, 'readdir').mockImplementation(((
      p: fs.PathLike,
      opts?: unknown,
    ) =>
      String(p) === mountPoint
        ? Promise.resolve(['.fseventsd', '3.7.5'])
        : // path.join gives backslashes on Windows; the mount point is a POSIX path.
          path.normalize(String(p)).startsWith(path.normalize(mountPoint))
          ? Promise.resolve([])
          : realReaddir(p, opts as never)) as typeof fs.promises.readdir);
    const calls: [string, readonly string[]][] = [];
    vi.mocked(spawn).mockImplementation((cmd: string, args: readonly string[]) => {
      calls.push([cmd, args]);
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: () => true,
      });
      if (cmd === 'hdiutil' && args[0] === 'attach') {
        setImmediate(() =>
          child.stdout.emit(
            'data',
            Buffer.from(`<key>mount-point</key><string>${mountPoint}</string>\n`),
          ),
        );
      }
      if (cmd === 'cp') {
        // What the copy lands: the image's 3.7.5/64bit folder.
        fs.mkdirSync(path.join(clientDir(), '3.7.5', '64bit'), { recursive: true });
        fs.writeFileSync(path.join(clientDir(), '3.7.5', '64bit', 'libgcits-3.7.5-64.dylib'), '');
      }
      setTimeout(() => child.emit('close', 0), 5);
      return child as unknown as ChildProcess;
    });

    try {
      await manager.downloadAndExtractClient('3.7.5', { report: vi.fn() }, noopToken);
    } finally {
      readdir.mockRestore();
    }
    return calls;
  }

  it('copies the disk image’s contents, not its hidden volume files, into the client folder', async () => {
    const calls = await downloadFromImage();

    expect(calls.filter(([cmd]) => cmd === 'cp')).toEqual([
      ['cp', ['-Rv', `${path.join(mountPoint, '3.7.5')}/.`, path.join(clientDir(), '3.7.5')]],
    ]);
    expect(calls.map(([cmd, args]) => `${cmd} ${args[0]}`)).toContain('hdiutil detach');
    expect(fs.existsSync(dmgPath())).toBe(false);
    expect(new SysadminStorage().getClientGciPath('3.7.5')).toBe(
      path.join(clientDir(), '3.7.5', '64bit', 'libgcits-3.7.5-64.dylib'),
    );
  });

  it('downloads again over an earlier copy by copying into its folder, not inside it', async () => {
    const earlier = path.join(clientDir(), '3.7.5', '64bit');
    fs.mkdirSync(earlier, { recursive: true });
    fs.writeFileSync(path.join(earlier, 'libgcits-3.7.5-64.dylib'), 'stale');

    const calls = await downloadFromImage();

    // Copying the folder itself onto an existing one would land at 3.7.5/3.7.5.
    const [, args] = calls.find(([cmd]) => cmd === 'cp')!;
    expect(args[1]).toBe(`${path.join(mountPoint, '3.7.5')}/.`);
    expect(args[2]).toBe(path.join(clientDir(), '3.7.5'));
  });
});
