import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('child_process');
vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../../wslBridge', async () => {
  // Keep wslSpawn / windowsPathToWsl real so the existing startStone tests
  // continue to drive the child_process mock; only override wslExecSync and
  // needsWsl, which the new stale-lock tests need to control.
  const actual = await vi.importActual<typeof import('../../wslBridge')>('../../wslBridge');
  return {
    ...actual,
    needsWsl: vi.fn(() => false),
    wslExecSync: vi.fn(),
  };
});

import * as vscode from 'vscode';
import { spawn, type SpawnOptions } from 'child_process';
import {
  ProcessManager,
  parseGslist,
  classifyPidOwnership,
  versionsMatch,
  exportCommand,
} from '../processManager';
import { GemStoneDatabase, GemStoneProcess } from '../../sysadminTypes';
import { DEFAULT_GS_PW } from '../../loginTypes';
import { appendSysadmin, showSysadmin } from '../../sysadminChannel';
import * as wslBridge from '../../wslBridge';
import { SysadminStorage } from '../../sysadminStorage';

// ── Helpers ────────────────────────────────────────────────

function makeDatabase(overrides: Partial<GemStoneDatabase> = {}): GemStoneDatabase {
  return {
    dirName: 'db-1',
    path: '/home/user/gemstone/db-1',
    config: {
      version: '3.7.4',
      stoneName: 'gs64stone',
      ldiName: 'gs64ldi',
      baseExtent: 'extent0.dbf',
    },
    ...overrides,
  };
}

function rawStorage(gsPath = '/gs/3.7.4') {
  return {
    getRootPath: vi.fn(() => '/home/user/gemstone'),
    getGemstonePath: vi.fn(() => gsPath),
    getExtractedVersions: vi.fn(() => ['3.7.4']),
  };
}

function makeStorage(gsPath = '/gs/3.7.4'): SysadminStorage {
  return rawStorage(gsPath) as unknown as SysadminStorage;
}

/** Storage for the needsWsl() === true branches, which reach for the WSL-side
 *  accessors rather than the host-native ones. */
function makeWslStorage(gsPath = '/gs/3.7.4'): SysadminStorage {
  return {
    ...rawStorage(gsPath),
    getWslRootPath: vi.fn(() => '/home/user/gemstone'),
    getWslGemstonePath: vi.fn(() => gsPath),
  } as unknown as SysadminStorage;
}

/** Create a mock ChildProcess that emits 'close' with the given exit code. */
// `signal` models a process killed by a signal, which Node reports as a null
// exit code plus the signal name — what macOS jetsam does under memory
// pressure, and what the OS does to an unsigned/quarantined binary.
function makeChildProcess(exitCode: number | null = 0, signal: string | null = null) {
  const stdoutListeners: Array<(data: Buffer) => void> = [];
  const stderrListeners: Array<(data: Buffer) => void> = [];
  let closeCallback: ((code: number | null, signal: string | null) => void) | undefined;

  const proc = {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stdoutListeners.push(cb);
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stderrListeners.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: (code: number | null, signal: string | null) => void) => {
      if (event === 'close') closeCallback = cb;
    }),
    // Call this to simulate the process writing to stderr, which is where the
    // GemStone shell scripts put their complaints.
    emitStderr(text: string) {
      for (const listener of stderrListeners) listener(Buffer.from(text));
    },
    // Call this to simulate the process finishing
    finish() {
      closeCallback?.(exitCode, signal);
    },
  };
  return proc;
}

/** Point the mocked spawn() at a fake ChildProcess, keeping the cast in one place. */
function mockSpawnReturn(proc: ReturnType<typeof makeChildProcess>) {
  vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
}

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** The binary and argv a spawn call really asked for, past the `/bin/bash -c
 *  'ulimit …' --` wrapper wslSpawn adds on Linux. Lets a test say which GemStone
 *  script ran without also encoding how the wrapping works. */
function spawnedCommand(callIndex = 0): { cmd: string; args: string[] } {
  const [cmd, args] = vi.mocked(spawn).mock.calls[callIndex];
  const argv = (args ?? []) as string[];
  const sentinel = argv.indexOf('--');
  if (cmd === '/bin/bash' && sentinel !== -1) {
    return { cmd: argv[sentinel + 1], args: argv.slice(sentinel + 2) };
  }
  return { cmd, args: argv };
}

