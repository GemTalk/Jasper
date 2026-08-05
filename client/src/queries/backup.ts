// Query layer for logical (object) backups — Repository>>fullBackupTo:.
//
// These functions follow the shared `QueryExecutor` convention (see types.ts):
// the pre-flight checks are fast and use the synchronous executor, while the
// backup itself is long-running, so the caller runs `fullBackupCode` through a
// non-blocking executor. All emitted Smalltalk is ASCII-only so it compiles on
// the 3.6.x stones too (a non-ASCII byte trips the ComStrmSetCursor bug there).
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

// Smalltalk for a full backup to a server-side path. Returned verbatim as a
// String (not a printString) so it can be run through the non-blocking executor,
// which fetches chars directly. Evaluates to 'OK' on success.
//
// fullBackupTo: leaves the session in manualBegin mode on completion; we capture
// the session's transaction mode up front and restore it afterward (via ensure:,
// so it is restored even if the backup raises) so the user's session is left the
// way they had it.
export function fullBackupCode(serverPath: string): string {
  return `| mode ok |
mode := System transactionMode.
[ok := SystemRepository fullBackupTo: '${escapeString(serverPath)}']
  ensure: [System transactionMode: mode].
ok ifTrue: ['OK'] ifFalse: ['fullBackupTo: returned false']`;
}
