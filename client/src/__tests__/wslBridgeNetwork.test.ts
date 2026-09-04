import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
  exec: vi.fn(),
  // `wslExec` passes its script to wsl.exe as argv rather than inside a quoted
  // command line, so the module promisifies execFile as well as exec.
  execFile: vi.fn(),
}));

import * as fs from 'fs';
import { exec, execSync, type ChildProcess } from 'child_process';
import {
  parseWslConfigForMirrored,
  parseWslCoreVersion,
  isMirroredCapable,
  getWslIpAddressAsync,
  getWslCoreVersionAsync,
  refreshWslNetworkInfo,
  invalidateWslNetworkCache,
  getWslNetworkInfoCached,
  updateWslConfigMirrored,
  wslExecSync,
} from '../wslBridge';

// ── Helpers ────────────────────────────────────────────────

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Make exec call its callback with the given stdout. */
function mockExec(stdout: string) {
  vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
    cb?.(null, stdout, '');
    return {} as ChildProcess;
  });
}

function mockExecError() {
  vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
    cb?.(new Error('fail'), '', '');
    return {} as ChildProcess;
  });
}

/** Route stdout per command substring — useful when refreshWslNetworkInfo
 *  fans out into multiple exec calls (hostname + version). */
function mockExecByCommand(table: Array<{ match: RegExp; stdout?: string; error?: boolean }>) {
  vi.mocked(exec).mockImplementation((cmd, _opts, cb) => {
    for (const row of table) {
      if (row.match.test(String(cmd))) {
        if (row.error) {
          cb?.(new Error('fail'), '', '');
          return {} as ChildProcess;
        }
        cb?.(null, row.stdout ?? '', '');
        return {} as ChildProcess;
      }
    }
    cb?.(new Error('no match'), '', '');
    return {} as ChildProcess;
  });
}

// ── parseWslConfigForMirrored ──────────────────────────────

describe('parseWslConfigForMirrored', () => {
  it('returns true for networkingMode=mirrored under [wsl2]', () => {
    const content = '[wsl2]\nnetworkingMode=mirrored\n';
    expect(parseWslConfigForMirrored(content)).toBe(true);
  });

  it('is case-insensitive on key, value, and section', () => {
    const content = '[WSL2]\nNetworkingMode = Mirrored\n';
    expect(parseWslConfigForMirrored(content)).toBe(true);
  });

  it('tolerates whitespace around key and value', () => {
    const content = '[wsl2]\n   networkingMode   =   mirrored   \n';
    expect(parseWslConfigForMirrored(content)).toBe(true);
  });

  it('returns false for networkingMode=nat', () => {
    const content = '[wsl2]\nnetworkingMode=nat\n';
    expect(parseWslConfigForMirrored(content)).toBe(false);
  });

  it('returns false when key is outside [wsl2]', () => {
    const content = '[other]\nnetworkingMode=mirrored\n';
    expect(parseWslConfigForMirrored(content)).toBe(false);
  });

  it('returns false for empty file', () => {
    expect(parseWslConfigForMirrored('')).toBe(false);
  });

  it('ignores # comments', () => {
    const content = '[wsl2]\n# networkingMode=mirrored\nnetworkingMode=nat\n';
    expect(parseWslConfigForMirrored(content)).toBe(false);
  });

  it('ignores ; comments', () => {
    const content = '[wsl2]\n; networkingMode=mirrored\n';
    expect(parseWslConfigForMirrored(content)).toBe(false);
  });

  it('handles CRLF line endings', () => {
    const content = '[wsl2]\r\nnetworkingMode=mirrored\r\n';
    expect(parseWslConfigForMirrored(content)).toBe(true);
  });

  it('honors the last section only for keys in that section', () => {
    const content = '[wsl2]\nnetworkingMode=mirrored\n[other]\nnetworkingMode=nat\n';
    expect(parseWslConfigForMirrored(content)).toBe(true);
  });
});

// ── getWslIpAddressAsync ───────────────────────────────────

