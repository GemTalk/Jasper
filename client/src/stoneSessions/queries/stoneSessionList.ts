import { NO_PRIVILEGE_ERROR } from '../../queries/sessionOfLogin';
import type { QueryExecutor } from '../../queries/types';

/** The whole answer from a login without SessionAccess, which can't look at other sessions. */
export const NO_SESSION_ACCESS = 'noSessionAccess';

/**
 * Every session on the stone except the one asking. One line per session,
 * tab-separated; the first line is the stone's clock, the commit-record
 * backlog, the stone's abort threshold, whether the login has SystemControl,
 * and the sessions holding the oldest commit record. A session that logs out
 * while the list is read answers a session number of 0 and is left out.
 */
export function stoneSessionList(execute: QueryExecutor): string {
  return execute(
    '| out me noAccess | out := WriteStream on: String new. me := System session. ' +
      'noAccess := false. out print: System timeGmt; tab; print: System commitRecordBacklog; tab; ' +
      'print: (System stoneConfigurationAt: #StnSignalAbortCrBacklog); tab; ' +
      'print: (System myUserProfile privileges includes: #SystemControl); tab. ' +
      'System sessionsReferencingOldestCr do: [:id | out print: id] separatedBy: [out space]. ' +
      'System currentSessions do: [:id | | d | id = me ifFalse: [' +
      'd := [System descriptionOfSession: id] on: Error do: [:e | ' +
      `e number = ${NO_PRIVILEGE_ERROR} ifFalse: [e pass]. noAccess := true. nil]. ` +
      '(d notNil and: [(d at: 10) = id]) ifTrue: [' +
      'out lf; print: id; tab; print: (d at: 9); tab; ' +
      "nextPutAll: ((d at: 1) ifNil: [''] ifNotNil: [:u | u userId]); tab; " +
      'print: (d at: 2); tab; nextPutAll: (d at: 3); tab; print: (d at: 15); tab; ' +
      "print: (d at: 7); tab; nextPutAll: ((d at: 17) ifNil: [''])]]]. " +
      `noAccess ifTrue: [^ '${NO_SESSION_ACCESS}']. out contents`,
  );
}
