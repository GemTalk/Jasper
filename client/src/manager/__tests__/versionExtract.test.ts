import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../../wslBridge', () => ({
  isWindows: () => false,
  needsWsl: () => false,
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
  wslSpawn: vi.fn(),
}));

import { __setConfig, __resetConfig, CancellationTokenSource } from '../../__mocks__/vscode';
import type * as vscode from 'vscode';
import { SysadminStorage } from '../../sysadminStorage';
import { InstallCancelledError, VersionManager } from '../versionManager';
import { GemStoneVersion } from '../../sysadminTypes';

// These run the real unzip and python3 against a small archive built here, and
// stand in for unzip with a script on PATH where a test needs it slow, stuck or
// failing. The Linux leg only: macOS unpacks a disk image, Windows through WSL.
function which(cmd: string): string | undefined {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}
const realUnzip = which('unzip');
const realPython = which('python3');

const VERSION = '3.7.5';

let tmpDir: string;
let rootPath: string;
let binDir: string;
let savedPath: string | undefined;
let storage: SysadminStorage;
let manager: VersionManager;
let productDir: string;
let zipPath: string;

function version(): GemStoneVersion {
  return {
    version: VERSION,
    fileName: path.basename(zipPath),
    url: '',
    size: 0,
    date: '',
    downloaded: true,
    extracted: false,
  };
}

/** A few files shaped like a product tree: an executable, a read-only file and directory, a space. */
function buildArchive(): void {
  const name = path.basename(productDir);
  const src = path.join(tmpDir, 'src');
  fs.mkdirSync(path.join(src, name, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(src, name, 'doc'));
  fs.writeFileSync(path.join(src, name, 'bin', 'gem'), '#!/bin/sh\n');
  fs.chmodSync(path.join(src, name, 'bin', 'gem'), 0o755);
  fs.writeFileSync(path.join(src, name, 'doc', 'read me.txt'), 'hello');
  fs.chmodSync(path.join(src, name, 'doc', 'read me.txt'), 0o444);
  fs.chmodSync(path.join(src, name, 'doc'), 0o555);
  execFileSync(
    realPython!,
    [
      '-c',
      'import os,sys,zipfile\n' +
        'with zipfile.ZipFile(sys.argv[1],"w") as z:\n' +
        '  for d,ds,fs in os.walk(sys.argv[2]):\n' +
        '    for n in ds+fs:\n' +
        '      p=os.path.join(d,n); z.write(p,os.path.relpath(p,sys.argv[2]))\n',
      zipPath,
      src,
    ],
    { stdio: 'ignore' },
  );
  fs.chmodSync(path.join(src, name, 'doc'), 0o755);
}

/** Put a shell script named `cmd` first on PATH. Its arguments are unzip's: -o ZIP -d DEST. */
function fakeCommand(cmd: string, script: string): void {
  const file = path.join(binDir, cmd);
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(file, 0o755);
}

/** A script body that leaves a partly written product tree, with a read-only corner. */
const PARTIAL_TREE = (name: string) =>
  `mkdir -p "$4/${name}/ro" && echo x > "$4/${name}/ro/f" && chmod 555 "$4/${name}/ro"`;

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 25));
}

function progressLog(): { progress: vscode.Progress<{ message?: string }>; messages: string[] } {
  const messages: string[] = [];
  return { progress: { report: (v) => messages.push(v.message ?? '') }, messages };
}

/** The mock's token, typed as the real one: the only cast this file needs. */
function cancelSource(): { token: vscode.CancellationToken; cancel: () => void } {
  const source = new CancellationTokenSource();
  return {
    token: source.token as unknown as vscode.CancellationToken,
    cancel: () => source.cancel(),
  };
}

