import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
// On Windows, Jasper's GemStone lives in WSL and every unpack command goes
// through `wsl.exe -e env <cmd> <args>`. Here the stand-in runs the same
// `/usr/bin/env <cmd> <args>` on this Linux host, so the commands are real — only
// wsl.exe itself is missing. The paths are Linux paths, as WSL's are.
vi.mock('../../wslBridge', async () => {
  const { spawn } = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    isWindows: () => true,
    needsWsl: () => true,
    getWslInfo: () => ({ available: true }),
    wslPathToWindows: (p: string) => p,
    windowsPathToWsl: (p: string) => p,
    wslExecSync: vi.fn(),
    wslSpawn: vi.fn((cmd: string, args: string[]) => spawn('/usr/bin/env', [cmd, ...args])),
  };
});

import { __resetConfig } from '../../__mocks__/vscode';
import { SysadminStorage } from '../../sysadminStorage';
import { wslSpawn } from '../../wslBridge';
import { InstallCancelledError, VersionManager } from '../versionManager';
import {
  ExtractFixture,
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

const realUnzip = which('unzip');
const realPython = which('python3');

let f: ExtractFixture;
let manager: VersionManager;

function extract(source = cancelSource()): Promise<void> {
  const done = manager.extract(f.version, progressLog().progress, source.token);
  f.inFlight.push({ done, cancel: source.cancel });
  return done;
}

function onlyFakesOnPath(...realTools: string[]): void {
  for (const tool of realTools) fs.symlinkSync(which(tool)!, path.join(f.binDir, tool));
  process.env.PATH = f.binDir;
}

describe.runIf(process.platform === 'linux' && realUnzip && realPython)(
  'Unpacking a GemStone zip into WSL, for Windows',
  () => {
    beforeEach(() => {
      __resetConfig();
      vi.mocked(wslSpawn).mockClear();
      f = makeFixture(new SysadminStorage().getPlatformSuffix(), 'zip');
      manager = new VersionManager(new SysadminStorage());
      buildZip(f, realPython!);
    });

    afterEach(() => tearDown(f));

    it('runs unzip inside WSL, on WSL paths, and unpacks the tree', async () => {
      await extract();

      expect(wslSpawn).toHaveBeenCalledWith('unzip', ['-o', f.archivePath, '-d', f.rootPath]);
      expect(fs.statSync(path.join(f.productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
    });

    it('unpacks with python3 when the distro has no unzip', async () => {
      onlyFakesOnPath('python3');

      await extract();

      expect(wslSpawn).toHaveBeenCalledWith('python3', expect.arrayContaining([f.archivePath]));
      expect(fs.statSync(path.join(f.productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
    });

    it('says how to install unzip in WSL when the distro has neither', async () => {
      onlyFakesOnPath();

      await expect(extract()).rejects.toThrow(
        "Neither 'unzip' nor 'python3' is available in your WSL distro. " +
          'Install one with: wsl -e sudo apt-get install -y unzip',
      );
    });

    it('on cancel, stops unzip and removes the partial tree from inside WSL', async () => {
      fakeCommand(f, 'unzip', `${partialTree(f.productDir)}\nexec sleep 30`);
      const source = cancelSource();
      const extracting = extract(source);
      await until(() => fs.existsSync(path.join(f.productDir, 'ro', 'f')));

      source.cancel();

      await expect(extracting).rejects.toBeInstanceOf(InstallCancelledError);
      expect(fakePids(f).filter(isAlive)).toEqual([]);
      expect(wslSpawn).toHaveBeenCalledWith('chmod', ['-R', 'u+w', f.productDir]);
      expect(wslSpawn).toHaveBeenCalledWith('rm', ['-rf', f.productDir]);
      expect(fs.existsSync(f.productDir)).toBe(false);
      expect(fs.existsSync(f.archivePath)).toBe(true);
    });

    it('on a failed unpack, removes the partial tree and keeps the download', async () => {
      fakeCommand(f, 'unzip', `${partialTree(f.productDir)}\necho "disk full" >&2\nexit 9`);

      await expect(extract()).rejects.toThrow('unzip failed with exit code 9: disk full');

      expect(fs.existsSync(f.productDir)).toBe(false);
      expect(fs.existsSync(f.archivePath)).toBe(true);
    });
  },
);
