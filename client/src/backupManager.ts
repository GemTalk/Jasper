// Orchestrates a logical (object) backup of a running stone: pre-flight checks,
// destination selection, and running Repository>>fullBackupTo: via a
// non-blocking executor (which keeps VS Code responsive and shows its own
// progress notification for the long-running call).
//
// Session acquisition (matching the active session to the target stone) and the
// executor wiring live in the command handler; this module takes the executors
// as dependencies so it stays unit-testable without a live GCI session.
import * as vscode from 'vscode';
import { QueryExecutor } from './queries/types';
import * as backup from './queries/backup';
import { isWindows, wslPathToWindows } from './wslBridge';
import { wslExistsSync } from './wslFs';
import { backupFolderInServer } from './queries/extentBackup';
import path from 'path';

export interface LogicalBackupDeps {
  // Fast, synchronous executor for the pre-flight queries.
  execute: QueryExecutor;
  // Non-blocking executor for the long-running backup itself. Returns the
  // stone's result string ('OK' on success). Should suppress its own progress
  // toast — this module shows a single always-visible progress notification.
  runBackup: (code: string) => Promise<string>;
  // Stone the session is connected to (used for labels and the default filename).
  stoneName: string;
}

const GEMSTONE_BACKUP_EXTENSION = '.dbf';

// How long the green success message lingers in the status bar (ms).
const STATUS_SUCCESS_MS = 6000;
// Theme-color ids for the status-bar item (adapt to the active color theme).
const WORKING_COLOR = 'charts.blue';
const SUCCESS_COLOR = 'charts.green';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// A filesystem-safe, sortable timestamp in LOCAL time (YYYY-MM-DD_HH-MM-SS) for
// default names, so they match what the user sees in their file manager (UTC
// from toISOString() looked "off" by the local offset).
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

