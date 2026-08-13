import { GciLibrary } from '../gciLibrary';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

/** The live GCI state handed to a `useIntegrationTest` callback on every login. */
export type GciTestContext = {
  gciLibrary: GciLibrary;
  session: unknown;
  login: (options?: LoginOptions) => void;
  logout: () => unknown;
  withTransientSession: (callback: (transientSession: unknown) => void) => void;
};

type UseIntegrationTestCallback = (testContext: GciTestContext) => void;

/**
 * Reason GemStone reports when it refuses a commit from a harness session. It
 * names the harness so a refusal is traceable back to here rather than reading
 * as an unrelated transaction error — assert against this constant instead of
 * the surrounding message, whose wording varies by GemStone release.
 */
export const COMMIT_GUARD_REASON = 'jasper-test-harness: integration tests must not commit';

/** Options accepted by a `GciTestContext`'s `login`. */
type LoginOptions = {
  /** GemStone user to log in as. Defaults to `VITE_GEMSTONE_USER`; override to test login with different (e.g. invalid) credentials. */
  user?: string;
};

/**
 * Sets up a full GemStone integration test environment for a Vitest describe block.
 *
 * Call this at the top of a `describe` block. It handles the entire lifecycle:
 * - Loads the GCI shared library and logs in before any tests run.
 * - Wraps each test in a transaction that is always aborted afterward,
 *   so database changes never leak between tests.
 * - Logs out and closes the library after all tests finish.
 *
 * The `callback` fires after every login, starting with the one at the end of
 * `beforeAll` — use it to capture the {@link GciTestContext} fields you need
 * into variables your tests can reach. If a test calls `logout`, a later
 * test's `beforeEach` re-logs in automatically and the callback fires again,
 * so these variables stay current instead of going stale:
 *
 * ```ts
 * describe('my feature', () => {
 *   let gci: GciLibrary;
 *   let session: unknown;
 *
 *   useIntegrationTest(({gciLibrary, session: s}) => { gci = gciLibrary; session = s; });
 *
 *   it('does something', () => { ... });
 * });
 * ```
 *
 * Connection details are read from `process.env.VITE_GEMSTONE_*` variables.
 * Vite loads these automatically from `.env.test` when running in test mode —
 * run `npm run test:server:start` to generate that file. To override individual
 * values for your local setup without touching `.env.test`, create `.env.test.local`
 * alongside it (gitignored; takes precedence).
 *
 * `GEMSTONE_GLOBAL_DIR` is set from `VITE_GEMSTONE_GLOBAL_DIR` for the duration
 * of each suite and restored afterward, so a local GemStone installation is
 * unaffected outside of test runs.
 */
