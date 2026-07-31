import { describe, it, expect, vi } from 'vitest';

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
});
