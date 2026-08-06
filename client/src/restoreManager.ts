// Orchestrates a logical (object) restore of a stone from a full backup file —
// the destructive counterpart to backupManager.ts.
//
// Unlike a backup (one call on the live session), a restore spans a whole
// stop→swap→start→login→restore→reconnect→commit lifecycle, so this module takes
// the stone lifecycle, filesystem, and login capabilities as injected
// dependencies. That keeps the orchestration (and the tricky 4046 handling)
// unit-testable without a live stone or a real repository to destroy.
//
// The 4046 quirk (see queries/restore.ts): on a full-logging stone,
// `restoreFromBackup:` raises error 4046 (RestoreBackupSuccess) and auto-logs-out
// on success. That error number therefore MEANS success — we catch it, reconnect,
// and run `commitRestore`. A partial-logging stone instead returns normally
// (RESTORE_NO_LOGOUT_MARKER) already fully restored, needing no commit step.
import * as vscode from 'vscode';
import * as path from 'path';
import * as restore from './queries/restore';

// GCI error number the stone raises on a successful full-logging restore, just
// before it auto-logs-out the session. Treated as success, not failure.
const RESTORE_SUCCESS_LOGOUT_ERROR = 4046;

// A logged-in GCI session scoped to the restore. `run` executes a code snippet
// and returns the stone's String result; on a GCI error it throws (carrying the
// `gciErrorNumber`, as BrowserQueryError does) so the 4046 success can be caught.
export interface RestoreSession {
  run: (label: string, code: string) => Promise<string>;
  logout: () => void;
}

export interface LogicalRestoreDeps {
  // Stone the session is connected to (labels, filenames, messages).
  stoneName: string;
  // Managed database root. Restore is local-only (the gem must run on the same
  // machine as the stone), so this is always known; the safety copy of the
  // current extent lands under <dbPath>/backups/backupExtents.
  dbPath: string;

  // Pre-flight against the CURRENT live session, before it is torn down. A
  // restore requires the FileControl privilege.
  hasFileControl: () => boolean;

  // Tear down the user's live session so the stone can be stopped cleanly.
  closeCurrentSession: () => Promise<void>;
  // Stone lifecycle (wrap processManager.stop/startStone).
  stopStone: () => Promise<void>;
  startStone: () => Promise<void>;

  // Preserve the current extent to a server-side path (a clean copy — the stone
  // is stopped when this runs). The manager computes the destination name.
  copyCurrentExtentAside: (destPath: string) => Promise<void>;
  // Replace the current extent with a pristine $GEMSTONE/bin/extent0.dbf. Only
  // called when the user chose a fresh extent (the space-reclaiming default).
  swapInFreshExtent: () => Promise<void>;

  // Log in to the freshly started stone. A fresh extent has only the default
  // accounts (the restored user does not exist yet), so that path authenticates
  // as DataCurator/swordfish; an in-place restore uses the harvested session
  // creds. The commitRestore reconnect reuses the SAME login as the restore,
  // because the restore is not yet committed (auth still reflects the
  // pre-restore committed state).
  loginAsDefaultAdmin: () => Promise<RestoreSession>;
  loginAsSessionUser: () => Promise<RestoreSession>;
}

const BACKUP_FILTERS: Record<string, string[]> = {
  'GemStone backup': ['dbf'],
  'All files': ['*'],
};

// How long the green success message lingers in the status bar (ms).
const STATUS_SUCCESS_MS = 6000;
const WORKING_COLOR = 'charts.blue';
const SUCCESS_COLOR = 'charts.green';
const FAILURE_COLOR = 'charts.red';

// User-facing labels for the fresh-extent choice.
const FRESH_EXTENT = 'Fresh extent (recommended — reclaims space)';
const IN_PLACE = 'Restore onto the current extent';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The GCI error number carried by a thrown query error (BrowserQueryError), or
// undefined for anything else. Duck-typed so this module needn't import the
// browser-query layer.
function gciErrorNumberOf(e: unknown): number | undefined {
  const n = (e as { gciErrorNumber?: unknown })?.gciErrorNumber;
  return typeof n === 'number' ? n : undefined;
}

// A filesystem-safe, sortable timestamp in LOCAL time (YYYY-MM-DD_HH-MM-SS), so
// names line up with what the user sees in their file manager rather than UTC.
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

// Where the current extent is preserved before the restore overwrites it: a
// smart, sortable name under <dbPath>/backups/backupExtents. Exported for tests.
export function preRestoreExtentPath(dbPath: string, stoneName: string): string {
  return path.join(
    dbPath,
    'backups',
    'backupExtents',
    `extent0_preRestore_${stoneName}_${timestamp()}.dbf`,
  );
}

// Runs restoreFromBackup: on a freshly started stone and interprets the outcome.
// Returns true when the full-logging 4046 auto-logout fired (a commitRestore step
// is still needed); false when the stone returned normally (partial-logging, no
// commit needed). Re-throws any genuine failure.
async function runRestoreCall(session: RestoreSession, backupFile: string): Promise<boolean> {
  try {
    await session.run('restore: restoreFromBackup', restore.restoreFromBackupCode(backupFile));
    // Returned without logging out: a partial-logging backup, fully restored.
    return false;
  } catch (e) {
    if (gciErrorNumberOf(e) === RESTORE_SUCCESS_LOGOUT_ERROR) {
      // Success: the stone restored the objects and auto-logged-out.
      return true;
    }
    throw e;
  } finally {
    // The session is already gone on the 4046 path; log out best-effort otherwise.
    try {
      session.logout();
    } catch {
      /* already logged out */
    }
  }
}

