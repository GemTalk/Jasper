import { GemStoneLogin } from './loginTypes';
import { GemStoneDatabase } from './sysadminTypes';
import { versionsMatch } from './manager/processManager';

/**
 * True when a host name means this machine. `::1` counts: it is the IPv6
 * loopback, and a login on it would otherwise read as remote and quietly lose
 * the auto-start offer — the user would just see the original login failure
 * again, with nothing explaining why. NRS spellings bracket the address, so
 * both forms are accepted.
 */
export function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * True when a login targets a stone on this machine. Only a local stone can be
 * started by Jasper — starting a remote one would mean running `startstone`
 * over there, which the extension has no way to do.
 */
export function isLocalLogin(login: Pick<GemStoneLogin, 'gem_host'>): boolean {
  return isLocalHost(login.gem_host);
}

/**
 * The Jasper-managed database a login connects to, or undefined when the login
 * points somewhere Jasper does not manage (a remote host, a hand-rolled stone,
 * or a stone belonging to a different installed version).
 *
 * Matching on the stone name alone is not enough: the same stone name can exist
 * under two installed versions, and starting the wrong one would connect the
 * user to the wrong database. So the version must agree too — loosely, via
 * `versionsMatch`, because a login's version and a database.yaml's version are
 * recorded at different precisions.
 *
 * Pure (no vscode / fs) so it can be unit-tested directly.
 */
export function findDatabaseForLogin(
  login: GemStoneLogin,
  databases: GemStoneDatabase[],
): GemStoneDatabase | undefined {
  if (!isLocalLogin(login)) return undefined;
  return databases.find(
    (db) => db.config.stoneName === login.stone && versionsMatch(db.config.version, login.version),
  );
}

/**
 * The sessions logged into a database — the ones stopping its stone kills.
 *
 * Paired through `findDatabaseForLogin`, so a session inherits its care about
 * host and version: a login on a remote host, or on a same-named stone of a
 * different installed version, is not a session on *this* database and must not
 * be reaped when it stops.
 *
 * Pure (no vscode / fs) so it can be unit-tested directly.
 */
export function sessionsOnDatabase<T extends { login: GemStoneLogin }>(
  db: GemStoneDatabase,
  sessions: T[],
  databases: GemStoneDatabase[],
): T[] {
  return sessions.filter((s) => findDatabaseForLogin(s.login, databases)?.path === db.path);
}