export function useIntegrationTest(callback: UseIntegrationTestCallback) {
  let gciLibrary: GciLibrary;
  let session: unknown;
  let originalGemstoneGlobalDir: string | undefined;
  let sessionCleanupFailed = false;

  // gciLibrary and session are created inside a beforeAll hook, so they don't
  // exist at call time. The callback fires at the end of that hook, letting
  // callers assign the values into their own variables before any test runs.
  beforeAll(() => {
    configureGemstoneGlobalDir();

    handleIntegrationTestSetupErrorDuring(() => {
      gciLibrary = new GciLibrary(process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH!);
      login();
    });
  });

  afterAll(() => {
    if (!gciLibrary) return;
    try {
      if (session) {
        logout();
      }
      gciLibrary.close();
    } finally {
      restoreGemstoneGlobalDir();
    }
  });

  // Wrap each test in a GCI transaction. Always abort (never commit) so
  // database changes from one test don't leak into the next.
  beforeEach(() => {
    if (sessionCleanupFailed) {
      throw new Error(
        `useIntegrationTest: skipping this test — a previous test's cleanup failed, leaving the GemStone session in an unknown state. See the earlier failure in this file for the actual error.`,
      );
    }

    // A prior test may have called logout() — re-establish a session rather
    // than leaving the rest of the file to fail, since shuffled test order
    // means "prior" and "rest of the file" aren't fixed relative to any one test.
    if (!session) {
      console.warn(
        `useIntegrationTest: no active session in beforeEach for "${expect.getState().currentTestName}" — a previous test called logout() and didn't log back in. Re-logging in automatically.`,
      );
      login();
    }
    gciLibrary.beginTransaction(session);
  });

  afterEach(() => {
    if (!session) return;

    try {
      // Checked before the cleanup below on purpose: if the commit guard is no longer armed, that means a test
      // committed and left the session dirty, so the cleanup below is not guaranteed to succeed. Bail out early
      const commitGuardStillArmed = gciLibrary.executeAndRelease(
        session,
        'System commitsDisabledUntilLogout',
        (oop) => gciLibrary.isTrueOop(oop),
      );

      if (!commitGuardStillArmed) {
        throw new Error(
          `useIntegrationTest: the commit guard was no longer armed at the end of "${expect.getState().currentTestName}" — this is a harness bug, not a mid-test abort (the guard cannot be dropped). Failing the rest of this file since every remaining test would run against an unguarded session.`,
        );
      }

      gciLibrary.abortTransaction(session);
      gciLibrary.resetNonTransactionalSessionState(session);
    } catch (error) {
      sessionCleanupFailed = true;
      throw error;
    }
  });

  /**
   * Logs in (using `options.user`, or `VITE_GEMSTONE_USER` by default) and
   * stores the result as the current session, then re-invokes `callback`
   * with a fresh {@link GciTestContext} so callers stay in sync.
   *
   * @throws {GciLibraryError} If login fails (see `GciLibrary.login`).
   */
  function login(options?: LoginOptions) {
    session = gciLibrary.login(
      process.env.VITE_GEMSTONE_STONE_NRS!,
      process.env.VITE_GEMSTONE_GEM_NRS!,
      options?.user ?? process.env.VITE_GEMSTONE_USER!,
      process.env.VITE_GEMSTONE_PASSWORD!,
    );
    armCommitGuard(session);

    callback({
      gciLibrary,
      session,
      login,
      logout,
      withTransientSession,
    });
  }

  /**
   * Logs out the current session and clears it.
   *
   * @returns The session that was just logged out, so a test can still
   *   reference that specific (now invalid) session after this clears the
   *   shared one.
   */
  function logout() {
    gciLibrary.logout(session);
    const loggedOutSession = session;

    session = undefined;

    return loggedOutSession;
  }

  /**
   * Logs into a second, independent session for the duration of `callback`,
   * then always logs it out afterward -- for tests that need to verify
   * behavior is isolated per session (e.g. that one session's cache doesn't
   * leak into another's).
   *
   * @param callback - Runs with the transient session. The session is
   *   logged out once this returns, whether it throws or not.
   * @throws {GciLibraryError} If logging into the transient session fails.
   */
  function withTransientSession(callback: (transientSession: unknown) => void) {
    const transientSession = gciLibrary.login(
      process.env.VITE_GEMSTONE_STONE_NRS!,
      process.env.VITE_GEMSTONE_GEM_NRS!,
      process.env.VITE_GEMSTONE_USER!,
      process.env.VITE_GEMSTONE_PASSWORD!,
    );

    try {
      armCommitGuard(transientSession);
      callback(transientSession);
    } finally {
      gciLibrary.logout(transientSession);
    }
  }

  /**
   * Arms GemStone's own session-level commit guard, so any commit attempted by a
   * test — or by the production code it exercises — fails at the commit site
   * with TransactionError 2249 instead of leaking state past the harness's abort.
   *
   * Session-scoped and irreversible: there is no `enableCommits`, and the only
   * exit is logout. That is why it is armed once per session here rather than
   * per test, and why every session the harness creates must go through it.
   *
   * Deliberately strict: arming is required to be *this* harness's doing. If
   * GemStone reports commits were already disabled -- by this user's profile,
   * or by a stone that is mid-restore -- the commit invariant happens to hold,
   * but it holds for a reason the harness did not establish and cannot vouch
   * for. Rather than run a whole matrix pass under a guard it did not arm, the
   * harness fails loudly so the environment gets explained.
   */
  function armCommitGuard(aSession: unknown) {
    let armedNewly: boolean;
    try {
      armedNewly = gciLibrary.executeAndRelease(
        aSession,
        `System disableCommitsWithReason: '${COMMIT_GUARD_REASON}'`,
        (oop) => gciLibrary.isTrueOop(oop),
      );
    } catch (error) {
      // `cause` keeps the original error — stack included — linked to this one, which
      // vitest prints under a "Caused by:" heading. Its message is also inlined here so
      // the failure reads completely even through reporters that only show the message.
      // A non-Error throw has no message, so it gets described by type and value rather
      // than through JSON.stringify, which renders `undefined` for several such values.
      const cause =
        error instanceof Error
          ? error.message
          : `a non-Error value of type ${typeof error} was thrown (${String(error)})`;

      throw new Error(
        `useIntegrationTest: could not arm the "no commits allowed" guard on this session. Cause: ${cause}`,
        { cause: error },
      );
    }

    if (!armedNewly) {
      throw new Error(
        `useIntegrationTest: GemStone reports commits were already disabled on this fresh session, so the "no commits allowed" guard is not this harness's doing. This is an unexpected environment, and the harness refuses to run under a guard it did not arm. Usual causes: this user's UserProfile has "disableCommits" set, or the stone is mid-restore. Check the stone and the credentials in .env.test (or .env.test.local).`,
      );
    }

    // Arming is a doit, so it caches the Utf8 class oop and leaves oops in the
    // PureExportSet: a session would reach its first test already dirty, and
    // arming would be observable by tests that assert otherwise. Resetting here
    // hands every session over in the state a bare login leaves behind.
    gciLibrary.resetNonTransactionalSessionState(aSession);
  }

  /**
   * Runs `callback`, and if it throws, rewrites the error's message with a
   * banner explaining how to provision a test environment before
   * re-throwing — so a missing `.env.test` fails with actionable guidance
   * instead of an opaque login/library-load error.
   */
  function handleIntegrationTestSetupErrorDuring(callback: () => void) {
    try {
      callback();
    } catch (error) {
      const integrationTestInitializationErrorBanner = `
            -----------------------------------------------------------------------------------------
            Integration test initialization failed.

            A common cause is a missing or misconfigured test environment.

            If you haven't already, try running \`npm run test:server:start\`.
            This installs GemStone (if needed), starts a fresh test stone, and writes \`.env.test\`.

            If the environment is already set up, refer to the original error below for more details.
            -----------------------------------------------------------------------------------------

            `;

      if (error instanceof Error) {
        error.message = integrationTestInitializationErrorBanner + error.message;
        throw error;
      }

      throw new Error(integrationTestInitializationErrorBanner + JSON.stringify(error, null, 2));
    }
  }

  /** Points `GEMSTONE_GLOBAL_DIR` at the suite's test stone for the suite's duration. */
  function configureGemstoneGlobalDir() {
    // Vite only exposes VITE_-prefixed variables to test code. GemStone
    // expects GEMSTONE_GLOBAL_DIR (no prefix), so we copy the VITE_ variant
    // over for the suite's duration and restore the original value afterward.
    originalGemstoneGlobalDir = process.env.GEMSTONE_GLOBAL_DIR;
    process.env.GEMSTONE_GLOBAL_DIR = process.env.VITE_GEMSTONE_GLOBAL_DIR;
  }

  /** Restores `GEMSTONE_GLOBAL_DIR` to whatever it was before this suite ran. */
  function restoreGemstoneGlobalDir() {
    // Restore the original value so subsequent suites — including other
    // useIntegrationTest blocks — don't inherit this suite's GEMSTONE_GLOBAL_DIR.
    if (originalGemstoneGlobalDir === undefined) {
      delete process.env.GEMSTONE_GLOBAL_DIR;
    } else {
      process.env.GEMSTONE_GLOBAL_DIR = originalGemstoneGlobalDir;
    }
  }
}
