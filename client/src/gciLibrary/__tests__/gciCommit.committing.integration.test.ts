import { describe, it, expect } from 'vitest';
import { GciLibrary, GciError } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The `.committing.` infix comes from `commitEmptyTransaction` below, not
 * from this suite's own tests (`allowedCommits` stays at 0 — none of them
 * commit on the harness session).
 */
describe('GciTsCommit (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  /** Throws unless `session`'s transaction is provably empty. Never commits. */
  function assertTransactionIsEmpty(gciLibrary: GciLibrary, session: unknown): void {
    const needsCommit = gciLibrary.executeAndFetchString(session, 'System needsCommit printString');
    if (needsCommit !== 'false') {
      throw new Error(
        `assertTransactionIsEmpty: expected System needsCommit to be false, got ${needsCommit}`,
      );
    }
  }

  /**
   * Logs in a session of its own, outside the harness and never armed with
   * its commit guard, proves the transaction empty, commits it, and logs
   * out. Safe only because the transaction is proven empty first — this
   * is not a pattern to copy for a test that needs to commit real changes.
   */
  function commitEmptyTransaction(gciLibrary: GciLibrary): { success: boolean; err: GciError } {
    // eslint-disable-next-line no-restricted-syntax -- the one sanctioned unarmed login in this repo; safe only because assertTransactionIsEmpty runs before the commit below. If you are reading this comment in a second file, that is the bug.
    const session = gciLibrary.login(
      process.env.VITE_GEMSTONE_STONE_NRS!,
      process.env.VITE_GEMSTONE_GEM_NRS!,
      process.env.VITE_GEMSTONE_USER!,
      // eslint-disable-next-line no-restricted-syntax -- credentials for the sanctioned unarmed login above; see that comment before copying either line
      process.env.VITE_GEMSTONE_PASSWORD!,
    );

    try {
      assertTransactionIsEmpty(gciLibrary, session);

      // The empty commit below is still a real commit at the stone level —
      // it writes a commit record and advances the sequence. Harmless, but
      // not a no-op: never call this in a loop.
      return gciLibrary.GciTsCommit(session);
    } finally {
      gciLibrary.logout(session);
    }
  }

  it('commit succeeds on a clean session', () => {
    const commit = commitEmptyTransaction(gci);

    expect(commit.success).toBe(true);
    expect(commit.err.number).toBe(0);
  });

  it('the emptiness proof passes on a clean harness session', () => {
    expect(() => assertTransactionIsEmpty(gci, handle)).not.toThrow();
  });

  it('the emptiness proof has discriminating power', () => {
    gci.executeDiscardingResult(handle, 'UserGlobals at: #JasperEmptyCommitProbe put: 42');

    expect(() => assertTransactionIsEmpty(gci, handle)).toThrow();
  });
});
