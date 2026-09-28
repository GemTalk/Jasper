import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
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

import * as vscode from 'vscode';
import { __resetConfig, __setConfig } from '../../__mocks__/vscode';
import { SysadminStorage } from '../../sysadminStorage';
import { InstallCancelledError, VersionManager } from '../versionManager';
import {
  ExtractFixture,
  buildDmg,
  buildZip,
  cancelSource,
  fakeCommand,
  fakePids,
  isAlive,
  makeFixture,
  partialTree,
  progressLog,
  tearDown,
  until,
  which,
} from './extractFixture';

// The native legs, run for real: unzip and python3 on Linux, hdiutil and cp on
// macOS. A fake command on PATH stands in where a test needs one slow, stuck or
// failing. The Windows leg goes through WSL and is in versionExtractWsl.test.ts.

const realUnzip = which('unzip');
const realPython = which('python3');

let f: ExtractFixture;
let manager: VersionManager;

function setUp(ext: 'zip' | 'dmg'): void {
  __resetConfig();
  vi.mocked(vscode.window.showWarningMessage).mockClear();
  f = makeFixture(new SysadminStorage().getPlatformSuffix(), ext);
  manager = new VersionManager(new SysadminStorage());
}

/** Start an unpack the teardown knows about, so a test that fails early leaves nothing running. */
function extract(source = cancelSource(), progress = progressLog().progress): Promise<void> {
  const done = manager.extract(f.version, progress, source.token);
  f.inFlight.push({ done, cancel: source.cancel });
  return done;
}

