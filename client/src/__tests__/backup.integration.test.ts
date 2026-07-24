import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as q from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import { hasFileControlPrivilege, sessionNeedsCommit, fullBackupCode } from '../queries/backup';
import { DatabaseTreeProvider } from '../databaseTreeProvider';
import type { GemStoneDatabase } from '../sysadminTypes';

/**
 * Automatic GCI integration tests for the full logical backup, run against a
 * live stone (localhost, so the gem writes files the test process can read).
 *
 * The read-only pre-flight checks are transient. The real-backup test writes an
 * actual .dbf — a filesystem side effect the harness's per-test GciTsAbort can't
 * roll back — so it targets a throwaway temp dir and cleans it up in `finally`.
 * All emitted Smalltalk is ASCII-only so it stays valid on the 3.6.x stones.
 */
describe('full logical backup (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  it('confirms the connected user holds the FileControl privilege backups require', () => {
    expect(hasFileControlPrivilege(exec)).toBe(true);
  });

  it('sees a freshly begun transaction as having no uncommitted changes', () => {
    expect(sessionNeedsCommit(exec)).toBe(false);
  });

  // fullBackupTo:'s startup blocks until the stone's checkpoint machinery is
  // quiescent — ~5s when a checkpoint is still settling (e.g. from a backup in
  // a recent test run), which straddles vitest's 5s default timeout. The wait
  // is legitimate stone behavior, so give the backup an explicit budget.
  it(
    'writes a real backup file that then appears in the Backups tree node',
    { timeout: 30000 },
    () => {
      const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-it-db-'));
      const dest = path.join(dbDir, 'backups', 'itbackup.dbf');
      fs.mkdirSync(path.dirname(dest));
      const db: GemStoneDatabase = {
        dirName: path.basename(dbDir),
        path: dbDir,
        config: {
          version: '0.0.0',
          stoneName: 'itstone',
          ldiName: 'itldi',
          baseExtent: 'extent0.dbf',
        },
      };

      try {
        const modeBefore = exec('System transactionMode printString').trim();

        const result = exec(fullBackupCode(dest)).trim();

        expect(result).toBe('OK');
        expect(fs.existsSync(dest)).toBe(true);
        expect(fs.statSync(dest).size).toBeGreaterThan(0);
        // fullBackupTo: leaves the session in manualBegin; the ensure: block in
        // fullBackupCode must put the transaction mode back where it was.
        expect(exec('System transactionMode printString').trim()).toBe(modeBefore);

        // The produced file is discovered by the real (unmocked) tree provider.
        const provider = new DatabaseTreeProvider(
          { getDatabases: () => [db] } as never,
          {
            isStoneRunning: () => false,
            isNetldiRunning: () => false,
            getProcesses: () => [],
          } as never,
        );
        const topLevelKinds = provider.getChildren({ kind: 'database', db }).map((c) => c.kind);
        const backupFiles = provider
          .getChildren({ kind: 'backups', db })
          .map((c) => (c.kind === 'backupFile' ? c.filePath : ''));

        expect(topLevelKinds).toContain('backups');
        expect(backupFiles).toContain(dest);
      } finally {
        fs.rmSync(dbDir, { recursive: true, force: true });
      }
    },
  );
});
