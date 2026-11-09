/**
 * The committing half of auto-commit (issue #254): {@link autoCommitAfterWrite} commits a
 * write that has landed, and the deferred forms ({@link holdAutoCommit} and the regions built
 * on it) hold commits back across an operation that is only correct as a whole. Free of
 * `vscode`, so the failure prompt is a registered handler; see docs/explanation/auto-commit.md.
 */
import { ActiveSession } from '../sessionManager';
import { ERR_NOT_IN_TRANSACTION } from '../queries/transactionMode';
import { logInfo, logWarning } from '../gciLog';
import {
  clearAutoCommitPending,
  getAutoCommitStatus,
  hasAutoCommitPending,
  isAutoCommitArmed,
  isAutoCommitSuspended,
  markAutoCommitPending,
  markAutoCommitRegionFailed,
  resumeAutoCommit,
  setAutoCommitStatus,
  suspendAutoCommit,
  takeAutoCommitRegionFailed,
} from './autoCommitState';

/** What a write did about auto-commit. Only tests read it. */
export type AutoCommitOutcome =
  /** Auto-commit is off or already failed on this session — nothing was attempted. */
  | 'skipped'
  /** A deferred region is open; the commit is owed and will run when it closes. */
  | 'deferred'
  | 'committed'
  | 'failed';

/**
 * Why a commit failed. `notInTransaction` (error 2030) means the session left Auto-Begin, so
 * no retry or abort will help and auto-commit turns off rather than going to `failed`.
 * `threw` is a commit that never got an answer: a busy or dead session, not a conflict.
 */
export type AutoCommitFailureKind = 'refused' | 'notInTransaction' | 'threw';

/** How the user is told a commit failed. Installed once, at activation. */
export type AutoCommitFailureHandler = (
  session: ActiveSession,
  reason: string,
  kind: AutoCommitFailureKind,
) => void;

let failureHandler: AutoCommitFailureHandler | undefined;

/** What a landed auto-commit owes the rest of the workbench. Installed once, at activation. */
export type AutoCommitCommittedHandler = (session: ActiveSession) => void;

let committedHandler: AutoCommitCommittedHandler | undefined;

/**
 * Install what runs after each auto-commit lands. A commit moves the session's view, so the
 * caches a manual Commit drops (the ClassOrganizer, GemStone Search's corpora) are stale too.
 */
export function setAutoCommitCommittedHandler(
  handler: AutoCommitCommittedHandler | undefined,
): void {
  committedHandler = handler;
}

/**
 * Install the failure prompt. Left unset in tests and in any context with no workbench,
 * where a failure still flips the status and logs — it just goes unannounced.
 */
export function setAutoCommitFailureHandler(handler: AutoCommitFailureHandler | undefined): void {
  failureHandler = handler;
}

function reportFailure(
  session: ActiveSession,
  reason: string,
  kind: AutoCommitFailureKind = 'refused',
): void {
  setAutoCommitStatus(session.id, kind === 'notInTransaction' ? 'off' : 'failed');
  logWarning(`[autoCommit] session ${session.id}: commit failed — ${reason}`);
  try {
    failureHandler?.(session, reason, kind);
  } catch {
    /* a prompt that throws must not fail the edit that triggered the commit */
  }
}

/**
 * Commit the session's transaction and read the result. Every failure lands here, whether
 * the stone refused the commit or the call itself threw — a dead session throws rather
 * than answering, and both mean the same thing to the user: the work is not saved.
 */
function commitNow(session: ActiveSession, what: string): AutoCommitOutcome {
  try {
    const { success, err } = session.GciTsCommit();
    if (success) {
      logInfo(`[autoCommit] session ${session.id}: committed (${what})`);
      try {
        committedHandler?.(session);
      } catch {
        /* a stale cache must not fail the edit that triggered the commit */
      }
      return 'committed';
    }
    reportFailure(
      session,
      err.message || `error ${err.number}`,
      err.number === ERR_NOT_IN_TRANSACTION ? 'notInTransaction' : 'refused',
    );
    return 'failed';
  } catch (e: unknown) {
    reportFailure(session, e instanceof Error ? e.message : String(e), 'threw');
    return 'failed';
  }
}

/**
 * Commit the session's transaction if auto-commit is armed on it. Called from the write
 * path after a mutation has landed — never before, so a mutation that threw commits
 * nothing.
 *
 * Cheap on the overwhelmingly common path: a session that never armed auto-commit costs
 * one map lookup and no round trip. `what` names the action in the commit's log line.
 */
export function autoCommitAfterWrite(session: ActiveSession, what: string): AutoCommitOutcome {
  if (!isAutoCommitArmed(session.id)) return 'skipped';
  if (isAutoCommitSuspended(session.id)) {
    markAutoCommitPending(session.id);
    return 'deferred';
  }
  return commitNow(session, what);
}

