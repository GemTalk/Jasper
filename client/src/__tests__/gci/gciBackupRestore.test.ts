// On-demand GCI round-trip for the full logical backup + restore feature.
//
// Exercises the exact Smalltalk we ship (queries/backup.ts + queries/restore.ts)
// against a live stone: commit a marker, take a full backup, commit a SECOND
// marker, restore from the backup, and prove the first marker survived while the
// post-backup one is gone. That is the whole contract of a logical restore —
// it rolls the repository back to the moment the backup was taken.
//
// DESTRUCTIVE — READ THIS. restoreFromBackup: replaces the ENTIRE repository, so
// this test cannot live in the automatic suite (`npm test`); it is in the
// on-demand `gci` project only (`npm run test:gci`). It runs an IN-PLACE restore
// (no fresh extent, no stone stop/start), so it needs no process management. It
// is written to be near-idempotent against the shared test stone: the backup is
// taken at the very start, so the restore only discards this test's own
// post-backup marker, and we delete the pre-backup marker on the way out. The
// gci project runs serially (fileParallelism: false), so no other session is
// disrupted by the mid-restore 4046 auto-logout. The shared test stone is
// re-provisionable via `npm run test:server:start` regardless.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';
import { fullBackupCode } from '../../queries/backup';
import {
  restoreFromBackupCode,
  commitRestoreCode,
  RESTORE_NO_LOGOUT_MARKER,
} from '../../queries/restore';

const OOP_NIL = 0x14n;
const OOP_ILLEGAL = 0x01n;
const MAX_RESULT = 256 * 1024;

// GemStone raises this on a successful full-logging restore, then auto-logs-out.
const RESTORE_SUCCESS_LOGOUT_ERROR = 4046;

// A persistent restore takes a while (backup + multi-threaded restore of the
// whole repo), so give the single round-trip a generous ceiling.
const ROUND_TRIP_TIMEOUT_MS = 180_000;

const KEY_BEFORE = 'JasperRoundTripCommittedBeforeBackup';
const KEY_AFTER = 'JasperRoundTripCommittedAfterBackup';

// The two users that back the always-present system gems (symbol + garbage
// collection). They never block a restore; any OTHER session sharing the stone
// does. A logical restore replaces the whole repository and demands exclusive
// access — a second user session makes `restoreFromBackup:` fail with error 2734.
const SYSTEM_GEM_USERS = "#('GcUser' 'SymbolUser')";

// Smalltalk that returns the user sessions other than our own and the system
// gems, as `userId(sid)` joined by commas — an empty string when the stone is
// ours alone. Used to skip (rather than fail) the destructive round-trip when
// someone else — e.g. the VS Code extension connected to the same stone — holds
// a session.
const OTHER_USER_SESSIONS_CODE =
  `| mine sys | mine := System session. sys := ${SYSTEM_GEM_USERS}. ` +
  `((System currentSessions ` +
  `reject: [:sid | (sid = mine) or: [sys includes: (((System descriptionOfSession: sid) at: 1) userId)]]) ` +
  `collect: [:sid | ((System descriptionOfSession: sid) at: 1) userId, '(', sid printString, ')']) ` +
  `inject: '' into: [:a :b | a isEmpty ifTrue: [b] ifFalse: [a, ', ', b]]`;

interface RunResult {
  data: string;
  errNumber: number;
  errMessage: string;
}

function connect(gci: GciLibrary): unknown {
  const r = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
  if (!r.session) {
    throw new Error(`GciTsLogin failed: ${r.err.message || `error ${r.err.number}`}`);
  }
  return r.session;
}

// The Smalltalk source is interpreted as this class; Utf8 matches production.
function sourceClass(gci: GciLibrary, session: unknown): bigint {
  return gci.utf8ClassOop(session);
}

// Execute and surface the raw GCI error NUMBER (not just a thrown message) so the
// caller can treat the 4046 auto-logout as success rather than failure.
function run(gci: GciLibrary, session: unknown, src: bigint, code: string): RunResult {
  const { data, err } = gci.GciTsExecuteFetchBytes(
    session,
    code,
    -1,
    src,
    OOP_ILLEGAL,
    OOP_NIL,
    MAX_RESULT,
  );
  return { data: (data ?? '').trim(), errNumber: err.number, errMessage: err.message || '' };
}

