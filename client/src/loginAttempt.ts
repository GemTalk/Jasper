import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GemStoneLogin } from './loginTypes';
import type { ActiveSession } from './sessionManager';
import type { LoginOutcome } from './telemetry';
import { bundledWindowsClientGciPath, bundledGciArchSupported } from './bundledGci';
import { showInstallOutcome } from './manager/versionManager';

/** What {@link attemptLogin} needs from the extension's storage, installers and connect UI. */
export interface LoginAttemptDeps {
  keychainPassword(login: GemStoneLogin): Promise<string | undefined>;
  getGciLibraryPath(version: string): string | undefined;
  setGciLibraryPath(version: string, gciPath: string): Promise<void>;
  getGemstonePath(version: string): string | undefined;
  getWindowsClientGciPath(version: string): string | undefined;
  getRootPath(): string;
  downloadAndExtractWindowsClient(
    version: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken,
  ): Promise<void>;
  refreshVersions(): void;
  /** Undefined when the login failed, after the failure has been shown. */
  connect(login: GemStoneLogin, gciPath: string): Promise<ActiveSession | undefined>;
  connected(login: GemStoneLogin, session: ActiveSession): void;
}

/**
 * The gemstone.login command: collect any missing passwords, find a GCI library
 * for the login's version, then connect. Resolves to the outcome the command
 * reports, so every exit is tied to the outcome it stands for.
 */
export async function attemptLogin(
  original: GemStoneLogin,
  deps: LoginAttemptDeps,
): Promise<LoginOutcome> {
  const login = { ...original };

  // If the login is configured to use the OS keychain, fetch the password
  // from there. Fall through to the prompt if the keychain entry is missing.
  if (login.password_in_keychain && !login.gs_password) {
    const stored = await deps.keychainPassword(login);
    if (stored) {
      login.gs_password = stored;
    }
  }

  if (!login.gs_password) {
    const password = await vscode.window.showInputBox({
      prompt: `GemStone password for ${login.gs_user || 'user'}@${login.gem_host || 'host'}`,
      password: true,
    });
    if (password === undefined) {
      return 'cancelled';
    }
    login.gs_password = password;
  }

  if (!login.host_password && login.host_user) {
    const password = await vscode.window.showInputBox({
      prompt: `Host password for ${login.host_user}@${login.gem_host || 'host'}`,
      password: true,
    });
    if (password === undefined) {
      return 'cancelled';
    }
    login.host_password = password;
  }

  // Ensure GCI library is configured for this version
  let gciPath = deps.getGciLibraryPath(login.version);

  // Prefer a GCI library bundled with the extension (for secure /
  // air-gapped installs that cannot download from gemtalksystems.com).
  // This must win over the download/file-picker prompts below.
  if (!gciPath && process.platform === 'win32') {
    const bundled = bundledWindowsClientGciPath(login.version);
    if (bundled) {
      if (bundledGciArchSupported()) {
        gciPath = bundled;
      } else {
        // The bundled DLLs are x64; an ARM64 VS Code process cannot load
        // them. Guide the user to the x64 build instead of letting the
        // native loader fail with a cryptic architecture-mismatch error.
        vscode.window.showErrorMessage(
          `The GemStone ${login.version} client library bundled with Jasper is x64, but VS Code is ` +
            `running as ${process.arch}. Install and run the x64 build of VS Code (it runs under ` +
            `emulation on Windows on ARM) to use the bundled library.`,
        );
        return 'noClientLibrary';
      }
    }
  }

  // Auto-detect from extracted version's lib/ directory.
  // Skipped on Windows: the product dir is a Linux build (only .so), so
  // the GCI for a Windows host has to come from the Windows client below.
  if (!gciPath && process.platform !== 'win32') {
    const gsPath = deps.getGemstonePath(login.version);
    if (gsPath) {
      const ext = process.platform === 'darwin' ? 'dylib' : 'so';
      const candidate = path.join(gsPath, 'lib', `libgcits-${login.version}-64.${ext}`);
      if (fs.existsSync(candidate)) {
        gciPath = candidate;
      }
    }
  }

  // Auto-detect from extracted Windows client distribution
  if (!gciPath && process.platform === 'win32') {
    const clientGci = deps.getWindowsClientGciPath(login.version);
    if (clientGci) {
      gciPath = clientGci;
    }
  }

  // On Windows, offer to download the client distribution before falling
  // back to the manual file picker.
  if (!gciPath && process.platform === 'win32') {
    if (!login.version || !login.version.trim()) {
      vscode.window.showErrorMessage(
        'Cannot download a Windows client: the login has no GemStone version set. Edit the login to choose a version first.',
      );
      return 'noClientLibrary';
    }
    const choice = await vscode.window.showInformationMessage(
      `Windows client library not found for GemStone ${login.version}. Download it?`,
      'Download',
      'Browse...',
    );
    if (choice === 'Download') {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Installing Windows client ${login.version}...`,
            cancellable: true,
          },
          (progress, token) => deps.downloadAndExtractWindowsClient(login.version, progress, token),
        );
        gciPath = deps.getWindowsClientGciPath(login.version);
        if (gciPath) {
          await deps.setGciLibraryPath(login.version, gciPath);
        }
        deps.refreshVersions();
      } catch (e) {
        showInstallOutcome(e, 'Windows client install failed');
        return 'noClientLibrary';
      }
    } else if (choice !== 'Browse...') {
      return 'noClientLibrary';
    }
  }

  if (!gciPath) {
    const filters: Record<string, string[]> =
      process.platform === 'win32'
        ? { 'DLL files': ['dll'] }
        : process.platform === 'darwin'
          ? { 'Dynamic libraries': ['dylib'] }
          : { 'Shared libraries': ['so'] };

    const ext =
      process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
    const expectedName = `libgcits-${login.version}-64.${ext}`;

    const result = await vscode.window.showOpenDialog({
      title: `Select GCI library (${expectedName}) for GemStone ${login.version}`,
      canSelectMany: false,
      filters,
    });
    if (!result || result.length === 0) {
      return 'noClientLibrary';
    }
    gciPath = result[0].fsPath;

    const selectedName = gciPath.split(/[\\/]/).pop();
    const libPattern = /^libgcits-[\d.]+.*-64\.\w+$/;
    if (!libPattern.test(selectedName || '')) {
      const pick = await vscode.window.showWarningMessage(
        `Selected file "${selectedName}" does not match expected pattern "${expectedName}". Use it anyway?`,
        'Yes',
        'No',
      );
      if (pick !== 'Yes') {
        return 'noClientLibrary';
      }
    }
    await deps.setGciLibraryPath(login.version, gciPath);
  }

  // The in-process GCI library reads GEMSTONE_GLOBAL_DIR to find the
  // NetLDI lock file (which encodes the port it is listening on).
  // Set both variables from sysadminStorage so the login can succeed
  // even though the VSCode/Electron process doesn't inherit them.
  process.env.GEMSTONE_GLOBAL_DIR = deps.getRootPath();
  const gsInstallPath = deps.getGemstonePath(login.version) ?? path.dirname(path.dirname(gciPath));
  process.env.GEMSTONE = gsInstallPath;
  const session = await deps.connect(login, gciPath);
  if (!session) {
    return 'failed';
  }
  deps.connected(login, session);
  return 'connected';
}
