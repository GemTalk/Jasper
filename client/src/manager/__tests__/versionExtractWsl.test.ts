import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../../wslBridge', () => ({
  isWindows: () => true,
  needsWsl: () => true,
  getWslInfo: () => ({ available: true }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
  wslSpawn: vi.fn(),
}));

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

// On Windows, Jasper's GemStone lives in WSL and every unpack command goes
// through `wsl.exe -e env <cmd> <args>`. The stand-ins below run the same
// `env <cmd> <args>` on this Linux host, so the commands are real and only
// wsl.exe is missing; the paths are Linux paths, as WSL's are. `sh` is given
// by its full path because WSL always has one, even where a test has emptied
// PATH to hide unzip or python3.

function linuxSide(cmd: string, args: string[]): ChildProcess {
  return spawn('/usr/bin/env', [cmd === 'sh' ? '/bin/sh' : cmd, ...args]);
}

/** A wsl.exe whose death does not reach the Linux process it started — the case Jasper must handle. */
function wslExeThatLeavesItsChild(cmd: string, args: string[]): ChildProcess {
  const linux = linuxSide(cmd, args);
  const wslExe = Object.assign(new EventEmitter(), {
    stdout: linux.stdout,
    stderr: linux.stderr,
    kill: () => {
      setTimeout(() => wslExe.emit('close', null), 10);
      return true;
    },
  });
  linux.on('close', (code) => wslExe.emit('close', code));
  linux.on('error', (err) => wslExe.emit('error', err));
  return wslExe as unknown as ChildProcess;
}

/** The commands run inside WSL, as they reached the Linux side of the pid wrapper. */
function commandsInWsl(): string[][] {
  return vi.mocked(wslSpawn).mock.calls.map(([, args]) => args.slice(3));
}

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
      vi.mocked(wslSpawn).mockReset();
      vi.mocked(wslSpawn).mockImplementation(linuxSide);
      f = makeFixture(new SysadminStorage().getPlatformSuffix(), 'zip');
      manager = new VersionManager(new SysadminStorage());
      buildZip(f, realPython!);
    });

    afterEach(() => tearDown(f));

    it('runs unzip inside WSL, on WSL paths, and unpacks the tree', async () => {
      await extract();

      expect(commandsInWsl()).toContainEqual(['unzip', '-o', f.archivePath, '-d', f.rootPath]);
      expect(fs.statSync(path.join(f.productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
    });

    it('unpacks with python3 when the distro has no unzip', async () => {
      onlyFakesOnPath('python3');

      await extract();

      expect(commandsInWsl().some(([cmd]) => cmd === 'python3')).toBe(true);
      expect(fs.statSync(path.join(f.productDir, 'bin', 'gem')).mode & 0o111).not.toBe(0);
    });

    it('says how to install unzip in WSL when the distro has neither', async () => {
      onlyFakesOnPath();

      await expect(extract()).rejects.toThrow(
        "Neither 'unzip' nor 'python3' is available in your WSL distro. " +
          'Install one with: wsl -e sudo apt-get install -y unzip',
      );
    });

    it('says wsl.exe itself is missing, rather than blaming the distro', async () => {
      vi.mocked(wslSpawn).mockImplementation(() => {
        const child = Object.assign(new EventEmitter(), {
          stdout: null,
          stderr: null,
          kill: () => true,
        });
        setImmediate(() =>
          child.emit('error', Object.assign(new Error('spawn wsl.exe ENOENT'), { code: 'ENOENT' })),
        );
        return child as unknown as ChildProcess;
      });

      await expect(extract()).rejects.toThrow('spawn wsl.exe ENOENT');
    });

    describe('when cancelled', () => {
      it('stops unzip and removes the partial tree from inside WSL', async () => {
        fakeCommand(f, 'unzip', `${partialTree(f.productDir)}\nexec sleep 30`);
        const source = cancelSource();
        const extracting = extract(source);
        await until(() => fs.existsSync(path.join(f.productDir, 'ro', 'f')));

        source.cancel();

        await expect(extracting).rejects.toBeInstanceOf(InstallCancelledError);
        expect(fakePids(f).filter(isAlive)).toEqual([]);
        expect(commandsInWsl()).toContainEqual(['chmod', '-R', 'u+w', f.productDir]);
        expect(commandsInWsl()).toContainEqual(['rm', '-rf', f.productDir]);
        expect(fs.existsSync(f.productDir)).toBe(false);
        expect(fs.existsSync(f.archivePath)).toBe(true);
      });

      it('stops the Linux unpacker itself when killing wsl.exe does not', async () => {
        vi.mocked(wslSpawn).mockImplementation(wslExeThatLeavesItsChild);
        // Left running, this rebuilds the tree after cleanup has removed it.
        fakeCommand(
          f,
          'unzip',
          `${partialTree(f.productDir)}\n` +
            `while :; do mkdir -p "${f.productDir}" && echo x >> "${f.productDir}/late"; sleep 0.05; done`,
        );
        const source = cancelSource();
        const extracting = extract(source);
        await until(() => fs.existsSync(path.join(f.productDir, 'ro', 'f')));

        source.cancel();
        await expect(extracting).rejects.toBeInstanceOf(InstallCancelledError);
        await new Promise((r) => setTimeout(r, 300));

        expect(fakePids(f).filter(isAlive)).toEqual([]);
        expect(fs.existsSync(f.productDir)).toBe(false);
      });
    });

    it('on a failed unpack, removes the partial tree and keeps the download', async () => {
      fakeCommand(f, 'unzip', `${partialTree(f.productDir)}\necho "disk full" >&2\nexit 9`);

      await expect(extract()).rejects.toThrow('unzip failed with exit code 9: disk full');

      expect(fs.existsSync(f.productDir)).toBe(false);
      expect(fs.existsSync(f.archivePath)).toBe(true);
    });

    it('on a cancelled download, stops curl inside WSL and removes the partial file', async () => {
      vi.mocked(wslSpawn).mockImplementation(wslExeThatLeavesItsChild);
      const target = path.join(f.rootPath, 'GemStone64Bit3.7.6-x86_64.Linux.zip');
      // curl's arguments are -L -o TARGET -# URL; left running, it writes on.
      fakeCommand(f, 'curl', 'while :; do echo more >> "$3"; sleep 0.05; done');
      const source = cancelSource();
      const downloading = manager.download(
        { ...f.version, version: '3.7.6', fileName: path.basename(target) },
        progressLog().progress,
        source.token,
      );
      f.inFlight.push({ done: downloading, cancel: source.cancel });
      await until(() => fs.existsSync(target));

      source.cancel();
      const error = await downloading.catch((e: unknown) => e);
      await new Promise((r) => setTimeout(r, 300));

      expect(error).toBeInstanceOf(InstallCancelledError);
      expect((error as Error).message).toBe(
        'Download cancelled. The partly downloaded file was removed.',
      );
      expect(fakePids(f).filter(isAlive)).toEqual([]);
      expect(fs.existsSync(target)).toBe(false);
    });
  },
);
