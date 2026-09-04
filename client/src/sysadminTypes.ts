export interface DatabaseYaml {
  version: string;
  stoneName: string;
  ldiName: string;
  /**
   * The base extent this database was created from. Absent for a REGISTERED
   * database: Jasper copied no extent for it, and does not know (or want to
   * assume) which file the installation runs on.
   */
  baseExtent?: string;
  /**
   * True when the database was registered from an existing installation rather
   * than created by Jasper. Everything below is only meaningful then, and says
   * where the installation really lives — the one thing a created database can
   * derive from its own directory and a registered one cannot.
   */
  registered?: boolean;
  /** The GemStone product tree whose binaries run this database. */
  productPath?: string;
  /** Its configuration directory — `GEMSTONE_SYS_CONF` / `GEMSTONE_EXE_CONF`. */
  confPath?: string;
  /** The `GEMSTONE_GLOBAL_DIR` it registers in, which is where its lock files
   *  and `gslist` record live. GemStone's own default is /opt/gemstone. */
  globalDir?: string;
  /**
   * The NetLDI's listening port. Recorded because a NetLDI name resolves only
   * through /etc/services, and an installation Jasper did not set up commonly
   * uses a name that is not there — in which case the port is the only way a
   * login can address it (see `loginNetldiTarget`).
   */
  netldiPort?: number;
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

/**
 * What a command that acts on one running server is invoked with. The Databases
 * & Versions panel hands over the live record it last read, rather than the row
 * it drew from it.
 */
export interface ProcessTarget {
  process: GemStoneProcess;
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
  /**
   * The `GEMSTONE_GLOBAL_DIR` whose `gslist` reported this process — Jasper's
   * own root for everything it manages, and the installation's own directory
   * for a registered database. Carried because that is where the process's
   * lock file lives, and a lock looked for in the wrong directory reads as a
   * server that has vanished.
   */
  globalDir?: string;
}
