import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SysadminStorage } from './sysadminStorage';
import { VersionManager } from './manager/versionManager';
import { DatabaseManager } from './manager/databaseManager';
import { ProcessManager } from './manager/processManager';
import { LoginStorage } from './loginStorage';
import { DEFAULT_GS_PW } from './loginTypes';
import { GemStoneVersion } from './sysadminTypes';
import { getSharedMemory } from './sharedMemoryTreeProvider';
import { appendSysadmin } from './sysadminChannel';
import { isWindows } from './wslBridge';
import { bundledWindowsClientGciPath } from './bundledGci';

function waitForTerminalClose(name: string): Promise<void> {
  return new Promise((resolve) => {
    const disposable = vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal.name === name) {
        disposable.dispose();
        resolve();
      }
    });
  });
}

export interface QuickSetupDeps {
  sysadminStorage: SysadminStorage;
  versionManager: VersionManager;
  databaseManager: DatabaseManager;
  processManager: ProcessManager;
  loginStorage: LoginStorage;
  refreshAdminViews: () => void;
  refreshVersions: () => void;
  refreshLogins: () => void;
}

export async function runQuickSetup(deps: QuickSetupDeps): Promise<void> {
  const {
    sysadminStorage,
    versionManager,
    databaseManager,
    processManager,
    loginStorage,
    refreshAdminViews,
    refreshVersions,
    refreshLogins,
  } = deps;

  // ── Step 1: Check shared memory ─────────────────────────
  if (process.platform !== 'win32') {
    const mem = await getSharedMemory();
    const shmmaxGb = mem ? mem.shmmax / Math.pow(2, 30) : 0;
    const shmallGb = mem ? mem.shmall / Math.pow(2, 18) : 0;
    if (shmmaxGb < 1 || shmallGb < 1) {
      const choice = await vscode.window.showWarningMessage(
        'Shared memory is not configured (< 1 GB). Run the setup script first?',
        { modal: true },
        'Run Setup Script',
        'Skip',
      );
      if (choice === 'Run Setup Script') {
        await vscode.commands.executeCommand(
          process.platform === 'linux'
            ? 'gemstone.runSetSharedMemoryLinux'
            : 'gemstone.runSetSharedMemory',
        );
        await waitForTerminalClose('GemStone: Shared Memory Setup');
        return runQuickSetup(deps);
      }
      if (choice !== 'Skip') return; // cancelled
    }
  }

  // ── Step 2: Fetch available versions ────────────────────
  let versions: GemStoneVersion[];
  try {
    versions = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Quick Setup: Fetching available versions...',
      },
      () => versionManager.fetchAvailableVersions(),
    );
  } catch (e) {
    vscode.window.showErrorMessage(
      `Failed to fetch versions: ${e instanceof Error ? e.message : e}`,
    );
    return;
  }
  if (versions.length === 0) {
    vscode.window.showErrorMessage('No GemStone versions available for this platform.');
    return;
  }

  // ── Step 3: Pick version ────────────────────────────────
  const latest = versions[0];
  const items = versions.map((v) => ({
    label: v.version,
    description: v.extracted ? 'extracted' : v.downloaded ? 'downloaded' : '',
    version: v,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: 'GemStone Quick Setup',
    placeHolder: `Select a version (latest: ${latest.version})`,
  });
  if (!pick) return;
  const version = pick.version;

  // ── Step 4: Download if needed ──────────────────────────
  if (!version.downloaded && !version.extracted) {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Quick Setup: Downloading GemStone ${version.version}...`,
          cancellable: true,
        },
        (progress, token) => versionManager.download(version, progress, token),
      );
      version.downloaded = true;
      refreshVersions();
    } catch (e) {
      vscode.window.showErrorMessage(`Download failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
  }

  // ── Step 5: Extract if needed ───────────────────────────
  if (!version.extracted) {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Quick Setup: Extracting GemStone ${version.version}...`,
        },
        (progress) => versionManager.extract(version, progress),
      );
      version.extracted = true;
      refreshVersions();
    } catch (e) {
      vscode.window.showErrorMessage(`Extraction failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
  }

  // ── Step 6: Create database ─────────────────────────────
  const stoneName = 'gs64stone';
  const ldiName = 'gs64ldi';
  const baseExtent = 'extent0';
  let db;
  try {
    db = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Quick Setup: Creating database...',
      },
      (progress) =>
        databaseManager.createDatabaseDirect(
          version.version,
          baseExtent,
          stoneName,
          ldiName,
          progress,
        ),
    );
    refreshAdminViews();
  } catch (e) {
    vscode.window.showErrorMessage(
      `Database creation failed: ${e instanceof Error ? e.message : e}`,
    );
    return;
  }

  // ── Step 7: Start stone ─────────────────────────────────
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Quick Setup: Starting stone ${stoneName}...`,
      },
      () => processManager.startStone(db),
    );
    refreshAdminViews();
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to start stone: ${e instanceof Error ? e.message : e}`);
    return;
  }

  // ── Step 8: Start NetLDI ────────────────────────────────
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Quick Setup: Starting NetLDI ${ldiName}...`,
      },
      () => processManager.startNetldi(db),
    );
    refreshAdminViews();
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to start NetLDI: ${e instanceof Error ? e.message : e}`);
    return;
  }

  // ── Step 9: Create login ────────────────────────────────
  const login = {
    label: '',
    version: version.version,
    gem_host: 'localhost',
    stone: stoneName,
    gs_user: 'DataCurator',
    gs_password: DEFAULT_GS_PW,
    netldi: ldiName,
    host_user: '',
    host_password: '',
  };

  // Auto-detect GCI library path
  const bundledDll = isWindows() ? bundledWindowsClientGciPath(version.version) : undefined;
  if (bundledDll) {
    // A GCI DLL ships with the extension (secure/air-gapped build) — use it
    // directly and skip the network download.
    await loginStorage.setGciLibraryPath(version.version, bundledDll);
    appendSysadmin(`Using GCI library bundled with the extension: ${bundledDll}`);
  } else if (isWindows()) {
    // Download and extract the Windows client for this version so the
    // native GCI DLL is available for login.
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Quick Setup: Installing Windows client ${version.version}...`,
          cancellable: true,
        },
        (progress, token) =>
          versionManager.downloadAndExtractWindowsClient(version.version, progress, token),
      );
      const dllPath = sysadminStorage.getWindowsClientGciPath(version.version);
      if (dllPath) {
        await loginStorage.setGciLibraryPath(version.version, dllPath);
      }
      refreshVersions();
    } catch (e) {
      appendSysadmin(`Windows client install failed: ${e instanceof Error ? e.message : e}`);
      // Non-fatal: the user can still manually configure the GCI library
    }
  } else {
    const gsPath = sysadminStorage.getGemstonePath(version.version);
    if (gsPath) {
      const ext = process.platform === 'darwin' ? 'dylib' : 'so';
      const libPath = path.join(gsPath, 'lib', `libgcits-${version.version}-64.${ext}`);
      if (fs.existsSync(libPath)) {
        await loginStorage.setGciLibraryPath(version.version, libPath);
      }
    }
  }

  await loginStorage.saveLogin(login);
  refreshLogins();

  appendSysadmin('Quick Setup complete');
  vscode.window.showInformationMessage(
    `Quick Setup complete! Database "${db.dirName}" is running. Use the login "DataCurator on ${stoneName} (localhost)" to connect.`,
  );
}
