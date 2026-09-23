import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { onSupportedPosixIt } from './platformGates';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../wslBridge', () => ({
  isWindows: () => false,
  needsWsl: () => false,
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
}));

import { SysadminStorage } from '../sysadminStorage';
import { __setConfig, __resetConfig } from '../__mocks__/vscode';

/** Run `fn` with process.platform/arch temporarily overridden, then restore. */
function withPlatform(platform: NodeJS.Platform, arch: string, fn: () => void): void {
  const origPlatform = process.platform;
  const origArch = process.arch;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
  }
}

describe('SysadminStorage.getPlatformKey on Darwin', () => {
  it('maps Apple silicon to arm64.Darwin', () => {
    withPlatform('darwin', 'arm64', () => {
      expect(new SysadminStorage().getPlatformKey()).toBe('arm64.Darwin');
    });
  });

  it('maps Intel Macs to i386.Darwin (historic GemStone name), never x86_64.Darwin', () => {
    // x86_64.Darwin does not exist on downloads.gemtalksystems.com and would 404;
    // GemStone's Darwin x86_64 build is published under i386.Darwin.
    withPlatform('darwin', 'x64', () => {
      const key = new SysadminStorage().getPlatformKey();
      expect(key).toBe('i386.Darwin');
      expect(key).not.toBe('x86_64.Darwin');
    });
  });

  it('uses the real platform key as the catalog key on Intel Macs (no Linux fallback)', () => {
    withPlatform('darwin', 'x64', () => {
      expect(new SysadminStorage().getCatalogPlatformKey()).toBe('i386.Darwin');
    });
  });

  it('falls back to x86_64.Linux when there is no local server platform', () => {
    withPlatform('win32', 'x64', () => {
      expect(new SysadminStorage().getPlatformKey()).toBeUndefined();
      expect(new SysadminStorage().getCatalogPlatformKey()).toBe('x86_64.Linux');
    });
  });
});

describe('a root path that cannot be read', () => {
  /** A directory that exists and refuses to open. Root can read it anyway, so a
   *  test run as root would prove nothing and is skipped. */
  function unreadableRoot(): string | undefined {
    if (process.getuid?.() === 0) return undefined;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-noperm-'));
    fs.chmodSync(dir, 0o000);
    __setConfig('gemstone', 'rootPath', dir);
    return dir;
  }

  // One of these scans runs while the extension is activating, where a throw
  // stopped every GemStone command from being registered — the panel that would
  // have reported it included.
  onSupportedPosixIt('lists nothing rather than throwing', () => {
    const dir = unreadableRoot();
    if (!dir) return;
    try {
      const storage = new SysadminStorage();
      expect(storage.getExtractedVersionInfos(true)).toEqual([]);
      expect(storage.getDownloadedFiles().size).toBe(0);
      expect(storage.getDatabases()).toEqual([]);
    } finally {
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
      __resetConfig();
    }
  });

  // Listing nothing is the same answer an empty folder gives, and the panel
  // cannot say "no versions installed" about a folder it never managed to read.
  onSupportedPosixIt('can still be told apart from an empty one', () => {
    const dir = unreadableRoot();
    if (!dir) return;
    try {
      expect(new SysadminStorage().rootPathProblem()).toContain('EACCES');
    } finally {
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
      __resetConfig();
    }
  });

  it('reports no problem for a folder that is simply not there yet', () => {
    __setConfig('gemstone', 'rootPath', path.join(os.tmpdir(), 'jasper-absent-root-xyz'));
    try {
      expect(new SysadminStorage().rootPathProblem()).toBeUndefined();
    } finally {
      __resetConfig();
    }
  });
});
