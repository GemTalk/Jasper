import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DatabaseYaml, GemStoneDatabase } from './sysadminTypes';
import { needsWsl, getWslInfo, wslPathToWindows, wslExecSync } from './wslBridge';
import { appendSysadmin } from './sysadminChannel';
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
  /** The last unreadable-directory line written, so one that has not changed is
   *  not written again on every rescan. A successful read clears it, so the
   *  same failure coming back is written again. */
  private lastUnreadable = '';

  /**
   * The names in a directory, or none. A directory that is there but cannot be
   * opened answers the same as an empty one, and says why once in the log. It
   * used to throw — and one of these scans runs while the extension is
   * activating, so an unreadable root took every GemStone command down with it
   * rather than the listing that wanted it. `existsSync` cannot stand in for
   * this: it answers only whether the path is there.
   */
  private entriesIn(dir: string): string[] {
    try {
      const entries = fs.readdirSync(dir);
      this.lastUnreadable = '';
      return entries;
    } catch (e) {
      // Every caller of this reads the root path, so the setting that names it is
      // the thing to say: it is where a reader goes either to fix the folder or
      // to point Jasper at another one.
      const line =
        `Could not read ${dir} — ${e instanceof Error ? e.message : String(e)}. ` +
        `Jasper lists nothing in it: check the folder's permissions, or set ` +
        `gemstone.rootPath to somewhere it can read.`;
      if (line !== this.lastUnreadable) {
        this.lastUnreadable = line;
        appendSysadmin(line);
      }
      return [];
    }
  }

  /**
   * Why the root path cannot be read, if it cannot. The scans answer "nothing
   * here" for a folder they cannot open, which is what keeps the extension
   * loading — so something has to be able to tell that apart from a folder that
   * is genuinely empty, or the panel offers a New Database that cannot work.
   *
   * Absent is not unreadable: a root that does not exist yet is the ordinary
   * state of a new machine, and creating it is what the panel already offers.
   */
  rootPathProblem(): string | undefined {
    // Under WSL every listing goes through `ls` in the bridge, which answers an
    // empty list for both cases and leaves nothing here to read.
    if (needsWsl()) return undefined;
    const rootPath = this.getRootPath();
    if (!fs.existsSync(rootPath)) return undefined;
    try {
      fs.readdirSync(rootPath);
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

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
   * Whether a GemStone server can run on this machine. GemStone has no Windows server
   * build, so on Windows only WSL gives it one. Without one, no installed server is
   * looked for on disk.
   */
  hasLocalServer(): boolean {
    return this.getPlatformKey() !== undefined;
  }

  /**
   * Returns the platform key used to enumerate available versions.
   * Without a local server (see {@link hasLocalServer}) we still want
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

  /** Returns the product directory suffix, e.g. "-arm64.Darwin"; only with {@link hasLocalServer}. */
  getPlatformSuffix(): string {
    return `-${this.getPlatformKey()}`;
  }

  /** Get the GEMSTONE path for a given version */
  getGemstonePath(version: string): string | undefined {
    if (!this.hasLocalServer()) return undefined;
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
    if (!this.hasLocalServer()) return false;
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
    if (!this.hasLocalServer()) return [];
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
    for (const entry of this.entriesIn(rootPath)) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      const full = path.join(rootPath, entry);
      let isLocal: boolean;
      let isDir: boolean;
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
    return this.clientFolderVersions(
      SysadminStorage.WIN_CLIENT_PREFIX,
      SysadminStorage.WIN_CLIENT_SUFFIX,
    );
  }

  /** Versions named by `<prefix><version><suffix>` folders in the native root, newest first. */
  private clientFolderVersions(prefix: string, suffix: string): string[] {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) return [];
    const versions: string[] = [];
    for (const entry of this.entriesIn(rootPath)) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      if (!fs.statSync(path.join(rootPath, entry)).isDirectory()) continue;
      versions.push(entry.slice(prefix.length, -suffix.length));
    }
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return versions;
  }

  // ── Client files: what a login needs, without the server ───

  private static readonly CLIENT_LIBS_PREFIX = 'GemStoneClientLibs';

  /**
   * The platform GemTalk's client packages are named for on this machine. It is
   * not {@link getPlatformKey}: Windows has its own client, with or without WSL.
   */
  getClientPlatformKey(): string {
    if (process.platform === 'win32') return 'x86.Windows_NT';
    // Off Windows the server's key, which is always defined there.
    return this.getPlatformKey()!;
  }

  /**
   * Folder the client files for `version` unpack into. On Windows it is the
   * Windows client's; elsewhere GemStoneClientLibs<version>-<platform>, apart
   * from the GemStone64Bit… folder a full install uses, so neither touches the other.
   */
  getClientDirName(version: string): string {
    if (process.platform === 'win32') {
      return `${SysadminStorage.WIN_CLIENT_PREFIX}${version}${SysadminStorage.WIN_CLIENT_SUFFIX}`;
    }
    return `${SysadminStorage.CLIENT_LIBS_PREFIX}${version}-${this.getClientPlatformKey()}`;
  }

  /** The client folder for a version, if one is on disk. */
  getClientPath(version: string): string | undefined {
    if (process.platform === 'win32') return this.getWindowsClientPath(version);
    const dir = path.join(this.getNativeRootPath(), this.getClientDirName(version));
    return fs.existsSync(dir) ? dir : undefined;
  }

  /**
   * The GCI library inside a version's client folder. GemTalk's packages put it
   * under <version>/64bit/; the macOS disk image is searched rather than assumed.
   */
  getClientGciPath(version: string): string | undefined {
    if (process.platform === 'win32') return this.getWindowsClientGciPath(version);
    const dir = this.getClientPath(version);
    if (!dir) return undefined;
    const ext = process.platform === 'darwin' ? 'dylib' : 'so';
    return findFile(dir, `libgcits-${version}-64.${ext}`, 3);
  }

  /** Bytes the client folder for `version` takes on disk, or 0 if there is none. */
  getClientSize(version: string): number {
    const dir = this.getClientPath(version);
    return dir ? treeSize(dir) : 0;
  }

  /** Versions with client files on disk, newest first. */
  getExtractedClientVersions(): string[] {
    if (process.platform === 'win32') return this.getExtractedWindowsClientVersions();
    return this.clientFolderVersions(
      SysadminStorage.CLIENT_LIBS_PREFIX,
      `-${this.getClientPlatformKey()}`,
    );
  }

  /** Get downloaded Windows client zip files */
  getDownloadedWindowsClientFiles(): Map<string, number> {
    const rootPath = this.getNativeRootPath();
    if (!fs.existsSync(rootPath)) return new Map();
    const prefix = SysadminStorage.WIN_CLIENT_PREFIX;
    const suffix = SysadminStorage.WIN_CLIENT_SUFFIX;
    const files = new Map<string, number>();
    for (const entry of this.entriesIn(rootPath)) {
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
    for (const entry of this.entriesIn(rootPath)) {
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

/** Total size of the files under `dir`; links are not followed. */
function treeSize(dir: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += treeSize(full);
    else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // Gone or unreadable since the listing: it takes no space we can count.
      }
    }
  }
  return total;
}

/** The first file called `name` under `dir`, at most `depth` folders down. */
function findFile(dir: string, name: string, depth: number): string | undefined {
  const direct = path.join(dir, name);
  if (fs.existsSync(direct)) return direct;
  if (depth === 0) return undefined;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findFile(path.join(dir, entry.name), name, depth - 1);
    if (found) return found;
  }
  return undefined;
}
