import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onSupportedPosixIt } from './platformGates';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

import type * as vscode from 'vscode';
import { __setConfig, __resetConfig } from '../__mocks__/vscode';
import { SysadminStorage } from '../sysadminStorage';
import { VersionManager } from '../versionManager';
import { VersionItem } from '../versionTreeProvider';
import { GemStoneVersion } from '../sysadminTypes';

/** VersionManager's private `fetchUrl`, exposed as a narrow surface for spying. */
type FetchUrlHost = { fetchUrl(url: string): Promise<string> };

// ── Helpers ────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  __resetConfig();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-test-'));
  __setConfig('gemstone', 'rootPath', tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeVersionTxt(dir: string, content: string): void {
  fs.writeFileSync(path.join(dir, 'version.txt'), content);
}

const SAMPLE_VERSION_TXT = `GemStone/S 64 Bit
3.7.6 Build: 2026-03-24T16:26:18-07:00 33994442e3683e07316c37898dec65099700dee5
Tue Mar 24 16:45:27 2026 jfoster private build (branch 3.7.6)`;

// ── SysadminStorage.readVersionTxt ─────────────────────────

describe('SysadminStorage.readVersionTxt', () => {
  it('parses a valid version.txt', () => {
    const dir = path.join(tmpDir, 'product');
    fs.mkdirSync(dir);
    writeVersionTxt(dir, SAMPLE_VERSION_TXT);

    const result = SysadminStorage.readVersionTxt(dir);
    expect(result).toEqual({
      version: '3.7.6',
      date: '2026-03-24',
      description: 'Tue Mar 24 16:45:27 2026 jfoster private build (branch 3.7.6)',
    });
  });

  it('returns undefined when version.txt is missing', () => {
    expect(SysadminStorage.readVersionTxt(tmpDir)).toBeUndefined();
  });

  it('returns undefined when version.txt has fewer than 2 lines', () => {
    writeVersionTxt(tmpDir, 'GemStone/S 64 Bit\n');
    expect(SysadminStorage.readVersionTxt(tmpDir)).toBeUndefined();
  });

  it('returns undefined when line 2 does not match expected format', () => {
    writeVersionTxt(tmpDir, 'GemStone/S 64 Bit\nsome garbage line\nthird line');
    expect(SysadminStorage.readVersionTxt(tmpDir)).toBeUndefined();
  });

  it('handles version.txt with only 2 lines (no description)', () => {
    writeVersionTxt(tmpDir, 'GemStone/S 64 Bit\n3.7.6 Build: 2026-03-24T16:26:18-07:00 abc123');
    const result = SysadminStorage.readVersionTxt(tmpDir);
    expect(result).toEqual({
      version: '3.7.6',
      date: '2026-03-24',
      description: '',
    });
  });
});

// ── SysadminStorage.isLocalVersion ─────────────────────────

describe('SysadminStorage.isLocalVersion', () => {
  let storage: SysadminStorage;

  beforeEach(() => {
    storage = new SysadminStorage();
  });

  onSupportedPosixIt('returns true for a symlinked version directory', () => {
    const productDir = path.join(tmpDir, 'product');
    fs.mkdirSync(productDir);
    const suffix = storage.getPlatformSuffix();
    fs.symlinkSync(productDir, path.join(tmpDir, `GemStone64Bit3.7.6${suffix}`));

    expect(storage.isLocalVersion('3.7.6')).toBe(true);
  });

  it('returns false for a real directory', () => {
    const suffix = storage.getPlatformSuffix();
    fs.mkdirSync(path.join(tmpDir, `GemStone64Bit3.7.4${suffix}`));

    expect(storage.isLocalVersion('3.7.4')).toBe(false);
  });

  it('returns false for a non-existent version', () => {
    expect(storage.isLocalVersion('9.9.9')).toBe(false);
  });
});

// ── VersionManager.deleteExtracted (symlink safety) ────────

describe('VersionManager.deleteExtracted', () => {
  let storage: SysadminStorage;
  let manager: VersionManager;

  beforeEach(() => {
    storage = new SysadminStorage();
    manager = new VersionManager(storage);
  });

  onSupportedPosixIt('only removes the symlink, not the target directory', async () => {
    const productDir = path.join(tmpDir, 'product');
    fs.mkdirSync(productDir);
    fs.writeFileSync(path.join(productDir, 'sentinel.txt'), 'do not delete');

    const suffix = storage.getPlatformSuffix();
    const linkPath = path.join(tmpDir, `GemStone64Bit3.7.6${suffix}`);
    fs.symlinkSync(productDir, linkPath);

    const version: GemStoneVersion = {
      version: '3.7.6',
      fileName: '',
      url: '',
      size: 0,
      date: '',
      downloaded: false,
      extracted: true,
      local: true,
    };

    await manager.deleteExtracted(version);

    // Symlink should be gone
    expect(fs.existsSync(linkPath)).toBe(false);
    // Original directory and contents should still exist
    expect(fs.existsSync(productDir)).toBe(true);
    expect(fs.readFileSync(path.join(productDir, 'sentinel.txt'), 'utf-8')).toBe('do not delete');
  });
});

// ── VersionTreeProvider (local version display) ─────────────

describe('VersionItem (local version)', () => {
  it('shows folder icon and "(local)" description for local versions', () => {
    const version: GemStoneVersion = {
      version: '3.7.6',
      fileName: '',
      url: '',
      size: 0,
      date: '2026-03-24',
      downloaded: false,
      extracted: true,
      local: true,
      buildDescription: 'private build (branch 3.7.6)',
    };

    const item = new VersionItem(version);

    expect(item.contextValue).toBe('gemstoneVersionLocal');
    expect(item.description).toContain('(local)');
    expect(item.description).toContain('2026-03-24');
    expect((item.iconPath as vscode.ThemeIcon).id).toBe('check');
    expect(item.tooltip).toContain('local build');
    expect(item.tooltip).toContain('private build (branch 3.7.6)');
  });

  it('shows standard icons for non-local versions', () => {
    const version: GemStoneVersion = {
      version: '3.7.4',
      fileName: 'GemStone64Bit3.7.4-arm64.Darwin.dmg',
      url: 'https://example.com/file.dmg',
      size: 100_000_000,
      date: '24-Mar-2026',
      downloaded: false,
      extracted: false,
    };

    const item = new VersionItem(version);

    expect(item.contextValue).toBe('gemstoneVersion');
    expect((item.iconPath as vscode.ThemeIcon).id).toBe('cloud');
    expect(item.description).toContain('100 MB');
  });

  it('shows check icon for extracted non-local versions', () => {
    const version: GemStoneVersion = {
      version: '3.7.4',
      fileName: 'file.dmg',
      url: '',
      size: 50_000_000,
      date: '24-Mar-2026',
      downloaded: true,
      extracted: true,
    };

    const item = new VersionItem(version);

    expect(item.contextValue).toBe('gemstoneVersionServerDownloadedServerExtracted');
    expect((item.iconPath as vscode.ThemeIcon).id).toBe('check');
  });

  it('marks a bundled version in description, contextValue, and tooltip', () => {
    const version: GemStoneVersion = {
      version: '3.7.5',
      fileName: 'GemStone64BitClient3.7.5-x86.Windows_NT.zip',
      url: '',
      size: 0,
      date: '24-Mar-2026',
      downloaded: false,
      extracted: false,
      bundled: true,
    };

    const item = new VersionItem(version);

    // The Bundled suffix drops the row out of the download command's anchored
    // `when` regex, so no download is offered.
    expect(item.contextValue).toBe('gemstoneVersionBundled');
    expect(item.description).toContain('bundled');
    expect(item.tooltip).toContain('bundled');
  });

  it('renders a hand-placed product directory as extracted and ready to use', () => {
    const version: GemStoneVersion = {
      version: '4.0.0',
      fileName: '',
      url: '',
      size: 0,
      date: '2026-07-01',
      downloaded: false,
      extracted: true,
      buildDescription: 'private 4.0 build',
    };

    const item = new VersionItem(version);

    // ServerExtracted context is what offers Create Database / Delete Extracted.
    expect(item.contextValue).toBe('gemstoneVersionServerExtracted');
    expect((item.iconPath as vscode.ThemeIcon).id).toBe('check');
  });
});

// ── VersionManager.fetchAvailableVersions (local inclusion) ──

describe('VersionManager.fetchAvailableVersions', () => {
  onSupportedPosixIt('includes local symlinked versions in the list', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);

    // Create a fake product directory with version.txt
    const productDir = path.join(tmpDir, 'product');
    fs.mkdirSync(productDir);
    writeVersionTxt(productDir, SAMPLE_VERSION_TXT);

    // Symlink it into the root path
    const suffix = storage.getPlatformSuffix();
    fs.symlinkSync(productDir, path.join(tmpDir, `GemStone64Bit3.7.6${suffix}`));

    // Mock the network fetch to return empty HTML (no remote versions)
    const fetchSpy = vi.spyOn(manager as unknown as FetchUrlHost, 'fetchUrl').mockResolvedValue('');

    const versions = await manager.fetchAvailableVersions();

    expect(fetchSpy).toHaveBeenCalled();
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe('3.7.6');
    expect(versions[0].local).toBe(true);
    expect(versions[0].date).toBe('2026-03-24');
    expect(versions[0].buildDescription).toContain('private build');
  });

  onSupportedPosixIt(
    'does not mark remote versions as extracted when a local symlink has the same version',
    async () => {
      const storage = new SysadminStorage();
      const manager = new VersionManager(storage);
      const suffix = storage.getPlatformSuffix();
      const platformKey = storage.getPlatformKey();
      const ext = storage.getDownloadExtension();

      // Create a symlinked local version
      const productDir = path.join(tmpDir, 'product');
      fs.mkdirSync(productDir);
      writeVersionTxt(productDir, SAMPLE_VERSION_TXT);
      fs.symlinkSync(productDir, path.join(tmpDir, `GemStone64Bit3.7.6${suffix}`));

      // Mock fetch to return a remote version with the same version number
      const html = `<a href="GemStone64Bit3.7.6-${platformKey}.${ext}">GemStone64Bit3.7.6-${platformKey}.${ext}</a>  24-Mar-2026 12:00  200000000`;
      vi.spyOn(manager as unknown as FetchUrlHost, 'fetchUrl').mockResolvedValue(html);

      const versions = await manager.fetchAvailableVersions();

      const local = versions.find((v) => v.local);
      const remote = versions.find((v) => !v.local);

      expect(local).toBeDefined();
      expect(local!.version).toBe('3.7.6');
      expect(local!.local).toBe(true);

      expect(remote).toBeDefined();
      expect(remote!.version).toBe('3.7.6');
      expect(remote!.extracted).toBe(false); // should NOT show as extracted

      // Local version should sort before remote at the same version
      expect(versions[0].local).toBe(true);
      expect(versions[1].local).toBeUndefined();
    },
  );

  onSupportedPosixIt(
    'sorts versions newest-first with local versions interleaved correctly',
    async () => {
      const storage = new SysadminStorage();
      const manager = new VersionManager(storage);
      const suffix = storage.getPlatformSuffix();
      const platformKey = storage.getPlatformKey();
      const ext = storage.getDownloadExtension();

      // Create a local version at 3.7.6
      const productDir = path.join(tmpDir, 'product');
      fs.mkdirSync(productDir);
      writeVersionTxt(productDir, SAMPLE_VERSION_TXT);
      fs.symlinkSync(productDir, path.join(tmpDir, `GemStone64Bit3.7.6${suffix}`));

      // Mock fetch to return remote versions older and newer than the local one
      const html = [
        `<a href="GemStone64Bit3.6.4-${platformKey}.${ext}">file</a>  06-Jun-2022 12:00  169000000`,
        `<a href="GemStone64Bit3.8.0-${platformKey}.${ext}">file</a>  01-Jan-2027 12:00  200000000`,
      ].join('\n');
      vi.spyOn(manager as unknown as FetchUrlHost, 'fetchUrl').mockResolvedValue(html);

      const versions = await manager.fetchAvailableVersions();

      const versionStrings = versions.map((v) => `${v.version}${v.local ? ' (local)' : ''}`);
      expect(versionStrings).toEqual(['3.8.0', '3.7.6 (local)', '3.6.4']);
    },
  );

  it('excludes remote versions older than the minimum supported gemstone version', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    // getCatalogPlatformKey, not getPlatformKey: production matches the
    // catalog against the former, which falls back to 'x86_64.Linux' when
    // there's no local server platform (e.g. Windows without WSL). Building
    // the fixture with getPlatformKey would diverge from that on such hosts.
    const platformKey = storage.getCatalogPlatformKey();
    const ext = storage.getDownloadExtension();

    const html = [
      `<a href="GemStone64Bit3.6.1-${platformKey}.${ext}">file</a>  01-Jan-2021 12:00  160000000`,
      `<a href="GemStone64Bit3.6.1.9-${platformKey}.${ext}">file</a>  01-Jun-2021 12:00  161000000`,
      `<a href="GemStone64Bit3.6.2-${platformKey}.${ext}">file</a>  01-Jun-2021 12:00  161000000`,
      `<a href="GemStone64Bit3.7.0-${platformKey}.${ext}">file</a>  01-Jan-2022 12:00  170000000`,
    ].join('\n');
    vi.spyOn(manager as unknown as FetchUrlHost, 'fetchUrl').mockResolvedValue(html);

    const versions = await manager.fetchAvailableVersions();

    expect(versions.map((v) => v.version)).toEqual(['3.7.0', '3.6.2']);
  });

  onSupportedPosixIt('keeps a local version even when it is older than 3.6.2', async () => {
    const storage = new SysadminStorage();
    const manager = new VersionManager(storage);
    const suffix = storage.getPlatformSuffix();

    const productDir = path.join(tmpDir, 'product');
    fs.mkdirSync(productDir);
    writeVersionTxt(productDir, SAMPLE_VERSION_TXT);
    fs.symlinkSync(productDir, path.join(tmpDir, `GemStone64Bit3.5.0${suffix}`));

    vi.spyOn(manager as unknown as FetchUrlHost, 'fetchUrl').mockResolvedValue('');

    const versions = await manager.fetchAvailableVersions();

    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe('3.5.0');
    expect(versions[0].local).toBe(true);
  });

  onSupportedPosixIt(
    'includes a locally-built product directory the download catalog does not list',
    async () => {
      const storage = new SysadminStorage();
      const manager = new VersionManager(storage);
      const suffix = storage.getPlatformSuffix();

      // A real product directory (not a symlink) dropped straight into rootPath
      // for a version the catalog has never heard of — e.g. a private 4.0 build.
      const versionDir = path.join(tmpDir, `GemStone64Bit4.0.0${suffix}`);
      fs.mkdirSync(versionDir);
      writeVersionTxt(
        versionDir,
        'GemStone/S 64 Bit\n4.0.0 Build: 2026-07-01T10:00:00-07:00 abcdef\nprivate 4.0 build',
      );

      vi.spyOn(manager as unknown as FetchUrlHost, 'fetchUrl').mockResolvedValue('');

      const versions = await manager.fetchAvailableVersions();

      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe('4.0.0');
      expect(versions[0].extracted).toBe(true);
      expect(versions[0].local).toBeUndefined(); // a real dir, not a symlink — never marked "(local)"
      expect(versions[0].date).toBe('2026-07-01');
    },
  );

  onSupportedPosixIt(
    'lists a catalog version present as a real directory only once, marked extracted',
    async () => {
      const storage = new SysadminStorage();
      const manager = new VersionManager(storage);
      const suffix = storage.getPlatformSuffix();
      const platformKey = storage.getPlatformKey();
      const ext = storage.getDownloadExtension();

      const versionDir = path.join(tmpDir, `GemStone64Bit3.7.4${suffix}`);
      fs.mkdirSync(versionDir);
      writeVersionTxt(versionDir, 'GemStone/S 64 Bit\n3.7.4 Build: 2026-01-01T10:00:00-07:00 abc');

      const html = `<a href="GemStone64Bit3.7.4-${platformKey}.${ext}">file</a>  01-Jan-2026 12:00  200000000`;
      vi.spyOn(manager as unknown as FetchUrlHost, 'fetchUrl').mockResolvedValue(html);

      const versions = await manager.fetchAvailableVersions();

      const matching = versions.filter((v) => v.version === '3.7.4');
      expect(matching).toHaveLength(1);
      expect(matching[0].extracted).toBe(true);
    },
  );
});

