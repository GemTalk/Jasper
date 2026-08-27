import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * Covers the binding's success branch: the koffi signature, the session
 * pointer round-trip, and reading `number` back out of the `GciErrSType`
 * out-param. The refusal branch — where that struct's `number` and `message`
 * carry the values production reads on a failed commit — is covered by
 * "refuses a commit issued through the GCI commit call directly" in
 * `client/src/__tests__/useIntegrationTest.integration.test.ts`.
 */
describe('GciTsCommit (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      handle = testContext.session;
    },
    { allowedCommits: 1 },
  );

  it('commit succeeds on a clean session', () => {
    const commit = gci.GciTsCommit(handle);

    expect(commit.success).toBe(true);
    expect(commit.err.number).toBe(0);
  });
});