describe('full logical backup + restore round-trip', () => {
  it(
    'restores committed state as of the backup and drops changes committed after it',
    (ctx) => {
      const gci = new GciLibrary(GCI_LIBRARY_PATH);
      const backupFile = path.join(os.tmpdir(), `jasper-restore-roundtrip-${process.pid}.dbf`);

      try {
        // ── Commit a marker, back up, then commit a second marker ──
        let session = connect(gci);
        let src = sourceClass(gci, session);

        // A restore needs the stone to itself; another user session makes it
        // fail with error 2734. Skip rather than fail so a stray login (commonly
        // the VS Code extension pointed at the same stone) is not a false red.
        const otherSessions = run(gci, session, src, OTHER_USER_SESSIONS_CODE);
        if (otherSessions.data.length > 0) {
          try {
            gci.GciTsLogout(session);
          } catch {
            /* ignore */
          }
          ctx.skip(
            `another session is logged into the stone (${otherSessions.data}); ` +
              `a logical restore needs exclusive access`,
          );
        }

        const committedBefore = run(
          gci,
          session,
          src,
          `System abortTransaction. ` +
            `UserGlobals at: #${KEY_BEFORE} put: 'before-backup'. ` +
            `System commitTransaction. 'ok'`,
        );
        expect(committedBefore.errNumber).toBe(0);

        const backup = run(gci, session, src, fullBackupCode(backupFile));
        expect(backup.errNumber).toBe(0);
        expect(backup.data).toBe('OK');
        expect(fs.existsSync(backupFile)).toBe(true);

        const committedAfter = run(
          gci,
          session,
          src,
          `UserGlobals at: #${KEY_AFTER} put: 'after-backup'. ` + `System commitTransaction. 'ok'`,
        );
        expect(committedAfter.errNumber).toBe(0);

        // ── Restore. Full logging → 4046 auto-logout (success) then commitRestore;
        //    partial logging → returns the marker, already fully restored. ──
        const restore = run(gci, session, src, restoreFromBackupCode(backupFile));
        if (restore.errNumber === RESTORE_SUCCESS_LOGOUT_ERROR) {
          try {
            gci.GciTsLogout(session);
          } catch {
            /* already gone */
          }

          session = connect(gci);
          src = sourceClass(gci, session);
          const commit = run(gci, session, src, commitRestoreCode());
          // commitRestore raises a benign warning when we don't roll forward the
          // current tranlogs (out of scope); the commit still completes.
          const committed =
            commit.errNumber === 0 ||
            /restoreFromCurrentLogs|may not be restored/i.test(commit.errMessage);
          expect(committed).toBe(true);
          try {
            gci.GciTsLogout(session);
          } catch {
            /* ignore */
          }
        } else {
          expect(restore.errNumber).toBe(0);
          expect(restore.data).toBe(RESTORE_NO_LOGOUT_MARKER);
        }

        // ── Verify the rollback: before-backup survived, after-backup is gone ──
        session = connect(gci);
        src = sourceClass(gci, session);
        const hasBefore = run(
          gci,
          session,
          src,
          `(UserGlobals includesKey: #${KEY_BEFORE}) printString`,
        );
        const hasAfter = run(
          gci,
          session,
          src,
          `(UserGlobals includesKey: #${KEY_AFTER}) printString`,
        );
        expect(hasBefore.data).toBe('true');
        expect(hasAfter.data).toBe('false');

        // Leave the shared stone as we found it.
        run(
          gci,
          session,
          src,
          `UserGlobals removeKey: #${KEY_BEFORE} ifAbsent: []. System commitTransaction. 'ok'`,
        );
        try {
          gci.GciTsLogout(session);
        } catch {
          /* ignore */
        }
      } finally {
        fs.rmSync(backupFile, { force: true });
        gci.close();
      }
    },
    ROUND_TRIP_TIMEOUT_MS,
  );
});
