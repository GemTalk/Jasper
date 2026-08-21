export interface DatabaseYaml {
  version: string;
  stoneName: string;
  ldiName: string;
  baseExtent: string;
}

export interface GemStoneDatabase {
  /** Directory name, e.g. "db-1" */
  dirName: string;
  /** Full path to the database directory */
  path: string;
  /** Parsed database.yaml */
  config: DatabaseYaml;
}

export interface GemStoneVersion {
  /** e.g. "3.7.4.3" */
  version: string;
  /** e.g. "GemStone64Bit3.7.4.3-arm64.Darwin.dmg" */
  fileName: string;
  /** Full download URL */
  url: string;
  /** File size in bytes from the directory listing */
  size: number;
  /** Date string from the directory listing */
  date: string;
  /** Whether the server archive has been downloaded to rootPath */
  downloaded: boolean;
  /** Whether the server version has been extracted to rootPath */
  extracted: boolean;
  /** Whether the Windows client distribution is extracted (Windows only) */
  clientExtracted?: boolean;
  /** Whether a GCI library for this version ships bundled in the extension */
  bundled?: boolean;
  /** Whether this is a locally registered version (symlink) */
  local?: boolean;
  /** Build description from version.txt (for local versions) */
  buildDescription?: string;
}

export interface GemStoneProcess {
  type: 'stone' | 'netldi';
  name: string;
  version: string;
  pid: number;
  port?: number;
  startTime?: string;
  /** gslist Status column — "OK" when responding; otherwise stale (e.g. "frozen", "killed", "exe deleted", "exists"). */
  status: string;
  /** True when status is "OK". */
  responding: boolean;
}

/**
 * The stone and NetLDI names for a database created with the defaults, numbered
 * past whatever is already in use. Both are identified by name, so a second
 * `gs64stone` would contend with the first over locks and registration — and the
 * pair stays on one number so a database's two servers read as a set.
 */
export function defaultDatabaseNames(taken: Iterable<string>): {
  stoneName: string;
  ldiName: string;
} {
  const used = new Set(taken);
  let suffix = '';
  for (let n = 2; used.has(`gs64stone${suffix}`) || used.has(`gs64ldi${suffix}`); n += 1) {
    suffix = String(n);
  }
  return { stoneName: `gs64stone${suffix}`, ldiName: `gs64ldi${suffix}` };
}
