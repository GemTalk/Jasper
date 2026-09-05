import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseYaml, GemStoneDatabase } from './sysadminTypes';
import { needsWsl, getWslInfo, wslPathToWindows, wslExecSync } from './wslBridge';
import {
  wslExistsSync,
  wslIsDirectory,
  wslIsSymlink,
  wslReaddirSync,
  wslReadFileSync,
} from './wslFs';

export interface ExtractedVersionInfo {
  version: string;
  isLocal: boolean;
}

function parseExtractedRows(out: string, prefix: string, suffix: string): ExtractedVersionInfo[] {
  const result: ExtractedVersionInfo[] = [];
  for (const line of out.split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim();
    if (!trimmed) continue;
    const [type, name] = trimmed.split('\t');
    if (!name || !name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    if (type !== 'd' && type !== 'l') continue;
    result.push({
      version: name.slice(prefix.length, -suffix.length),
      isLocal: type === 'l',
    });
  }
  result.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return result;
}

export class SysadminStorage {
  getRootPath(): string {
    const config = vscode.workspace.getConfiguration('gemstone');
    const raw = config.get<string>('rootPath', '~/Documents/GemStone');
    if (needsWsl()) {
      const wslHome = getWslInfo().homeDir || '/root';
      return wslPathToWindows(raw.replace(/^~/, wslHome));
    }
    return raw.replace(/^~/, os.homedir());
  }

  /** Get the root path as a WSL Linux path (for use in WSL commands) */
  getWslRootPath(): string {
    if (!needsWsl()) return this.getRootPath();
    const config = vscode.workspace.getConfiguration('gemstone');
    const raw = config.get<string>('rootPath', '~/Documents/GemStone');
    const wslHome = getWslInfo().homeDir || '/root';
    return raw.replace(/^~/, wslHome);
  }

  ensureRootPath(): void {
    if (needsWsl()) {
      // On Windows with WSL, the root path is a \\wsl$\... UNC path. VS Code's
      // UNC enforcement can block fs.mkdirSync even when the host is in
      // security.allowedUNCHosts, so create the directory via WSL directly.
      const wslRoot = this.getWslRootPath();
      wslExecSync(`mkdir -p "${wslRoot}" "${wslRoot}/locks"`);
      return;
    }
    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) {
      fs.mkdirSync(rootPath, { recursive: true });
    }
    const locksDir = path.join(rootPath, 'locks');
    if (!fs.existsSync(locksDir)) {
      fs.mkdirSync(locksDir, { recursive: true });
    }
  }

  /** Returns the platform key for downloads, e.g. "arm64.Darwin" */
  getPlatformKey(): string | undefined {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    // GemStone's Darwin x86_64 build is named "i386.Darwin" for historic reasons.
    if (process.platform === 'darwin') return arch === 'arm64' ? 'arm64.Darwin' : 'i386.Darwin';
    if (process.platform === 'linux') return `${arch}.Linux`;
    if (needsWsl() && getWslInfo().available) {
      const wslArch = getWslInfo().arch || 'x86_64';
      return `${wslArch}.Linux`;
    }
    return undefined;
  }

  /**
   * Returns the platform key used to enumerate available versions.
   * On Windows without WSL we have no local server platform, but we still want
   * to list versions so users can download the Windows client distribution.
   * Fall back to the x86_64.Linux listing as the authoritative catalog.
   */
  getCatalogPlatformKey(): string {
    return this.getPlatformKey() ?? 'x86_64.Linux';
  }

  /** Returns the file extension for downloads on this platform */
  getDownloadExtension(): string {
    return process.platform === 'darwin' ? 'dmg' : 'zip';
  }

  /** Returns the product directory suffix, e.g. "-arm64.Darwin" */
  getPlatformSuffix(): string {
    return `-${this.getPlatformKey()}`;
  }

  /** Get the GEMSTONE path for a given version */
  getGemstonePath(version: string): string | undefined {
    const suffix = this.getPlatformSuffix();
    const dir = path.join(this.getRootPath(), `GemStone64Bit${version}${suffix}`);
    return wslExistsSync(dir) ? dir : undefined;
  }

  /** Get the GEMSTONE path as a WSL Linux path (for use in WSL commands) */
  getWslGemstonePath(version: string): string | undefined {
    if (!needsWsl()) return this.getGemstonePath(version);
    // Check existence via the UNC path
    if (!this.getGemstonePath(version)) return undefined;
    const suffix = this.getPlatformSuffix();
    return `${this.getWslRootPath()}/GemStone64Bit${version}${suffix}`;
  }

  /** Scan for db-* directories containing database.yaml */
  getDatabases(): GemStoneDatabase[] {
    const rootPath = this.getRootPath();
    if (!wslExistsSync(rootPath)) return [];
    const databases: GemStoneDatabase[] = [];
    for (const entry of wslReaddirSync(rootPath)) {
      if (!entry.startsWith('db-')) continue;
      const dbPath = path.join(rootPath, entry);
      if (!wslIsDirectory(dbPath)) continue;
      const config = this.readDatabaseYaml(dbPath);
      if (config) {
        databases.push({ dirName: entry, path: dbPath, config });
      }
    }
    databases.sort((a, b) => a.dirName.localeCompare(b.dirName, undefined, { numeric: true }));
    return databases;
  }

  readDatabaseYaml(dbPath: string): DatabaseYaml | undefined {
    const yamlPath = path.join(dbPath, 'database.yaml');
    const content = wslReadFileSync(yamlPath);
    if (content === undefined) return undefined;
    // Simple YAML parser for our known format
    const field = (name: string): string | undefined =>
      content.match(new RegExp(`^${name}:\\s*"?([^"\\n]+)"?`, 'm'))?.[1];
    const version = field('version');
    const stoneName = field('stoneName');
    const ldiName = field('ldiName');
    const baseExtent = field('baseExtent');
    const registered = field('registered') === 'true';
    if (!version || !stoneName || !ldiName) return undefined;
    // A created database is defined by the extent it was copied from, so a
    // record without one is incomplete and better ignored than half-read. A
    // registered database has no base extent by definition (see
    // registeredDatabase.ts), and requiring one would make every one of them
    // invisible.
    if (!registered && !baseExtent) return undefined;
    if (!registered) return { version, stoneName, ldiName, baseExtent };
    const port = field('netldiPort');
    const netldiPort = port !== undefined && /^\d+$/.test(port) ? parseInt(port, 10) : undefined;
    return {
      version,
      stoneName,
      ldiName,
      registered: true,
      productPath: field('productPath'),
      confPath: field('confPath'),
      globalDir: field('globalDir'),
      ...(netldiPort !== undefined ? { netldiPort } : {}),
    };
  }

  /** Get the next available db-N number within the given directory */
  getNextDbNumber(parentDir?: string): number {
    const dir = parentDir || this.getRootPath();
    let i = 1;
    while (wslExistsSync(path.join(dir, `db-${i}`))) {
      i++;
    }
    return i;
  }

  /** Get extracted version directory names as version strings */
  getExtractedVersions(): string[] {
    return this.getExtractedVersionInfos().map((v) => v.version);
  }

  /** Check if an extracted version directory is a symlink (local version) */
  isLocalVersion(version: string): boolean {
    const match = this.getExtractedVersionInfos().find((v) => v.version === version);
    if (match) return match.isLocal;
    // Not in the extracted list — fall back to a direct check.
    const suffix = this.getPlatformSuffix();
    const dir = path.join(this.getRootPath(), `GemStone64Bit${version}${suffix}`);
    return wslIsSymlink(dir);
  }

  /**
   * List extracted versions with metadata (local-or-not) in a single WSL call.
   * Results are cached per instance for ~2s so repeated calls within one
   * refresh don't re-spawn wsl.exe. Pass `force: true` to bypass the cache.
   */
  getExtractedVersionInfos(force = false): ExtractedVersionInfo[] {
    const now = Date.now();
    if (!force && this.extractedCache && now - this.extractedCache.at < 2000) {
      return this.extractedCache.value;
    }
    const value = this.loadExtractedVersionInfos();
    this.extractedCache = { value, at: now };
    return value;
  }

  /** Forget any cached extracted-version list. Call after extract/delete/register. */
  invalidateExtractedCache(): void {
    this.extractedCache = undefined;
  }

  private extractedCache?: { value: ExtractedVersionInfo[]; at: number };

  private loadExtractedVersionInfos(): ExtractedVersionInfo[] {
    const suffix = this.getPlatformSuffix();
    const prefix = 'GemStone64Bit';
    const pattern = `${prefix}*${suffix}`;

    if (needsWsl()) {
      const root = this.getWslRootPath();
      try {
        // %y = type char (d=dir, l=symlink, f=file); %f = basename.
        // One wsl.exe call returns everything we need.
        const out = wslExecSync(
          `find "${root}" -maxdepth 1 -mindepth 1 -name '${pattern}' -printf '%y\\t%f\\n' 2>/dev/null || true`,
        );
        return parseExtractedRows(out, prefix, suffix);
      } catch {
        return [];
      }
    }

    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) return [];
    const result: ExtractedVersionInfo[] = [];
    for (const entry of fs.readdirSync(rootPath)) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      const full = path.join(rootPath, entry);
      let isLocal = false;
      let isDir = false;
      try {
        const st = fs.lstatSync(full);
        isLocal = st.isSymbolicLink();
        isDir = isLocal || st.isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      result.push({
        version: entry.slice(prefix.length, -suffix.length),
        isLocal,
      });
    }
    result.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
    return result;
  }

  /** Read version.txt from a product directory, returns { version, date, description } */
  static readVersionTxt(
    productPath: string,
  ): { version: string; date: string; description: string } | undefined {
    const versionFile = path.join(productPath, 'version.txt');
    const raw = wslReadFileSync(versionFile);
    if (raw === undefined) return undefined;
    const lines = raw.trim().split('\n');
    if (lines.length < 2) return undefined;
    // Line 2: "3.7.6 Build: 2026-03-24T16:26:18-07:00 ..."
    const match = lines[1].match(/^(\S+)\s+Build:\s+(\S+)/);
    if (!match) return undefined;
    const version = match[1];
    const buildDate = match[2].split('T')[0]; // just the date portion
    const description = lines.length >= 3 ? lines[2].trim() : '';
    return { version, date: buildDate, description };
  }

  /** Get available .dbf extent files from a version's bin/ directory */
  getAvailableExtents(version: string): string[] {
    const gsPath = this.getGemstonePath(version);
    if (!gsPath) return [];
    const binDir = path.join(gsPath, 'bin');
    if (!wslExistsSync(binDir)) return [];
    const extents: string[] = [];
    for (const entry of wslReaddirSync(binDir)) {
      if (entry.endsWith('.dbf')) {
        extents.push(entry.slice(0, -4)); // remove .dbf extension
      }
    }
    extents.sort();
    return extents;
  }

  // ── Windows client distribution helpers ────────────────────

  /** Root path resolved via native os.homedir() (no WSL translation) */
  getNativeRootPath(): string {
    const config = vscode.workspace.getConfiguration('gemstone');
    const raw = config.get<string>('rootPath', '~/Documents/GemStone');
    return raw.replace(/^~/, os.homedir());
  }

  /** Ensure the native root directory exists (for Windows client downloads) */
  ensureNativeRootPath(): void {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) {
      fs.mkdirSync(rootPath, { recursive: true });
    }
  }

  private static readonly WIN_CLIENT_SUFFIX = '-x86.Windows_NT';
  private static readonly WIN_CLIENT_PREFIX = 'GemStone64BitClient';

  /** Get the extracted Windows client directory for a version */
  getWindowsClientPath(version: string): string | undefined {
    const dir = path.join(
      this.getNativeRootPath(),
      `${SysadminStorage.WIN_CLIENT_PREFIX}${version}${SysadminStorage.WIN_CLIENT_SUFFIX}`,
    );
    return fs.existsSync(dir) ? dir : undefined;
  }

  /** Get the GCI DLL path from an extracted Windows client */
  getWindowsClientGciPath(version: string): string | undefined {
    const clientPath = this.getWindowsClientPath(version);
    if (!clientPath) return undefined;
    // Windows client distributions place DLLs in bin/, not lib/
    const dllPath = path.join(clientPath, 'bin', `libgcits-${version}-64.dll`);
    return fs.existsSync(dllPath) ? dllPath : undefined;
  }

  /** Scan for extracted Windows client version directories */
  getExtractedWindowsClientVersions(): string[] {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) return [];
    const prefix = SysadminStorage.WIN_CLIENT_PREFIX;
    const suffix = SysadminStorage.WIN_CLIENT_SUFFIX;
    const versions: string[] = [];
    for (const entry of fs.readdirSync(rootPath)) {
      if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
        const dirPath = path.join(rootPath, entry);
        if (fs.statSync(dirPath).isDirectory()) {
          const version = entry.slice(prefix.length, -suffix.length);
          versions.push(version);
        }
      }
    }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions;
  }

  /** Get downloaded Windows client zip files */
  getDownloadedWindowsClientFiles(): Map<string, number> {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) return new Map();
    const prefix = SysadminStorage.WIN_CLIENT_PREFIX;
    const suffix = SysadminStorage.WIN_CLIENT_SUFFIX;
    const files = new Map<string, number>();
    for (const entry of fs.readdirSync(rootPath)) {
      if (entry.startsWith(prefix) && entry.endsWith(`${suffix}.zip`)) {
        const filePath = path.join(rootPath, entry);
        if (fs.statSync(filePath).isFile()) {
          const version = entry.slice(prefix.length, -(suffix.length + 4));
          files.set(version, fs.statSync(filePath).size);
        }
      }
    }
    return files;
  }

  /** Get downloaded files in the root path (batched to a single WSL call). */
  getDownloadedFiles(): Map<string, number> {
    const ext = this.getDownloadExtension();
    const suffix = this.getPlatformSuffix();
    const prefix = 'GemStone64Bit';
    const pattern = `${prefix}*${suffix}.${ext}`;
    const trimTail = suffix.length + ext.length + 1;
    const files = new Map<string, number>();

    if (needsWsl()) {
      const root = this.getWslRootPath();
      try {
        // Single `find ... -printf '%s\t%f\n'` replaces one wsl.exe spawn
        // per zip (existsSync + isFile + fileSize each).
        const out = wslExecSync(
          `find "${root}" -maxdepth 1 -type f -name '${pattern}' -printf '%s\\t%f\\n' 2>/dev/null || true`,
        );
        for (const line of out.split('\n')) {
          const trimmed = line.replace(/\r$/, '').trim();
          if (!trimmed) continue;
          const [sizeStr, name] = trimmed.split('\t');
          if (!name || !name.startsWith(prefix) || !name.endsWith(`${suffix}.${ext}`)) continue;
          const size = parseInt(sizeStr, 10);
          if (!Number.isFinite(size)) continue;
          files.set(name.slice(prefix.length, -trimTail), size);
        }
      } catch {
        /* return empty */
      }
      return files;
    }

    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) return files;
    for (const entry of fs.readdirSync(rootPath)) {
      if (entry.startsWith(prefix) && entry.endsWith(`${suffix}.${ext}`)) {
        const filePath = path.join(rootPath, entry);
        try {
          const st = fs.statSync(filePath);
          if (st.isFile()) {
            files.set(entry.slice(prefix.length, -trimTail), st.size);
          }
        } catch {
          /* skip */
        }
      }
    }
    return files;
  }
}