// Returns true if the restore completed and the stone is operational again, false
// if it was cancelled or failed (all failure paths surface their own message).
export async function runLogicalRestore(deps: LogicalRestoreDeps): Promise<boolean> {
  let hasPrivilege: boolean;
  try {
    hasPrivilege = deps.hasFileControl();
  } catch (e) {
    vscode.window.showErrorMessage(`Could not check restore privileges: ${errorMessage(e)}`);
    return false;
  }
  if (!hasPrivilege) {
    vscode.window.showErrorMessage(
      'A full logical restore requires the FileControl privilege. Connect as a user that has it ' +
        '(for example DataCurator or SystemUser) and try again.',
    );
    return false;
  }

  const defaultDir = path.join(deps.dbPath, 'backups');
  const picked = await vscode.window.showOpenDialog({
    title: `Full Logical Restore of ${deps.stoneName}`,
    defaultUri: vscode.Uri.file(defaultDir),
    canSelectMany: false,
    openLabel: 'Restore',
    filters: BACKUP_FILTERS,
  });
  if (!picked?.[0]) return false;
  const backupFile = picked[0].fsPath;

  // Fresh extent (default) reclaims space; in-place keeps the existing bloat.
  const extentChoice = await vscode.window.showQuickPick([FRESH_EXTENT, IN_PLACE], {
    title: `Full Logical Restore of ${deps.stoneName}`,
    placeHolder: 'Restore into a fresh extent (reclaims space) or onto the current extent?',
  });
  if (!extentChoice) return false;
  const freshExtent = extentChoice === FRESH_EXTENT;

  // Point of no return: name the stone and spell out what is lost.
  const proceed = await vscode.window.showWarningMessage(
    `Restore "${deps.stoneName}" from ${backupFile}? This REPLACES the entire repository. ` +
      'Everything committed since this backup was taken will be permanently lost. ' +
      'The current extent is saved aside first' +
      (freshExtent ? ', then replaced with a fresh extent.' : '.'),
    { modal: true },
    'Restore',
  );
  if (proceed !== 'Restore') return false;

  // A single always-blue status-bar item is the sole progress indicator: it
  // updates per step, then turns green on success or red on failure. We do NOT
  // use a withProgress notification — it would sit alongside this item in the
  // default gray (reading as "blue & gray"), and notification text cannot be
  // recolored. Plain text, no codicon (an animated $(sync~spin) renders in the
  // default foreground rather than the item's color, which also looks two-toned).
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.color = new vscode.ThemeColor(WORKING_COLOR);
  const step = (message: string) => {
    status.text = `Restoring "${deps.stoneName}" — ${message}`;
  };
  step('closing the current session…');
  status.show();

  const login = freshExtent ? deps.loginAsDefaultAdmin : deps.loginAsSessionUser;

  try {
    await deps.closeCurrentSession();

    step('stopping the stone…');
    await deps.stopStone();

    step('saving the current extent aside…');
    await deps.copyCurrentExtentAside(preRestoreExtentPath(deps.dbPath, deps.stoneName));

    if (freshExtent) {
      step('installing a fresh extent…');
      await deps.swapInFreshExtent();
    }

    step('starting the stone…');
    await deps.startStone();

    step('restoring from the backup…');
    const needsCommit = await runRestoreCall(await login(), backupFile);

    if (needsCommit) {
      step('finalizing the restore…');
      const admin = await login();
      try {
        await admin.run('restore: commitRestore', restore.commitRestoreCode());
      } catch (e) {
        // commitRestore raises a benign warning when a full backup is restored
        // WITHOUT rolling forward the current transaction logs (roll-forward is
        // out of scope for now):
        //   "...commitRestore not immediately preceeded by restoreFromCurrentLogs.
        //    WARNING: Some transactions may not be restored."
        // The commit still completes and the stone is operational (verified on
        // 3.6.2: restoreStatus reports "Restore is not active." afterward), so
        // this specific warning is success. Any other error is a real failure.
        const msg = errorMessage(e);
        if (!/restoreFromCurrentLogs|may not be restored/i.test(msg)) {
          throw e;
        }
      } finally {
        try {
          admin.logout();
        } catch {
          /* ignore */
        }
      }
    }
  } catch (e) {
    status.text = `Restore of "${deps.stoneName}" failed`;
    status.color = new vscode.ThemeColor(FAILURE_COLOR);
    setTimeout(() => status.dispose(), STATUS_SUCCESS_MS);
    vscode.window.showErrorMessage(
      `Full logical restore failed: ${errorMessage(e)}. The current extent was saved under ` +
        `${path.join(deps.dbPath, 'backups', 'backupExtents')}.`,
    );
    return false;
  }

  status.text = `"${deps.stoneName}" restored`;
  status.color = new vscode.ThemeColor(SUCCESS_COLOR);
  setTimeout(() => status.dispose(), STATUS_SUCCESS_MS);

  vscode.window.showInformationMessage(
    `"${deps.stoneName}" was restored from ${backupFile}. Reconnect to resume working.`,
  );
  return true;
}