/**
 * Close one level of deferral: on the outermost one, commit what the region owes. Answers
 * whether a FAILED region left owed changes uncommitted.
 *
 * A region that FAILED commits nothing, deliberately: its caller may be about to abort as a
 * rollback, and a commit on the way out would leave that abort rewinding to a repository that
 * already held the half-applied change. An inner failure is remembered, so an outer region
 * that succeeds (a second debugger's run finishing) does not commit it after all.
 */
function settleDeferred(session: ActiveSession, succeeded: boolean, what: string): boolean {
  if (!resumeAutoCommit(session.id)) {
    // An inner level. (Also a session logged out mid-region, which is no longer suspended.)
    if (succeeded || !isAutoCommitSuspended(session.id)) return false;
    markAutoCommitRegionFailed(session.id);
    return hasAutoCommitPending(session.id);
  }
  const ok = !takeAutoCommitRegionFailed(session.id) && succeeded;
  const owed = hasAutoCommitPending(session.id);
  clearAutoCommitPending(session.id);
  if (!owed) return false;
  if (ok && isAutoCommitArmed(session.id)) {
    commitNow(session, what);
    return false;
  }
  if (!ok) {
    logWarning(
      `[autoCommit] session ${session.id}: the ${what} failed, so its changes were ` +
        'left uncommitted for the caller to abort or retry',
    );
  }
  return !ok;
}

/**
 * Hold commits back until the returned function is called, then commit once what was written
 * meanwhile, or nothing if it is called with `false`. Safe to call more than once; answers
 * whether closing as failed left owed changes uncommitted. For a pause that spans events
 * rather than one call, such as a debugger holding a halted run; the region forms below are
 * built on it.
 */
export function holdAutoCommit(
  session: ActiveSession,
  what: string,
): (succeeded: boolean) => boolean {
  if (getAutoCommitStatus(session.id) !== 'on') return () => false;
  suspendAutoCommit(session.id);
  let open = true;
  return (succeeded) => {
    if (!open) return false;
    open = false;
    return settleDeferred(session, succeeded, what);
  };
}

/** The part both region forms share: a hold, closed by whether the answer was accepted. */
function openRegion<T>(session: ActiveSession, what: string, succeeded: (answer: T) => boolean) {
  const release = holdAutoCommit(session, what);
  let ok = false;
  return {
    landed(answer: T): T {
      ok = succeeded(answer);
      return answer;
    },
    close(): void {
      release(ok);
    },
  };
}

/**
 * Run an operation that must commit as one unit, or not at all: one commit when it finishes
 * and `succeeded` accepts its answer, none when it throws or is rejected. Nests: an inner
 * region borrows the outer one's commit, logged under the outer `what`.
 */
export async function runWithAutoCommitDeferred<T>(
  session: ActiveSession,
  what: string,
  run: () => T | Promise<T>,
  succeeded: (answer: T) => boolean = () => true,
): Promise<T> {
  const region = openRegion(session, what, succeeded);
  try {
    return region.landed(await run());
  } finally {
    region.close();
  }
}

/**
 * {@link runWithAutoCommitDeferred} for a synchronous operation, so the commit lands before
 * the caller reports the result rather than a tick after it.
 */
export function runWithAutoCommitDeferredSync<T>(
  session: ActiveSession,
  what: string,
  run: () => T,
  succeeded: (answer: T) => boolean = () => true,
): T {
  const region = openRegion(session, what, succeeded);
  try {
    return region.landed(run());
  } finally {
    region.close();
  }
}

/**
 * {@link runWithAutoCommitDeferredSync} for writes through a raw query executor, which bypass
 * `browserQueries`' `writing` and so never say they wrote: the region owes a commit whenever
 * `run` returns.
 */
export function runRawWritesWithAutoCommit<T>(
  session: ActiveSession,
  what: string,
  run: () => T,
  succeeded: (answer: T) => boolean = () => true,
): T {
  return runWithAutoCommitDeferredSync(
    session,
    what,
    () => {
      const answer = run();
      if (isAutoCommitSuspended(session.id)) markAutoCommitPending(session.id);
      return answer;
    },
    succeeded,
  );
}

/**
 * A commit or abort that succeeded has settled the transaction the auto-commit failure was
 * stuck on, so auto-commit resumes. Called wherever a commit or abort runs outside auto-commit:
 * the Commit and Abort commands, the inst-var panel's Abort, and MCP's commit and abort tools.
 */
export function autoCommitTransactionSettled(sessionId: number): void {
  if (getAutoCommitStatus(sessionId) !== 'failed') return;
  setAutoCommitStatus(sessionId, 'on');
  logInfo(`[autoCommit] session ${sessionId}: transaction settled, auto-commit resumed`);
}
