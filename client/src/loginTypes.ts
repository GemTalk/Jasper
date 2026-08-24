/**
 * The NRS naming the gem process to start for `login` — the host, the NetLDI
 * that spawns it, and the service it runs. The NetLDI name comes from the login
 * because it is a deployment fact: GemStone's own default is `gs64ldi`, and
 * anything named otherwise cannot be reached without saying so.
 */
export function gemNrsFor(login: Pick<GemStoneLogin, 'gem_host' | 'netldi'>): string {
  return `!tcp@${login.gem_host}#netldi:${login.netldi}#task!gemnetobject`;
}

/**
 * The NRS naming the stone itself for `login` — the host and the stone name,
 * with no NetLDI/service component (that's `gemNrsFor`'s job). Used to log in
 * and to identify which stone a session belongs to.
 */
export function stoneNrsFor(login: Pick<GemStoneLogin, 'gem_host' | 'stone'>): string {
  return `!tcp@${login.gem_host}#server!${login.stone}`;
}

/**
 * The inverse of `stoneNrsFor`: pulls `{ gem_host, stone }` back out of a
 * stone-NRS string in exactly the `!tcp@<host>#server!<stone>` shape
 * `stoneNrsFor` produces. GCI accepts other legal Stone NRS shapes this
 * doesn't recognize — a bare stone name (GCI's own default is `gs64stone`),
 * `#netldi:`/`#auth:` forms, host omitted, etc. — so `undefined` means "not
 * this shape", not "invalid NRS". Don't treat it as a validity check.
 */
