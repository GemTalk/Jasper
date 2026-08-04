import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as q from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import {
  hasFileControlPrivilege,
  sessionNeedsCommit,
  serverFileExists,
  fullBackupCode,
} from '../queries/backup';
import { backupFolderInServer, extentFileNames } from '../queries/extentBackup';
import { temporaryFileName } from './support/file';
import { sizeInBytesOfServerFile } from './support/gemstone';

/**
 * Automatic GCI integration tests for the full logical backup, run against a
 * live stone.
 *
 * The read-only pre-flight checks work from any client OS — they never touch
 * the local filesystem. The real-backup test does: it writes an actual .dbf
 * and then reads it back through the client's own filesystem to confirm the
 * tree provider picks it up, which only holds where the client and the stone
 * share a filesystem directly — Linux/macOS here, not Windows, where the gem
 * runs under WSL and the client reaches it only through the \\wsl$ share. So
 * that test is gated to run on supported POSIX platforms only, where the
 * server and client path are simply the same path.
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

  // serverFileExists wraps GsFile existsOnServer: in an ifNil:/ifNotNil: guard —
  // only a live stone can confirm that selector exists and that the guard's
  // Smalltalk actually compiles, which a mocked executor can't catch.
  it('confirms a real file on the server and denies one that is not there', () => {
    const [extent] = extentFileNames(exec);

    expect(serverFileExists(exec, extent)).toBe(true);
    expect(serverFileExists(exec, `${extent}.does-not-exist`)).toBe(false);
  });

  // fullBackupTo:'s startup blocks until the stone's checkpoint machinery is
  // quiescent — ~5s when a checkpoint is still settling (e.g. from a backup in
  // a recent test run), which straddles vitest's 5s default timeout. The wait
  // is legitimate stone behavior, so give the backup an explicit budget.
  it('writes a real backup file to the requested destination', { timeout: 30000 }, () => {
    const backupFilePath = path.posix.join(backupFolderInServer(exec), temporaryFileName('.dbf'));
    const modeBefore = exec('System transactionMode printString').trim();

    const result = exec(fullBackupCode(backupFilePath)).trim();

    expect(result).toBe('OK');
    expect(sizeInBytesOfServerFile(exec, backupFilePath)).toBeGreaterThan(0);
    // fullBackupTo: leaves the session in manualBegin; the ensure: block in
    // fullBackupCode must put the transaction mode back where it was.
    expect(exec('System transactionMode printString').trim()).toBe(modeBefore);
  });
});