function staleStone(overrides: Partial<GemStoneProcess> = {}): GemStoneProcess {
  return {
    type: 'stone',
    name: 'gs64stone',
    version: '3.7.5',
    pid: 4106,
    startTime: 'May 17 19:57',
    status: 'frozen',
    responding: false,
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────

describe('ProcessManager', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = process.platform;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.mocked(spawn).mockReset();
    // Restore the wslBridge mock defaults. Several tests set needsWsl→true (or
    // a wslExecSync return) with sticky overrides; without resetting them here
    // they leak into blocks that don't reset them (e.g. startNetldi), making
    // those tests fail under sequence.shuffle (getEnvironment then takes the WSL
    // path and calls a storage method the test stub doesn't provide).
    vi.mocked(wslBridge.needsWsl).mockReset().mockReturnValue(false);
    vi.mocked(wslBridge.wslExecSync).mockReset();
  });

  // ── runCommand spawn behaviour ────────────────────────────

  describe('runCommand (via startStone)', () => {
    it('on Linux wraps spawn in bash with ulimit -n 1024', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage);
      const db = makeDatabase();

      const promise = manager.startStone(db);
      proc.finish();
      await promise;

      expect(spawn).toHaveBeenCalledOnce();
      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toBe('/bin/bash');
      expect(args).toContain('-c');
      expect(args).toContain('ulimit -n 1024; exec "$@"');
      expect(spawnedCommand().cmd).toContain('startstone');
    });

    it('on Linux does not let the user shell rewrite the environment it built', async () => {
      // The wrapper exists only to set ulimit before exec, so it has no business
      // running startup files. Users do have `unset GEMSTONE` in their .bashrc,
      // and a GemStone command whose GEMSTONE was unset out from under it
      // reports a broken install rather than a hijacked environment.
      setPlatform('linux');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      const promise = manager.startStone(makeDatabase());
      proc.finish();
      await promise;

      const [, args, options] = vi.mocked(spawn).mock.calls[0];
      expect(args).toContain('--noprofile');
      expect(args).toContain('--norc');
      // BASH_ENV is the remaining way a non-interactive shell reads a file.
      expect(options.env?.BASH_ENV).toBe('');
      expect(options.env?.GEMSTONE).toBe('/gs/3.7.4');
    });

    it('on Linux passes the stone arguments after the exec sentinel', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage);
      const db = makeDatabase();

      const promise = manager.startStone(db);
      proc.finish();
      await promise;

      const [, args] = vi.mocked(spawn).mock.calls[0];
      // args: ['-c', script, '--', cmd, '-l', logPath, stoneName]
      expect(args).toContain('-l');
      expect(args).toContain(db.config.stoneName);
    });

    it('on macOS spawns the binary directly without a shell wrapper', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage);
      const db = makeDatabase();

      const promise = manager.startStone(db);
      proc.finish();
      await promise;

      expect(spawn).toHaveBeenCalledOnce();
      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toContain('startstone');
      expect(args).not.toContain('ulimit');
    });

    it('on Linux the env is passed as the spawn options env', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage);
      const promise = manager.startStone(makeDatabase());
      proc.finish();
      await promise;

      const [, , opts] = vi.mocked(spawn).mock.calls[0] as [string, string[], SpawnOptions];
      expect(opts.env).toBeDefined();
      expect(opts.env?.GEMSTONE).toBe('/gs/3.7.4');
    });

    it('on Linux sets LD_LIBRARY_PATH (not DYLD_LIBRARY_PATH) in env', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage);
      const promise = manager.startStone(makeDatabase());
      proc.finish();
      await promise;

      const [, , opts] = vi.mocked(spawn).mock.calls[0] as [string, string[], SpawnOptions];
      const env = opts.env as NodeJS.ProcessEnv;
      expect(env.LD_LIBRARY_PATH).toContain('/gs/3.7.4/lib');
      expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
    });

    it('on macOS sets DYLD_LIBRARY_PATH (not LD_LIBRARY_PATH) in env', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const storage = makeStorage('/gs/3.7.4');
      const manager = new ProcessManager(storage);
      const promise = manager.startStone(makeDatabase());
      proc.finish();
      await promise;

      const [, , opts] = vi.mocked(spawn).mock.calls[0] as [string, string[], SpawnOptions];
      const env = opts.env as NodeJS.ProcessEnv;
      expect(env.DYLD_LIBRARY_PATH).toContain('/gs/3.7.4/lib');
      expect(env.LD_LIBRARY_PATH).toBeUndefined();
    });

    it('rejects when the process exits with a non-zero code', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(1);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startStone(makeDatabase());
      proc.finish();

      await expect(promise).rejects.toThrow();
    });
  });

  // ── parseGslist ───────────────────────────────────────────

  describe('parseGslist', () => {
    // Header and dashes appear in real gslist output and must not be parsed
    // as data rows; the trailing OK / frozen lines are the actual processes.
    const sampleOutput = [
      'Status        Version    Owner       Pid   Port   Started     Type       Name',
      '-------      --------- --------- -------- ----- ------------ ------      ----',
      'OK           3.7.5     jfoster      10923 50377 May 24 07:06 Netldi      gs64ldi',
      'frozen       3.7.5     jfoster       4106 49677 May 17 19:57 Stone       gs64stone',
    ].join('\n');

    it('parses both responding and frozen processes from a mixed gslist run', () => {
      const procs = parseGslist(sampleOutput);
      expect(procs).toHaveLength(2);
    });

    it('marks an "OK" netldi as responding and preserves its port', () => {
      const procs = parseGslist(sampleOutput);
      const netldi = procs.find((p) => p.type === 'netldi')!;
      expect(netldi.status).toBe('OK');
      expect(netldi.responding).toBe(true);
      expect(netldi.port).toBe(50377);
      expect(netldi.pid).toBe(10923);
      expect(netldi.name).toBe('gs64ldi');
    });

    it('marks a "frozen" stone as not responding so the UI can flag it', () => {
      const procs = parseGslist(sampleOutput);
      const stone = procs.find((p) => p.type === 'stone')!;
      expect(stone.status).toBe('frozen');
      expect(stone.responding).toBe(false);
      expect(stone.pid).toBe(4106);
      expect(stone.name).toBe('gs64stone');
    });

    it('recognizes the two-word "exe deleted" status without bleeding into version', () => {
      const line =
        'exe deleted  3.7.5     jfoster       4106 49677 May 17 19:57 Stone       gs64stone';
      const procs = parseGslist(line);
      expect(procs).toHaveLength(1);
      expect(procs[0].status).toBe('exe deleted');
      expect(procs[0].responding).toBe(false);
      expect(procs[0].version).toBe('3.7.5');
    });

    it('recognizes "unknown(EPERM)" as a stale (non-responding) status', () => {
      const line =
        'unknown(EPERM)  3.7.5     jfoster       4106 49677 May 17 19:57 Stone       gs64stone';
      const procs = parseGslist(line);
      expect(procs).toHaveLength(1);
      expect(procs[0].status).toBe('unknown(EPERM)');
      expect(procs[0].responding).toBe(false);
    });

    it('skips the header row and separator line', () => {
      const onlyHeaders = [
        'Status        Version    Owner       Pid   Port   Started     Type       Name',
        '-------      --------- --------- -------- ----- ------------ ------      ----',
      ].join('\n');
      expect(parseGslist(onlyHeaders)).toEqual([]);
    });

    it('returns an empty list for the "No GemStone servers" info message', () => {
      expect(parseGslist('gslist[Info]: No GemStone servers.')).toEqual([]);
    });
  });

  // ── versionsMatch (pure) ──────────────────────────────────

  describe('versionsMatch', () => {
    it('matches identical versions', () => {
      expect(versionsMatch('3.7.5', '3.7.5')).toBe(true);
    });

    it('treats a shorter version as matching when it is a dotted prefix', () => {
      // gslist may report "3.7.4" while the product dir yields "3.7.4.3" (or vice versa).
      expect(versionsMatch('3.7.4', '3.7.4.3')).toBe(true);
      expect(versionsMatch('3.7.4.3', '3.7.4')).toBe(true);
    });

    it('keeps genuinely different installs distinct', () => {
      // The exact scenario from the bug report.
      expect(versionsMatch('3.6.2', '3.7.5')).toBe(false);
    });

    it('does not match when only the major component agrees', () => {
      expect(versionsMatch('3.6.2', '3.6.3')).toBe(false);
    });
  });

  // ── isStoneRunning / isNetldiRunning (version-aware) ──────

  describe('isStoneRunning / isNetldiRunning', () => {
    // Two installed versions share the same stone and netldi names; only 3.7.5 is running.
    const running = [
      'OK     3.7.5     jfoster      10923 50377 May 24 07:06 Netldi      gs64ldi',
      'OK     3.7.5     jfoster       4106 49677 May 17 19:57 Stone       gs64stone',
    ].join('\n');

    function managerWith(output: string) {
      vi.mocked(wslBridge.wslExecSync).mockReturnValue(output);
      const storage = makeStorage('/gs/3.7.5');
      const manager = new ProcessManager(storage);
      manager.refreshProcesses();
      return manager;
    }

    beforeEach(() => {
      vi.mocked(wslBridge.wslExecSync).mockReset();
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    });

    it('reports the running version as running', () => {
      const manager = managerWith(running);
      expect(manager.isStoneRunning('gs64stone', '3.7.5')).toBe(true);
      expect(manager.isNetldiRunning('gs64ldi', '3.7.5')).toBe(true);
    });

    it('does NOT report a same-named stone from a different version as running', () => {
      // Regression: starting the 3.7.5 stone must not light up the 3.6.2 database.
      const manager = managerWith(running);
      expect(manager.isStoneRunning('gs64stone', '3.6.2')).toBe(false);
      expect(manager.isNetldiRunning('gs64ldi', '3.6.2')).toBe(false);
    });
  });

  // ── startNetldi spawn behaviour ───────────────────────────

  describe('runCommand (via startNetldi)', () => {
    it('on Linux also wraps startnetldi in the bash ulimit shell', async () => {
      setPlatform('linux');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();
      await promise;

      expect(vi.mocked(spawn).mock.calls[0][0]).toBe('/bin/bash');
      expect(spawnedCommand().cmd).toContain('startnetldi');
    });

    it('on macOS spawns startnetldi directly', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();
      await promise;

      const [cmd] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toContain('startnetldi');
    });

    // A signal-killed process reports a null exit code, so the plain
    // "exit code ${code}" wording renders as the useless "exit code null" —
    // and such a process usually dies before writing any output at all, so
    // there is nothing else in the message to go on.
    it('names the signal when the process was killed, instead of "exit code null"', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(null, 'SIGKILL');
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();

      await expect(promise).rejects.toThrow(/SIGKILL/);
      await expect(promise).rejects.not.toThrow(/exit code null/);
    });

    it('blames memory pressure for a SIGKILL, which is what jetsam does', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(null, 'SIGKILL');
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();

      await expect(promise).rejects.toThrow(/memory/i);
    });

    // A signal is not evidence of memory pressure on its own: a SIGSEGV means a
    // broken install and a SIGTERM means someone ran kill. Naming memory for
    // those sends the reader looking in the wrong place.
    it('names the signal without blaming memory when it is not a SIGKILL', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(null, 'SIGSEGV');
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();

      await expect(promise).rejects.toThrow(/SIGSEGV/);
      await expect(promise).rejects.not.toThrow(/memory/i);
    });

    // The Admin output channel is force-revealed on every start, which yanks
    // focus off the editor. That is fine for an explicit "Start Stone" click,
    // but not when the start is a step inside a connect the user is waiting on.
    it('reveals the Admin channel by default', async () => {
      setPlatform('darwin');
      vi.mocked(showSysadmin).mockClear();
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();
      await promise;

      expect(vi.mocked(showSysadmin)).toHaveBeenCalled();
    });

    it('does not steal focus when the caller asks to stay quiet', async () => {
      setPlatform('darwin');
      vi.mocked(showSysadmin).mockClear();
      vi.mocked(appendSysadmin).mockClear();
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase(), { reveal: false });
      proc.finish();
      await promise;

      expect(vi.mocked(showSysadmin)).not.toHaveBeenCalled();
    });

    it('still records the output when quiet, so the log is not lost', async () => {
      setPlatform('darwin');
      vi.mocked(showSysadmin).mockClear();
      vi.mocked(appendSysadmin).mockClear();
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase(), { reveal: false });
      proc.finish();
      await promise;

      expect(vi.mocked(appendSysadmin)).toHaveBeenCalled();
    });

    it('stays quiet for a quiet stone start too', async () => {
      setPlatform('darwin');
      vi.mocked(showSysadmin).mockClear();
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startStone(makeDatabase(), { reveal: false });
      proc.finish();
      await promise;

      expect(vi.mocked(showSysadmin)).not.toHaveBeenCalled();
    });

    it('still reports a plain non-zero exit with its code', async () => {
      setPlatform('darwin');
      const proc = makeChildProcess(1);
      mockSpawnReturn(proc);

      const manager = new ProcessManager(makeStorage());
      const promise = manager.startNetldi(makeDatabase());
      proc.finish();

      await expect(promise).rejects.toThrow(/exit code 1/);
    });
  });

  // ── classifyPidOwnership (pure) ───────────────────────────

  describe('classifyPidOwnership', () => {
    it('reports the PID gone when ps fell back to the "GONE" sentinel', () => {
      const r = classifyPidOwnership('GONE');
      expect(r.pidGone).toBe(true);
      expect(r.isGemStoneServer).toBe(false);
    });

    it('reports the PID gone when ps produced nothing', () => {
      const r = classifyPidOwnership('');
      expect(r.pidGone).toBe(true);
    });

    it('recognizes a real stoned command line as a GemStone server', () => {
      const cmd =
        '/Users/jfoster/Documents/GemStone/GemStone64Bit3.7.5/sys/stoned -l /log/x.log -e /conf/x.conf -z /conf/system.conf gs64stone';
      const r = classifyPidOwnership(cmd);
      expect(r.pidGone).toBe(false);
      expect(r.isGemStoneServer).toBe(true);
      expect(r.command).toBe(cmd);
    });

    it('recognizes a real netldid command line as a GemStone server', () => {
      const r = classifyPidOwnership('/gs/sys/netldid gs64ldi');
      expect(r.isGemStoneServer).toBe(true);
    });

    it('does NOT mistake a recycled-PID unrelated process for a GemStone server', () => {
      const r = classifyPidOwnership('/usr/bin/ssh-agent');
      expect(r.pidGone).toBe(false);
      expect(r.isGemStoneServer).toBe(false);
    });

    it('does NOT match substrings like "stoned-arm" or "netldid_helper" that share a prefix only', () => {
      // Regression: word-boundary anchors prevent a substring that merely
      // starts with the token from falsely triggering the server check.
      expect(classifyPidOwnership('/opt/stoned-arm/binary').isGemStoneServer).toBe(false);
      expect(classifyPidOwnership('/opt/netldid_helper/x').isGemStoneServer).toBe(false);
    });
  });

  // ── inspectStaleLock / deleteStaleLock ────────────────────

  describe('inspectStaleLock', () => {
    beforeEach(() => {
      vi.mocked(wslBridge.wslExecSync).mockReset();
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    });

    it('returns safe=true and the expected lock path when the PID is gone', () => {
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('GONE');
      const manager = new ProcessManager(makeStorage());
      const report = manager.inspectStaleLock(staleStone());
      expect(report.safe).toBe(true);
      expect(report.lockPath).toBe('/home/user/gemstone/locks/gs64stone..LCK');
      expect(report.reason).toMatch(/no longer exists/);
    });

    it('refuses when the recorded PID is still a running stoned', () => {
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('/gs/sys/stoned -l /log gs64stone');
      const manager = new ProcessManager(makeStorage());
      const report = manager.inspectStaleLock(staleStone());
      expect(report.safe).toBe(false);
      expect(report.reason).toMatch(/still a running GemStone server/);
    });

    it('marks safe=true when the PID has been reused by an unrelated process', () => {
      // This is the exact scenario from the user's bug: PID 4106 is now ssh-agent.
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('/usr/bin/ssh-agent');
      const manager = new ProcessManager(makeStorage());
      const report = manager.inspectStaleLock(staleStone());
      expect(report.safe).toBe(true);
      expect(report.currentPidOwner).toBe('/usr/bin/ssh-agent');
      expect(report.reason).toMatch(/reused by an unrelated process/);
    });

    it('refuses (rather than risk a wrong delete) when the ps call throws', () => {
      vi.mocked(wslBridge.wslExecSync).mockImplementation(() => {
        throw new Error('ps: not found');
      });
      const manager = new ProcessManager(makeStorage());
      const report = manager.inspectStaleLock(staleStone());
      expect(report.safe).toBe(false);
      expect(report.reason).toMatch(/Could not check PID/);
    });

    it('uses the WSL root path when running under WSL', () => {
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('GONE');
      const storage = {
        ...rawStorage(),
        getWslRootPath: vi.fn(() => '/mnt/c/gemstone'),
      } as unknown as SysadminStorage;
      const manager = new ProcessManager(storage);
      const report = manager.inspectStaleLock(staleStone());
      expect(report.lockPath).toBe('/mnt/c/gemstone/locks/gs64stone..LCK');
    });
  });

  describe('deleteStaleLock', () => {
    beforeEach(() => {
      vi.mocked(wslBridge.wslExecSync).mockReset();
    });

    it('shells out an rm -f for the lock path and reports success', () => {
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('');
      const manager = new ProcessManager(makeStorage());
      const ok = manager.deleteStaleLock('/home/user/gemstone/locks/gs64stone..LCK');
      expect(ok).toBe(true);
      const cmd = vi.mocked(wslBridge.wslExecSync).mock.calls[0][0];
      expect(cmd).toContain('rm -f');
      expect(cmd).toContain('gs64stone..LCK');
    });

    it('returns false when rm throws (e.g. permission denied)', () => {
      vi.mocked(wslBridge.wslExecSync).mockImplementation(() => {
        throw new Error('rm: permission denied');
      });
      const manager = new ProcessManager(makeStorage());
      const ok = manager.deleteStaleLock('/home/user/gemstone/locks/gs64stone..LCK');
      expect(ok).toBe(false);
    });
  });

  describe('forceKillStone', () => {
    beforeEach(() => {
      vi.mocked(wslBridge.wslExecSync).mockReset();
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    });

    it('reports success without signalling anything when the stone is not running', async () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([]);

      const result = await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      expect(result.killed).toBe(true);
      expect(result.reason).toMatch(/not running/);
      expect(wslBridge.wslExecSync).not.toHaveBeenCalled();
    });

    it('refuses to kill a PID that now belongs to an unrelated process', async () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([staleStone()]);
      vi.mocked(wslBridge.wslExecSync).mockReturnValueOnce('/usr/bin/ssh-agent');

      const result = await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/unrelated process/);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /kill/.test(c))).toBe(false);
    });

    /** A real `stoned` command line: the server name is the first argument,
     *  before any flags — which is what the name re-check reads. */
    const STONED = '/gs/sys/stoned gs64stone -l /log';

    it('replaces GemStone’s bare GEMSTONE complaint with the real situation', async () => {
      // Without this the user is told their GEMSTONE variable is undefined —
      // which Jasper just set — and goes off to debug a shell profile that is
      // fine. The wording is unit-tested; this covers it actually being used.
      setPlatform('linux');
      const child = makeChildProcess(1);
      mockSpawnReturn(child);
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      const promise = manager.startStone(makeDatabase());
      child.emitStderr("startstone[Error]: The environment variable 'GEMSTONE' is not defined.\n");
      child.finish();

      await expect(promise).rejects.toThrow(/did not reach the command/);
    });

    it('leaves any other start failure reported as it came', async () => {
      setPlatform('linux');
      const child = makeChildProcess(1);
      mockSpawnReturn(child);
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      const promise = manager.startStone(makeDatabase());
      child.emitStderr('extent0.dbf is already in use\n');
      child.finish();

      await expect(promise).rejects.toThrow(/extent0\.dbf is already in use/);
    });

    it('SIGTERMs a running stone, clears its lock, and reports recovery', async () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([staleStone()]);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(STONED)
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('');

      const result = await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      expect(result.killed).toBe(true);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /^kill 4106/.test(c))).toBe(true);
      expect(commands.some((c) => /rm -f/.test(c) && c.includes('gs64stone..LCK'))).toBe(true);
      expect(result.reason).toMatch(/recover/);
    });

    it('escalates to SIGKILL when SIGTERM does not stop the stone', async () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([staleStone()]);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(STONED)
        .mockReturnValueOnce('')
        .mockReturnValueOnce(STONED)
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('');

      const result = await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      expect(result.killed).toBe(true);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /^kill -9 4106/.test(c))).toBe(true);
    });

    it('still clears the lock after escalating to SIGKILL', async () => {
      // The case the lock matters most in, and the one that used to skip it:
      // the check ran before the process had been reaped, read it as a live
      // server, and kept the lock — silently.
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([staleStone()]);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(STONED)
        .mockReturnValueOnce('')
        .mockReturnValueOnce(STONED)
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('');

      await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /rm -f/.test(c) && c.includes('gs64stone..LCK'))).toBe(true);
    });

    it('reports failure when the stone outlives SIGKILL', async () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([staleStone()]);
      vi.mocked(wslBridge.wslExecSync).mockReturnValue(STONED);

      const result = await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/survived SIGKILL/);
    });

    it('refuses to kill a process id now held by a different stone', async () => {
      // Same rigor as the external-server kill path: a modal escalation dialog
      // and an optional password prompt sit in front of this.
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([staleStone()]);
      vi.mocked(wslBridge.wslExecSync).mockReturnValueOnce('/gs/sys/stoned someone-elses-stone');

      const result = await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/no longer stone/);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /kill/.test(c))).toBe(false);
    });
  });

  // ── external servers ──────────────────────────────────────

  describe('getExternalServers', () => {
    const PS_LINE =
      ' 1889606 /gs/GemStone64Bit3.7.4-x86_64.Linux/sys/stoned gs64stone ' +
      '-e /home/user/gemstone/db-1/conf/gs64stone.conf';
    const PS_LDI_LINE =
      ' 1889602 /gs/GemStone64Bit3.7.4-x86_64.Linux/sys/netldid gs64ldi -g ' +
      '-l /home/user/gemstone/db-1/log/gs64ldi.log';

    beforeEach(() => {
      vi.mocked(wslBridge.wslExecSync).mockReset();
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    });

    /**
     * Put a *successful* gslist reading in place, reporting `processes`.
     *
     * It drives the real `refreshProcesses` rather than only stubbing the
     * accessors, because the cross-check refuses to report anything unless that
     * read actually succeeded — so a stub that skips it would leave every case
     * below silently answering `{}` for the wrong reason.
     */
    function seedGslist(manager: ProcessManager, processes: GemStoneProcess[]) {
      // `test -x` for findGslist, then the `gslist -cvl` output itself.
      vi.mocked(wslBridge.wslExecSync).mockReset().mockReturnValue('');
      manager.refreshProcesses();
      vi.mocked(wslBridge.wslExecSync).mockReset();
      vi.spyOn(manager, 'getProcesses').mockReturnValue(processes);
      vi.spyOn(manager, 'isStoneRunning').mockReturnValue(
        processes.some((p) => p.type === 'stone'),
      );
      vi.spyOn(manager, 'isNetldiRunning').mockReturnValue(
        processes.some((p) => p.type === 'netldi'),
      );
    }

    /** The same, but with gslist unreadable — the state that must never be
     *  mistaken for "gslist looked and saw nothing". */
    function gslistUnreadable(manager: ProcessManager) {
      vi.mocked(wslBridge.wslExecSync)
        .mockReset()
        .mockImplementation(() => {
          throw new Error('gslist: cannot execute');
        });
      manager.refreshProcesses();
      vi.mocked(wslBridge.wslExecSync).mockReset();
    }

    it('never scans the process table while both servers are accounted for', () => {
      // The healthy case is the common one, and it has nothing to explain.
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, [
        staleStone({ status: 'OK', responding: true }),
        staleStone({ type: 'netldi', name: 'gs64ldi', status: 'OK', responding: true }),
      ]);

      expect(manager.getExternalServers(makeDatabase())).toEqual({});
      expect(wslBridge.wslExecSync).not.toHaveBeenCalled();
    });

    it('accuses nothing of being external when gslist could not be run at all', () => {
      // With no extracted version there is no gslist to run, so the process
      // list is empty for a reason that says nothing about what is registered.
      // Reading it as "nothing is registered" would make every live server —
      // including ones Jasper started — look external, confirmed, and killable.
      const storage = {
        ...rawStorage(),
        getExtractedVersions: vi.fn(() => []),
      } as unknown as SysadminStorage;
      const manager = new ProcessManager(storage);
      manager.refreshProcesses();
      vi.mocked(wslBridge.wslExecSync).mockReset().mockReturnValue(PS_LINE);

      expect(manager.getExternalServers(makeDatabase())).toEqual({});
    });

    it('accuses nothing of being external when the gslist read failed', () => {
      const manager = new ProcessManager(makeStorage());
      gslistUnreadable(manager);
      vi.mocked(wslBridge.wslExecSync).mockReturnValue(PS_LINE);

      expect(manager.getExternalServers(makeDatabase())).toEqual({});
    });

    it('does not call a server external when it is registered where Jasper looks', () => {
      // The backstop behind the gslist-readable guard: whatever the listing
      // said, a server registered in Jasper's own root is not outside it.
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(PS_LINE)
        .mockReturnValue('GEMSTONE_GLOBAL_DIR=/home/user/gemstone');

      expect(manager.getExternalServers(makeDatabase())).toEqual({});
    });

    it('reports only the side its own gslist cannot see', () => {
      const manager = new ProcessManager(makeStorage());
      // Version has to match the database's, or the cross-check rightly treats
      // this as another install's stone rather than as "gslist can see it".
      seedGslist(manager, [staleStone({ version: '3.7.4', status: 'OK', responding: true })]);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(`${PS_LINE}\n${PS_LDI_LINE}`)
        .mockReturnValue('GEMSTONE_GLOBAL_DIR=/elsewhere');

      const finding = manager.getExternalServers(makeDatabase());

      expect(finding.stone).toBeUndefined();
      expect(finding.netldi?.process.pid).toBe(1889602);
    });

    it('drops a candidate whose version only its environment revealed as another install', () => {
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync)
        // No product directory in the path, so the version is unknown here and
        // the candidate is admitted on name alone…
        .mockReturnValueOnce(
          ' 700 /opt/sys/stoned gs64stone -e /home/user/gemstone/db-1/conf/s.conf',
        )
        // …and its environment then reveals it belongs to a different install.
        .mockReturnValue(
          'GEMSTONE=/opt/GemStone64Bit3.6.2-x86_64.Linux GEMSTONE_GLOBAL_DIR=/elsewhere',
        );

      expect(manager.getExternalServers(makeDatabase())).toEqual({});
    });

    it('prefers the same-named server it can place over one it cannot', () => {
      // Two live stones share the name. Picking the first listed would report
      // "probably a different database" about a server running right there.
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(
          ' 111 /gs/GemStone64Bit3.7.4-x86_64.Linux/sys/stoned gs64stone -e /elsewhere/db-9/conf/s.conf\n' +
            ' 222 /gs/GemStone64Bit3.7.4-x86_64.Linux/sys/stoned gs64stone -e /home/user/gemstone/db-1/conf/s.conf',
        )
        .mockReturnValue('GEMSTONE_GLOBAL_DIR=/elsewhere');

      const finding = manager.getExternalServers(makeDatabase());

      expect(finding.stone?.process.pid).toBe(222);
      expect(finding.stone?.identity).toBe('confirmed');
    });

    it('finds a server that is alive on the host but absent from its own gslist', () => {
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(`${PS_LINE}\n${PS_LDI_LINE}`)
        .mockReturnValue('GEMSTONE_GLOBAL_DIR=/elsewhere GEMSTONE=/gs');

      const finding = manager.getExternalServers(makeDatabase());

      expect(finding.stone?.process.pid).toBe(1889606);
      expect(finding.netldi?.process.pid).toBe(1889602);
    });

    it('reads the directory an externally started server registered in', () => {
      // Without it the user is told a process is alive somewhere and given no
      // way to go find it.
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(PS_LINE)
        .mockReturnValue('GEMSTONE_GLOBAL_DIR=/elsewhere GEMSTONE=/gs');

      const finding = manager.getExternalServers(makeDatabase());

      expect(finding.stone?.process.globalDir).toBe('/elsewhere');
      expect(finding.stone?.identity).toBe('confirmed');
    });

    it('reports nothing rather than guessing when the process table cannot be read', () => {
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync).mockImplementation(() => {
        throw new Error('ps: command not found');
      });

      expect(manager.getExternalServers(makeDatabase())).toEqual({});
    });

    it('matches a Windows database path against the WSL paths the server reports', () => {
      // Under WSL the database is a UNC path on the Windows side while the
      // running server reports Linux paths, so identity has to be judged after
      // converting — otherwise it never confirms on Windows and the restart is
      // silently never offered.
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
      const db = makeDatabase({ path: '\\\\wsl$\\Ubuntu\\home\\user\\gemstone\\db-1' });
      const manager = new ProcessManager(makeWslStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(
          ' 700 /gs/GemStone64Bit3.7.4-x86_64.Linux/sys/stoned gs64stone ' +
            '-e /home/user/gemstone/db-1/conf/gs64stone.conf',
        )
        .mockReturnValue('GEMSTONE_GLOBAL_DIR=/elsewhere');

      const finding = manager.getExternalServers(db);

      expect(finding.stone?.identity).toBe('confirmed');
    });

    it('does not confirm a WSL server belonging to another database', () => {
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
      const db = makeDatabase({ path: '\\\\wsl$\\Ubuntu\\home\\user\\gemstone\\db-1' });
      const manager = new ProcessManager(makeWslStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce(
          ' 700 /gs/GemStone64Bit3.7.4-x86_64.Linux/sys/stoned gs64stone ' +
            '-e /home/user/gemstone/db-9/conf/gs64stone.conf',
        )
        .mockReturnValue('GEMSTONE_GLOBAL_DIR=/elsewhere');

      expect(manager.getExternalServers(db).stone?.identity).toBe('different');
    });

    it('scans the process table once for repeated questions about a database', () => {
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('');

      manager.getExternalServers(makeDatabase());
      manager.getExternalServers(makeDatabase());

      expect(vi.mocked(wslBridge.wslExecSync).mock.calls).toHaveLength(1);
    });

    it('scans the process table once for several databases', () => {
      // One scan answers for every database, which is the point of caching it
      // rather than the per-database verdict alone.
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('');

      manager.getExternalServers(makeDatabase());
      manager.getExternalServers(
        makeDatabase({ dirName: 'db-2', path: '/home/user/gemstone/db-2' }),
      );

      expect(vi.mocked(wslBridge.wslExecSync).mock.calls).toHaveLength(1);
    });

    it('scans the process table again after the next refresh', () => {
      const manager = new ProcessManager(makeStorage());
      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('');
      manager.getExternalServers(makeDatabase());

      seedGslist(manager, []);
      vi.mocked(wslBridge.wslExecSync).mockReturnValue('');
      manager.getExternalServers(makeDatabase());

      expect(vi.mocked(wslBridge.wslExecSync).mock.calls).toHaveLength(1);
    });
  });

  describe('isServerAlive', () => {
    it('counts a server its own gslist can see', () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'isStoneRunning').mockReturnValue(true);
      vi.spyOn(manager, 'getExternalServers').mockReturnValue({});

      expect(manager.isServerAlive(makeDatabase(), 'stone')).toBe(true);
    });

    it('counts a server that is alive on the host but absent from gslist', () => {
      // The guard for anything destructive: such a stone has the extent open,
      // so deleting or replacing under it would corrupt a running database.
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'isStoneRunning').mockReturnValue(false);
      vi.spyOn(manager, 'getExternalServers').mockReturnValue({
        stone: {
          process: {
            pid: 1,
            type: 'stone',
            name: 'gs64stone',
            dbPathHints: [],
            command: 'stoned gs64stone',
          },
          identity: 'confirmed',
        },
      });

      expect(manager.isServerAlive(makeDatabase(), 'stone')).toBe(true);
    });

    it('does not count the other server as this one', () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'isStoneRunning').mockReturnValue(false);
      vi.spyOn(manager, 'isNetldiRunning').mockReturnValue(false);
      vi.spyOn(manager, 'getExternalServers').mockReturnValue({
        stone: {
          process: {
            pid: 1,
            type: 'stone',
            name: 'gs64stone',
            dbPathHints: [],
            command: 'stoned gs64stone',
          },
          identity: 'confirmed',
        },
      });

      expect(manager.isServerAlive(makeDatabase(), 'netldi')).toBe(false);
    });

    it('reports nothing alive when neither view sees anything', () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'isStoneRunning').mockReturnValue(false);
      vi.spyOn(manager, 'getExternalServers').mockReturnValue({});

      expect(manager.isServerAlive(makeDatabase(), 'stone')).toBe(false);
    });
  });

  describe('stopExternalServer', () => {
    beforeEach(() => {
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
      setPlatform('linux');
    });

    it('aims the stop at the directory the server actually registered in', async () => {
      // Run in Jasper's own environment the stop script looks in Jasper's locks
      // directory, does not find the server, and reports it as not running —
      // the very blind spot being reconciled.
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      const promise = manager.stopExternalServer(makeDatabase(), {
        process: {
          pid: 1,
          type: 'stone',
          name: 'gs64stone',
          globalDir: '/elsewhere',
          dbPathHints: [],
          command: 'stoned gs64stone',
        },
        identity: 'confirmed',
      });
      proc.finish();
      await promise;

      const options = vi.mocked(spawn).mock.calls[0][2];
      expect(options.env?.GEMSTONE_GLOBAL_DIR).toBe('/elsewhere');
    });

    it('runs stopstone, with DataCurator credentials, at a stone', async () => {
      // Which binary and which argv each server kind gets was asserted nowhere:
      // the two could be swapped and every test stayed green, while at runtime
      // both stops would fail and fall straight through to kill -9, losing
      // uncommitted work with the clean-stop failure deliberately swallowed.
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      const promise = manager.stopExternalServer(makeDatabase(), {
        process: {
          pid: 1,
          type: 'stone',
          name: 'gs64stone',
          globalDir: '/elsewhere',
          dbPathHints: [],
          command: 'stoned gs64stone',
        },
        identity: 'confirmed',
      });
      proc.finish();
      await promise;

      expect(spawnedCommand()).toEqual({
        cmd: '/gs/3.7.4/bin/stopstone',
        args: ['gs64stone', 'DataCurator', DEFAULT_GS_PW],
      });
    });

    it('runs stopnetldi, with just the name, at a netldi', async () => {
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      const promise = manager.stopExternalServer(makeDatabase(), {
        process: {
          pid: 1,
          type: 'netldi',
          name: 'gs64ldi',
          globalDir: '/elsewhere',
          dbPathHints: [],
          command: 'netldid gs64ldi',
        },
        identity: 'confirmed',
      });
      proc.finish();
      await promise;

      expect(spawnedCommand()).toEqual({ cmd: '/gs/3.7.4/bin/stopnetldi', args: ['gs64ldi'] });
    });

    it('falls back to the root Jasper manages when the directory is unknown', async () => {
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      const promise = manager.stopExternalServer(makeDatabase(), {
        process: {
          pid: 1,
          type: 'netldi',
          name: 'gs64ldi',
          dbPathHints: [],
          command: 'netldid gs64ldi',
        },
        identity: 'confirmed',
      });
      proc.finish();
      await promise;

      const options = vi.mocked(spawn).mock.calls[0][2];
      expect(options.env?.GEMSTONE_GLOBAL_DIR).toBe('/home/user/gemstone');
    });
  });

  describe('killHostServer', () => {
    const server = {
      process: {
        pid: 4106,
        type: 'stone' as const,
        name: 'gs64stone',
        dbPathHints: [],
        command: 'stoned gs64stone',
      },
      identity: 'confirmed' as const,
    };

    beforeEach(() => {
      vi.mocked(wslBridge.wslExecSync).mockReset();
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    });

    it('refuses to signal a process id that now belongs to something else', async () => {
      // An external server's PID comes from a scan, not from gslist, so this
      // check is the only thing standing between a reconcile and an unrelated
      // process that inherited the number.
      vi.mocked(wslBridge.wslExecSync).mockReturnValueOnce('/usr/bin/ssh-agent');

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/unrelated process/);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /kill/.test(c))).toBe(false);
    });

    it('reports success when the process has already gone', async () => {
      vi.mocked(wslBridge.wslExecSync).mockReturnValueOnce('GONE');

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(true);
    });

    it('escalates to SIGKILL when the server survives SIGTERM', async () => {
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce('/gs/sys/stoned gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('/gs/sys/stoned gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE');

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(true);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /^kill -9 4106/.test(c))).toBe(true);
    });

    it('refuses to signal a process id now held by a different GemStone server', async () => {
      // The reconcile holds this PID across a modal dialog the user can sit on,
      // so the number has had real time to be recycled — and "some stoned" is
      // not the same as "the stoned we meant".
      vi.mocked(wslBridge.wslExecSync).mockReturnValueOnce('/gs/sys/stoned someone-elses-stone');

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/no longer/);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /kill/.test(c))).toBe(false);
    });

    it('does not mistake the netldi of the same name for the stone', async () => {
      vi.mocked(wslBridge.wslExecSync).mockReturnValueOnce('/gs/sys/netldid gs64stone');

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/no longer/);
    });

    it('stops after SIGTERM when the process id is taken over mid-kill', async () => {
      // Between the SIGTERM and the check, the PID came back as a different
      // server. Ours is gone; escalating would SIGKILL a bystander.
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce('/gs/sys/stoned gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('/gs/sys/stoned someone-elses-stone');

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(true);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /kill -9/.test(c))).toBe(false);
    });

    it('admits failure rather than claiming a server it could not kill is stopped', async () => {
      // The caller shows the resolve-it-by-hand details on this, so reporting a
      // false success would dead-end the user. `kill` says nothing, so this is a
      // process that genuinely ignored the signal.
      vi.mocked(wslBridge.wslExecSync).mockImplementation((cmd: string) =>
        /^kill/.test(cmd) ? '' : '/gs/sys/stoned gs64stone',
      );

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/survived SIGKILL/);
    });

    it('says a signal was refused rather than blaming a stubborn process', async () => {
      // An external server owned by another user needs sudo, and nothing else
      // will do — "survived SIGKILL" sends the user hunting a wedged process.
      vi.mocked(wslBridge.wslExecSync).mockImplementation((cmd: string) =>
        /^kill/.test(cmd) ? 'kill: (4106) - Operation not permitted' : '/gs/sys/stoned gs64stone',
      );

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      expect(result.killed).toBe(false);
      expect(result.reason).toMatch(/not permitted/);
      expect(result.reason).toMatch(/sudo/);
    });

    it('removes the stale lock a confirmed server left in its own directory', async () => {
      // Jasper's SIGKILL orphaned that lock. Left behind, gslist in the user's
      // own shell keeps listing a dead server and their next start refuses —
      // while Jasper's own restart works, which is why this would never show up
      // in Jasper's own testing.
      const confirmed = {
        ...server,
        process: { ...server.process, globalDir: '/elsewhere' },
      };
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce('/gs/sys/stoned gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('');

      const result = await new ProcessManager(makeStorage()).killHostServer(confirmed, {
        graceMs: 0,
      });

      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(
        commands.some((c) => /rm -f/.test(c) && c.includes('/elsewhere/locks/gs64stone..LCK')),
      ).toBe(true);
      expect(result.reason).toContain('/elsewhere/locks/gs64stone..LCK');
    });

    it("never touches a lock under Jasper's own root for an external server", async () => {
      const confirmed = {
        ...server,
        process: { ...server.process, globalDir: '/elsewhere' },
      };
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce('/gs/sys/stoned gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('');

      await new ProcessManager(makeStorage()).killHostServer(confirmed, { graceMs: 0 });

      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => c.includes('/home/user/gemstone/locks'))).toBe(false);
    });

    it('leaves the lock alone when it could not confirm whose database it is', async () => {
      // Then it really is a directory Jasper has no business writing in.
      const unknown = {
        process: { ...server.process, globalDir: '/elsewhere' },
        identity: 'unknown' as const,
      };
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce('/gs/sys/stoned gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE');

      const result = await new ProcessManager(makeStorage()).killHostServer(unknown, {
        graceMs: 0,
      });

      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /rm -f/.test(c))).toBe(false);
      expect(result.reason).toMatch(/left in place/);
    });

    it('leaves the lock alone when it does not know where the server registered', async () => {
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce('/gs/sys/stoned gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE');

      const result = await new ProcessManager(makeStorage()).killHostServer(server, {
        graceMs: 0,
      });

      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /rm -f/.test(c))).toBe(false);
      expect(result.reason).toMatch(/left in place/);
    });
  });

  // ── openVersionTerminal ───────────────────────────────────

  describe('openVersionTerminal', () => {
    beforeEach(() => {
      vi.mocked(vscode.window.createTerminal).mockClear();
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    });

    it('opens a terminal rooted at the version product directory', () => {
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      manager.openVersionTerminal('3.7.4');

      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'GemStone: 3.7.4', cwd: '/gs/3.7.4' }),
      );
      const terminal = vi.mocked(vscode.window.createTerminal).mock.results[0].value;
      expect(terminal.show).toHaveBeenCalled();
    });

    it('puts the version bin on PATH so its tools run, without any stone-specific vars', () => {
      setPlatform('darwin');
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      manager.openVersionTerminal('3.7.4');

      const options = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(options.env?.PATH).toContain('/gs/3.7.4/bin');
      expect(options.env?.GEMSTONE).toBe('/gs/3.7.4');
      expect(options.env?.GEMSTONE_GLOBAL_DIR).toBe('/home/user/gemstone');
      expect(options.env?.DYLD_LIBRARY_PATH).toBe('/gs/3.7.4/lib');
      // Still not tied to a particular stone. GEMSTONE_NRS_ALL is set, but
      // blanked: it has to be exported to override whatever the shell that
      // launched the editor left in it, and only a per-database environment
      // gives it a real value.
      expect(options.env?.GEMSTONE_SYS_CONF).toBeUndefined();
      expect(options.env?.GEMSTONE_NRS_ALL).toBe('');
    });

    it('blanks an inherited NRS setting so the shell cannot steer the terminal', () => {
      // A stray GEMSTONE_NRS_ALL from the launching shell carries #netldi: and
      // #dir: components that would send commands somewhere other than what
      // Jasper manages.
      setPlatform('linux');
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      manager.openVersionTerminal('3.7.4');

      const options = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(options.env).toHaveProperty('GEMSTONE_NRS_ALL', '');
    });

    it('uses LD_LIBRARY_PATH (not DYLD_LIBRARY_PATH) on Linux', () => {
      setPlatform('linux');
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      manager.openVersionTerminal('3.7.4');

      const options = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(options.env?.LD_LIBRARY_PATH).toBe('/gs/3.7.4/lib');
      expect(options.env?.DYLD_LIBRARY_PATH).toBeUndefined();
    });

    it('refuses when the requested version has not been extracted', () => {
      const storage = {
        ...rawStorage(),
        getGemstonePath: vi.fn(() => undefined),
      } as unknown as SysadminStorage;
      const manager = new ProcessManager(storage);

      // The message has to name the directory searched, not read as a lost
      // setting — a user who installed 9.9.9 elsewhere needs to know where
      // Jasper looked.
      expect(() => manager.openVersionTerminal('9.9.9')).toThrow(
        /no GemStone 9\.9\.9 install under \/home\/user\/gemstone/,
      );
      expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    });

    it('under WSL launches a bash shell that cds and exports the version paths', () => {
      setPlatform('win32');
      vi.mocked(wslBridge.needsWsl).mockReturnValue(true);
      const storage = {
        ...rawStorage(),
        getWslGemstonePath: vi.fn(() => '/mnt/c/gs/3.7.4'),
        getWslRootPath: vi.fn(() => '/mnt/c/gemstone'),
      } as unknown as SysadminStorage;
      const manager = new ProcessManager(storage);

      manager.openVersionTerminal('3.7.4');

      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ shellPath: 'wsl.exe' }),
      );
      const terminal = vi.mocked(vscode.window.createTerminal).mock.results[0].value;
      const sent = vi.mocked(terminal.sendText).mock.calls[0][0] as string;
      expect(sent).toContain("cd '/mnt/c/gs/3.7.4'");
      expect(sent).toContain("export GEMSTONE='/mnt/c/gs/3.7.4'");
      expect(sent).toContain("export GEMSTONE_GLOBAL_DIR='/mnt/c/gemstone'");
      expect(sent).toContain("export PATH='/mnt/c/gs/3.7.4/bin:");
      expect(sent).toContain("export LD_LIBRARY_PATH='/mnt/c/gs/3.7.4/lib'");
    });
  });

  describe('exportCommand', () => {
    it('re-asserts every variable as a shell export', () => {
      expect(exportCommand({ GEMSTONE: '/gs', GEMSTONE_LOG: '/db/log' })).toBe(
        "export GEMSTONE='/gs'; export GEMSTONE_LOG='/db/log'",
      );
    });

    it('survives a value containing a single quote', () => {
      // Paths are Jasper-made and rarely contain one, but a broken quote here
      // would corrupt every export that follows it in the same line.
      expect(exportCommand({ GEMSTONE_LOG: "/db/o'brien/log" })).toBe(
        "export GEMSTONE_LOG='/db/o'\\''brien/log'",
      );
    });

    it('keeps an empty value empty rather than dropping it', () => {
      // GEMSTONE_NRS_ALL is deliberately blanked; it has to be exported blank,
      // not omitted, or an inherited one survives.
      expect(exportCommand({ GEMSTONE_NRS_ALL: '' })).toBe("export GEMSTONE_NRS_ALL=''");
    });
  });

  describe('openTerminal (database)', () => {
    beforeEach(() => {
      vi.mocked(vscode.window.createTerminal).mockClear();
      vi.mocked(wslBridge.needsWsl).mockReturnValue(false);
    });

    it('sets PATH to the version bin alongside the stone-specific environment', () => {
      setPlatform('darwin');
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      manager.openTerminal(makeDatabase());

      const options = vi.mocked(vscode.window.createTerminal).mock
        .calls[0][0] as vscode.TerminalOptions;
      expect(options.env?.PATH).toContain('/gs/3.7.4/bin');
      expect(options.env?.DYLD_LIBRARY_PATH).toBe('/gs/3.7.4/lib');
      expect(options.env?.GEMSTONE_SYS_CONF).toBe('/home/user/gemstone/db-1/conf');
      expect(options.env?.GEMSTONE_NRS_ALL).toContain('#netldi:gs64ldi');
    });

    it('re-asserts GemStone bin as a PATH prefix so shell customizations survive', () => {
      // The re-export after startup files run makes Jasper's vars authoritative,
      // but PATH must be asserted as a *prefix* — re-exporting our fixed value
      // wholesale would wipe whatever .bashrc prepended (nvm, homebrew, …).
      setPlatform('darwin');
      const manager = new ProcessManager(makeStorage('/gs/3.7.4'));

      manager.openTerminal(makeDatabase());

      const terminal = vi.mocked(vscode.window.createTerminal).mock.results[0].value;
      const sent = vi.mocked(terminal.sendText).mock.calls[0][0] as string;
      expect(sent).toContain(`export PATH='/gs/3.7.4/bin':"$PATH"`);
      // Stone-specific vars are still re-asserted verbatim...
      expect(sent).toContain('export GEMSTONE_SYS_CONF=');
      // ...but the fixed system dirs are NOT re-exported over the user's PATH.
      expect(sent).not.toContain('/usr/local/bin:/usr/bin:/bin');
    });
  });

  describe('gem temp-object cache self-heal (via startNetldi)', () => {
    function dbWithGemConf(cacheLine: string | null): {
      db: ReturnType<typeof makeDatabase>;
      confFile: string;
    } {
      const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'pm-db-'));
      fs.mkdirSync(nodePath.join(dir, 'conf'));
      fs.mkdirSync(nodePath.join(dir, 'log'), { recursive: true });
      const confFile = nodePath.join(dir, 'conf', 'gem.conf');
      fs.writeFileSync(confFile, `# gem config\n${cacheLine ?? ''}`);
      return { db: makeDatabase({ path: dir }), confFile };
    }

    it('raises an existing 50 MB cache to 500 MB on start', async () => {
      const { db, confFile } = dbWithGemConf('GEM_TEMPOBJ_CACHE_SIZE = 50000;');
      const manager = new ProcessManager(makeStorage());
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const promise = manager.startNetldi(db);
      proc.finish();
      await promise;

      expect(fs.readFileSync(confFile, 'utf8')).toContain('GEM_TEMPOBJ_CACHE_SIZE = 500000;');
      expect(fs.readFileSync(confFile, 'utf8')).not.toContain('50000;');
    });

    it('adds the cache setting when the conf lacks it', async () => {
      const { db, confFile } = dbWithGemConf(null);
      const manager = new ProcessManager(makeStorage());
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const promise = manager.startNetldi(db);
      proc.finish();
      await promise;

      expect(fs.readFileSync(confFile, 'utf8')).toContain('GEM_TEMPOBJ_CACHE_SIZE = 500000;');
    });

    it('leaves an already-adequate cache untouched', async () => {
      const { db, confFile } = dbWithGemConf('GEM_TEMPOBJ_CACHE_SIZE = 2000000;');
      const manager = new ProcessManager(makeStorage());
      const proc = makeChildProcess(0);
      mockSpawnReturn(proc);

      const promise = manager.startNetldi(db);
      proc.finish();
      await promise;

      expect(fs.readFileSync(confFile, 'utf8')).toContain('GEM_TEMPOBJ_CACHE_SIZE = 2000000;');
    });
  });
});
