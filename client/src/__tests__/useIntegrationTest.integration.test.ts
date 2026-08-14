import { describe, expect, it } from 'vitest';
import { GciLibrary } from '../gciLibrary';
import { GciLibraryError } from '../gciLibraryError';
import { COMMIT_GUARD_REASON, GciTestContext, useIntegrationTest } from './useIntegrationTest';

/**
 * The harness's own commit invariant: every session it hands out has GemStone's
 * session-level commit guard armed, so nothing a test does can persist past the
 * automatic abort. These tests exercise the guard the only way it can be
 * exercised — by attempting a real commit and asserting GemStone refuses it.
 */
describe('integration test harness commit guard (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;
  let login: GciTestContext['login'];
  let logout: GciTestContext['logout'];
  let withTransientSession: GciTestContext['withTransientSession'];

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    session = testContext.session;
    login = testContext.login;
    logout = testContext.logout;
    withTransientSession = testContext.withTransientSession;
  });

  const commitGuardIsArmedOn = (aSession: unknown) => gci.areCommitsDisabledUntilLogout(aSession);

  const commitOn = (aSession: unknown) => () =>
    gci.executeAndRelease(aSession, 'System commitTransaction', (oop) => gci.isTrueOop(oop));

  // Asserts on GemStone's error number and on the harness's own reason, never on
  // the prose around them: that wording is GemStone's and differs across the
  // releases the integration matrix covers.
  const expectRefusedByCommitGuard = (attemptCommit: () => unknown) => {
    let refusal: unknown;
    try {
      attemptCommit();
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(GciLibraryError);
    expect((refusal as Error).message).toMatch(/error 2249/);
    expect((refusal as Error).message).toContain(COMMIT_GUARD_REASON);
  };

  it('reports commits as disabled for the rest of the session', () => {
    expect(commitGuardIsArmedOn(session)).toBe(true);
  });

  it('refuses a commit attempted on the session handed to a test', () => {
    expectRefusedByCommitGuard(commitOn(session));
  });

  it('refuses a commit issued through the GCI commit call directly', () => {
    const { success, err } = gci.GciTsCommit(session);

    expect(success).toBe(false);
    expect(err.number).toBe(2249);
    expect(err.message).toContain(COMMIT_GUARD_REASON);
  });

  it('refuses a commit attempted on a second, independent session', () => {
    withTransientSession((transientSession) => {
      expect(commitGuardIsArmedOn(transientSession)).toBe(true);
      expectRefusedByCommitGuard(commitOn(transientSession));
    });
  });

  it('refuses a commit on a session re-established part way through a test file', () => {
    logout();
    login();

    expect(commitGuardIsArmedOn(session)).toBe(true);
    expectRefusedByCommitGuard(commitOn(session));
  });

  it('leaves the session usable after a refused commit', () => {
    expect(commitOn(session)).toThrow();

    expect(gci.executeAndRelease(session, '3 + 4 = 7', (oop) => gci.isTrueOop(oop))).toBe(true);
  });
});
