import * as path from 'path';
import * as vscode from 'vscode';
import { SysadminStorage } from './sysadminStorage';
import { ProcessManager } from './processManager';
import { GemStoneDatabase } from './sysadminTypes';
import { appendSysadmin } from './sysadminChannel';
import { needsWsl, windowsPathToWsl, wslExecSync } from './wslBridge';
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
} from './wslFs';

export class DatabaseManager {
  constructor(
    private storage: SysadminStorage,
    private processManager: ProcessManager,
  ) {}

  /** Create a new database via multi-step QuickPick */
  async createDatabase(): Promise<GemStoneDatabase | undefined> {
    // Step 1: Pick extracted version
    const versions = this.storage.getExtractedVersions();
    if (versions.length === 0) {
      vscode.window.showErrorMessage(
        'No GemStone versions extracted. Download and extract a version first.',
      );
      return undefined;
    }
    const versionPick = await vscode.window.showQuickPick(
      versions.map((v) => ({ label: v })),
      {
        placeHolder:
          'Which GemStone release this database runs — the newest unless you need to match a server',
        title: 'New Database — 1 of 4: version',
      },
    );
    if (!versionPick) return undefined;
    const version = versionPick.label;

    // Step 2: Pick base extent
    const extents = this.storage.getAvailableExtents(version);
    if (extents.length === 0) {
      vscode.window.showErrorMessage(`No extent files found for version ${version}.`);
      return undefined;
    }
    const extentPick = await vscode.window.showQuickPick(
      extents.map((e) => ({ label: e })),
      {
        placeHolder: 'The starting repository to copy — extent0.dbf is the standard one',
        title: 'New Database — 2 of 4: base extent',
      },
    );
    if (!extentPick) return undefined;
    const baseExtent = extentPick.label;

    // Step 3: Stone name
    const stoneName = await vscode.window.showInputBox({
      prompt:
        'Names the stone — the process that owns this repository and coordinates every session in it. You log in to a stone by this name.',
      value: 'gs64stone',
      title: 'New Database — 3 of 4: stone name',
      validateInput: (v) => (/^\w+$/.test(v) ? null : 'Alphanumeric and underscore only'),
    });
    if (!stoneName) return undefined;

    // Step 4: NetLDI name
    const ldiName = await vscode.window.showInputBox({
      prompt:
        'Names the NetLDI — the listener that starts a gem process for each session reaching this stone. The default is right unless another NetLDI already uses the name.',
      value: 'gs64ldi',
      title: 'New Database — 4 of 4: NetLDI name',
      validateInput: (v) => (/^\w+$/.test(v) ? null : 'Alphanumeric and underscore only'),
    });
    if (!ldiName) return undefined;

    // NFS check — only on the first database to avoid re-prompting experienced users
    let effectiveParentDir: string | undefined;
    let allowNfsExtents = false;

    if (this.storage.getDatabases().length === 0) {
      const rootPath = this.storage.getRootPath();
      const checkPath = needsWsl() ? this.storage.getWslRootPath() : rootPath;
      const fsType = this.detectFilesystem(checkPath);
      appendSysadmin(`NFS check: path=${checkPath}, fsType=${fsType ?? '(not detected)'}`);
      if (fsType && /^nfs/i.test(fsType)) {
        const choice = await vscode.window.showWarningMessage(
          `GemStone root path is on NFS — database will not start by default`,
          {
            modal: true,
            detail:
              `Your root path (${rootPath}) is on a network filesystem (${fsType}). ` +
              `GemStone databases lock their extent files in a way that is incompatible with NFS by default — ` +
              `a database created here will fail to start.\n\n` +
              `• "Use a local directory" — select a folder on a local disk. Jasper will create the database ` +
              `there and save it as your new default root path.\n\n` +
              `• "Continue on NFS" — create the database here and automatically add ` +
              `STN_ALLOW_NFS_EXTENTS = TRUE to system.conf, which overrides the restriction. ` +
              `The database will start, but NFS locking may reduce reliability and performance.`,
          },
          'Use a local directory',
          'Continue on NFS',
        );
        if (choice === undefined) return undefined;

        if (choice === 'Use a local directory') {
          const folderResult = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Use This Folder',
            title: 'Select a local disk folder for this GemStone database',
          });
          if (!folderResult?.[0]) {
            appendSysadmin('NFS check: folder picker cancelled');
            return undefined;
          }
          effectiveParentDir = folderResult[0].fsPath;
          appendSysadmin(`NFS check: local directory selected: ${effectiveParentDir}`);
        } else {
          allowNfsExtents = true;
        }
      }
    }

    // Create directory structure
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating GemStone database...' },
      async (progress) => {
        try {
          appendSysadmin(
            `createDatabase: parentDir=${effectiveParentDir ?? '(rootPath)'}, allowNfsExtents=${allowNfsExtents}`,
          );
          const db = await this.createDatabaseDirect(
            version,
            baseExtent,
            stoneName,
            ldiName,
            progress,
            effectiveParentDir,
            allowNfsExtents,
          );

          if (effectiveParentDir) {
            // Update rootPath after creation so version lookup used the old path during creation
            await vscode.workspace
              .getConfiguration('gemstone')
              .update('rootPath', effectiveParentDir, vscode.ConfigurationTarget.Global);
            vscode.window
              .showInformationMessage(
                `Database created at ${effectiveParentDir}. ` +
                  `Your GemStone root path setting has been updated to this location — ` +
                  `new databases and version downloads will go here by default. ` +
                  `To change it, open Preferences › Settings and search for "GemStone: Root Path".`,
                'Open Settings',
              )
              .then((btn) => {
                if (btn === 'Open Settings') {
                  vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'gemstone.rootPath',
                  );
                }
              });
          }

          if (allowNfsExtents) {
            const systemConfPath = path.join(db.path, 'conf', 'system.conf');
            vscode.window
              .showInformationMessage(
                `Database created on NFS. ` +
                  `STN_ALLOW_NFS_EXTENTS = TRUE was added to system.conf so the database can start on a network filesystem. ` +
                  `You can view that file using the button below. ` +
                  `To store future databases on local disk instead, open Preferences › Settings ` +
                  `and search for "GemStone: Root Path".`,
                'Open system.conf',
                'Open Settings',
              )
              .then((btn) => {
                if (btn === 'Open system.conf') {
                  vscode.workspace
                    .openTextDocument(systemConfPath)
                    .then((doc) => vscode.window.showTextDocument(doc));
                } else if (btn === 'Open Settings') {
                  vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'gemstone.rootPath',
                  );
                }
              });
          }

          return db;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          appendSysadmin(`createDatabase failed: ${msg}`);
          vscode.window.showErrorMessage(`Create database failed: ${msg}`);
          return undefined;
        }
      },
    );
  }

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

  /** Delete a database directory after confirmation */
  async deleteDatabase(db: GemStoneDatabase): Promise<boolean> {
    // Check if processes are running
    if (this.processManager.isStoneRunning(db.config.stoneName, db.config.version)) {
      vscode.window.showErrorMessage(
        `Stone "${db.config.stoneName}" is still running. Stop it before deleting.`,
      );
      return false;
    }
    if (this.processManager.isNetldiRunning(db.config.ldiName, db.config.version)) {
      vscode.window.showErrorMessage(
        `NetLDI "${db.config.ldiName}" is still running. Stop it before deleting.`,
      );
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
    if (this.processManager.isStoneRunning(db.config.stoneName, db.config.version)) {
      vscode.window.showErrorMessage(
        `Stone "${db.config.stoneName}" is still running. Stop it before replacing the extent.`,
      );
      return false;
    }

    // Offer the vendor-supplied extents plus a "browse" escape hatch so the
    // user can seed from an extent copied off another machine. Browse is
    // always available, so a not-yet-extracted version no longer blocks this.
    const browseItem: vscode.QuickPickItem = {
      label: '$(folder-opened) Browse for extent file…',
      detail: 'Copy an extent from another location (e.g. a copy from another machine)',
    };
    const currentExtent = db.config.baseExtent.replace(/\.dbf$/, '');
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

  private detectFilesystem(linuxPath: string): string | undefined {
    try {
      const out = wslExecSync(`findmnt -n -o FSTYPE --target "${linuxPath}" 2>/dev/null`).trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  }
}