/** The archive's entry count by unzip's own reckoning, to check Jasper's against. */
function entriesInZip(): number {
  return execFileSync(realUnzip!, ['-Z1', f.archivePath], { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean).length;
}

/** A PATH holding only the fake commands still needs the real chmod and rm for cleanup. */
function onlyFakesOnPath(...realTools: string[]): void {
  for (const tool of realTools) fs.symlinkSync(which(tool)!, path.join(f.binDir, tool));
  process.env.PATH = f.binDir;
}

describe.runIf(process.platform === 'linux' && realUnzip && realPython)(
  'Unpacking a GemStone zip on Linux',
  () => {
    beforeEach(() => {
      setUp('zip');
      buildZip(f, realPython!);
    });

    afterEach(() => tearDown(f));

    it('unpacks the tree, keeping the execute bit', async () => {
      await extract();

      expect(fs.readFileSync(path.join(f.productDir, 'doc', 'read me.txt'), 'utf-8')).toBe('hello');
      expect(fs.statSync(path.join(f.productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
    });

    it('counts files out of the archive’s total, and fills the bar to match', async () => {
      const total = entriesInZip();
      const { progress, messages, increments } = progressLog();

      await extract(undefined, progress);

      expect(messages).toContainEqual(
        expect.stringMatching(new RegExp(`^Unpacked \\d+ of ${total} files \\(\\d+%\\)`)),
      );
      expect(increments.length).toBeGreaterThan(0);
      expect(increments.every((i) => i >= 0)).toBe(true);
      expect(increments.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100);
    });

    it('finds the total when the zip carries a comment after its index', async () => {
      fs.rmSync(f.archivePath);
      buildZip(f, realPython!, 'x'.repeat(5000));
      const total = entriesInZip();
      const { progress, messages } = progressLog();

      await extract(undefined, progress);

      expect(messages).toContainEqual(expect.stringContaining(`of ${total} files`));
    });

    it('keeps the editor answering while unzip runs', async () => {
      // The whole of the bug: a synchronous unzip let no timer fire until it ended.
      fakeCommand(f, 'unzip', `sleep 0.5\nexec "${realUnzip}" "$@"`);
      let ticks = 0;
      const timer = setInterval(() => ticks++, 20);

      try {
        await extract();
      } finally {
        clearInterval(timer);
      }

      expect(ticks).toBeGreaterThanOrEqual(10);
      expect(fs.existsSync(path.join(f.productDir, 'bin', 'gem'))).toBe(true);
    });

    it('unpacks under a root path holding a space, a quote and a dollar sign', async () => {
      const oddRoot = path.join(f.tmpDir, `odd "root" $HOME`);
      fs.mkdirSync(oddRoot);
      fs.renameSync(f.archivePath, path.join(oddRoot, f.version.fileName));
      __setConfig('gemstone', 'rootPath', oddRoot);

      await extract();

      expect(fs.existsSync(path.join(oddRoot, path.basename(f.productDir), 'bin', 'gem'))).toBe(
        true,
      );
    });

    describe('when cancelled', () => {
      it('stops unzip, removes the partial tree, keeps the download and says so', async () => {
        fakeCommand(f, 'unzip', `${partialTree(f.productDir)}\nexec sleep 30`);
        const source = cancelSource();
        const started = Date.now();
        const extracting = extract(source);
        await until(() => fs.existsSync(path.join(f.productDir, 'ro', 'f')));

        source.cancel();
        const error = await extracting.catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InstallCancelledError);
        expect((error as Error).message).toBe(
          'Unpacking GemStone 3.7.5 cancelled. The partly unpacked files were removed; ' +
            'the download is kept.',
        );
        expect(Date.now() - started).toBeLessThan(10_000);
        expect(fakePids(f).filter(isAlive)).toEqual([]);
        expect(fs.existsSync(f.productDir)).toBe(false);
        expect(fs.existsSync(f.archivePath)).toBe(true);
      });

      it('starts nothing when cancelled before it begins', async () => {
        fakeCommand(f, 'unzip', partialTree(f.productDir));
        const source = cancelSource();
        source.cancel();

        await expect(extract(source)).rejects.toBeInstanceOf(InstallCancelledError);

        expect(fakePids(f)).toEqual([]);
        expect(fs.existsSync(f.productDir)).toBe(false);
      });
    });

    describe('when the unpack fails', () => {
      it('removes the partial tree, keeps the download, and passes on unzip’s own words', async () => {
        fakeCommand(f, 'unzip', `${partialTree(f.productDir)}\necho "disk full" >&2\nexit 9`);

        await expect(extract()).rejects.toThrow('unzip failed with exit code 9: disk full');

        expect(fs.existsSync(f.productDir)).toBe(false);
        expect(fs.existsSync(f.archivePath)).toBe(true);
      });

      it('removes the partial tree python3 left when standing in for a missing unzip', async () => {
        onlyFakesOnPath('chmod', 'rm', 'mkdir');
        fakeCommand(
          f,
          'python3',
          `${partialTree(f.productDir)}\necho "BadZipFile: File is not a zip file" >&2\nexit 1`,
        );

        await expect(extract()).rejects.toThrow(
          'python3 zipfile extract failed with exit code 1: BadZipFile: File is not a zip file',
        );

        expect(fs.existsSync(f.productDir)).toBe(false);
      });

      it('names the folder left behind, and why, when the partial tree cannot be removed', async () => {
        fakeCommand(f, 'unzip', `${partialTree(f.productDir)}\nexit 9`);
        fakeCommand(f, 'rm', 'echo "Permission denied" >&2\nexit 1');

        await expect(extract()).rejects.toThrow(
          'Unpacking failed (unzip failed with exit code 9), and the partly unpacked files at ' +
            `${f.productDir} could not be removed: Permission denied. ` +
            'Remove that folder before installing again.',
        );

        expect(fs.existsSync(f.productDir)).toBe(true);
      });

      it('leaves alone a product directory that was there before it started', async () => {
        fs.mkdirSync(f.productDir);
        fs.writeFileSync(path.join(f.productDir, 'mine'), '');
        fakeCommand(f, 'unzip', 'exit 9');

        await expect(extract()).rejects.toThrow(/exit code 9/);

        expect(fs.existsSync(path.join(f.productDir, 'mine'))).toBe(true);
      });
    });

    describe('without unzip', () => {
      it('unpacks with python3, keeping the execute bit', async () => {
        onlyFakesOnPath('python3');

        await extract();

        expect(fs.statSync(path.join(f.productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
      });

      it('says what to install when python3 is missing too', async () => {
        onlyFakesOnPath();

        await expect(extract()).rejects.toThrow(
          /Neither 'unzip' nor 'python3' is installed\. Install unzip/,
        );
      });
    });
  },
);

describe.runIf(process.platform === 'darwin')('Unpacking a GemStone disk image on macOS', () => {
  let volume: string;

  beforeEach(() => {
    setUp('dmg');
    volume = `JasperTest${process.pid}${Date.now()}`;
    buildDmg(f, volume);
  });

  afterEach(async () => {
    await tearDown(f);
    // Only if a test left it mounted; the point of these tests is that none does.
    try {
      execFileSync('hdiutil', ['detach', `/Volumes/${volume}`, '-force'], { stdio: 'ignore' });
    } catch {
      /* not mounted */
    }
  });

  it('copies the tree out, counting against its total, and ejects the image', async () => {
    const { progress, messages } = progressLog();

    await extract(undefined, progress);

    expect(fs.existsSync(path.join(f.productDir, 'bin', 'gem'))).toBe(true);
    expect(messages).toContainEqual(expect.stringMatching(/^Copied \d+ of \d+ files \(\d+%\)/));
    expect(fs.existsSync(`/Volumes/${volume}`)).toBe(false);
  });

  it('on cancel, stops the copy, removes the partial tree and ejects the image', async () => {
    // cp's arguments are -Rv SRC DEST.
    fakeCommand(f, 'cp', `${partialTree('$3')}\nexec sleep 30`);
    const source = cancelSource();
    const extracting = extract(source);
    await until(() => fs.existsSync(path.join(f.productDir, 'ro', 'f')));

    source.cancel();

    await expect(extracting).rejects.toBeInstanceOf(InstallCancelledError);
    expect(fakePids(f).filter(isAlive)).toEqual([]);
    expect(fs.existsSync(f.productDir)).toBe(false);
    expect(fs.existsSync(`/Volumes/${volume}`)).toBe(false);
    expect(fs.existsSync(f.archivePath)).toBe(true);
  });

  it('on a failed copy, removes the partial tree, ejects the image and passes on cp’s words', async () => {
    fakeCommand(f, 'cp', `${partialTree('$3')}\necho "No space left on device" >&2\nexit 1`);

    await expect(extract()).rejects.toThrow('cp failed with exit code 1: No space left on device');

    expect(fs.existsSync(f.productDir)).toBe(false);
    expect(fs.existsSync(`/Volumes/${volume}`)).toBe(false);
  });

  it('warns, naming the volume, when the image will not eject', async () => {
    fakeCommand(
      f,
      'hdiutil',
      'if [ "$1" = detach ]; then echo "resource busy" >&2; exit 16; fi\nexec /usr/bin/hdiutil "$@"',
    );

    await extract();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      `The GemStone disk image is still mounted at /Volumes/${volume}: resource busy. ` +
        'Eject it in Finder.',
    );
  });
});
