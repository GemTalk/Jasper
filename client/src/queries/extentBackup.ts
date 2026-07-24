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
