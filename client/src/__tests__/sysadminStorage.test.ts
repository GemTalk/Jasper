import { describe, it, expect, vi, afterEach } from 'vitest';
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
import { appendSysadmin } from '../sysadminChannel';
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
  /** Root can read a folder whatever its mode, so a run as root would prove
   *  nothing — and should say it was skipped rather than report a pass. */
  const unreadableRootIt = process.getuid?.() === 0 ? it.skip : onSupportedPosixIt;
  let dir: string | undefined;

  /** A directory that exists and refuses to open, named as the root path. */
  function unreadableRoot(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-noperm-'));
    fs.chmodSync(dir, 0o000);
    __setConfig('gemstone', 'rootPath', dir);
    return dir;
  }

  afterEach(() => {
    if (dir) {
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    __resetConfig();
  });

  // One of these scans runs while the extension is activating, where a throw
  // stopped every GemStone command from being registered — the panel that would
  // have reported it included.
  unreadableRootIt('lists nothing rather than throwing', () => {
    unreadableRoot();
    const storage = new SysadminStorage();
    expect(storage.getExtractedVersionInfos(true)).toEqual([]);
    expect(storage.getDownloadedFiles().size).toBe(0);
    expect(storage.getDatabases()).toEqual([]);
  });

  // Listing nothing is the same answer an empty folder gives, and the panel
  // cannot say "no versions installed" about a folder it never managed to read.
  unreadableRootIt('can still be told apart from an empty one', () => {
    unreadableRoot();
    expect(new SysadminStorage().rootPathProblem()).toContain('EACCES');
  });

  // Said once while it stays broken, but a folder that is fixed and then breaks
  // again is news, and the log has to say so.
  unreadableRootIt('is named again when it breaks a second time', () => {
    const root = unreadableRoot();
    vi.mocked(appendSysadmin).mockClear();
    const storage = new SysadminStorage();
    const said = () =>
      vi.mocked(appendSysadmin).mock.calls.filter(([line]) => line.startsWith('Could not read'));

    storage.getDownloadedFiles();
    storage.getDownloadedFiles();
    expect(said()).toHaveLength(1);

    fs.chmodSync(root, 0o755);
    storage.getDownloadedFiles();
    fs.chmodSync(root, 0o000);
    storage.getDownloadedFiles();
    expect(said()).toHaveLength(2);
  });

  it('reports no problem for a folder that is simply not there yet', () => {
    __setConfig('gemstone', 'rootPath', path.join(os.tmpdir(), 'jasper-absent-root-xyz'));
    expect(new SysadminStorage().rootPathProblem()).toBeUndefined();
  });
});