// ── GCI library auto-detection ───────────────────────────────

describe('GCI library auto-detection', () => {
  const libExt =
    process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';

  it('finds GCI library in extracted version lib/ directory', () => {
    const storage = new SysadminStorage();
    const suffix = storage.getPlatformSuffix();

    // Create an extracted version with a GCI library
    const versionDir = path.join(tmpDir, `GemStone64Bit3.7.4${suffix}`);
    const libDir = path.join(versionDir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    const libName = `libgcits-3.7.4-64.${libExt}`;
    fs.writeFileSync(path.join(libDir, libName), '');

    // Simulate the auto-detect logic from extension.ts
    const gsPath = storage.getGemstonePath('3.7.4');
    expect(gsPath).toBeDefined();
    const candidate = path.join(gsPath!, 'lib', libName);
    expect(fs.existsSync(candidate)).toBe(true);
  });

  onSupportedPosixIt('finds GCI library in symlinked local version', () => {
    const storage = new SysadminStorage();
    const suffix = storage.getPlatformSuffix();

    // Create a product directory with a GCI library
    const productDir = path.join(tmpDir, 'product');
    const libDir = path.join(productDir, 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    const libName = `libgcits-3.7.6-64.${libExt}`;
    fs.writeFileSync(path.join(libDir, libName), '');

    // Symlink it
    fs.symlinkSync(productDir, path.join(tmpDir, `GemStone64Bit3.7.6${suffix}`));

    const gsPath = storage.getGemstonePath('3.7.6');
    expect(gsPath).toBeDefined();
    const candidate = path.join(gsPath!, 'lib', libName);
    expect(fs.existsSync(candidate)).toBe(true);
  });

  it('returns undefined for version without extracted directory', () => {
    const storage = new SysadminStorage();
    expect(storage.getGemstonePath('9.9.9')).toBeUndefined();
  });

  it('does not find GCI library when lib/ directory is missing', () => {
    const storage = new SysadminStorage();
    const suffix = storage.getPlatformSuffix();

    // Create an extracted version without a lib/ directory
    fs.mkdirSync(path.join(tmpDir, `GemStone64Bit3.7.4${suffix}`));

    const gsPath = storage.getGemstonePath('3.7.4');
    expect(gsPath).toBeDefined();
    const candidate = path.join(gsPath!, 'lib', `libgcits-3.7.4-64.${libExt}`);
    expect(fs.existsSync(candidate)).toBe(false);
  });
});
