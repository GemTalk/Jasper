import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('child_process');
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../wslBridge', async () => {
  // Keep wslSpawn / windowsPathToWsl real so the existing startStone tests
  // continue to drive the child_process mock; only override wslExecSync and
  // needsWsl, which the new stale-lock tests need to control.
  const actual = await vi.importActual<typeof import('../wslBridge')>('../wslBridge');
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
} from '../processManager';
import { GemStoneDatabase, GemStoneProcess } from '../sysadminTypes';
import * as wslBridge from '../wslBridge';
import { SysadminStorage } from '../sysadminStorage';

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

/** Create a mock ChildProcess that emits 'close' with the given exit code. */
function makeChildProcess(exitCode = 0) {
  const stdoutListeners: Array<(data: Buffer) => void> = [];
  const stderrListeners: Array<(data: Buffer) => void> = [];
  let closeCallback: ((code: number) => void) | undefined;

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
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') closeCallback = cb;
    }),
    // Call this to simulate the process finishing
    finish() {
      closeCallback?.(exitCode);
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
      expect(args[0]).toBe('-c');
      expect(args[1]).toBe('ulimit -n 1024; exec "$@"');
      expect(args[2]).toBe('--');
      // The actual startstone binary should follow as the first exec argument
      expect(args[3]).toContain('startstone');
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

      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toBe('/bin/bash');
      expect(args[3]).toContain('startnetldi');
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

    it('SIGTERMs a running stone, clears its lock, and reports recovery', async () => {
      const manager = new ProcessManager(makeStorage());
      vi.spyOn(manager, 'refreshProcesses').mockReturnValue([staleStone()]);
      vi.mocked(wslBridge.wslExecSync)
        .mockReturnValueOnce('/gs/sys/stoned -l /log gs64stone')
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
        .mockReturnValueOnce('/gs/sys/stoned -l /log gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('/gs/sys/stoned -l /log gs64stone')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('GONE')
        .mockReturnValueOnce('');

      const result = await manager.forceKillStone(makeDatabase(), { graceMs: 0 });

      expect(result.killed).toBe(true);
      const commands = vi.mocked(wslBridge.wslExecSync).mock.calls.map((c) => c[0]);
      expect(commands.some((c) => /^kill -9 4106/.test(c))).toBe(true);
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
      // Still not tied to a particular stone.
      expect(options.env?.GEMSTONE_SYS_CONF).toBeUndefined();
      expect(options.env?.GEMSTONE_NRS_ALL).toBeUndefined();
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

      expect(() => manager.openVersionTerminal('9.9.9')).toThrow(/not found/);
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
