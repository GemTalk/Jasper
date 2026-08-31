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

/**
 * What every `gemstone.*` version command is handed: the release to act on.
 *
 * This used to be a row of the Versions tree, and the commands were typed to
 * that row. The tree is gone — versions are a section of the Databases &
 * Versions panel — so the commands are typed to the only part of the row they
 * ever read.
 */
export interface VersionTarget {
  version: GemStoneVersion;
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
