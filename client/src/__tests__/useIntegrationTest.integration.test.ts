import { describe, expect, it } from 'vitest';
import { GciLibrary } from '../gciLibrary';
import { GciLibraryError } from '../gciLibraryError';
import { COMMIT_GUARD_REASON, GciTestContext, useIntegrationTest } from './useIntegrationTest';
import { expectUtf8OopToResolveViaSymbolLookup } from './support/utf8OopCache';

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

/**
 * The `nested` commit strategy (see `useIntegrationTest`'s JSDoc and
 * `commitDepth` option) exists for the rare test that must exercise a real
 * `System commitTransaction` -- the default strategy refuses commits outright
 * via GemStone's own commit guard, so it cannot host those tests at all. These
 * tests prove the strategy's core promise: a commit performed under it still
 * never reaches the repository, because it only ever lands in one of the
 * nested transaction levels opened for the test, and the suite's `afterEach`
 * always aborts every level it opened.
 */
describe('nested-transaction commit strategy (integration)', () => {
  let gci: GciLibrary;
  let session: unknown;
  let login: GciTestContext['login'];
  let logout: GciTestContext['logout'];
  let withTransientSession: GciTestContext['withTransientSession'];

  useIntegrationTest(
    (testContext) => {
      gci = testContext.gciLibrary;
      session = testContext.session;
      login = testContext.login;
      logout = testContext.logout;
      withTransientSession = testContext.withTransientSession;
    },
    { commitStrategy: 'nested', commitDepth: 4 },
  );

  const isVisibleToOtherSessions = (key: string): boolean => {
    let visible = false;
    withTransientSession((transientSession) => {
      visible = gci.isIncludedInUserGlobals(transientSession, key);
    });
    return visible;
  };

  it('does not let a commit made during the test reach other sessions', () => {
    const key = gci.storeInUniqueUserGlobalsKey(session, 'true');
    gci.executeDiscardingResult(session, 'System commitTransaction');

    const visibleElsewhere = isVisibleToOtherSessions(key);

    expect(visibleElsewhere).toBe(false);
  });

  it('does not let several sequential commits made during the test reach other sessions', () => {
    const keys = [0, 1, 2].map(() => {
      const key = gci.storeInUniqueUserGlobalsKey(session, 'true');
      gci.executeDiscardingResult(session, 'System commitTransaction');
      return key;
    });

    const visibleElsewhere = keys.map(isVisibleToOtherSessions);

    expect(visibleElsewhere).toEqual(keys.map(() => false));
  });

  // This strategy opens its levels with a doit, where the default one uses a
  // plain begin -- so it is the strategy that can hand a test a session already
  // carrying state a bare login would not have left behind.
  it('hands a test a session as clean as a bare login leaves behind', () => {
    expectUtf8OopToResolveViaSymbolLookup(session, gci);
  });

  it('budgets commits for a session re-established part way through a test', () => {
    logout();
    login();

    const key = gci.storeInUniqueUserGlobalsKey(session, 'true');
    gci.executeDiscardingResult(session, 'System commitTransaction');

    expect(isVisibleToOtherSessions(key)).toBe(false);
  });
});

/**
 * A `commitDepth` says how many commits the suite's budget covers, so it has to
 * be a whole count of at least one level. Anything else describes a budget that
 * cannot be opened, and the harness refuses it where the suite declares it --
 * rather than accepting it and failing every test in that suite at teardown,
 * blaming tests that did nothing wrong.
 */
describe('nested-transaction commit strategy configuration', () => {
  const declaringASuiteWithCommitDepth = (commitDepth: number) => () =>
    useIntegrationTest(() => {}, { commitStrategy: 'nested', commitDepth });

  it.each([0, -1, 1.5, NaN, Infinity])('refuses a commitDepth of %s', (commitDepth) => {
    expect(declaringASuiteWithCommitDepth(commitDepth)).toThrow(
      `commitDepth of at least 1 whole nested level, but got ${commitDepth}`,
    );
  });
});