describe('getWslIpAddressAsync', () => {
  let originalPlatform: string;
  beforeEach(() => {
    originalPlatform = process.platform;
    vi.clearAllMocks();
  });
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('returns undefined when not on Windows', async () => {
    setPlatform('linux');
    await expect(getWslIpAddressAsync()).resolves.toBeUndefined();
  });

  it('returns the first IPv4 from hostname -I output', async () => {
    setPlatform('win32');
    mockExec('172.29.240.2 fe80::1\n');
    await expect(getWslIpAddressAsync()).resolves.toBe('172.29.240.2');
  });

  it('skips leading non-IPv4 tokens and returns the first IPv4', async () => {
    setPlatform('win32');
    mockExec('fe80::1234 10.0.0.5 \n');
    await expect(getWslIpAddressAsync()).resolves.toBe('10.0.0.5');
  });

  it('returns undefined when output has no IPv4 address', async () => {
    setPlatform('win32');
    mockExec('fe80::1\n');
    await expect(getWslIpAddressAsync()).resolves.toBeUndefined();
  });

  it('returns undefined when exec errors', async () => {
    setPlatform('win32');
    mockExecError();
    await expect(getWslIpAddressAsync()).resolves.toBeUndefined();
  });
});

// ── refreshWslNetworkInfo ──────────────────────────────────

