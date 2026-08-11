// Query layer for an ONLINE EXTENT (snapshot) backup — the file-system copy of
// live extents bracketed by checkpoint suspension, per
// $GEMSTONE/examples/admin/onlinebackup.sh and the System Administration Guide.
//
// The procedure is: suspend checkpoints, copy the extent files while they are
// frozen on disk, then resume checkpoints (and CHECK the result — a false
// resume means checkpoints had already resumed and the copy is unusable). The
// actual file copy happens on the host (see extentBackupManager); these
// functions are the GCI calls that bracket it.
//
// All emitted Smalltalk is ASCII-only (the 3.6.x ComStrmSetCursor bug) and
// returns a verbatim String, matching queries/backup.ts.
import { QueryExecutor } from './types';
import { splitLines } from './util';
import path from 'path';

// Whether the stone is in full transaction logging. Online extent backups
// require it: checkpoints cannot be suspended in partial-logging mode
// (STN_TRAN_FULL_LOGGING = FALSE). Returns undefined when the setting can't be
// read, so the caller proceeds and lets `suspendCheckpoints` be the real gate.
export function fullLoggingEnabled(execute: QueryExecutor): boolean | undefined {
  const code = `[(System stoneConfigurationAt: #STN_TRAN_FULL_LOGGING) printString]
  on: Error do: [:e | 'unknown']`;
  const result = execute(code).trim();
  if (result === 'true') return true;
  if (result === 'false') return false;
  return undefined;
}

// The stone's extent file paths (absolute, as the stone sees them). Excludes
// transaction logs. Returns [] when the query fails, so the caller can fall
// back to scanning the managed database's data directory.
export function extentFileNames(execute: QueryExecutor): string[] {
  const code = `[| ws |
ws := WriteStream on: String new.
SystemRepository fileNames do: [:nm | ws nextPutAll: nm asString; lf].
ws contents] on: Error do: [:e | '']`;
  return splitLines(execute(code));
}

// Suspend checkpoints for `minutes`. true => suspended, safe to copy the
// extents. false => another session already holds them, or the stone is in
// partial-logging mode; in either case no backup should be taken. The timeout
// is a safety net: checkpoints auto-resume after it, so pick a value well above
// the expected copy time.
export function suspendCheckpoints(execute: QueryExecutor, minutes: number): boolean {
  const code = `(System suspendCheckpointsForMinutes: ${Math.trunc(minutes)})
  ifTrue: ['OK'] ifFalse: ['FAILED']`;
  return execute(code).trim() === 'OK';
}

// Resume checkpoints. The result MUST be checked: false means checkpoints had
// already resumed (the suspend timeout elapsed) before the copy finished, so
// the copied extents are not a usable backup.
export function resumeCheckpoints(execute: QueryExecutor): boolean {
  const code = "(System resumeCheckpoints) ifTrue: ['OK'] ifFalse: ['FAILED']";
  return execute(code).trim() === 'OK';
}

/**
 * Where this stone keeps its extents, according to the stone itself — the only
 * party that authoritatively knows its own filesystem, and the same answer for a
 * local, WSL-hosted, or remote stone. It exists and the stone can write there,
 * because the stone is actively writing there; on a stock install it is
 * $GEMSTONE/data.
 *
 * The stone's paths are POSIX regardless of the client's OS, so this must use
 * path.posix — plain `path` is win32 on Windows and would mangle them.
 *
 * A running stone always has at least one extent, so there is no legitimate
 * "no answer" case to hand back softly: `extentFileNames` coming back empty
 * means something is genuinely wrong (a permission issue, a Smalltalk-side
 * error caught by its own `on: Error do:`, or a communication failure raising
 * out of `execute` itself). Left to fail naturally rather than turned into a
 * softer result, so a caller building a server-side destination can't proceed
 * as if one existed.
 *
 * @param execute - runs the query synchronously against the session.
 * @throws if extentFileNames has no extent to report, or if the stone's
 *   answer resolves to a relative directory rather than an absolute one.
 */
export function extentFolderInServer(execute: QueryExecutor): string {
  const [extentPath] = extentFileNames(execute);
  if (extentPath === undefined) {
    throw new Error('Expected the stone to report at least one extent, got none');
  }

  const extentFolder = path.posix.dirname(extentPath);

  if (!path.posix.isAbsolute(extentFolder)) {
    throw new Error(`Expected an absolute extent path from the stone, got "${extentPath}"`);
  }

  return extentFolder;
}

/**
 * Where backups for this stone belong: the extent directory's sibling backups/
 * folder (<db>/data -> <db>/backups). Derived from the stone's own answer, so it
 * holds for a local, WSL-hosted, or remote stone — but deliberately NOT the
 * extent directory itself, for two reasons. It is the folder the admin views
 * list and the restore picker reads (databaseTreeProvider, restoreManager,
 * extentBackupManager all use <db>/backups), so a backup written anywhere else is
 * invisible to them; and "Replace extent" deletes every .dbf in the extent
 * directory, which would silently destroy a backup stored there.
 *
 * The parent is resolved lexically, so a symlinked extent directory yields its
 * link-parent rather than its target's. Unlike the extent directory this folder
 * is not part of the layout created with the database, so the caller must be
 * prepared for it not to exist yet.
 *
 * @param execute - runs the query synchronously against the session.
 * @throws whatever {@link extentFolderInServer} throws.
 */
export function backupFolderInServer(execute: QueryExecutor): string {
  return path.posix.join(path.posix.dirname(extentFolderInServer(execute)), 'backups');
}
