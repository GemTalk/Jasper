import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChildProcess, execSync, spawn } from 'child_process';
import { SysadminStorage, ExtractedVersionInfo } from '../sysadminStorage';
import { GemStoneVersion } from '../sysadminTypes';
import { appendSysadmin } from '../sysadminChannel';
import { needsWsl, wslSpawn, wslExecSync } from '../wslBridge';
import { wslExistsSync } from '../wslFs';
import { bundledWindowsClientVersions, bundledGciArchSupported } from '../bundledGci';
import { compareGemStoneVersions, isComparableGemStoneVersion } from '../gemStoneVersion';

const WIN_CLIENT_BASE_URL = 'https://downloads.gemtalksystems.com/pub/GemStone64/';
const MINIMUM_SUPPORTED_GEMSTONE_VERSION = '3.6.2';

/**
 * The user cancelled a download or an unpack, and what it had written is gone.
 * The message says so; callers show it as information, not as an error.
 */
export class InstallCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallCancelledError';
  }
}

/**
 * What to say when an install step did not finish: a cancel's own message, or
 * `failure` with the error's. Every call site that runs an install goes
 * through this, so a cancel never reads as a failure.
 */
export function installOutcomeText(e: unknown, failure: string): string {
  if (e instanceof InstallCancelledError) return e.message;
  return `${failure}: ${e instanceof Error ? e.message : String(e)}`;
}

/** Show {@link installOutcomeText}: a cancel as information, anything else as an error. */
export function showInstallOutcome(e: unknown, failure: string): void {
  const text = installOutcomeText(e, failure);
  if (e instanceof InstallCancelledError) vscode.window.showInformationMessage(text);
  else vscode.window.showErrorMessage(text);
}

const DOWNLOAD_CANCELLED = 'Download cancelled. The partly downloaded file was removed.';

/**
 * Put before a command run through WSL, so Jasper learns its Linux pid:
 * `exec` hands the command the shell's own pid, which the shell has just named.
 */
const WSL_PID_WRAPPER = 'echo "jasper-pid $$" >&2; exec "$@"';
const WSL_PID_LINE = /^jasper-pid (\d+)\r?\n/;

/** How a child process ended. 127 also stands for "no such command", as a shell reports it. */
interface ChildResult {
  code: number;
  stderr: string;
}

/** Progress for an unpack: a message, and an increment that fills the notification's bar. */
type UnpackProgress = vscode.Progress<{ message?: string; increment?: number }>;

/** The last few lines of a child's stderr, for an error message. */
function stderrTail(stderr: string): string {
  return stderr ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : '';
}

/**
 * What to say when an install did not finish and removing what it left failed
 * too: how it ended, then the folder to remove by hand. `detail` is why the
 * removal failed, already punctuated. Shared by the GemStone and Windows-client
 * unpacks so their wording cannot drift apart.
 */
function cleanupFailedMessage(
  subject: string,
  cause: unknown,
  dir: string,
  detail: string,
): string {
  const what =
    cause instanceof InstallCancelledError
      ? `${subject} was cancelled`
      : `${subject} failed (${cause instanceof Error ? cause.message : String(cause)})`;
  return (
    `${what}, and the partly unpacked files at ${dir} could not be removed${detail}. ` +
    'Remove that folder before installing again.'
  );
}

/**
 * How many entries a zip holds, read from its end-of-central-directory record
 * in the last few KB rather than by a pass over the archive. Undefined when it
 * cannot say: no record found, or a zip64 archive, which keeps the count elsewhere.
 */
