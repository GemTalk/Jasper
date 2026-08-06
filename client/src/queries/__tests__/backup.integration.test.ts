import { describe, expect, it } from 'vitest';
import { QueryExecutor } from '../types';
import { serverBackupFilePaths, serverFileExists } from '../backup';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import path from 'path';
import { temporaryFileName } from '../../__tests__/support/file';
import {
  createServerFile,
  removeServerDirectory,
  waitForSeconds,
  withTemporaryServerFileDo,
  withTemporaryServerFolderDo,
} from '../../__tests__/support/gemstone';

describe('backup queries', () => {
  let gciLibrary: GciLibrary;
  let session: unknown;
  let execute: QueryExecutor;

  useIntegrationTest((testContext) => {
    gciLibrary = testContext.gciLibrary;
    session = testContext.session;
    execute = (code: string) => gciLibrary.executeAndFetchString(session, code);
  });

  function createServerFileIn(folder: string, extension: string) {
    return createServerFile(folder, extension, session, gciLibrary);
  }

  function createBackupFileIn(folder: string) {
    return createServerFileIn(folder, '.dbf');
  }

  describe('listing backup files', () => {
    it('returns the .dbf paths the stone reports, newest name first', () => {
      withTemporaryServerFolderDo(session, gciLibrary, (folder) => {
        const oldestBackupPath = createBackupFileIn(folder);
        // Files are told apart by `lastModified`, which only has one-second
        // resolution, so asserting an ordering needs a real gap between the
        // two files' creation times.
        waitForSeconds(1, session, gciLibrary);
        const newestBackupPath = createBackupFileIn(folder);

        const backups = serverBackupFilePaths(execute, folder);

        expect(backups).toStrictEqual([newestBackupPath, oldestBackupPath]);
      });
    });

    it('excludes non-.dbf entries from the directory listing', () => {
      withTemporaryServerFolderDo(session, gciLibrary, (folder) => {
        createServerFileIn(folder, '.txt');

        const backups = serverBackupFilePaths(execute, folder);

        expect(backups).toStrictEqual([]);
      });
    });

    it('reports no backups when the directory does not exist yet', () => {
      const nonExistentFolderPath = temporaryFileName();
      removeServerDirectory(nonExistentFolderPath, session, gciLibrary);

      const backups = serverBackupFilePaths(execute, nonExistentFolderPath);

      expect(backups).toStrictEqual([]);
    });

    it('escapes single quotes in the directory it lists', () => {
      withTemporaryServerFolderDo(session, gciLibrary, (folder) => {
        const folderPathWithQuotes = path.posix.join(folder, "foo'bar");

        const backups = serverBackupFilePaths(execute, folderPathWithQuotes);

        expect(backups).toStrictEqual([]);
      });
    });
  });

  describe('checking whether a file exists on the server', () => {
    it('reports false when the path does not exist', () => {
      const nonExistentFolderPath = temporaryFileName();
      removeServerDirectory(nonExistentFolderPath, session, gciLibrary);

      const result = serverFileExists(execute, nonExistentFolderPath);

      expect(result).toBe(false);
    });

    it('reports true when the file exists', () => {
      withTemporaryServerFileDo('.tmp', session, gciLibrary, (file) => {
        const result = serverFileExists(execute, file);

        expect(result).toBe(true);
      });
    });

    it('reports true when the file path contains a single quote', () => {
      withTemporaryServerFileDo(".foo'bar", session, gciLibrary, (file) => {
        const result = serverFileExists(execute, file);

        expect(result).toBe(true);
      });
    });
  });
});