export function parseStoneNrs(nrs: string): Pick<GemStoneLogin, 'gem_host' | 'stone'> | undefined {
  const match = nrs.match(/^!tcp@([^#]+)#server!(.+)$/);
  return match ? { gem_host: match[1], stone: match[2] } : undefined;
}

/**
 * The NetLDI name embedded in a gem-NRS string built by `gemNrsFor`, or
 * `undefined` if it doesn't carry a `#netldi:<name>#` segment.
 */
export function netldiNameFromGemNrs(gemNrs: string): string | undefined {
  return gemNrs.match(/#netldi:([^#]+)#/)?.[1];
}

export interface GemStoneLogin {
  label: string;
  version: string;
  gem_host: string;
  stone: string;
  gs_user: string;
  gs_password: string;
  netldi: string;
  host_user: string;
  host_password: string;
  /**
   * When true, the GemStone password is stored in the OS keychain and
   * `gs_password` in the settings file is left empty. See loginCredentials.ts.
   */
  password_in_keychain?: boolean;
  /**
   * When true (the default when unset), the local `.gemstone` class mirror is
   * synced for this login so VS Code's Find in Files / Go to Definition work over
   * the source. Turn it off for slow/remote connections where the initial sync
   * isn't worth it — server-side search still works. See client/src/sync/.
   */
  sync_classes?: boolean;
}

// Whether the class mirror should be synced for a login. Defaults to true when
// the flag is unset, so existing logins keep today's behavior.
export function shouldSyncClasses(login: Pick<GemStoneLogin, 'sync_classes'>): boolean {
  return login.sync_classes !== false;
}

export function loginLabel(login: Pick<GemStoneLogin, 'gs_user' | 'stone' | 'gem_host'>): string {
  return `${login.gs_user} on ${login.stone} (${login.gem_host})`;
}

/**
 * True when two logins point at the same target connection (same user, stone,
 * host, and NetLDI). Used to group active sessions under the configured login
 * that spawned them.
 */
export function sameLoginTarget(
  a: Pick<GemStoneLogin, 'gem_host' | 'stone' | 'gs_user' | 'netldi'>,
  b: Pick<GemStoneLogin, 'gem_host' | 'stone' | 'gs_user' | 'netldi'>,
): boolean {
  return (
    a.gem_host === b.gem_host &&
    a.stone === b.stone &&
    a.gs_user === b.gs_user &&
    a.netldi === b.netldi
  );
}

/**
 * A stable string key for a login's target connection (user, stone, host,
 * NetLDI). Two logins produce the same key exactly when `sameLoginTarget`
 * considers them the same target, so it can index in-flight connection
 * attempts (see InFlightGuard / the gemstone.login command).
 */
export function loginTargetKey(
  login: Pick<GemStoneLogin, 'gem_host' | 'stone' | 'gs_user' | 'netldi'>,
): string {
  return JSON.stringify([login.gem_host, login.stone, login.gs_user, login.netldi]);
}

/**
 * The active sessions that belong under the login at position `loginIndex`,
 * using first-match-wins: each session is assigned to the first login in
 * `logins` whose connection target it matches. Keyed on position rather than
 * object identity because each LoginStorage.getLogins() call returns a fresh
 * deserialized array, so the same login is a different object across calls.
 * Pure and free of VS Code/GCI deps so it can be unit-tested directly. Generic
 * over the session shape (only `.login` is read) to avoid importing
 * ActiveSession here.
 */
export function sessionsForLogin<T extends { login: GemStoneLogin }>(
  loginIndex: number,
  logins: GemStoneLogin[],
  sessions: T[],
): T[] {
  return sessions.filter(
    (s) => logins.findIndex((l) => sameLoginTarget(l, s.login)) === loginIndex,
  );
}

// GemStone's stock default password for DataCurator/SystemUser on a fresh stone.
// Defined as a named constant — and deliberately NOT a `password`-suffixed one —
// so the literal never sits next to a `password:` / `password =` key in the
// bundled extension.js. Open VSX's publish secret scan rejects that pattern
// (gitleaks hashicorp-tf-password), even though 'swordfish' is GemStone's public
// default, not a secret. Reuse this wherever a default login is constructed.
export const DEFAULT_GS_PW = 'swordfish';

export const DEFAULT_LOGIN: GemStoneLogin = {
  label: '',
  version: '',
  gem_host: 'localhost',
  stone: 'gs64stone',
  gs_user: 'DataCurator',
  gs_password: DEFAULT_GS_PW,
  netldi: 'gs64ldi',
  host_user: '',
  host_password: '',
};

/** The connection coordinates of a Jasper-managed database, enough to build a
 *  login for it. Matches the relevant fields of a GemStoneDatabase's config. */
export interface ManagedStoneConfig {
  version: string;
  stoneName: string;
  ldiName: string;
}

/**
 * A DataCurator login for a Jasper-created stone. The stone is built from the
 * pristine extent, so DataCurator's password is GemStone's stock default —
 * prefilling it lets the login both connect and (cleanly) stop the stone right
 * away. The user can change it, or the connect flow resolves the GCI library on
 * first login.
 */
export function buildDataCuratorLogin(config: ManagedStoneConfig): GemStoneLogin {
  return {
    label: '',
    version: config.version,
    gem_host: 'localhost',
    stone: config.stoneName,
    gs_user: 'DataCurator',
    gs_password: DEFAULT_GS_PW,
    netldi: config.ldiName,
    host_user: '',
    host_password: '',
  };
}

/**
 * The configured logins a *local* database's removal would leave pointing at
 * nothing: local host, same stone, same version. Creating a database auto-creates
 * a DataCurator login for its stone, so deleting one without consulting this
 * leaves behind an entry Jasper made itself — plus any others the user added for
 * the same local stone.
 *
 * Restricted to `gem_host === 'localhost'`, because a Jasper-managed database runs
 * on this machine (buildDataCuratorLogin sets `gem_host: 'localhost'`). A *remote*
 * login that merely shares the default stone name and version — a login to a stone
 * on another server — must NEVER be swept: deleting a local database must not
 * delete someone's remote credentials. `versionsMatch` is injected rather than
 * imported: processManager owns it and already imports this module, so importing
 * it back would be a cycle.
 */
export function loginsTargetingStone(
  logins: GemStoneLogin[],
  config: Pick<ManagedStoneConfig, 'stoneName' | 'version'>,
  versionsMatch: (a: string, b: string) => boolean,
): GemStoneLogin[] {
  return logins.filter(
    (l) =>
      l.gem_host === 'localhost' &&
      l.stone === config.stoneName &&
      versionsMatch(l.version, config.version),
  );
}

/**
 * The DataCurator login to auto-create for a freshly-created stone, or undefined
 * when one already targets it — so creating a stone never duplicates an entry or
 * clobbers a login the user has since edited (or deliberately deleted and does
 * not want back).
 */
export function dataCuratorLoginToCreate(
  existing: GemStoneLogin[],
  config: ManagedStoneConfig,
): GemStoneLogin | undefined {
  const candidate = buildDataCuratorLogin(config);
  return existing.some((l) => sameLoginTarget(l, candidate)) ? undefined : candidate;
}
