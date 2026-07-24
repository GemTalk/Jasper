import { QueryExecutor } from './types';
import { escapeString } from './util';

/**
 * Whether this stone can fork a gem at all.
 *
 * Not every version can. On 3.6.2 the one-time password selector doesn't exist
 * and `GsTsExternalSession newDefault` fails outright (`UndefinedObject does not
 * understand #key`), so a fork dies with a MessageNotUnderstood that says
 * nothing useful. Ask first, and tell the user plainly.
 *
 * Asked as a capability rather than a version comparison: the selector is the
 * thing actually required, and a version floor would be a guess about every
 * release in between.
 */
export function canForkGem(execute: QueryExecutor): boolean {
  const answer = execute(
    `((GsCurrentSession currentSession respondsTo: #'createOnetimePasswordForUserId:validForSeconds:')
      and: [(System myUserProfile symbolList objectNamed: #'GsTsExternalSession') notNil]) printString`,
  );
  return answer.trim() === 'true';
}

/**
 * Run `expression` in a gem of its own and leave it running, answering the new
 * gem's stone session id.
 *
 * Some expressions never return — a web server's listen loop, for instance —
 * so they cannot run in the extension's own session without wedging it. This
 * forks a second gem to carry them.
 *
 * The new gem logs in as *the current user*, using a one-time password minted
 * for that same user. Minting one for yourself needs no special privilege, so
 * the forked gem is never more powerful than the session that asked for it —
 * unlike shelling out to topaz as SystemUser, which is what serving used to do.
 *
 * The session id is read *before* forking: `forkAndDetachString:` detaches the
 * gem, after which it stops answering, so asking afterwards would be too late.
 *
 * `gemNrs` must name the NetLDI that will spawn the gem — see `gemNrsFor`.
 * `newDefault` alone assumes GemStone's default NetLDI name (`gs64ldi`) and
 * fails outright against any stone whose NetLDI is called something else, which
 * is most of them:
 *   ERROR 2710, NetLDI service 'gs64ldi' not found on node '…'
 *
 * Nothing yet lists or stops gems started this way — they appear in neither the
 * Processes panel (server processes only) nor Logins & Sessions (Jasper's own
 * GCI sessions). A forked gem holds its port and a stone session until the
 * stone goes down. The id this answers is what a stop action would need.
 */
export function forkGemRunning(execute: QueryExecutor, expression: string, gemNrs: string): string {
  return execute(
    `| gem id |
gem := GsTsExternalSession newDefault.
gem gemNRS: '${escapeString(gemNrs)}'.
gem username: System myUserProfile userId.
gem onetimePassword: (GsCurrentSession currentSession
  createOnetimePasswordForUserId: System myUserProfile userId
  validForSeconds: 300).
gem login.
id := gem stoneSessionId.
gem forkAndDetachString: '${escapeString(expression)}'.
id printString`,
  );
}
