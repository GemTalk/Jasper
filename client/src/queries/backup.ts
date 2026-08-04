// Query layer for logical (object) backups — Repository>>fullBackupTo:.
//
// These functions follow the shared `QueryExecutor` convention (see types.ts):
// the pre-flight checks are fast and use the synchronous executor, while the
// backup itself is long-running, so the caller runs `fullBackupCode` through a
// non-blocking executor. All emitted Smalltalk is ASCII-only so it compiles on
// the 3.6.x stones too (a non-ASCII byte trips the ComStrmSetCursor bug there).
import * as path from 'path';
import { QueryExecutor } from './types';
import { escapeString } from './util';

// `fullBackupTo:` requires the FileControl privilege; without it the stone
// raises a raw GCI error. Pre-flighting lets us stop with a clear message.
export function hasFileControlPrivilege(execute: QueryExecutor): boolean {
  return (
    execute('(System myUserProfile privileges includes: #FileControl) printString').trim() ===
    'true'
  );
}

// A logical backup aborts the session; `fullBackupTo:` refuses outright
// (rtErrAbortWouldLoseData) when the session holds uncommitted changes. Pre-flight
// so we can warn the user before anything is discarded.
export function sessionNeedsCommit(execute: QueryExecutor): boolean {
  return execute('System needsCommit printString').trim() === 'true';
}

// Discard the session's uncommitted changes so the subsequent backup won't be
// refused. Only call this after the user has explicitly consented to lose them.
export function abortTransaction(execute: QueryExecutor): void {
  execute("System abortTransaction. 'aborted'");
}

/**
 * `fullBackupTo:` overwrites an existing file at `filePath` with no warning
 * of its own, so the caller can check first and confirm before triggering a
 * backup that would silently clobber one. `existsOnServer:` answers true or
 * false normally; a raised error (e.g. a permission issue on the containing
 * directory) is left to propagate as-is, since the caller is already set up
 * to report a failed pre-flight check.
 *
 * @param execute - runs the pre-flight check synchronously against the session.
 * @param filePath - the destination path to check for, as the stone would see it.
 * @throws if `existsOnServer:` answers nil. That isn't a case it's documented
 *   to produce, so rather than let it read as falsy (false), it's turned into
 *   an explicit error: there's nothing this function can do with an answer it
 *   doesn't understand.
 */
export function serverFileExists(execute: QueryExecutor, filePath: string): boolean {
  return (
    execute(
      `(GsFile existsOnServer: '${escapeString(filePath)}')
       ifNil: [ self error: 'Failed to check if a file exists on the server' ]
       ifNotNil: [ :exists | exists printString ]`,
    ).trim() === 'true'
  );
}

/**
 * Smalltalk for a full backup to a server-side path. Returned verbatim as a
 * String (not a printString) so it can be run through the non-blocking executor,
 * which fetches chars directly. Evaluates to 'OK' on success.
 *
 * backups/ is not created with the database, and fullBackupTo: won't create it,
 * so this creates the destination's parent directory up front — on the stone
 * itself (GsFile createServerDirectory:), so it holds for a local, WSL-hosted,
 * or remote stone alike, with no client-side path guessing. createServerDirectory:
 * is a bare statement, deliberately unchecked: if the directory already exists it
 * is a harmless no-op (returns nil, raises nothing), and if it still can't be
 * created (e.g. its own parent is missing), fullBackupTo: below fails with its
 * own clear error — no need to duplicate that as a separate return code here.
 *
 * fullBackupTo: leaves the session in manualBegin mode on completion; we capture
 * the session's transaction mode up front and restore it afterward (via ensure:,
 * so it is restored even if the backup raises) so the user's session is left the
 * way they had it.
 *
 * @param backupFilePath - the server-side destination path for the backup file.
 */
export function fullBackupCode(backupFilePath: string): string {
  const backupFileFolder = path.posix.dirname(backupFilePath);
  return `| mode ok |
GsFile createServerDirectory: '${escapeString(backupFileFolder)}'.
mode := System transactionMode.
[ok := SystemRepository fullBackupTo: '${escapeString(backupFilePath)}']
  ensure: [System transactionMode: mode].
ok ifTrue: ['OK'] ifFalse: ['fullBackupTo: returned false']`;
}
