import * as path from 'path';
import * as vscode from 'vscode';
import { SysadminStorage } from '../sysadminStorage';
import { ProcessManager } from './processManager';
import { DatabaseYaml, GemStoneDatabase } from '../sysadminTypes';
import {
  DEFAULT_GLOBAL_DIR,
  defaultConfDir,
  isRegisteredDatabase,
  registeredDatabaseYaml,
  registeredRefusal,
} from './registeredDatabase';
import { appendSysadmin } from '../sysadminChannel';
import { needsWsl, windowsPathToWsl, wslExecSync } from '../wslBridge';
import {
  wslExistsSync,
  wslMkdirSync,
  wslWriteFileSync,
  wslCopyFileSync,
  wslImportFileSync,
  wslUnlinkSync,
  wslRmSync,
  wslChmodSync,
  wslReaddirSync,
} from '../wslFs';

/** Drop a trailing path separator, either kind: an answer from the folder dialog
 *  is a `\\wsl$\…` UNC on Windows and a POSIX path everywhere else. */
function trimSeparator(p: string | undefined): string {
  return (p ?? '').replace(/[/\\]+$/, '');
}

/** `20260831-153000` — sorts chronologically as text, and is safe in a filename. */
export function timestampForFileName(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`
  );
}

export class DatabaseManager {
  constructor(
    private storage: SysadminStorage,
    private processManager: ProcessManager,
  ) {}

  /** Create a database with explicit parameters (no interactive UI). */
  async createDatabaseDirect(
    version: string,
    baseExtent: string,
    stoneName: string,
    ldiName: string,
    progress?: vscode.Progress<{ message?: string }>,
    parentDir?: string,
    allowNfsExtents?: boolean,
  ): Promise<GemStoneDatabase> {
    this.storage.ensureRootPath();
    const actualParent = parentDir || this.storage.getRootPath();
    const dbNum = this.storage.getNextDbNumber(actualParent);
    const dbDir = path.join(actualParent, `db-${dbNum}`);

    progress?.report({ message: 'Creating directories...' });
    wslMkdirSync(dbDir);
    wslMkdirSync(path.join(dbDir, 'conf'));
    wslMkdirSync(path.join(dbDir, 'data'));
    wslMkdirSync(path.join(dbDir, 'log'));
    wslMkdirSync(path.join(dbDir, 'stat'));

    progress?.report({ message: 'Writing configuration...' });

    // Config files are read by GemStone inside WSL, so paths must be Linux-side
    const confPath = needsWsl() ? windowsPathToWsl(dbDir) : dbDir;

    // database.yaml
    wslWriteFileSync(
      path.join(dbDir, 'database.yaml'),
      `---\nbaseExtent: "${baseExtent}.dbf"\nldiName: "${ldiName}"\nstoneName: "${stoneName}"\nversion: "${version}"\n`,
    );

    // gem.conf
    wslWriteFileSync(
      path.join(dbDir, 'conf', 'gem.conf'),
      `# Edit this file to change your gem or topaz configuration\n\n` +
        `# 500 MB: large Rowan project loads (e.g. Seaside) overflow the 50 MB\n` +
        `# default's old space; a development gem can afford the headroom.\n` +
        `GEM_TEMPOBJ_CACHE_SIZE = 500000;\n` +
        `GEM_TEMPOBJ_POMGEN_PRUNE_ON_VOTE = 90;\n\n` +
        `# Set the following to FALSE if you get an error\n` +
        `# related to native code when stepping in the debugger\n` +
        `GEM_NATIVE_CODE_ENABLED = TRUE;\n`,
    );

    // stoneName.conf
    wslWriteFileSync(
      path.join(dbDir, 'conf', `${stoneName}.conf`),
      `# Edit this file to change your stone configuration.\n` +
        `# For example, you might want a larger Shared Page Cache.\n\n` +
        `SHR_PAGE_CACHE_SIZE_KB = 100000;\n` +
        `KEYFILE = "${confPath}/conf/gemstone.key";\n`,
    );

    // system.conf
    wslWriteFileSync(
      path.join(dbDir, 'conf', 'system.conf'),
      `# See conf/default.conf (a copy of $GEMSTONE/data/system.conf) for descriptions of these lines.\n` +
        `# In general, this file should not be edited.\n` +
        `# You may customize the stone config file (stonename.conf) or gem.conf\n\n` +
        `DBF_EXTENT_NAMES = "${confPath}/data/extent0.dbf";\n` +
        `STN_TRAN_FULL_LOGGING = TRUE;\n` +
        `STN_TRAN_LOG_DIRECTORIES = "${confPath}/data/";\n` +
        `STN_TRAN_LOG_SIZES = 1000;\n` +
        (allowNfsExtents ? `STN_ALLOW_NFS_EXTENTS = TRUE;\n` : ''),
    );

    progress?.report({ message: 'Copying key file...' });
    const gsPath = this.storage.getGemstonePath(version)!;
    const keySource = path.join(gsPath, 'sys', 'community.starter.key');
    if (wslExistsSync(keySource)) {
      wslCopyFileSync(keySource, path.join(dbDir, 'conf', 'gemstone.key'));
    }

    // Copy the product tree's system.conf as default.conf so the documented
    // default configuration values sit alongside the database, rather than
    // buried in the GemStone install directory.
    progress?.report({ message: 'Copying default configuration...' });
    const defaultConfSource = path.join(gsPath, 'data', 'system.conf');
    if (wslExistsSync(defaultConfSource)) {
      wslCopyFileSync(defaultConfSource, path.join(dbDir, 'conf', 'default.conf'));
    } else {
      appendSysadmin(`default.conf not created: ${defaultConfSource} not found`);
    }

    progress?.report({ message: 'Copying base extent (this may take a moment)...' });
    const extentSource = path.join(gsPath, 'bin', `${baseExtent}.dbf`);
    const extentDest = path.join(dbDir, 'data', 'extent0.dbf');
    wslCopyFileSync(extentSource, extentDest);
    wslChmodSync(extentDest, 0o644);

    appendSysadmin(`Created database db-${dbNum} with stone "${stoneName}", version ${version}`);

    return {
      dirName: `db-${dbNum}`,
      path: dbDir,
      config: { version, stoneName, ldiName, baseExtent: `${baseExtent}.dbf` },
    };
  }

  /**
   * Adopt an installation that already exists, as a database Jasper can list,
   * start, stop and log in to — without creating or copying anything of its.
   *
   * What gets written is one `database.yaml` in Jasper's own root, plus the
   * `log/` directory that Jasper's own `startstone` writes into. Nothing is
   * written inside `productPath`: no conf, no key file, no extent, no
   * `default.conf` copy — all of which `createDatabaseDirect` above does, and
   * none of which Jasper is entitled to do to someone else's installation.
   *
   * The version is not asked for. It is read from the product tree's own
   * `version.txt`, because a version typed by hand is a version that can be
   * wrong, and every path Jasper resolves from it (its binaries, its GCI
   * library) has to match the tree it actually runs.
   *
   * `confPath` and `globalDir` default to GemStone's own conventions when the
   * caller cannot supply better; the panel supplies what it reads off a running
   * server, which is exact.
   */
  async registerExistingDatabase(input: {
    productPath: string;
    stoneName: string;
    ldiName: string;
    netldiPort?: number;
    confPath?: string;
    globalDir?: string;
  }): Promise<GemStoneDatabase> {
    const productPath = trimSeparator(input.productPath);
    const info = SysadminStorage.readVersionTxt(productPath);
    if (!info) {
      throw new Error(
        `${productPath} is not a GemStone product directory — it has no readable version.txt.`,
      );
    }

    this.storage.ensureRootPath();
    const parent = this.storage.getRootPath();
    const dbNum = this.storage.getNextDbNumber(parent);
    const dbDir = path.join(parent, `db-${dbNum}`);

    const confPath = trimSeparator(input.confPath) || defaultConfDir(productPath);
    const globalDir = trimSeparator(input.globalDir) || DEFAULT_GLOBAL_DIR;

    wslMkdirSync(dbDir);
    // Jasper's own log directory, not the installation's: a start driven from
    // here passes `-l` into this directory, so the one file Jasper's actions
    // create lands on Jasper's side of the line.
    wslMkdirSync(path.join(dbDir, 'log'));

    const config: DatabaseYaml = {
      version: info.version,
      stoneName: input.stoneName,
      ldiName: input.ldiName,
      registered: true,
      productPath,
      confPath,
      globalDir,
      ...(input.netldiPort ? { netldiPort: input.netldiPort } : {}),
    };
    wslWriteFileSync(path.join(dbDir, 'database.yaml'), registeredDatabaseYaml(config));

    appendSysadmin(
      `Registered existing database db-${dbNum}: stone "${input.stoneName}", ` +
        `NetLDI "${input.ldiName}"${input.netldiPort ? ` (port ${input.netldiPort})` : ''}, ` +
        `GemStone ${info.version} at ${productPath}`,
    );

    return { dirName: `db-${dbNum}`, path: dbDir, config };
  }

  /**
   * Write a registered database's NetLDI port into its record, when what is
   * running disagrees with what was written down.
   *
   * The record's port exists so a login can address a NetLDI whose name may not
   * resolve, and so `startNetldi` can ask for the same port back. Both are
   * wrong the moment someone restarts that NetLDI outside Jasper, since it then
   * takes a fresh ephemeral port — so the observed port replaces the remembered
   * one rather than being merely preferred at the point of use. Only Jasper's
   * own file is rewritten; the installation is untouched — and it is rewritten
   * through the same serializer registration uses, so a record that recorded
   * only its product tree keeps working rather than acquiring the literal
   * `"undefined"` where its resolved defaults belong.
   *
   * Returns the config as it now stands, so a caller need not re-read it.
   */
  recordNetldiPort(db: GemStoneDatabase, port: number): DatabaseYaml {
    if (!isRegisteredDatabase(db) || db.config.netldiPort === port) return db.config;
    const updated: DatabaseYaml = { ...db.config, netldiPort: port };
    wslWriteFileSync(path.join(db.path, 'database.yaml'), registeredDatabaseYaml(updated));
    appendSysadmin(
      `NetLDI "${updated.ldiName}" is on port ${port}; updated ${db.dirName}'s record` +
        (db.config.netldiPort ? ` (was ${db.config.netldiPort})` : ''),
    );
    return updated;
  }

  /**
   * Drop Jasper's record of a registered database, leaving the installation
   * exactly as it was.
   *
   * The counterpart of Delete, which registered databases do not get: there is
   * nothing of Jasper's to delete but the record, and nothing of the user's
   * that Jasper should. Only the `db-N` directory Jasper wrote goes — and it goes
   * whole: registering makes a `log/` inside it, so a non-recursive remove fails
   * on its own subdirectory with EISDIR and the record can never be dropped.
   */
  async unregisterDatabase(db: GemStoneDatabase): Promise<boolean> {
    if (!isRegisteredDatabase(db)) {
      vscode.window.showErrorMessage(
        `"${db.config.stoneName}" was created by Jasper — use Delete Database, which removes its files too.`,
      );
      return false;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Stop managing "${db.config.stoneName}" (${db.dirName})?`,
      {
        modal: true,
        detail:
          `Only Jasper's record of it is removed. The installation at ` +
          `${db.config.productPath} is left untouched, and any running stone keeps running.`,
      },
      'Unregister',
    );
    if (confirmed !== 'Unregister') return false;
    wslRmSync(db.path, { recursive: true, force: true });
    appendSysadmin(`Unregistered database ${db.dirName} (${db.config.stoneName})`);
    return true;
  }

  /**
   * Where offline extent copies live: their own directory inside the database's
   * backups folder.
   *
   * Deliberately NOT alongside the logical backups. Both are `.dbf` files, and
   * the two are restored in completely different ways — a logical backup through
   * a running stone, an extent copy by putting the file back in place with the
   * stone down. Mixing them in one list means offering the wrong restore on the
   * wrong file, which either fails after a full stop/start cycle or destroys a
   * database.
   */
  static extentBackupDir(dbPath: string): string {
    return path.join(dbPath, 'backups', 'extents');
  }

  /**
   * Copy a stopped database's extents into its backups folder.
   *
   * This is the backup Jasper did not have: the other two (logical, and the
   * online extent snapshot) both run through a live session, so neither can be
   * taken of a database that is simply sitting there stopped — which is exactly
   * when copying extents is safe and cheap.
   *
   * The stone MUST be down. Copying a live extent without suspending checkpoints
   * yields a file that looks like a backup and is not one, so this refuses
   * rather than producing something misleading; the online path exists for a
   * running stone.
   *
   * Answers the directory written to, or undefined if nothing was.
   */
  async offlineExtentBackup(db: GemStoneDatabase): Promise<string | undefined> {
    // Copying a registered database's extents means reading the installation's
    // files and writing copies of them; the panel offers no button for it, and
    // this is the same answer for every other way in. Worth having, and what it
    // needs is the extent list, which `db.path` cannot supply for a registered
    // database: https://github.com/GemTalk/Jasper/issues/562
    if (isRegisteredDatabase(db)) {
      vscode.window.showErrorMessage(
        registeredRefusal('back up the extents of', db.config.stoneName),
      );
      return undefined;
    }
    // Re-read first, then refuse for a stone alive anywhere on the host — not
    // just one Jasper's own gslist knows about. Same guard, and same reasoning,
    // as deleting a database or replacing its extent.
    this.processManager.refreshProcesses();
    if (this.processManager.isServerAlive(db, 'stone')) {
      vscode.window.showErrorMessage(
        this.stillRunningMessage(db, 'stone', 'backing up its extents'),
      );
      return undefined;
    }

    const dataDir = path.join(db.path, 'data');
    const extents = wslReaddirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.dbf'));
    if (extents.length === 0) {
      vscode.window.showErrorMessage(`No extent files found in ${dataDir}.`);
      return undefined;
    }

    const destDir = DatabaseManager.extentBackupDir(db.path);
    // recursive: the `backups` parent does not exist until something makes it —
    // a database is created without one.
    wslMkdirSync(destDir, { recursive: true });
    // Stamped rather than overwritten: a backup that silently replaces the last
    // one is one mistake away from being no backup at all.
    const stamp = timestampForFileName(new Date());
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Backing up extents for ${db.config.stoneName}...`,
      },
      async () => {
        for (const extent of extents) {
          const base = extent.replace(/\.dbf$/i, '');
          wslCopyFileSync(path.join(dataDir, extent), path.join(destDir, `${base}-${stamp}.dbf`));
        }
        appendSysadmin(
          `Offline extent backup for ${db.config.stoneName}: ${extents.length} file(s) → ${destDir}`,
        );
        vscode.window.showInformationMessage(
          `Backed up ${extents.length === 1 ? 'the extent' : `${extents.length} extents`} for "${db.config.stoneName}".`,
        );
        return destDir;
      },
    );
  }

  /**
   * Why a destructive operation was refused, and what the user can do about it.
   *
   * "Stop it before deleting" is a dead end for a server started outside
   * Jasper's environment: its row offers no Stop button, and `stopstone` run in
   * Jasper's environment cannot find it — that blind spot is the whole reason
   * the server is being reported at all. So that case names the process, says
   * where it is registered, and points at the action that does work.
   */
  private stillRunningMessage(
    db: GemStoneDatabase,
    type: 'stone' | 'netldi',
    operation: string,
  ): string {
    const what =
      type === 'stone' ? `Stone "${db.config.stoneName}"` : `NetLDI "${db.config.ldiName}"`;
    // Already memoized against the current gslist reading, so this costs nothing.
    const external = this.processManager.getExternalServers(db)[type];
    if (!external) return `${what} is still running. Stop it before ${operation}.`;
    const where = external.process.globalDir ? `, registered in ${external.process.globalDir}` : '';
    return (
      `${what} is running, but was started outside Jasper's environment ` +
      `(PID ${external.process.pid}${where}), so Jasper cannot stop it directly. Use ` +
      `"Restart Under Jasper's Environment" on its row in the Databases view, or stop it from ` +
      `the shell it was started in, then try ${operation} again.`
    );
  }

  /** Delete a database directory after confirmation */
  async deleteDatabase(db: GemStoneDatabase): Promise<boolean> {
    // A registered database's files are the user's, not Jasper's. The panel
    // greys the button and says why, and this is the same answer for every
    // other way the command can be reached (palette, sidebar row).
    if (isRegisteredDatabase(db)) {
      vscode.window.showErrorMessage(
        `${registeredRefusal('delete', db.config.stoneName)} Use Unregister Database to drop ` +
          `Jasper's record of it instead.`,
      );
      return false;
    }
    // Re-read before the guard: isServerAlive answers from the memoized
    // per-refresh gslist verdict, and the user may have started a stone by
    // hand since the tree last refreshed. Without this, the check could pass
    // against a reading that predates the live database — the exact case
    // isServerAlive was widened to catch (restartExternalServers re-reads for
    // the same reason).
    this.processManager.refreshProcesses();
    // isServerAlive, not isStoneRunning: a server started outside Jasper's
    // environment is absent from Jasper's gslist but has the extent open, and
    // deleting the directory under it would corrupt a running database.
    if (this.processManager.isServerAlive(db, 'stone')) {
      vscode.window.showErrorMessage(this.stillRunningMessage(db, 'stone', 'deleting'));
      return false;
    }
    if (this.processManager.isServerAlive(db, 'netldi')) {
      vscode.window.showErrorMessage(this.stillRunningMessage(db, 'netldi', 'deleting'));
      return false;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete database "${db.dirName}" (${db.config.stoneName})? This cannot be undone.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') return false;

    wslRmSync(db.path, { recursive: true, force: true });
    appendSysadmin(`Deleted database ${db.dirName}`);
    return true;
  }

  /** Replace the extent and transaction logs with a fresh base extent */
  async replaceExtent(db: GemStoneDatabase): Promise<boolean> {
    // The extent of a registered database is the installation's own file, in a
    // directory the user handed over to be read, not overwritten.
    if (isRegisteredDatabase(db)) {
      vscode.window.showErrorMessage(
        registeredRefusal('replace the extent of', db.config.stoneName),
      );
      return false;
    }
    // See deleteDatabase: re-read first so the guard sees a stone the user
    // started by hand since the last refresh, then refuse for a stone alive
    // anywhere on the host, not just one Jasper's own gslist can see.
    this.processManager.refreshProcesses();
    if (this.processManager.isServerAlive(db, 'stone')) {
      vscode.window.showErrorMessage(this.stillRunningMessage(db, 'stone', 'replacing the extent'));
      return false;
    }

    // Offer the vendor-supplied extents plus a "browse" escape hatch so the
    // user can seed from an extent copied off another machine. Browse is
    // always available, so a not-yet-extracted version no longer blocks this.
    const browseItem: vscode.QuickPickItem = {
      label: '$(folder-opened) Browse for extent file…',
      detail: 'Copy an extent from another location (e.g. a copy from another machine)',
    };
    // Only a created database reaches here, and one always records its extent —
    // but the field is optional on the type (a registered database has none), so
    // an empty current selection is the honest fallback rather than a cast.
    const currentExtent = (db.config.baseExtent ?? '').replace(/\.dbf$/, '');
    const items: vscode.QuickPickItem[] = [browseItem];
    const extents = this.storage.getAvailableExtents(db.config.version);
    if (extents.length > 0) {
      items.push({ label: 'Initial databases', kind: vscode.QuickPickItemKind.Separator });
      items.push(...extents.map((e) => ({ label: e, picked: e === currentExtent })));
    }

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select new base extent',
      title: `Replace extent for ${db.config.stoneName}`,
    });
    if (!pick) return false;

    // Resolve the source path and the name to record in database.yaml.
    let extentSource: string;
    let baseExtentName: string;
    if (pick === browseItem) {
      const selection = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select Extent',
        title: `Select an extent file to copy into ${db.config.stoneName}`,
        filters: { 'Extent files': ['dbf'], 'All files': ['*'] },
      });
      if (!selection?.[0]) return false;
      extentSource = selection[0].fsPath;
      baseExtentName = path.basename(extentSource);
    } else {
      const gsPath = this.storage.getGemstonePath(db.config.version);
      if (!gsPath) {
        vscode.window.showErrorMessage(`GemStone ${db.config.version} not found.`);
        return false;
      }
      extentSource = path.join(gsPath, 'bin', `${pick.label}.dbf`);
      baseExtentName = `${pick.label}.dbf`;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Replace the database for "${db.config.stoneName}" with ${baseExtentName}? ` +
        `This will delete the current extent and all transaction logs. This cannot be undone.`,
      { modal: true },
      'Replace',
    );
    if (confirmed !== 'Replace') return false;

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Replacing extent for ${db.config.stoneName}...`,
      },
      async (progress) => {
        try {
          // Verify the source exists before deleting anything, so a missing or
          // unreadable source can't leave the database with no extent at all.
          if (!wslExistsSync(extentSource)) {
            vscode.window.showErrorMessage(`Extent file not found: ${extentSource}`);
            return false;
          }

          const dataDir = path.join(db.path, 'data');

          // Delete all .dbf files in data/
          progress.report({ message: 'Removing old extent and transaction logs...' });
          for (const entry of wslReaddirSync(dataDir)) {
            if (entry.endsWith('.dbf')) {
              wslUnlinkSync(path.join(dataDir, entry));
            }
          }

          // Copy new extent (source may be on a different filesystem than the
          // WSL-side database, so use the cross-filesystem-aware import).
          progress.report({ message: 'Copying new extent (this may take a moment)...' });
          const extentDest = path.join(dataDir, 'extent0.dbf');
          wslImportFileSync(extentSource, extentDest);
          wslChmodSync(extentDest, 0o644);

          // Update database.yaml
          progress.report({ message: 'Updating configuration...' });
          wslWriteFileSync(
            path.join(db.path, 'database.yaml'),
            `---\nbaseExtent: "${baseExtentName}"\nldiName: "${db.config.ldiName}"\n` +
              `stoneName: "${db.config.stoneName}"\nversion: "${db.config.version}"\n`,
          );

          appendSysadmin(`Replaced extent for ${db.config.stoneName} with ${baseExtentName}`);
          return true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Replace extent failed: ${msg}`);
          return false;
        }
      },
    );
  }

  /**
   * The NFS risk a database created right now would run into, or undefined when
   * there is none to report.
   *
   * Only the *first* database is checked. After that the user has already
   * answered the question for this root path, and re-asking every time is what
   * made the original flow tiresome. Both the Quick Pick flow and the panel's
   * form ask here rather than each testing the rule, so they cannot disagree
   * about when the warning is due.
   */
  nfsRiskForNextDatabase(): { rootPath: string; fsType: string } | undefined {
    if (this.storage.getDatabases().length > 0) return undefined;
    const rootPath = this.storage.getRootPath();
    const checkPath = needsWsl() ? this.storage.getWslRootPath() : rootPath;
    const fsType = this.detectFilesystem(checkPath);
    appendSysadmin(`NFS check: path=${checkPath}, fsType=${fsType ?? '(not detected)'}`);
    if (!fsType || !/^nfs/i.test(fsType)) return undefined;
    return { rootPath, fsType };
  }

  private detectFilesystem(linuxPath: string): string | undefined {
    try {
      const out = wslExecSync(`findmnt -n -o FSTYPE --target "${linuxPath}" 2>/dev/null`).trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  }
}
