import { QueryExecutor } from './types';

/** The error GemStone raises for an operation that needs a privilege the user lacks. */
export const NO_PRIVILEGE_ERROR = 2151;

// GemStone gives a session number to the next login once a gem has gone, but
// never reuses a login's serial number. So a session to be acted on is named
// by both, and checked against its login's serial first.

/** Whether login `serial` still has session `sessionId`, and, when given, gem process `gemPid`. */
export function loginHasSession(
  execute: QueryExecutor,
  sessionId: number | string,
  serial: number | string,
  gemPid?: number,
): boolean {
  const sameGem = gemPid === undefined ? '' : ` and: [(d at: 2) = ${gemPid}]`;
  return (
    execute(
      `| d | d := System descriptionOfSessionSerialNum: ${serial}. ` +
        `((d at: 10) = ${sessionId}${sameGem}) printString`,
    ) === 'true'
  );
}

/**
 * End session `sessionId` with `System stopSession:` while login `serial` still
 * has it, answering whether it did. Needs the SessionAccess and SystemControl
 * privileges ({@link NO_PRIVILEGE_ERROR} otherwise).
 */
export function stopSessionOfLogin(
  execute: QueryExecutor,
  sessionId: number | string,
  serial: number | string,
): boolean {
  return (
    execute(
      `| now | now := (System descriptionOfSessionSerialNum: ${serial}) at: 10. ` +
        `now = ${sessionId} ifTrue: [System stopSession: now]. ` +
        `(now = ${sessionId}) printString`,
    ) === 'true'
  );
}