async function zipEntryCount(file: string): Promise<number | undefined> {
  const EOCD_SIGNATURE = 0x06054b50;
  const EOCD_SIZE = 22; // fixed part; a comment of up to 64 KB may follow it
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, EOCD_SIZE + 0xffff);
    const tail = Buffer.alloc(length);
    await handle.read(tail, 0, length, size - length);
    for (let i = length - EOCD_SIZE; i >= 0; i--) {
      if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
      const entries = tail.readUInt16LE(i + 10);
      return entries === 0xffff ? undefined : entries;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

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
   * How long a cancel through WSL waits for the Linux pid before killing
   * wsl.exe anyway, so a wsl.exe that never names it cannot hold the cancel
   * forever. A seam for tests.
   */
  static pidWaitMs = 5000;

  /** The unreadable version numbers last written to the log, so a list that has
   *  not changed is not written again. */
  private lastUnreadable = '';

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

    // A version number the comparison cannot read — a hand-built product
    // directory, or a pre-release spelling this client does not know yet. It can
    // be neither filtered nor ordered, and asking either of the two comparisons
    // below to judge it threw, which cost the whole list rather than the one
    // row. One on this disk was put there by someone, so it is listed last and
    // named in the log rather than dropped. One only the catalog offers is
    // dropped, the way the minimum filter drops an old one: it cannot be checked
    // against that minimum, and nobody asked for it.
    const readable = versions.filter((v) => isComparableGemStoneVersion(v.version));
    const unreadable = versions.filter(
      (v) => !isComparableGemStoneVersion(v.version) && (v.local || v.extracted || v.downloaded),
    );
    // Said once, not on every rebuild: the panel re-reads the disk on each
    // refresh and twice on each open, and the same folder repeating down the log
    // reads as something happening again rather than a state that has not moved.
    const named = unreadable.map((v) => v.version).join(', ');
    if (named !== this.lastUnreadable) {
      this.lastUnreadable = named;
      if (named) {
        // Everything needed to act on it: which folder, which part of its name
        // is the version, and what a version number is allowed to look like.
        appendSysadmin(
          `Versions: could not read the version number in ${named} — listed last, because a row ` +
            `that cannot be compared cannot be ordered or checked against the minimum supported ` +
            `version (${MINIMUM_SUPPORTED_GEMSTONE_VERSION}). A version is three or four numbers ` +
            `with an optional pre-release tag: 3.7.5, 3.7.4.3, 4.0.0-a3. The name comes from the ` +
            `folder GemStone64Bit<version>${this.storage.getPlatformSuffix()}, or the archive ` +
            `of the same name, in ${this.storage.getRootPath()}; renaming it is what changes it.`,
        );
      }
    }

    // Drop remote versions older than the minimum; local installs are always kept
    const supportedVersions = readable.filter(
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

    unreadable.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
    return [...supportedVersions, ...unreadable];
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
      const removePartial = () => this.run('rm', ['-f', targetPath]);
      let curl: ChildResult;
      try {
        curl = await this.run('curl', ['-L', '-o', targetPath, '-#', version.url], {
          token,
          onStderr: (text) => {
            const pctMatch = text.match(/([\d.]+)%/);
            if (pctMatch) progress.report({ message: `${pctMatch[1]}%` });
          },
        });
      } catch (e) {
        await removePartial();
        throw e instanceof InstallCancelledError
          ? new InstallCancelledError(DOWNLOAD_CANCELLED)
          : e;
      }
      if (curl.code !== 0) {
        await removePartial();
        throw new Error(`curl exited with code ${curl.code}${stderrTail(curl.stderr)}`);
      }
      return;
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
          cancel.dispose();
          // Rejected only once the file is gone, because the message says it is.
          file.close(() => {
            cleanup();
            reject(new InstallCancelledError(DOWNLOAD_CANCELLED));
          });
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
            // A cancel closes the file too, which finishes it: that is not a download.
            if (cancelled) return;
            cancel.dispose();
            resolve();
          });

          file.on('error', (err) => {
            if (cancelled) return;
            cleanup();
            cancel.dispose();
            reject(err);
          });
        });

        request.on('error', (err) => {
          // Destroying a request before its response arrives fails it with
          // "socket hang up": the cancel's own doing, which it reports.
          if (cancelled) return;
          file.close(() => cleanup());
          cancel.dispose();
          reject(err);
        });
      });
    };

    return doDownload(url);
  }

  /**
   * Unpack a downloaded version. The unpack runs in child processes, so the
   * editor keeps answering, and its progress messages arrive while it works.
   *
   * On a cancel or a failure the product directory this run was creating is
   * removed, so the version list never offers a half-unpacked install as
   * installed. The downloaded archive is kept: it is the expensive part, and
   * unpacking it again is cheap.
   */
  async extract(
    version: GemStoneVersion,
    progress: UnpackProgress,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // Removed afterwards only if this run is what created it.
    const existed = this.storage.getGemstonePath(version.version) !== undefined;
    // Linux and Windows (via WSL) both unpack a zip, in WSL's own paths on Windows.
    const rootPath = needsWsl() ? this.storage.getWslRootPath() : this.storage.getRootPath();
    const productDir = `${rootPath}/GemStone64Bit${version.version}${this.storage.getPlatformSuffix()}`;
    try {
      if (process.platform === 'darwin') {
        await this.extractDmg(path.join(rootPath, version.fileName), rootPath, progress, token);
      } else {
        await this.extractZip(
          `${rootPath}/${version.fileName}`,
          path.join(this.storage.getRootPath(), version.fileName),
          rootPath,
          progress,
          token,
        );
      }
    } catch (e) {
      if (!existed) await this.removePartial(productDir, version.version, e);
      if (e instanceof InstallCancelledError) {
        throw new InstallCancelledError(
          existed
            ? `Unpacking GemStone ${version.version} cancelled. ${productDir} was there before, ` +
                'so it was not removed; the unpack may have replaced some of its files. ' +
                'The download is kept.'
            : `Unpacking GemStone ${version.version} cancelled. The partly unpacked files were ` +
                'removed; the download is kept.',
        );
      }
      throw e;
    } finally {
      this.storage.invalidateExtractedCache();
    }
  }

  /** Remove what a cancelled or failed unpack left, or say plainly that it could not. */
  private async removePartial(dir: string, version: string, cause: unknown): Promise<void> {
    if (this.storage.getGemstonePath(version) === undefined) return;
    // GemStone ships read-only files and directories, which rm -rf cannot delete from.
    await this.run('chmod', ['-R', 'u+w', dir]);
    const rm = await this.run('rm', ['-rf', dir]);
    if (rm.code === 0) return;
    const message = cleanupFailedMessage('Unpacking', cause, dir, stderrTail(rm.stderr));
    appendSysadmin(message);
    throw new Error(message, { cause });
  }

  private async extractDmg(
    dmgPath: string,
    destDir: string,
    progress: UnpackProgress,
    token: vscode.CancellationToken,
  ): Promise<void> {
    progress.report({ message: 'Mounting disk image...' });
    // Not cancellable: an attach killed partway can leave the image mounted with
    // no mount point to detach. It takes seconds; the copy is what takes minutes.
    const attachLines: string[] = [];
    const attach = await this.run('hdiutil', ['attach', '-nobrowse', dmgPath], {
      onLine: (line) => attachLines.push(line),
    });
    if (attach.code !== 0) {
      throw new Error(
        `hdiutil attach failed with exit code ${attach.code}${stderrTail(attach.stderr)}`,
      );
    }
    // Parse mount point from last line: /dev/diskXsY  Apple_HFS  /Volumes/GemStone64Bit...
    const lastLine =
      attachLines
        .filter((l) => l.trim())
        .at(-1)
        ?.trimEnd() ?? '';
    const mountMatch = lastLine.match(/\t(\/Volumes\/.+)$/);
    if (!mountMatch) {
      throw new Error(`Failed to parse mount point from: ${lastLine}`);
    }
    const mountPoint = mountMatch[1];

    try {
      // Find the GemStone directory in the mount point
      const entries = await fs.promises.readdir(mountPoint);
      const gsDir = entries.find((e) => e.startsWith('GemStone64Bit'));
      if (!gsDir) {
        throw new Error(`No GemStone directory found in mounted DMG at ${mountPoint}`);
      }
      progress.report({ message: 'Copying files...' });
      const srcPath = path.join(mountPoint, gsDir);
      // cp -v names the top directory too, hence the one.
      const total = await fs.promises
        .readdir(srcPath, { recursive: true })
        .then((names) => names.length + 1)
        .catch(() => undefined);
      // -v prints a line per file, which is all the progress cp can give.
      const cp = await this.run('cp', ['-Rv', srcPath, path.join(destDir, gsDir)], {
        token,
        onLine: this.fileCounter(progress, 'Copied', total),
      });
      if (cp.code !== 0) {
        throw new Error(`cp failed with exit code ${cp.code}${stderrTail(cp.stderr)}`);
      }
      appendSysadmin(`Extracted ${gsDir} to ${destDir}`);
    } finally {
      progress.report({ message: 'Unmounting disk image...' });
      const detach = await this.run('hdiutil', ['detach', mountPoint]);
      if (detach.code !== 0) {
        const message =
          `The GemStone disk image is still mounted at ${mountPoint}` +
          `${stderrTail(detach.stderr)}. Eject it in Finder.`;
        appendSysadmin(message);
        void vscode.window.showWarningMessage(message);
      }
    }
  }

  /**
   * `zipPath` and `destDir` are in the unpacking command's terms — WSL's on
   * Windows — and `localZipPath` is the same archive as this process reaches it.
   */
  private async extractZip(
    zipPath: string,
    localZipPath: string,
    destDir: string,
    progress: UnpackProgress,
    token: vscode.CancellationToken,
  ): Promise<void> {
    progress.report({ message: 'Unpacking...' });
    // WSL distros (Ubuntu, Debian) and minimal Linux installs often don't ship
    // unzip, but python3 is nearly always present. Try unzip first; on "command
    // not found" fall back to python3 -m zipfile.
    const unzip = await this.run('unzip', ['-o', zipPath, '-d', destDir], {
      token,
      // One indented "inflating: …" / "creating: …" line per entry, after an
      // unindented "Archive:" header.
      onLine: this.fileCounter(progress, 'Unpacked', await zipEntryCount(localZipPath), /^\s+\w+:/),
    });
    if (unzip.code === 0) {
      appendSysadmin(`Extracted ${path.basename(zipPath)} to ${destDir}`);
      return;
    }
    if (unzip.code !== 127) {
      throw new Error(`unzip failed with exit code ${unzip.code}${stderrTail(unzip.stderr)}`);
    }
    progress.report({ message: 'Unpacking with python3 (no file count)...' });
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
    const py = await this.run('python3', ['-c', pyScript, zipPath, destDir], { token });
    if (py.code === 0) {
      appendSysadmin(`Extracted ${path.basename(zipPath)} to ${destDir} (via python3)`);
      return;
    }
    if (py.code === 127) {
      throw new Error(
        needsWsl()
          ? "Neither 'unzip' nor 'python3' is available in your WSL distro. " +
              'Install one with: wsl -e sudo apt-get install -y unzip'
          : "Neither 'unzip' nor 'python3' is installed. " +
              'Install unzip with your package manager, for example: sudo apt-get install -y unzip',
      );
    }
    throw new Error(
      `python3 zipfile extract failed with exit code ${py.code}${stderrTail(py.stderr)}`,
    );
  }

  /**
   * A line handler that reports a running file count, at most four times a
   * second — out of `total`, with a percentage that fills the bar, when the
   * total is known.
   */
  private fileCounter(
    progress: UnpackProgress,
    verb: string,
    total: number | undefined,
    counts: RegExp = /./,
  ): (line: string) => void {
    let files = 0;
    let lastReport = 0;
    let reportedPercent = 0;
    return (line) => {
      if (!counts.test(line)) return;
      files++;
      const now = Date.now();
      if (now - lastReport < 250) return;
      lastReport = now;
      if (!total) {
        progress.report({ message: `${verb} ${files.toLocaleString()} files...` });
        return;
      }
      const percent = Math.min(100, Math.floor((files * 100) / total));
      progress.report({
        message: `${verb} ${files.toLocaleString()} of ${total.toLocaleString()} files (${percent}%)...`,
        increment: percent - reportedPercent,
      });
      reportedPercent = percent;
    };
  }

  /**
   * Run a command without blocking the extension host and say how it ended —
   * through WSL when GemStone lives there, unless `native`. Arguments reach the
   * child as an argv, never through a shell, so a root path holding a quote or
   * a `$` arrives intact.
   *
   * A cancel kills the child — and, through WSL, the Linux process behind
   * wsl.exe — and rejects only once both have gone, so the cleanup that follows
   * never races a child still writing. Through WSL that needs the Linux pid, so
   * a cancel that arrives before wsl.exe has named it waits for it, up to
   * {@link VersionManager.pidWaitMs}: killing wsl.exe first would close the
   * pipe the pid comes through. If stopping the Linux process fails, the cancel
   * still rejects, and the failure goes to the sysadmin log.
   */
  private run(
    cmd: string,
    args: string[],
    opts: {
      token?: vscode.CancellationToken;
      onLine?: (line: string) => void;
      onStderr?: (text: string) => void;
      native?: boolean;
    } = {},
  ): Promise<ChildResult> {
    const { token, onLine, onStderr } = opts;
    if (token?.isCancellationRequested)
      return Promise.reject(new InstallCancelledError('Cancelled'));
    const viaWsl = needsWsl() && !opts.native;
    return new Promise((resolve, reject) => {
      // Through WSL the child Jasper holds is wsl.exe, and killing it need not
      // stop the Linux process doing the work. The wrapper names that process,
      // so a cancel can stop it too.
      const proc: ChildProcess = viaWsl
        ? wslSpawn('sh', ['-c', WSL_PID_WRAPPER, 'sh', cmd, ...args])
        : spawn(cmd, args);
      let stderr = '';
      let firstLine = viaWsl ? '' : undefined;
      let linuxPid: string | undefined;
      let partial = '';
      let cancelled = false;
      let settled = false;
      let pidWait: NodeJS.Timeout | undefined;
      const subscription = token?.onCancellationRequested(() => {
        cancelled = true;
        // Still waiting for the pid line: kill once it arrives, below.
        if (firstLine !== undefined)
          pidWait = setTimeout(() => proc.kill(), VersionManager.pidWaitMs);
        else proc.kill();
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        let text = chunk.toString();
        if (firstLine !== undefined) {
          firstLine += text;
          if (!firstLine.includes('\n')) return;
          const pid = firstLine.match(WSL_PID_LINE);
          linuxPid = pid?.[1];
          text = pid ? firstLine.slice(pid[0].length) : firstLine;
          firstLine = undefined;
          if (cancelled) {
            clearTimeout(pidWait);
            proc.kill();
          }
        }
        // Only the tail is ever shown, and curl's progress bar would otherwise
        // grow this for the length of a download.
        stderr = (stderr + text).slice(-8192);
        onStderr?.(text);
      });
      // Read even when nobody wants the lines: a child whose stdout pipe fills
      // stops until someone does.
      proc.stdout?.on('data', (chunk: Buffer) => {
        if (!onLine) return;
        const lines = (partial + chunk.toString()).split('\n');
        partial = lines.pop() ?? '';
        lines.forEach(onLine);
      });
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(pidWait);
        subscription?.dispose();
        // Through WSL, ENOENT means wsl.exe itself is missing; a command
        // missing inside WSL comes back from sh as 127 instead.
        if (err.code === 'ENOENT' && !viaWsl) resolve({ code: 127, stderr: '' });
        else reject(err);
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(pidWait);
        subscription?.dispose();
        if (partial) onLine?.(partial);
        if (!cancelled) {
          resolve({ code: code ?? 1, stderr });
          return;
        }
        const stopped = linuxPid ? this.stopInWsl(linuxPid) : Promise.resolve();
        void stopped
          .catch((err: unknown) =>
            appendSysadmin(
              `Cancelled, but could not stop Linux process ${linuxPid} inside WSL ` +
                `(${err instanceof Error ? err.message : String(err)}); it may still be running.`,
            ),
          )
          .then(() => reject(new InstallCancelledError('Cancelled')));
      });
    });
  }

  /** Stop a Linux process a cancel may have left running inside WSL, and wait until it has gone. */
  private async stopInWsl(pid: string): Promise<void> {
    await this.run('kill', [pid]);
    for (let i = 0; i < 50; i++) {
      if ((await this.run('kill', ['-0', pid])).code !== 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    await this.run('kill', ['-9', pid]);
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
   * friendly error the caller can show verbatim. The zip is always deleted
   * afterwards, whether the unpack succeeded or not — the client distribution
   * is small enough that keeping it around doesn't add value.
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
          { cause: e },
        );
      }
      throw e;
    }

    // The archive holds one directory named after it, removed on a cancelled or
    // failed unpack only if this run is what created it.
    const clientDir = path.join(rootPath, fileName.replace(/\.zip$/, ''));
    const created = !fs.existsSync(clientDir);
    try {
      progress.report({ message: 'Extracting...' });
      // Native, not WSL: the Windows client is unpacked for Windows itself.
      const tar = await this.run('tar', ['-xf', zipPath, '-C', rootPath], { token, native: true });
      if (tar.code !== 0) {
        throw new Error(`tar failed with exit code ${tar.code}${stderrTail(tar.stderr)}`);
      }
      appendSysadmin(`Extracted Windows client: ${fileName}`);
    } catch (e) {
      if (created) {
        try {
          await fs.promises.rm(clientDir, { recursive: true, force: true });
        } catch (rmError) {
          // Said instead of the outcome, which it would otherwise replace: a
          // virus scanner holding a fresh DLL is enough to make this fail.
          const message = cleanupFailedMessage(
            'The Windows client install',
            e,
            clientDir,
            ` (${rmError instanceof Error ? rmError.message : String(rmError)})`,
          );
          appendSysadmin(message);
          throw new Error(message, { cause: rmError });
        }
      }
      if (e instanceof InstallCancelledError) {
        throw new InstallCancelledError(
          created
            ? 'Windows client install cancelled. The partly unpacked files were removed.'
            : `Windows client install cancelled. ${clientDir} was there before, so it was not ` +
                'removed; the unpack may have replaced some of its files.',
        );
      }
      throw e;
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