describe('refreshWslNetworkInfo', () => {
  let originalPlatform: string;
  beforeEach(() => {
    originalPlatform = process.platform;
    vi.clearAllMocks();
    invalidateWslNetworkCache();
  });
  afterEach(() => {
    setPlatform(originalPlatform);
    invalidateWslNetworkCache();
  });

  it('on non-Windows returns a disabled result without touching exec', async () => {
    setPlatform('linux');
    const info = await refreshWslNetworkInfo();
    expect(info).toEqual({
      mirrored: false,
      ip: undefined,
      netldiHost: undefined,
      wslCoreVersion: undefined,
      supportsMirrored: false,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('on Windows with mirrored config skips the IP probe but still checks WSL core version', async () => {
    setPlatform('win32');
    vi.mocked(fs.readFileSync).mockReturnValue('[wsl2]\nnetworkingMode=mirrored\n');
    mockExecByCommand([{ match: /--version/, stdout: 'WSL version: 2.0.9.0\n' }]);
    const info = await refreshWslNetworkInfo();
    expect(info).toEqual({
      mirrored: true,
      ip: undefined,
      netldiHost: 'localhost',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
    // IP probe (hostname -I) should NOT run when mirrored is true.
    const calls = vi.mocked(exec).mock.calls;
    expect(calls.some((c) => /hostname -I/.test(String(c[0])))).toBe(false);
  });

  it('on Windows without mirrored config probes both IP and core version', async () => {
    setPlatform('win32');
    vi.mocked(fs.readFileSync).mockReturnValue('[wsl2]\n');
    mockExecByCommand([
      { match: /hostname -I/, stdout: '172.29.240.2\n' },
      { match: /--version/, stdout: 'WSL version: 2.0.9.0\n' },
    ]);
    const info = await refreshWslNetworkInfo();
    expect(info).toEqual({
      mirrored: false,
      ip: '172.29.240.2',
      netldiHost: '172.29.240.2',
      wslCoreVersion: '2.0.9.0',
      supportsMirrored: true,
    });
  });

  it('on older WSL where --version errors, reports supportsMirrored=false', async () => {
    setPlatform('win32');
    vi.mocked(fs.readFileSync).mockReturnValue('[wsl2]\n');
    mockExecByCommand([
      { match: /hostname -I/, stdout: '10.0.0.5\n' },
      { match: /--version/, error: true },
    ]);
    const info = await refreshWslNetworkInfo();
    expect(info.wslCoreVersion).toBeUndefined();
    expect(info.supportsMirrored).toBe(false);
    expect(info.ip).toBe('10.0.0.5');
  });

  it('on Windows with no .wslconfig (read throws) falls back to a non-mirrored IP probe', async () => {
    setPlatform('win32');
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    mockExecByCommand([
      { match: /hostname -I/, stdout: '10.0.0.5\n' },
      { match: /--version/, stdout: 'WSL version: 2.0.9.0\n' },
    ]);
    const info = await refreshWslNetworkInfo();
    expect(info.mirrored).toBe(false);
    expect(info.netldiHost).toBe('10.0.0.5');
  });

  it('leaves netldiHost undefined when mirrored is false and IP probe fails', async () => {
    setPlatform('win32');
    vi.mocked(fs.readFileSync).mockReturnValue('[wsl2]\n');
    mockExecError();
    const info = await refreshWslNetworkInfo();
    expect(info.netldiHost).toBeUndefined();
    expect(info.mirrored).toBe(false);
  });

  it('caches the last result for getWslNetworkInfoCached', async () => {
    setPlatform('win32');
    vi.mocked(fs.readFileSync).mockReturnValue('[wsl2]\nnetworkingMode=mirrored\n');
    mockExecByCommand([{ match: /--version/, stdout: 'WSL version: 2.0.9.0\n' }]);
    expect(getWslNetworkInfoCached()).toBeUndefined();
    await refreshWslNetworkInfo();
    expect(getWslNetworkInfoCached()).toMatchObject({
      mirrored: true,
      netldiHost: 'localhost',
      supportsMirrored: true,
    });
  });

  it('invalidateWslNetworkCache resets the cache', async () => {
    setPlatform('win32');
    vi.mocked(fs.readFileSync).mockReturnValue('[wsl2]\nnetworkingMode=mirrored\n');
    mockExecByCommand([{ match: /--version/, stdout: 'WSL version: 2.0.9.0\n' }]);
    await refreshWslNetworkInfo();
    expect(getWslNetworkInfoCached()).toBeDefined();
    invalidateWslNetworkCache();
    expect(getWslNetworkInfoCached()).toBeUndefined();
  });
});

// ── parseWslCoreVersion + isMirroredCapable ────────────────

describe('parseWslCoreVersion', () => {
  it('parses the English "WSL version: X.Y.Z.W" header line', () => {
    const out = 'WSL version: 2.0.9.0\nKernel version: 5.15\n';
    expect(parseWslCoreVersion(out)).toBe('2.0.9.0');
  });

  it('handles NUL-byte UTF-16 leftover from wsl.exe', () => {
    // Intersperse NUL bytes to mimic UTF-16LE being decoded as UTF-8.
    const out = 'WSL version: 2.0.9.0\n'.split('').join('\u0000') + '\u0000';
    expect(parseWslCoreVersion(out)).toBe('2.0.9.0');
  });

  it('handles CRLF line endings', () => {
    expect(parseWslCoreVersion('WSL version: 1.2.5.0\r\n')).toBe('1.2.5.0');
  });

  it('accepts a localized header as long as the line contains "WSL" and a version', () => {
    // Mirroring real WSL output where only the numeric token is portable.
    expect(parseWslCoreVersion('版本 WSL: 2.1.0.0\n')).toBe('2.1.0.0');
  });

  it('returns undefined for empty input', () => {
    expect(parseWslCoreVersion('')).toBeUndefined();
  });

  it('returns undefined when no line mentions WSL', () => {
    expect(parseWslCoreVersion('Kernel version: 5.15.133\n')).toBeUndefined();
  });
});

describe('isMirroredCapable', () => {
  it('returns true for 2.0+', () => {
    expect(isMirroredCapable('2.0.9.0')).toBe(true);
    expect(isMirroredCapable('2.1.0.0')).toBe(true);
    expect(isMirroredCapable('3.0')).toBe(true);
  });

  it('returns false for < 2.0', () => {
    expect(isMirroredCapable('1.2.5.0')).toBe(false);
    expect(isMirroredCapable('0.64.0')).toBe(false);
  });

  it('returns false for undefined or non-numeric', () => {
    expect(isMirroredCapable(undefined)).toBe(false);
    expect(isMirroredCapable('')).toBe(false);
    expect(isMirroredCapable('abc')).toBe(false);
  });
});

// ── getWslCoreVersionAsync ─────────────────────────────────

describe('getWslCoreVersionAsync', () => {
  let originalPlatform: string;
  beforeEach(() => {
    originalPlatform = process.platform;
    vi.clearAllMocks();
  });
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('returns undefined when not on Windows', async () => {
    setPlatform('linux');
    await expect(getWslCoreVersionAsync()).resolves.toBeUndefined();
  });

  it('returns the parsed version when exec succeeds', async () => {
    setPlatform('win32');
    mockExec('WSL version: 2.0.9.0\n');
    await expect(getWslCoreVersionAsync()).resolves.toBe('2.0.9.0');
  });

  it('returns undefined when exec errors (pre-0.64 WSL)', async () => {
    setPlatform('win32');
    mockExecError();
    await expect(getWslCoreVersionAsync()).resolves.toBeUndefined();
  });
});

// ── updateWslConfigMirrored ────────────────────────────────

describe('updateWslConfigMirrored', () => {
  it('creates a new [wsl2] section when the file is empty', () => {
    const out = updateWslConfigMirrored('');
    expect(out).toBe('[wsl2]\nnetworkingMode=mirrored\n');
  });

  it('appends a [wsl2] section when only [other] exists', () => {
    const input = '[other]\nkey=value\n';
    const out = updateWslConfigMirrored(input);
    expect(out).toMatch(/\[other\]\s*\nkey=value\s*\n\[wsl2\]\s*\nnetworkingMode=mirrored\s*\n$/);
  });

  it('replaces an existing networkingMode value in [wsl2]', () => {
    const input = '[wsl2]\nnetworkingMode=nat\nmemory=8GB\n';
    const out = updateWslConfigMirrored(input);
    expect(out).toBe('[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\n');
  });

  it('inserts networkingMode as the first key in [wsl2] when absent', () => {
    const input = '[wsl2]\nmemory=8GB\n';
    const out = updateWslConfigMirrored(input);
    expect(out).toBe('[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\n');
  });

  it('only replaces the key inside [wsl2], not a same-named key in another section', () => {
    const input = '[other]\nnetworkingMode=weird\n[wsl2]\nmemory=8GB\n';
    const out = updateWslConfigMirrored(input);
    expect(out).toContain('[other]\nnetworkingMode=weird');
    expect(out).toContain('[wsl2]\nnetworkingMode=mirrored\nmemory=8GB');
  });

  it('preserves CRLF line endings when the input uses them', () => {
    const input = '[wsl2]\r\nmemory=8GB\r\n';
    const out = updateWslConfigMirrored(input);
    expect(out).toBe('[wsl2]\r\nnetworkingMode=mirrored\r\nmemory=8GB\r\n');
  });

  it('is a no-op when networkingMode is already mirrored', () => {
    const input = '[wsl2]\nnetworkingMode=mirrored\n';
    expect(updateWslConfigMirrored(input)).toBe(input);
  });
});

describe('wslExecSync', () => {
  const realPlatform = process.platform;
  afterEach(() => {
    setPlatform(realPlatform);
    vi.mocked(execSync).mockReset();
  });

  it('blanks BASH_ENV on Linux so a startup file cannot rewrite the environment', () => {
    // Parity with wslSpawn: execSync runs through /bin/sh, which is bash on many
    // distros, so a BASH_ENV file could `unset GEMSTONE` out from under gslist.
    setPlatform('linux');
    vi.mocked(execSync).mockReturnValue('ok');

    wslExecSync('gslist -cvl', { GEMSTONE: '/gs/3.7.4' });

    const options = vi.mocked(execSync).mock.calls[0][1] as { env?: Record<string, string> };
    expect(options.env?.BASH_ENV).toBe('');
    expect(options.env?.GEMSTONE).toBe('/gs/3.7.4');
  });
});