function removeAll(dir: string): void {
  if (fs.existsSync(dir)) execFileSync('chmod', ['-R', 'u+w', dir]);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe.runIf(process.platform === 'linux' && realUnzip && realPython)(
  'VersionManager.extract, the zip leg',
  () => {
    beforeEach(() => {
      __resetConfig();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-extract-'));
      rootPath = path.join(tmpDir, 'root');
      binDir = path.join(tmpDir, 'bin');
      fs.mkdirSync(rootPath);
      fs.mkdirSync(binDir);
      __setConfig('gemstone', 'rootPath', rootPath);
      storage = new SysadminStorage();
      manager = new VersionManager(storage);
      productDir = path.join(rootPath, `GemStone64Bit${VERSION}${storage.getPlatformSuffix()}`);
      zipPath = `${productDir}.zip`;
      buildArchive();
      savedPath = process.env.PATH;
      process.env.PATH = `${binDir}:${savedPath}`;
    });

    afterEach(() => {
      process.env.PATH = savedPath;
      removeAll(tmpDir);
    });

    it('unpacks the tree, keeping the execute bit, and counts files as they land', async () => {
      const { progress, messages } = progressLog();
      await manager.extract(version(), progress, cancelSource().token);

      expect(fs.readFileSync(path.join(productDir, 'doc', 'read me.txt'), 'utf-8')).toBe('hello');
      expect(fs.statSync(path.join(productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
      expect(messages.some((m) => /^Unpacked \d+ files/.test(m))).toBe(true);
    });

    it('keeps the editor answering while unzip runs', async () => {
      // The whole of the bug: a synchronous unzip let no timer fire until it ended.
      fakeCommand('unzip', `sleep 0.5\nexec "${realUnzip}" "$@"`);
      let ticks = 0;
      const timer = setInterval(() => ticks++, 20);
      try {
        await manager.extract(version(), progressLog().progress, cancelSource().token);
      } finally {
        clearInterval(timer);
      }
      expect(ticks).toBeGreaterThanOrEqual(10);
      expect(fs.existsSync(path.join(productDir, 'bin', 'gem'))).toBe(true);
    });

    it('on cancel, stops unzip, removes the partial tree and keeps the download', async () => {
      fakeCommand('unzip', `${PARTIAL_TREE(path.basename(productDir))}\nexec sleep 30`);
      const source = cancelSource();
      const started = Date.now();
      const extracting = manager.extract(version(), progressLog().progress, source.token);
      await until(() => fs.existsSync(path.join(productDir, 'ro', 'f')));
      source.cancel();

      const error = await extracting.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InstallCancelledError);
      expect((error as Error).message).toMatch(
        /Unpacking GemStone 3\.7\.5 cancelled\. The partly unpacked files were removed; the download is kept\./,
      );
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(fs.existsSync(productDir)).toBe(false);
      expect(fs.existsSync(zipPath)).toBe(true);
    });

    it('on failure, removes the partial tree and reports unzip’s own words', async () => {
      fakeCommand(
        'unzip',
        `${PARTIAL_TREE(path.basename(productDir))}\necho "disk full" >&2\nexit 9`,
      );
      await expect(
        manager.extract(version(), progressLog().progress, cancelSource().token),
      ).rejects.toThrow('unzip failed with exit code 9: disk full');
      expect(fs.existsSync(productDir)).toBe(false);
      expect(fs.existsSync(zipPath)).toBe(true);
    });

    it('leaves alone a product directory that was there before it started', async () => {
      fs.mkdirSync(productDir);
      fs.writeFileSync(path.join(productDir, 'mine'), '');
      fakeCommand('unzip', 'exit 9');
      await expect(
        manager.extract(version(), progressLog().progress, cancelSource().token),
      ).rejects.toThrow(/exit code 9/);
      expect(fs.existsSync(path.join(productDir, 'mine'))).toBe(true);
    });

    it('falls back to python3 when unzip is not installed', async () => {
      process.env.PATH = binDir;
      fs.symlinkSync(realPython!, path.join(binDir, 'python3'));
      await manager.extract(version(), progressLog().progress, cancelSource().token);
      expect(fs.statSync(path.join(productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
    });

    it('says what to install when neither unzip nor python3 is there', async () => {
      process.env.PATH = binDir;
      await expect(
        manager.extract(version(), progressLog().progress, cancelSource().token),
      ).rejects.toThrow(/Neither 'unzip' nor 'python3' is installed\. Install unzip/);
    });

    it('unpacks under a root path holding a space, a quote and a dollar sign', async () => {
      const oddRoot = path.join(tmpDir, `odd "root" $HOME`);
      fs.mkdirSync(oddRoot);
      __setConfig('gemstone', 'rootPath', oddRoot);
      const oddZip = path.join(oddRoot, path.basename(zipPath));
      fs.renameSync(zipPath, oddZip);
      await manager.extract(version(), progressLog().progress, cancelSource().token);
      expect(fs.existsSync(path.join(oddRoot, path.basename(productDir), 'bin', 'gem'))).toBe(true);
    });
  },
);

describe.runIf(process.platform === 'darwin')('VersionManager.extract, the disk-image leg', () => {
  let volume: string;

  beforeEach(() => {
    __resetConfig();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-extract-'));
    rootPath = path.join(tmpDir, 'root');
    binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(rootPath);
    fs.mkdirSync(binDir);
    __setConfig('gemstone', 'rootPath', rootPath);
    storage = new SysadminStorage();
    manager = new VersionManager(storage);
    productDir = path.join(rootPath, `GemStone64Bit${VERSION}${storage.getPlatformSuffix()}`);
    zipPath = `${productDir}.dmg`;
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(path.join(src, path.basename(productDir), 'bin'), { recursive: true });
    fs.writeFileSync(path.join(src, path.basename(productDir), 'bin', 'gem'), '#!/bin/sh\n');
    volume = `JasperTest${process.pid}${Date.now()}`;
    execFileSync('hdiutil', ['create', '-srcfolder', src, '-volname', volume, '-ov', zipPath], {
      stdio: 'ignore',
    });
    savedPath = process.env.PATH;
    process.env.PATH = `${binDir}:${savedPath}`;
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    // Only if a test left it mounted; the point of these tests is that it does not.
    try {
      execFileSync('hdiutil', ['detach', `/Volumes/${volume}`, '-force'], { stdio: 'ignore' });
    } catch {
      /* not mounted */
    }
    removeAll(tmpDir);
  });

  it('copies the tree out and ejects the image', async () => {
    await manager.extract(version(), progressLog().progress, cancelSource().token);
    expect(fs.existsSync(path.join(productDir, 'bin', 'gem'))).toBe(true);
    expect(fs.existsSync(`/Volumes/${volume}`)).toBe(false);
  });

  it('on cancel, stops the copy, removes the partial tree and ejects the image', async () => {
    // cp's arguments are -Rv SRC DEST.
    fakeCommand('cp', `mkdir -p "$3/ro" && echo x > "$3/ro/f" && chmod 555 "$3/ro"\nexec sleep 30`);
    const source = cancelSource();
    const extracting = manager.extract(version(), progressLog().progress, source.token);
    await until(() => fs.existsSync(path.join(productDir, 'ro', 'f')));
    source.cancel();

    await expect(extracting).rejects.toBeInstanceOf(InstallCancelledError);
    expect(fs.existsSync(productDir)).toBe(false);
    expect(fs.existsSync(`/Volumes/${volume}`)).toBe(false);
    expect(fs.existsSync(zipPath)).toBe(true);
  });
});
