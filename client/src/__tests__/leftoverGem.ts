import { onTestFinished } from 'vitest';
import type { ActiveSession } from '../activeSession';

// Gems are told apart by their login's serial number, which GemStone never gives
// another login, not by session number, which the next login gets once the gem
// has gone: a test that goes by number can check, or end, another test's session.

/** The serial number of `own`'s login. */
export function loginSerialOf(own: ActiveSession): string {
  return own.executeAndFetchString(
    '((System descriptionOfSession: System session) at: 9) printString',
  );
}

/** Smalltalk answering whether the login with serial number `serial` is still on the stone ('true' or 'false'); needs SessionAccess. */
export function stillOnStoneCode(serial: string): string {
  return `(((System descriptionOfSessionSerialNum: ${serial}) at: 10) > 0) printString`;
}

/** Whether the login with serial number `serial` is still on the stone, asked from `admin`. */
export function stillOnStone(admin: ActiveSession, serial: string): boolean {
  return admin.executeAndFetchString(stillOnStoneCode(serial)) === 'true';
}

/** End `own`'s gem when the test finishes, if it is still on the stone, from `admin`. */
export function endGemAfterTest(admin: () => ActiveSession, own: ActiveSession): void {
  const serial = loginSerialOf(own);
  onTestFinished(() => {
    admin().executeAndFetchString(
      `| now | now := (System descriptionOfSessionSerialNum: ${serial}) at: 10. ` +
        `now > 0 ifTrue: [System stopSession: now]. 'ok'`,
    );
  });
}
