import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { execSync, spawnSync } from 'child_process';
import { SysadminStorage, ExtractedVersionInfo } from './sysadminStorage';
import { GemStoneVersion } from './sysadminTypes';
import { appendSysadmin } from './sysadminChannel';
import { needsWsl, wslSpawn, wslExecSync } from './wslBridge';
import { wslExistsSync } from './wslFs';
import { bundledWindowsClientVersions, bundledGciArchSupported } from './bundledGci';
import { compareGemStoneVersions } from './gemStoneVersion';

const WIN_CLIENT_BASE_URL = 'https://downloads.gemtalksystems.com/pub/GemStone64/';
const MINIMUM_SUPPORTED_GEMSTONE_VERSION = '3.6.2';

/** One row of the downloads page — what the catalog says before any disk is read. */
export interface CatalogEntry {
  version: string;
  fileName: string;
  url: string;
  date: string;
  size: number;
}

export class VersionManager {
  constructor(private storage: SysadminStorage) {}

  /**
   * The versions present on disk, described from their `version.txt`. Reads the
   * filesystem only, so it answers while the download catalog is unreachable —
   * or before it has been asked.
   *
   * A catalog that lists nothing already means exactly this: every extracted
   * version becomes a row, since none of them can be in it. Saying it that way
   * rather than mapping the rows again is what keeps this list ordered and
   * filtered like the other one — two lists of the same versions that disagreed
   * about either would show a user their versions rearranging as the catalog
   * arrived.
   */
  getInstalledVersions(): GemStoneVersion[] {
    return this.versionsFrom([]);
  }

  /** One on-disk version as a catalog-shaped row: no file, no size, no URL. */
  private installedVersion(info: ExtractedVersionInfo): GemStoneVersion {
    const gsPath = this.storage.getGemstonePath(info.version);
    const txt = gsPath ? SysadminStorage.readVersionTxt(gsPath) : undefined;
    return {
      version: info.version,
      fileName: '',
      url: '',
      size: 0,
      date: txt?.date ?? '',
      downloaded: false,
      extracted: true,
      // Only a symlinked build carries the flag at all. A real directory leaves
      // it absent rather than false — the shape the catalog pass has always
      // produced, and which localVersion.test.ts pins.
      ...(info.isLocal ? { local: true as const } : {}),
      buildDescription: txt?.description,
    };
  }

