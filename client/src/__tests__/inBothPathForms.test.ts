import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// No WSL install, so the distro falls back to its default without running wsl.exe.
vi.mock('../wslInstall', () => ({
  isWslInstalled: vi.fn(() => false),
  isWslInstalledAsync: vi.fn(async () => false),
  forgetWslInstalled: vi.fn(),
}));

import { inBothPathForms, invalidateWslCache } from '../wslBridge';

describe('inBothPathForms', () => {
  let originalPlatform: string;

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  beforeEach(() => {
    originalPlatform = process.platform;
    invalidateWslCache();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    invalidateWslCache();
  });

  it('gives a WSL path its Windows form too, on Windows', () => {
    setPlatform('win32');

    expect(inBothPathForms('/home/u/db-1/conf/gemstone.key')).toBe(
      '\\\\wsl$\\Ubuntu\\home\\u\\db-1\\conf\\gemstone.key (in WSL: /home/u/db-1/conf/gemstone.key)',
    );
  });

  it('gives a Windows path into WSL its WSL form too, on Windows', () => {
    setPlatform('win32');

    expect(inBothPathForms('\\\\wsl.localhost\\Ubuntu\\opt\\gs\\sys\\community.starter.key')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\opt\\gs\\sys\\community.starter.key ' +
        '(in WSL: /opt/gs/sys/community.starter.key)',
    );
  });

  it('gives a WSL mount of a Windows drive its drive form', () => {
    setPlatform('win32');

    expect(inBothPathForms('/mnt/c/GemStone/conf/gemstone.key')).toBe(
      'C:\\GemStone\\conf\\gemstone.key (in WSL: /mnt/c/GemStone/conf/gemstone.key)',
    );
  });

  it('leaves a Windows path outside WSL alone', () => {
    setPlatform('win32');

    expect(inBothPathForms('C:\\keys\\gemstone.key')).toBe('C:\\keys\\gemstone.key');
  });

  it('leaves every path alone off Windows', () => {
    setPlatform('linux');

    expect(inBothPathForms('/opt/gs/sys/community.starter.key')).toBe(
      '/opt/gs/sys/community.starter.key',
    );
  });
});
