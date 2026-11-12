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

// A gem that takes longer than this to leave is reported even when it makes the deadline, so a
// near miss shows up in the CI log of a passing run too.
const SLOW_LEAVE_MS = 2_000;

/**
 * Polls from `admin` until the login with serial number `serial` is off the stone; past `ms` it
 * throws with the stone's own description of that login, read after the last check so it may differ from it.
 * A login that leaves after more than 2 s is logged with how long it took, measured from this call.
 */
export async function waitUntilOffTheStone(
  admin: ActiveSession,
  serial: string,
  ms: number,
): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + ms;
  while (stillOnStone(admin, serial)) {
    if (Date.now() >= deadline) {
      let description: string;
      try {
        description = admin.executeAndFetchString(
          `(System descriptionOfSessionSerialNum: ${serial}) printString`,
        );
      } catch (error) {
        // The timeout is the signal; a failed read of the description must not replace it.
        description = `unavailable (${error instanceof Error ? error.message : String(error)})`;
      }
      throw new Error(
        `Login ${serial} had not left the stone after ${ms} ms; it now reads: ${description}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const tookMs = Date.now() - startedAt;
  if (tookMs > SLOW_LEAVE_MS) {
    console.warn(`Login ${serial} took ${tookMs} ms to leave the stone.`);
  }
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
    // vitest's default hookTimeout (10 s) starts earlier and would end this hook before the deadline above.
  }, 15_000);
}