  /**
   * The downloads page for this platform, parsed. This is the only part of
   * building a version list that needs the network, which is why it is separate:
   * a caller that rebuilds often can hold one catalog and re-derive rows from
   * disk — the flags that actually change — without asking the site again.
   */
  async fetchCatalog(): Promise<CatalogEntry[]> {
    const platformKey = this.storage.getCatalogPlatformKey();
    const ext = platformKey.endsWith('.Darwin') ? 'dmg' : 'zip';
    const url = `https://downloads.gemtalksystems.com/platforms/${platformKey}/`;
    const html = await this.fetchUrl(url);

    const regex = new RegExp(
      `href="(GemStone64Bit([\\d.]+)-${platformKey.replace('.', '\\.')}\\.${ext})"[^>]*>.*?` +
        `(\\d{2}-\\w{3}-\\d{4})\\s+\\d{2}:\\d{2}\\s+(\\d+)`,
      'g',
    );

    const entries: CatalogEntry[] = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
      entries.push({
        version: match[2],
        fileName: match[1],
        url: `${url}${match[1]}`,
        date: match[3],
        size: parseInt(match[4], 10),
      });
    }
    return entries;
  }

  /** Fetch available versions from the downloads page. */
  async fetchAvailableVersions(): Promise<GemStoneVersion[]> {
    return this.versionsFrom(await this.fetchCatalog());
  }

  /**
   * What a catalog and the disk together say is available — the whole of the
   * answer that does not need the network. A caller holding a catalog can ask
   * this as often as it likes: what changes between two asks is on disk, and
   * this reads it afresh every time.
   */
  versionsFrom(catalog: CatalogEntry[]): GemStoneVersion[] {
    const versions: GemStoneVersion[] = [];
    const hasLocalServer = this.storage.getPlatformKey() !== undefined;
    const downloaded = hasLocalServer
      ? this.storage.getDownloadedFiles()
      : new Map<string, number>();
    const extractedInfos = hasLocalServer ? this.storage.getExtractedVersionInfos() : [];
    const extractedMap = new Map(extractedInfos.map((e) => [e.version, e.isLocal]));
    const clientExtracted = new Set(
      process.platform === 'win32' ? this.storage.getExtractedWindowsClientVersions() : [],
    );
    const bundled = new Set(
      process.platform === 'win32' && bundledGciArchSupported()
        ? bundledWindowsClientVersions()
        : [],
    );

    // Add local (symlinked) versions first
    for (const info of extractedInfos) {
      if (!info.isLocal) continue;
      versions.push(this.installedVersion(info));
    }

    const catalogVersions = new Set<string>();
    for (const entry of catalog) {
      const { version, size } = entry;
      catalogVersions.add(version);
      const isDownloaded = downloaded.has(version) && downloaded.get(version) === size;
      const extractedKind = extractedMap.get(version);
      versions.push({
        ...entry,
        downloaded: isDownloaded,
        extracted: extractedKind === false, // dir, not symlink
        clientExtracted: clientExtracted.has(version),
        bundled: bundled.has(version),
      });
    }

    // A locally-built product directory copied straight into rootPath (a real
    // directory, not a symlink) for a version the download catalog doesn't list
    // — e.g. a private 4.0 build. Symlinked local builds are handled by the
    // "local versions first" loop above, and catalog versions (downloaded or
    // extracted) by the loop just above; this surfaces the remaining case as a
    // present, extracted version so it shows in the list and can create
    // databases, instead of being silently dropped.
    for (const info of extractedInfos) {
      if (info.isLocal) continue;
      if (catalogVersions.has(info.version)) continue;
      versions.push(this.installedVersion(info));
    }

    // A downloaded archive the catalog does not list — which is *every* downloaded
    // archive when the catalog is empty (offline, or the fetch failed). The catalog
    // loop is the only place a downloaded row is otherwise produced, so without
    // this the version, and its no-network "Install (extract)" action, silently
    // vanish offline. Extracted versions are already covered by the loops above.
    const archiveSuffix = `${this.storage.getPlatformSuffix()}.${this.storage.getDownloadExtension()}`;
    for (const [version, size] of downloaded) {
      if (catalogVersions.has(version)) continue;
      if (extractedMap.has(version)) continue;
      versions.push({
        version,
        // Rebuilt rather than left empty: this is the exact name
        // getDownloadedFiles matched to find the file, and Install and Remove
        // both need it to reach the archive on disk.
        fileName: `GemStone64Bit${version}${archiveSuffix}`,
        url: '',
        size,
        date: '',
        downloaded: true,
        extracted: false,
        clientExtracted: clientExtracted.has(version),
        bundled: bundled.has(version),
      });
    }

    // Drop remote versions older than the minimum; local installs are always kept
    const supportedVersions = versions.filter(
      (version) =>
        version.local ||
        compareGemStoneVersions(version.version, MINIMUM_SUPPORTED_GEMSTONE_VERSION) >= 0,
    );

    // Sort newest first; local versions before remote at same version
    supportedVersions.sort((a, b) => {
      const comparison = compareGemStoneVersions(a.version, b.version);
      if (comparison !== 0) return -comparison; // negate for newest first
      return (b.local ? 1 : 0) - (a.local ? 1 : 0);
    });

    return supportedVersions;
  }

  /** Download a version with progress reporting */
  async download(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.storage.ensureRootPath();
    const targetPath = needsWsl()
      ? `${this.storage.getWslRootPath()}/${version.fileName}`
      : path.join(this.storage.getRootPath(), version.fileName);

    if (needsWsl()) {
      // On Windows, download via curl inside WSL
      return new Promise<void>((resolve, reject) => {
        const proc = wslSpawn('curl', ['-L', '-o', targetPath, '-#', version.url]);

        token.onCancellationRequested(() => {
          proc.kill();
          try {
            wslExecSync(`rm -f "${targetPath}"`);
          } catch {
            /* ignore */
          }
          reject(new Error('Download cancelled'));
        });

        proc.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          const pctMatch = text.match(/([\d.]+)%/);
          if (pctMatch) {
            progress.report({ message: `${pctMatch[1]}%` });
          }
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            try {
              wslExecSync(`rm -f "${targetPath}"`);
            } catch {
              /* ignore */
            }
            reject(new Error(`curl exited with code ${code}`));
          } else {
            resolve();
          }
        });
      });
    }

    return this.downloadFile(version.url, targetPath, progress, token);
  }

  /** Download a file via native Node.js HTTPS with redirect following */
  private downloadFile(
    url: string,
    targetPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const cleanup = () => {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    };

    const doDownload = (downloadUrl: string): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(targetPath);
        let cancelled = false;

        const cancel = token.onCancellationRequested(() => {
          cancelled = true;
          request.destroy();
          file.close(() => cleanup());
          cancel.dispose();
          reject(new Error('Download cancelled'));
        });

        const request = https.get(downloadUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            file.close(() => {
              if (!cancelled) {
                doDownload(res.headers.location!).then(resolve, reject);
              }
            });
            return;
          }
          if (res.statusCode !== 200) {
            file.close(() => cleanup());
            reject(new Error(`HTTP ${res.statusCode} downloading ${downloadUrl}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] ?? '0', 10);
          let received = 0;

          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (total > 0) {
              progress.report({ message: `${Math.round((received / total) * 100)}%` });
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            cancel.dispose();
            resolve();
          });

          file.on('error', (err) => {
            cleanup();
            cancel.dispose();
            reject(err);
          });
        });

        request.on('error', (err) => {
          file.close(() => cleanup());
          cancel.dispose();
          reject(err);
        });
      });
    };

    return doDownload(url);
  }

  /** Extract a downloaded version */
  async extract(
    version: GemStoneVersion,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    try {
      if (process.platform === 'darwin') {
        const rootPath = this.storage.getRootPath();
        const filePath = path.join(rootPath, version.fileName);
        await this.extractDmg(filePath, rootPath, progress);
      } else {
        // Linux and Windows (via WSL) both use zip
        const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
        const filePath = `${rootPath}/${version.fileName}`;
        await this.extractZip(filePath, rootPath, progress);
      }
    } finally {
      this.storage.invalidateExtractedCache();
    }
  }

  private async extractDmg(
    dmgPath: string,
    destDir: string,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    progress.report({ message: 'Mounting DMG...' });
    const attachOutput = execSync(`hdiutil attach -nobrowse "${dmgPath}"`, { encoding: 'utf-8' });
    // Parse mount point from last line: /dev/diskXsY  Apple_HFS  /Volumes/GemStone64Bit...
    const lines = attachOutput.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    const mountMatch = lastLine.match(/\t(\/Volumes\/.+)$/);
    if (!mountMatch) {
      throw new Error(`Failed to parse mount point from: ${lastLine}`);
    }
    const mountPoint = mountMatch[1];

    try {
      progress.report({ message: 'Copying files...' });
      // Find the GemStone directory in the mount point
      const entries = fs.readdirSync(mountPoint);
      const gsDir = entries.find((e) => e.startsWith('GemStone64Bit'));
      if (!gsDir) {
        throw new Error(`No GemStone directory found in mounted DMG at ${mountPoint}`);
      }
      const srcPath = path.join(mountPoint, gsDir);
      const destPath = path.join(destDir, gsDir);
      execSync(`cp -R "${srcPath}" "${destPath}"`);
      appendSysadmin(`Extracted ${gsDir} to ${destDir}`);
    } finally {
      progress.report({ message: 'Unmounting DMG...' });
      try {
        execSync(`hdiutil detach "${mountPoint}"`);
      } catch {
        // Best effort unmount
      }
    }
  }

  private async extractZip(
    zipPath: string,
    destDir: string,
    progress: vscode.Progress<{ message?: string }>,
  ): Promise<void> {
    progress.report({ message: 'Extracting zip...' });
    if (needsWsl()) {
      // WSL distros (Ubuntu, Debian) usually don't ship unzip, but python3 is
      // nearly always present. Try unzip first; on "command not found" fall
      // back to python3 -m zipfile.
      const unzip = await this.runWslExtract('unzip', ['-o', '-q', zipPath, '-d', destDir]);
      if (unzip.code === 0) {
        appendSysadmin(`Extracted ${path.basename(zipPath)} to ${destDir}`);
        return;
      }
      if (unzip.code !== 127) {
        throw new Error(
          `unzip failed with exit code ${unzip.code}` +
            (unzip.stderr ? `: ${unzip.stderr.trim().split('\n').slice(-3).join(' | ')}` : ''),
        );
      }
      // Unlike `python3 -m zipfile -e`, this preserves the Unix mode bits
      // recorded in each zip entry, so extracted binaries keep their +x bit.
      // Two-pass: extract everything first, then chmod in reverse depth order
      // so a locked-down dir mode (e.g. 0o555) doesn't block writes into it.
      const pyScript =
        'import zipfile,os,sys\n' +
        'p=sys.argv[2]\n' +
        'with zipfile.ZipFile(sys.argv[1]) as z:\n' +
        '  infos=z.infolist()\n' +
        '  z.extractall(p)\n' +
        '  for i in sorted(infos,key=lambda x:-len(x.filename)):\n' +
        '    m=(i.external_attr>>16)&0o7777\n' +
        '    if not m: continue\n' +
        '    try: os.chmod(os.path.join(p,i.filename),m)\n' +
        '    except OSError: pass\n';
      const py = await this.runWslExtract('python3', ['-c', pyScript, zipPath, destDir]);
      if (py.code === 0) {
        appendSysadmin(`Extracted ${path.basename(zipPath)} to ${destDir} (via python3)`);
        return;
      }
      if (py.code === 127) {
        throw new Error(
          "Neither 'unzip' nor 'python3' is available in your WSL distro. " +
            'Install one with: wsl -e sudo apt-get install -y unzip',
        );
      }
      throw new Error(
        `python3 zipfile extract failed with exit code ${py.code}` +
          (py.stderr ? `: ${py.stderr.trim().split('\n').slice(-3).join(' | ')}` : ''),
      );
    } else {
      const result = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'ignore' });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`unzip failed with exit code ${result.status}`);
      }
    }
    appendSysadmin(`Extracted ${path.basename(zipPath)} to ${destDir}`);
  }

  private runWslExtract(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = wslSpawn(cmd, args);
      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on('close', (code) => resolve({ code: code ?? 1, stderr }));
      proc.on('error', reject);
    });
  }

  /** Delete a downloaded file */
  async deleteDownload(version: GemStoneVersion): Promise<void> {
    // A version with no archive name is one that was never downloaded — a build
    // registered from a directory, or one found already extracted. Without this,
    // the path below is the root directory itself, and unlinking that either
    // throws or, on a filesystem that allows it, does real damage.
    if (!version.fileName) return;
    if (needsWsl()) {
      const wslFilePath = `${this.storage.getWslRootPath()}/${version.fileName}`;
      try {
        wslExecSync(`rm -f "${wslFilePath}"`);
        appendSysadmin(`Deleted download: ${version.fileName}`);
      } catch {
        /* file may not exist */
      }
      return;
    }
    const filePath = path.join(this.storage.getRootPath(), version.fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      appendSysadmin(`Deleted download: ${version.fileName}`);
    }
  }

  /** Delete an extracted version directory */
  async deleteExtracted(version: GemStoneVersion): Promise<void> {
    const gsPath = this.storage.getGemstonePath(version.version);
    if (gsPath && wslExistsSync(gsPath)) {
      // Safety: if this is a symlink (local version), only remove the link
      if (this.storage.isLocalVersion(version.version)) {
        if (needsWsl()) {
          const wslPath = this.storage.getWslGemstonePath(version.version);
          if (wslPath) wslExecSync(`rm -f "${wslPath}"`);
        } else {
          fs.unlinkSync(gsPath);
        }
        this.storage.invalidateExtractedCache();
        appendSysadmin(`Unregistered local version: ${version.version}`);
        return;
      }
      if (needsWsl()) {
        const wslPath = this.storage.getWslGemstonePath(version.version);
        if (wslPath) {
          wslExecSync(`chmod -R u+w "${wslPath}" && rm -rf "${wslPath}"`);
        }
      } else {
        // Make writable first (GemStone sets some files read-only)
        execSync(`chmod -R u+w "${gsPath}"`);
        fs.rmSync(gsPath, { recursive: true });
      }
      this.storage.invalidateExtractedCache();
      appendSysadmin(`Deleted extracted version: ${path.basename(gsPath)}`);
    }
  }

  // ── Windows client distribution ────────────────────────────

  /** Build the canonical Windows-client zip filename and download URL for a version. */
  static windowsClientArtifact(version: string): { fileName: string; url: string } {
    const fileName = `GemStone64BitClient${version}-x86.Windows_NT.zip`;
    return { fileName, url: `${WIN_CLIENT_BASE_URL}${version}/${fileName}` };
  }

  /**
   * Download, extract, and clean up the Windows client distribution for `version`.
   *
   * On HTTP 404 (GemTalk hasn't published a client for this version), throws a
   * friendly error the caller can show verbatim. The zip is always deleted after
   * a successful extract — the client distribution is small enough that keeping
   * it around doesn't add value.
   */
  async downloadAndExtractWindowsClient(
    version: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (!version || !version.trim()) {
      throw new Error('Cannot download Windows client: no GemStone version specified.');
    }
    this.storage.ensureNativeRootPath();
    const rootPath = this.storage.getNativeRootPath();
    const { fileName, url } = VersionManager.windowsClientArtifact(version);
    const zipPath = path.join(rootPath, fileName);

    progress.report({ message: 'Downloading...' });
    try {
      await this.downloadFile(url, zipPath, progress, token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/HTTP 404/.test(msg)) {
        throw new Error(
          `No Windows client distribution has been published for GemStone ${version}. ` +
            `Check ${WIN_CLIENT_BASE_URL} for available versions.`,
        );
      }
      throw e;
    }

    try {
      progress.report({ message: 'Extracting...' });
      execSync(`tar -xf "${zipPath}" -C "${rootPath}"`, { stdio: 'ignore' });
      appendSysadmin(`Extracted Windows client: ${fileName}`);
    } finally {
      if (fs.existsSync(zipPath)) {
        try {
          fs.unlinkSync(zipPath);
        } catch {
          /* best effort */
        }
      }
    }
  }

  /** Delete an extracted Windows client directory */
  async deleteWindowsClientExtracted(version: GemStoneVersion): Promise<void> {
    const clientPath = this.storage.getWindowsClientPath(version.version);
    if (clientPath && fs.existsSync(clientPath)) {
      fs.rmSync(clientPath, { recursive: true });
      appendSysadmin(`Deleted Windows client: ${path.basename(clientPath)}`);
    }
  }

  private fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { timeout: 10000 }, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          this.fetchUrl(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      });
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error(`Timeout fetching ${url}`));
      });
    });
  }
}
