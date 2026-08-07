import { GemStoneLogin } from './loginTypes';
import { GemStoneDatabase } from './sysadminTypes';
import { versionsMatch } from './processManager';

/**
 * True when a login targets a stone on this machine. Only a local stone can be
 * started by Jasper — starting a remote one would mean running `startstone`
 * over there, which the extension has no way to do.
 */
export function isLocalLogin(login: Pick<GemStoneLogin, 'gem_host'>): boolean {
  return login.gem_host === 'localhost' || login.gem_host === '127.0.0.1';
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
