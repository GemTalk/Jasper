import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';
import { GciLibrary } from '../../gciLibrary';
import { temporaryFileName } from './file';
import path from 'path';
import { extentFolderInServer } from '../../queries/extentBackup';

/**
 * Builds a unique, non-existent path inside the server's extent folder.
 *
 * @param session - GCI session used to query the extent folder location.
 * @param gciLibrary - GCI bridge used to run the query on the server.
 * @returns A POSIX path suitable for a one-off temporary file or folder.
 */
export function temporaryServerPath(session: unknown, gciLibrary: GciLibrary) {
  const extentFolderPath = extentFolderInServer((code) =>
    gciLibrary.executeAndFetchString(session, code),
  );

  return path.posix.join(extentFolderPath, temporaryFileName());
}

/**
 * Creates a directory on the server.
 *
 * @param folderPath - POSIX path of the directory to create.
 * @param session - GCI session the directory is created under.
 * @param gciLibrary - GCI bridge used to run the creation on the server.
 */
function createServerDirectory(folderPath: string, session: unknown, gciLibrary: GciLibrary) {
  gciLibrary.executeDiscardingResult(
    session,
    `GsFile createServerDirectory: '${escapeString(folderPath)}'`,
  );
}

/**
 * Removes a directory on the server, along with any contents inside it.
 *
 * `GsFile removeServerDirectory:` only handles an empty directory — it
 * silently no-ops on one with contents — so this shells out to `rm -rf` via
 * `GsHostProcess execute:` instead, which forks the executable directly (no
 * shell involved, so no metacharacter injection risk) and blocks until it
 * completes.
 *
 * @param directoryPath - POSIX path of the directory to remove.
 * @param session - GCI session the directory is removed under.
 * @param gciLibrary - GCI bridge used to run the removal on the server.
 */
export function removeServerDirectory(
  directoryPath: string,
  session: unknown,
  gciLibrary: GciLibrary,
) {
  gciLibrary.executeDiscardingResult(
    session,
    `GsHostProcess execute: '/bin/rm -rf ${escapeString(directoryPath)}'`,
  );
}

/**
 * Removes a directory on the server, logging rather than throwing on failure.
 *
 * Intended for best-effort test cleanup where a failed removal shouldn't
 * mask the original test outcome.
 *
 * @param pathToRemove - POSIX path of the directory to remove.
 * @param session - GCI session the directory is removed under.
 * @param gciLibrary - GCI bridge used to run the removal on the server.
 */
function safelyRemoveServerDirectory(
  pathToRemove: string,
  session: unknown,
  gciLibrary: GciLibrary,
) {
  try {
    removeServerDirectory(pathToRemove, session, gciLibrary);
  } catch (error) {
    console.error(`Failed to remove '${pathToRemove}': ${error}`);
  }
}

/**
 * Creates a unique temporary folder on the server, runs `consumer` with its
 * path, and removes the folder afterwards regardless of outcome.
 *
 * @param session - GCI session used to create and remove the folder.
 * @param gciLibrary - GCI bridge used to run the operations on the server.
 * @param consumer - Callback invoked with the temporary folder's POSIX path.
 */
export function withTemporaryServerFolderDo(
  session: unknown,
  gciLibrary: GciLibrary,
  consumer: (temporaryFolderPath: string) => void,
) {
  const temporaryFolderPath = temporaryServerPath(session, gciLibrary);
  createServerDirectory(temporaryFolderPath, session, gciLibrary);

  try {
    consumer(temporaryFolderPath);
  } finally {
    safelyRemoveServerDirectory(temporaryFolderPath, session, gciLibrary);
  }
}

/**
 * Creates an empty file with a unique name on the server, inside `folder`.
 *
 * @param folder - POSIX path of the directory the file is created in.
 * @param fileExtension - Extension appended to the generated file name.
 * @param session - GCI session the file is created under.
 * @param gciLibrary - GCI bridge used to run the creation on the server.
 * @returns The POSIX path of the created file.
 */
export function createServerFile(
  folder: string,
  fileExtension: string,
  session: unknown,
  gciLibrary: GciLibrary,
) {
  const filePath = path.posix.join(folder, temporaryFileName(fileExtension));

  gciLibrary.executeDiscardingResult(
    session,
    `(GsFile openWriteOnServer: '${escapeString(filePath)}') close`,
  );

  return filePath;
}

/**
 * Pauses for `secondsToWait` on the server.
 *
 * @param secondsToWait - How long to pause for, in seconds.
 * @param session - GCI session the wait runs under.
 * @param gciLibrary - GCI bridge used to run the wait on the server.
 */
export function waitForSeconds(secondsToWait: number, session: unknown, gciLibrary: GciLibrary) {
  gciLibrary.executeDiscardingResult(session, `Delay waitForSeconds: ${secondsToWait}`);
}

/**
 * Creates a unique temporary file on the server, runs `consumer` with its
 * path, and removes its containing folder afterwards regardless of outcome.
 *
 * @param extension - Extension appended to the generated file name.
 * @param session - GCI session used to create and remove the file.
 * @param gciLibrary - GCI bridge used to run the operations on the server.
 * @param consumer - Callback invoked with the temporary file's POSIX path.
 */
export function withTemporaryServerFileDo(
  extension: string,
  session: unknown,
  gciLibrary: GciLibrary,
  consumer: (temporaryFilePath: string) => void,
) {
  withTemporaryServerFolderDo(session, gciLibrary, (temporaryFolderPath) => {
    const temporaryFilePath = createServerFile(temporaryFolderPath, extension, session, gciLibrary);

    consumer(temporaryFilePath);
  });
}

/**
 * Looks up the size of a file on the server.
 *
 * @param execute - Query executor used to run the size check.
 * @param filePath - POSIX path of the file to check.
 * @returns The file's size in bytes.
 * @throws If the file doesn't exist on the server.
 */
export function sizeInBytesOfServerFile(execute: QueryExecutor, filePath: string): number {
  return Number(
    execute(
      `(GsFile sizeOfOnServer: '${escapeString(filePath)}')
         ifNil: [ self error: 'Failed to check the size of a file on the server' ]
         ifNotNil: [ :exists | exists printString ]`,
    ),
  );
}
