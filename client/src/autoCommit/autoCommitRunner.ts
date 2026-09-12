/**
 * The committing half of auto-commit (issue #254).
 *
 * Two entry points, and the difference between them is the whole design:
 *
 *  - {@link autoCommitAfterWrite} is called from the write path once a mutation has
 *    landed. On an armed session it commits, there and then.
 *  - {@link runWithAutoCommitDeferred} wraps an operation that is only correct as a
 *    WHOLE — a file-in of many methods, an undo that recompiles several — and holds the
 *    commits back until it finishes, then commits once.
 *
 * The second exists because auto-commit's failure mode is not a slow commit, it is a
 * committed half-operation. Several places in Jasper recover from a partly-applied change
 * by aborting the transaction (the instance-variable refactoring panel offers exactly that
 * button), and a commit landing in the middle of one silently disarms that recovery: the
 * abort then rewinds to a repository that already holds the wreckage. So anything with an
 * all-or-nothing contract runs deferred, and an operation that FAILS inside a deferred
 * region commits nothing at all — the caller's own rollback is left the transaction it
 * expects.
 *
 * A commit needs a live session and nothing else, so this layer takes `ActiveSession`
 * directly rather than going through `SessionManager`. It stays free of `vscode`: the
 * write path in `browserQueries` calls into it on every mutation, and that module has no
 * workbench dependency to spare. Telling the user about a failure is therefore a
 * REGISTERED handler, installed by the extension at activation — see
 * `setAutoCommitFailureHandler` and `autoCommitUi.ts`.
 */
import { ActiveSession } from '../sessionManager';
import { logInfo, logWarning } from '../gciLog';
import {
  clearAutoCommitPending,
  getAutoCommitStatus,
  hasAutoCommitPending,
  isAutoCommitArmed,
  isAutoCommitSuspended,
  markAutoCommitPending,
  resumeAutoCommit,
  setAutoCommitStatus,
  suspendAutoCommit,
} from './autoCommitState';

/** What a write did about auto-commit, for the caller's logging and for tests. */
export type AutoCommitOutcome =
  /** Auto-commit is off or already failed on this session — nothing was attempted. */
  | 'skipped'
  /** A deferred region is open; the commit is owed and will run when it closes. */
  | 'deferred'
  | 'committed'
  | 'failed';

/** How the user is told a commit failed. Installed once, at activation. */
export type AutoCommitFailureHandler = (session: ActiveSession, reason: string) => void;

let failureHandler: AutoCommitFailureHandler | undefined;

/**
 * Install the failure prompt. Left unset in tests and in any context with no workbench,
 * where a failure still flips the status and logs — it just goes unannounced.
 */
export function setAutoCommitFailureHandler(handler: AutoCommitFailureHandler | undefined): void {
  failureHandler = handler;
}

function reportFailure(session: ActiveSession, reason: string): void {
  setAutoCommitStatus(session.id, 'failed');
  logWarning(`[autoCommit] session ${session.id}: commit failed — ${reason}`);
  try {
    failureHandler?.(session, reason);
  } catch {
    /* a prompt that throws must not fail the edit that triggered the commit */
  }
}

/**
 * Commit an armed session now, whatever the suspension state. The one caller that wants
 * this rather than {@link autoCommitAfterWrite} is the deferred wrapper closing its
 * outermost level.
 */
function commitNow(session: ActiveSession): AutoCommitOutcome {
  try {
    const { success, err } = session.gci.GciTsCommit(session.handle);
    if (success) {
      logInfo(`[autoCommit] session ${session.id}: committed`);
      return 'committed';
    }
    reportFailure(session, err.message || `error ${err.number}`);
    return 'failed';
  } catch (e: unknown) {
    reportFailure(session, e instanceof Error ? e.message : String(e));
    return 'failed';
  }
}

/**
 * Commit the session's transaction if auto-commit is armed on it. Called from the write
 * path after a mutation has landed — never before, so a mutation that threw commits
 * nothing.
 *
 * Cheap on the overwhelmingly common path: a session that never armed auto-commit costs
 * one map lookup and no round trip.
 */
export function autoCommitAfterWrite(session: ActiveSession): AutoCommitOutcome {
  if (!isAutoCommitArmed(session.id)) return 'skipped';
  if (isAutoCommitSuspended(session.id)) {
    markAutoCommitPending(session.id);
    return 'deferred';
  }
  return commitNow(session);
}

/**
 * Close one level of deferral: on the outermost one, commit what the region owes.
 *
 * A region that FAILED commits nothing, deliberately. Its caller may be about to abort as
 * a rollback (the instance-variable refactoring panel does exactly that), and a commit on
 * the way out would leave that abort rewinding to a repository that already held the
 * half-applied change.
 */
function settleDeferred(session: ActiveSession, succeeded: boolean): void {
  if (!resumeAutoCommit(session.id)) return;
  const owed = hasAutoCommitPending(session.id);
  clearAutoCommitPending(session.id);
  if (!owed) return;
  if (succeeded && isAutoCommitArmed(session.id)) {
    commitNow(session);
    return;
  }
  if (!succeeded) {
    logWarning(
      `[autoCommit] session ${session.id}: the operation failed, so its changes were ` +
        'left uncommitted for the caller to abort or retry',
    );
  }
}

/**
 * Run an operation that must commit as one unit, or not at all.
 *
 * Every write inside runs without committing; when the outermost call finishes
 * SUCCESSFULLY and something inside actually wrote, one commit follows. A throw commits
 * nothing and leaves the transaction exactly as the operation left it, which is what the
 * caller's own abort-based rollback needs to still work.
 *
 * Nests: an inner region just borrows the outer one's commit.
 */
export async function runWithAutoCommitDeferred<T>(
  session: ActiveSession,
  run: () => T | Promise<T>,
): Promise<T> {
  if (getAutoCommitStatus(session.id) !== 'on') return await run();

  suspendAutoCommit(session.id);
  let succeeded = false;
  try {
    const answer = await run();
    succeeded = true;
    return answer;
  } finally {
    settleDeferred(session, succeeded);
  }
}

/**
 * {@link runWithAutoCommitDeferred} for a SYNCHRONOUS operation.
 *
 * Not a convenience: a file-in compiles its methods through blocking GCI calls in a plain
 * loop, and awaiting the async form around it would let the commit land a tick after the
 * caller had already reported the result. The two nest in either order.
 */
export function runWithAutoCommitDeferredSync<T>(session: ActiveSession, run: () => T): T {
  if (getAutoCommitStatus(session.id) !== 'on') return run();

  suspendAutoCommit(session.id);
  let succeeded = false;
  try {
    const answer = run();
    succeeded = true;
    return answer;
  } finally {
    settleDeferred(session, succeeded);
  }
}
