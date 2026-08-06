import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as q from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import { hasFileControlPrivilege, sessionNeedsCommit, fullBackupCode } from '../queries/backup';
import { extentFileNames } from '../queries/extentBackup';
import { temporaryFileName } from './support/file';
import { sizeInBytesOfServerFile, withTemporaryServerFolderDo } from './support/gemstone';

/**
 * Automatic GCI integration tests for the full logical backup, run against a
 * live stone.
 *
 * Every check here, including the real-backup test, works entirely through
 * server-side GCI queries and never touches the client's local filesystem —
 * so the whole file runs unconditionally on every client OS.
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

  // runLogicalBackup derives its destination directory from the stone's
  // extents and refuses to back up at all if that answer isn't an absolute
  // POSIX path, whatever the client's OS — this pins down that contract.
  it('reports its extent locations as absolute paths in the stone’s own POSIX form', () => {
    const extents = extentFileNames(exec);

    expect(extents.length).toBeGreaterThan(0);
    for (const extent of extents) {
      expect(extent.startsWith('/')).toBe(true);
      expect(extent).not.toContain('\\');
    }
  });

  // fullBackupTo:'s startup blocks until the stone's checkpoint machinery is
  // quiescent — ~5s when a checkpoint is still settling (e.g. from a backup in
  // a recent test run), which straddles vitest's 5s default timeout. The wait
  // is legitimate stone behavior, so give the backup an explicit budget.
  it('writes a real backup file to the requested destination', { timeout: 30000 }, () => {
    withTemporaryServerFolderDo(handle, gci, (temporaryFolderPath) => {
      const backupFilePath = path.posix.join(temporaryFolderPath, temporaryFileName('.dbf'));
      const modeBefore = exec('System transactionMode printString').trim();

      const result = exec(fullBackupCode(backupFilePath)).trim();

      expect(result).toBe('OK');
      expect(sizeInBytesOfServerFile(exec, backupFilePath)).toBeGreaterThan(0);
      // fullBackupTo: leaves the session in manualBegin; the ensure: block in
      // fullBackupCode must put the transaction mode back where it was.
      expect(exec('System transactionMode printString').trim()).toBe(modeBefore);
    });
  });
});
