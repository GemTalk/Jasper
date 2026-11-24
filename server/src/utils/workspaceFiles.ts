import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/** Folders the workspace scan never enters. */
function skippedFolder(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

/** The files under `dir` the workspace scan indexes. */
export function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skippedFolder(entry.name)) continue;
      results.push(...findFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Whether `uri` is a file {@link findFiles} finds under one of `folderUris`. */
export function isScannedFile(uri: string, folderUris: string[], extensions: string[]): boolean {
  if (!uri.startsWith('file:') || !extensions.some((ext) => uri.endsWith(ext))) return false;
  try {
    const file = fileURLToPath(uri);
    return folderUris.some((folderUri) => {
      const relative = path.relative(fileURLToPath(folderUri), file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
      return !relative.split(path.sep).slice(0, -1).some(skippedFolder);
    });
  } catch {
    // A URI this platform can't turn into a path, such as a drive-less one on Windows.
    return false;
  }
}
