import { onTestFinished } from 'vitest';
import type { ActiveSession } from '../activeSession';
import { reportedSerialOf, reportSessionClosed } from './sessionGateClient';

// Gems are told apart by their login's serial number, which GemStone never gives
// another login, not by session number, which the next login gets once the gem
// has gone: a test that goes by number can check, or end, another test's session.

/** Smalltalk answering whether the login with serial number `serial` is still on the stone ('true' or 'false'); needs SessionAccess. */
export function stillOnStoneCode(serial: string): string {
  return `(((System descriptionOfSessionSerialNum: ${serial}) at: 10) > 0) printString`;
}

/** Whether the login with serial number `serial` is still on the stone, asked from `admin`. */
export function stillOnStone(admin: ActiveSession, serial: string): boolean {
  return admin.executeAndFetchString(stillOnStoneCode(serial)) === 'true';
}

/** End `own`'s gem when the test finishes, if it is still on the stone, from `admin`. `own` must have been reported to the session gate. */
export function endGemAfterTest(admin: () => ActiveSession, own: ActiveSession): void {
  const serial = reportedSerialOf(own);
  onTestFinished(async () => {
    admin().executeAndFetchString(
      `| now | now := (System descriptionOfSessionSerialNum: ${serial}) at: 10. ` +
        `now > 0 ifTrue: [System stopSession: now]. 'ok'`,
    );
    reportSessionClosed(serial);
    // Waits for the gem to leave, so the next test starts without it holding a slot.
    const deadline = Date.now() + 10_000;
    while (stillOnStone(admin(), serial) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // vitest's default 10 s hookTimeout would end this hook before its own 10 s deadline.
  }, 15_000);
}
