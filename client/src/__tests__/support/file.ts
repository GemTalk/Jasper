import * as path from 'path';
import os from 'os';
import * as fs from 'node:fs';
import * as crypto from 'crypto';

/**
 * Creates a temporary file, passes its path to the given consumer function,
 * and cleans it up afterward on a best-effort basis: a failed deletion is
 * logged, never thrown, so it can't mask a failure from the consumer.
 *
 * Resolves once the consumer has finished and cleanup has been attempted.
 *
 * @param {(pathToFile: string) => Promise<void>} consumer - An async function that receives the path to the temporary file and performs work with it.
 */
export async function withTemporaryFileDo(
  consumer: (pathToFile: string) => Promise<void>,
): Promise<void> {
  const temporaryFilePath = createTemporaryFile();

  try {
    await consumer(temporaryFilePath);
  } finally {
    safelyRemovePath(temporaryFilePath);
  }
}

/**
 * Creates a temporary directory, passes its path to the given consumer
 * function, and cleans it up (recursively) afterward on a best-effort basis:
 * a failed deletion is logged, never thrown, so it can't mask a failure from
 * the consumer.
 *
 * Returns whatever the consumer returns, so a caller that needs a value out of
 * the folder (file contents, a subprocess result) can produce it inside and
 * still get crash-safe cleanup.
 */
export function withTemporaryFolderDo<T>(consumer: (pathToFolder: string) => T): T {
  const temporaryFolderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-test-temp-folder-'));

  try {
    return consumer(temporaryFolderPath);
  } finally {
    safelyRemovePath(temporaryFolderPath);
  }
}

/**
 * Creates an empty temporary file on disk.
 *
 * @param extension - The file extension to append to the generated file name (e.g. `.json`). Defaults to none.
 * @returns The absolute path to the newly created temporary file.
 */
function createTemporaryFile(extension: string = ''): string {
  const filePath = temporaryFilePath(extension);

  fs.writeFileSync(filePath, '');

  return filePath;
}

/**
 * Builds an absolute path for a temporary file within the OS's temp directory.
 *
 * @param extension - The file extension to append to the generated file name (e.g. `.json`). Defaults to none.
 * @returns The full path where a temporary file can be created.
 */
export function temporaryFilePath(extension: string = ''): string {
  return path.join(os.tmpdir(), temporaryFileName(extension));
}

/**
 * Generates a unique file name for a temporary file, prefixed for easy identification.
 *
 * @returns A unique file name in the form `jasper-mcp-tempfile-<random-hex>`.
 */
export function temporaryFileName(extension: string = ''): string {
  return `jasper-tempfile-${crypto.randomBytes(6).toString('hex')}${extension}`;
}

/**
 * A unique file path for a JSON "sidecar" file, generated via {@link temporaryFilePath}.
 * Used to store metadata or state a test needs on disk, such as an MCP owner sidecar.
 *
 * @returns An absolute path to a non-existent `.json` file in the OS's temp directory.
 */
export function temporarySidecarPath(): string {
  return temporaryFilePath('.json');
}

/**
 * Attempts to delete a file or directory (recursively), logging an error
 * instead of throwing if deletion fails.
 *
 * @param {string} pathToRemove - The path to the file or directory to delete.
 */
export function safelyRemovePath(pathToRemove: string): void {
  try {
    fs.rmSync(pathToRemove, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to remove '${pathToRemove}': ${error}`);
  }
}