// Returns true if the backup completed, false if it was cancelled or failed
// (all failure paths surface their own message to the user).
export async function runLogicalBackup(deps: LogicalBackupDeps): Promise<boolean> {
  let hasPrivilege: boolean;
  try {
    hasPrivilege = backup.hasFileControlPrivilege(deps.execute);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not check backup privileges: ${errorMessage(e)}`);
    return false;
  }
  if (!hasPrivilege) {
    vscode.window.showErrorMessage(
      'A full logical backup requires the FileControl privilege. Connect as a user that has it ' +
        '(for example DataCurator or SystemUser) and try again.',
    );
    return false;
  }

  // The destination is a path on the server, so a wrong or missing directory
  // here is not recoverable by falling back to "just a file name" — a relative
  // path would land wherever the gem's own working directory happens to be,
  // silently, on the server, with nothing for the user to inspect. So this is a
  // hard pre-flight check, same as the FileControl and needsCommit checks above,
  // rather than a soft default: either we know the stone's backups directory, or
  // we stop before asking for anything else.
  let backupFolder: string;
  try {
    backupFolder = backupFolderInServer(deps.execute);
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Could not determine the backups directory for "${deps.stoneName}": ${errorMessage(e)}`,
    );
    return false;
  }

  let needsCommit: boolean;
  try {
    needsCommit = backup.sessionNeedsCommit(deps.execute);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not check the session state: ${errorMessage(e)}`);
    return false;
  }
  if (needsCommit) {
    const proceed = await vscode.window.showWarningMessage(
      `The session connected to "${deps.stoneName}" has uncommitted changes. A full logical backup ` +
        'discards them (it aborts the session). Continue?',
      { modal: true },
      'Discard changes and back up',
    );
    if (proceed !== 'Discard changes and back up') return false;
    try {
      backup.abortTransaction(deps.execute);
    } catch (e) {
      vscode.window.showErrorMessage(`Could not abort the session: ${errorMessage(e)}`);
      return false;
    }
  }

  // Windows is a client-only platform — GemStone's server runs on Linux, AIX,
  // Solaris, or macOS, never Windows — so its path is always POSIX, even when
  // the extension itself runs on Windows and reaches the gem through WSL. We
  // ask only for a bare file name and join it onto the backups directory above,
  // rather than translate a path from a native picker — which is only
  // meaningful when the client and the gem share a filesystem.
  const suggestedFilename = `${deps.stoneName}_${timestamp()}.dbf`;
  const providedFilename = await vscode.window.showInputBox({
    title: `Full Logical Backup of ${deps.stoneName}`,
    prompt:
      'File name for the backup, no path: it will be written to the backups directory on the server',
    value: suggestedFilename,
    // Pre-select the name but not the extension, so retyping it can't drop the .dbf.
    valueSelection: [0, suggestedFilename.length - GEMSTONE_BACKUP_EXTENSION.length],
    validateInput: (answer) =>
      !/[/\\]/.test(answer) &&
      answer.length > GEMSTONE_BACKUP_EXTENSION.length &&
      answer.endsWith(GEMSTONE_BACKUP_EXTENSION)
        ? null
        : 'File name must end in .dbf and contain no path (for example, backup.dbf)',
  });
  if (!providedFilename) return false;

  const destination = path.posix.join(backupFolder, providedFilename);

  // showInputBox (above) has no native overwrite warning the way a save
  // dialog would, so check explicitly and let the user back out — same
  // confirm-or-cancel shape as the needsCommit warning above.
  let backupFileAlreadyExists: boolean;
  try {
    backupFileAlreadyExists = backup.serverFileExists(deps.execute, destination);
  } catch (e) {
    vscode.window.showErrorMessage(
      `Could not determine whether a backup already exists at "${destination}": ${errorMessage(e)}`,
    );
    return false;
  }
  if (backupFileAlreadyExists) {
    const overwriteAnswer = await vscode.window.showWarningMessage(
      `A backup already exists at "${destination}". Overwrite it?`,
      { modal: true },
      'Overwrite',
    );
    if (overwriteAnswer !== 'Overwrite') return false;
  }

  // Colored status-bar item: a blue spinner while the (possibly instant) backup
  // runs, then a green confirmation that lingers ~6s. A fast backup can outrace
  // the progress toast, so this guarantees a visible, unmissable signal — and the
  // color makes "working" vs "done" readable at a glance.
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.text = `$(sync~spin) Full logical backup of "${deps.stoneName}"…`;
  status.color = new vscode.ThemeColor(WORKING_COLOR);
  status.show();

  // The progress notification (the nb executor suppresses its own ~2s toast) is
  // the prominent indicator for a genuinely long backup.
  let result: string;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Full logical backup of "${deps.stoneName}"…`,
        cancellable: false,
      },
      async () => (await deps.runBackup(backup.fullBackupCode(destination))).trim(),
    );
  } catch (e) {
    status.dispose();
    vscode.window.showErrorMessage(`Full logical backup failed: ${errorMessage(e)}`);
    return false;
  }
  if (result !== 'OK') {
    status.dispose();
    vscode.window.showErrorMessage(`Full logical backup did not complete: ${result}`);
    return false;
  }

  status.text = `$(check) Full logical backup of "${deps.stoneName}" written`;
  status.color = new vscode.ThemeColor(SUCCESS_COLOR);
  setTimeout(() => status.dispose(), STATUS_SUCCESS_MS);

  // The gem has written the file, so rather than infer whether the client can
  // reach it, test it: on Windows the server path is only ever reachable via the
  // \\wsl$ share (destination itself is a foreign POSIX string there — checking
  // it directly against the local filesystem risks a false hit against an
  // unrelated drive-relative path); everywhere else the client and server share a
  // filesystem, so destination itself is the right name. No hit — a genuinely
  // remote stone — means we cannot name the file locally, and we offer no action.
  const candidatePath = isWindows() ? wslPathToWindows(destination) : destination;
  const revealPath = wslExistsSync(candidatePath) ? candidatePath : undefined;
  const reveal = 'Reveal in File Explorer';
  const actions = revealPath ? [reveal] : [];
  const choice = await vscode.window.showInformationMessage(
    `Full logical backup of "${deps.stoneName}" written to ${destination}`,
    ...actions,
  );
  if (choice === reveal && revealPath) {
    void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(revealPath));
  }
  return true;
}
