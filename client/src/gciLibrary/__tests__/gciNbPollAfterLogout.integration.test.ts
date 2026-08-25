import { describe, it } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { OOP_ILLEGAL } from '../../gciConstants';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * Repro for a native crash, not a normal test: see
 * docs/explanation/gci-nb-poll-crash-repro.md for the full writeup.
 *
 * Hypothesis: `GciTsNbPoll` does not validate its session argument before
 * dereferencing the outstanding call's state, so polling a session that was
 * logged out while a non-blocking call was still in flight segfaults the
 * process instead of returning the documented -1/invalid-session error.
 *
 * `GciTsNbPoll` isn't exported before GemStone 3.7.0 — older libraries fall
 * back to polling the raw socket, a different code path this does not
 * exercise — so this only has anything to repro from 3.7.0 onward.
 */
describe('GciTsNbPoll on a logged-out session', () => {
  let gci: GciLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
  });

  it('polls a session that was logged out mid-call', (ctx) => {
    if (!gci.isAvailable('GciTsNbPoll')) {
      return ctx.skip('GciTsNbPoll is not exported before GemStone 3.7.0');
    }

    const session = gci.login(
      process.env.VITE_GEMSTONE_STONE_NRS!,
      process.env.VITE_GEMSTONE_GEM_NRS!,
      process.env.VITE_GEMSTONE_USER!,
      process.env.VITE_GEMSTONE_PASSWORD!,
    );

    const { success, err } = gci.GciTsNbExecute(
      session,
      '(Delay forSeconds: 2) wait. true',
      gci.utf8ClassOop(session),
      OOP_ILLEGAL,
      gci.nilOop(),
      0,
      0,
    );
    if (!success) throw new Error(`GciTsNbExecute failed to start: ${err.message}`);

    gci.logout(session);

    // If this crashes the process, that's the repro reproducing — there is
    // nothing left to assert. If it survives, log what GciTsNbPoll actually
    // returned so the two behaviors are both visible in the CI matrix output.
    const polled = gci.GciTsNbPoll(session, 0);
    console.log(`GciTsNbPoll on a logged-out session returned: ${JSON.stringify(polled)}`);
  });
});
