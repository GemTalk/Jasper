/**
 * Registered databases — the ones Jasper did not create.
 *
 * Everything else in the manager may assume a database it laid out itself: a
 * `db-N` directory holding `conf/`, `data/` and `log/`, registered in Jasper's
 * own `GEMSTONE_GLOBAL_DIR`, running an extent Jasper copied. A *registered*
 * database is an installation that already existed — someone else's stone,
 * running from someone else's product tree, registered wherever they started
 * it. Jasper adopts the record, not the files.
 *
 * That distinction is a rule, not a preference: Jasper writes nothing inside a
 * registered installation. Its `database.yaml` lives in Jasper's root like any
 * other, its logs (the ones Jasper's own start writes) go to Jasper's log
 * directory, and every action that would modify the installation — delete,
 * replace the extent, back the extents up — is refused rather than aimed at a
 * directory the user did not hand over for writing.
 *
 * Pure and free of `vscode`, so the rules can be tested without a stone: the
 * paths a registered database resolves to, why an action is refused, and how a
 * login must address its NetLDI.
 */
import { DatabaseYaml, GemStoneDatabase } from '../sysadminTypes';
import { versionsMatch } from './versionMatch';

/** GemStone's own default `GEMSTONE_GLOBAL_DIR` when the variable is unset —
 *  where `startstone` registers a stone, and so where `gslist` finds it. Used
 *  as the fallback for a registered database whose global directory could not
 *  be read off a running process. */
export const DEFAULT_GLOBAL_DIR = '/opt/gemstone';

/** Whether this database was registered from an existing installation. */
export function isRegisteredDatabase(db: Pick<GemStoneDatabase, 'config'>): boolean {
  return db.config.registered === true;
}

/**
 * Why Jasper will not modify a registered database. One sentence, used verbatim
 * as the tooltip on every control it disables, so the reason a user reads on a
 * greyed-out button is the reason the command gives if it is invoked anyway.
 */
export const REGISTERED_REASON =
  'Jasper did not create this database — it was registered from an existing installation, ' +
  'so Jasper does not modify its files.';

/** The refusal for one named action, for a command guard and a tooltip alike. */
export function registeredRefusal(action: string, stoneName: string): string {
  return `Cannot ${action} "${stoneName}". ${REGISTERED_REASON}`;
}

/**
 * Where a registered database's parts actually are.
 *
 * `confDir` and `globalDir` are what a start or stop has to be told; every
 * created database derives both from its own directory, which is exactly what a
 * registered one cannot do. `identityDir` is the directory that identifies the
 * installation on a running server's command line — the `-e`/`-z`/`-l` paths
 * point inside it — and it is the product tree rather than Jasper's record
 * directory, which the foreign server has never heard of.
 */
export interface RegisteredPaths {
  productPath: string;
  confDir: string;
  globalDir: string;
  identityDir: string;
  netldiPort?: number;
}

/** GemStone's own layout: a product tree keeps its configuration in `data/`. */
export function defaultConfDir(productPath: string): string {
  return `${trimSlash(productPath)}/data`;
}

/**
 * The recorded paths of a registered database, or undefined when the record is
 * not a registered one (or is missing the product tree it cannot work without).
 * Callers branch on the undefined rather than on the flag, so a half-written
 * record can never be treated as registered-and-usable.
 */
export function registeredPaths(config: DatabaseYaml): RegisteredPaths | undefined {
  if (config.registered !== true || !config.productPath) return undefined;
  const productPath = trimSlash(config.productPath);
  return {
    productPath,
    confDir: config.confPath ? trimSlash(config.confPath) : defaultConfDir(productPath),
    globalDir: config.globalDir ? trimSlash(config.globalDir) : DEFAULT_GLOBAL_DIR,
    identityDir: productPath,
    netldiPort: config.netldiPort,
  };
}

/**
 * A registered database's `database.yaml`, as text.
 *
 * One serializer for both writers — the initial registration and the later
 * port correction — because two copies of the same template drift, and the
 * copy that drifted wrote `confPath: "undefined"` into records that only ever
 * held a product tree. That shape is legal (`registeredPaths` fills the rest in
 * from GemStone's own defaults), but the literal string is truthy, so the
 * fallback stops firing and the next start hands the installation
 * `GEMSTONE_SYS_CONF=undefined`. What goes in is the *resolved* record, so a
 * rewrite writes down the defaults it was already running on rather than
 * corrupting the line it left alone.
 */
export function registeredDatabaseYaml(config: DatabaseYaml): string {
  const paths = registeredPaths(config);
  return (
    `---\nregistered: true\n` +
    `version: "${config.version}"\n` +
    `stoneName: "${config.stoneName}"\n` +
    `ldiName: "${config.ldiName}"\n` +
    (config.netldiPort ? `netldiPort: ${config.netldiPort}\n` : '') +
    // A record with no product tree is not a usable registration — `registeredPaths`
    // answers undefined for it — so there is nothing to resolve and nothing to
    // invent: only what was actually given is written back.
    (paths
      ? `productPath: "${paths.productPath}"\n` +
        `confPath: "${paths.confDir}"\n` +
        `globalDir: "${paths.globalDir}"\n`
      : '')
  );
}

/**
 * How a version mismatch should be described, or undefined when there is none.
 *
 * A registered database records the version of the product tree it was
 * registered from; the servers actually running under its name are whatever
 * someone started. When those disagree, Jasper must not act: `startstone` would
 * collide with a live stone, and a stop driven by the wrong product tree is a
 * command aimed at binaries that do not match the extent it would touch.
 */
export function versionMismatchNote(
  recordedVersion: string,
  runningVersion: string | undefined,
  serverLabel: string,
): string | undefined {
  if (!runningVersion || versionsMatch(runningVersion, recordedVersion)) return undefined;
  return (
    `The ${serverLabel} running under this name is GemStone ${runningVersion}, ` +
    `but this database is registered as ${recordedVersion}. ` +
    `Jasper will not start or stop it: re-register the database from the ${runningVersion} ` +
    `product tree, or stop the server the way it was started.`
  );
}

/** Both separators: a recorded product path is whatever the folder dialog
 *  answered, which on Windows is a `\\wsl$\…` UNC ending in a backslash. */
function trimSlash(p: string): string {
  return p.replace(/[/\\]+$/, '');
}
