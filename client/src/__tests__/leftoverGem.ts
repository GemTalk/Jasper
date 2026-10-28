import { onTestFinished } from 'vitest';
import type { ActiveSession } from '../activeSession';

/**
 * End `own`'s gem when the test finishes, if it is still on the stone, from
 * `admin` (which needs SessionAccess). Goes by the login's serial number, never
 * reused, rather than the session number, which the next login gets once the gem
 * has gone: stopping by number can end another test's session.
 */
export function endGemAfterTest(admin: () => ActiveSession, own: ActiveSession): void {
  const serial = own.executeAndFetchString(
    '((System descriptionOfSession: System session) at: 9) printString',
  );
  onTestFinished(() => {
    admin().executeAndFetchString(
      `| now | now := (System descriptionOfSessionSerialNum: ${serial}) at: 10. ` +
        `now > 0 ifTrue: [System stopSession: now]. 'ok'`,
    );
  });
}
