// What to say when a commit does not land.
//
// GemStone draws a line Jasper did not: a commit can be REFUSED because another
// session got there first, or it can FAIL with an error.
//
// How the refusal arrives depends on which commit call made it. GemBuilder for C
// documents the old `GciCommit` as answering false with NO error set —
// `if (!GciCommit()) { if (GciErr(&errInfo)) {error} else {conflict} }`. The
// thread-safe `GciTsCommit` does not behave that way: on a live 3.7.5 stone a
// conflicting commit comes back as `ERR_TransactionError` (2738, gcierr.ht) with
// the reason `commitConflicts`. Both shapes are treated as refusals here, since
// the matrix spans releases and both are documented or observed behaviour.
//
// The reason is matched rather than the number: 2738 is the whole TransactionError
// family, so the number alone would swallow real errors, and `commitConflicts` is
// a Smalltalk symbol rather than prose — the English around it is free to be
// reworded release to release, which is why the message is only consulted when the
// struct's own `reason` field is empty.
import { ReportedGciError, explainGciError } from './gciLibraryError';
import { TransactionConflicts, describeRefusal } from './queries/transactionConflicts';

/** The reason GemStone gives a TransactionError raised by conflicting commits. */
export const COMMIT_CONFLICTS_REASON = 'commitConflicts';

/**
 * Whether a `GciTsCommit` that answered false was refused over a concurrency
 * conflict rather than having errored.
 *
 * An unfilled out-struct counts as a refusal: the GCI need not touch it when
 * there is nothing to report, so a missing `number` reads the same as a zero one.
 */
export function isCommitConflict(err: ReportedGciError): boolean {
  if (!err.number) return true;
  const reason = err.reason?.trim();
  // The struct's own field wins when it has one; only fall back to the message,
  // which carries the same token inside the stone's sentence about it.
  if (reason) return reason === COMMIT_CONFLICTS_REASON;
  return (err.message ?? '').includes(COMMIT_CONFLICTS_REASON);
}

export interface CommitFailure {
  /** GemStone "refuses" a conflicting commit; anything else is a failure. */
  verb: 'refused' | 'failed';
  /** The sentence after the em dash in the toast. */
  reason: string;
  /** The full conflict set for the output channel, when there was one to read. */
  details?: string;
}

/**
 * How to report a `GciTsCommit` that answered false.
 *
 * `conflicts` is what `System transactionConflicts` answered, or undefined when
 * it could not be read — a refusal is still reported in that case, just without
 * naming what collided. It is never read for an errored commit, where there is
 * no conflict set to read.
 */
export function commitFailureMessage(
  err: ReportedGciError,
  conflicts: TransactionConflicts | undefined,
): CommitFailure {
  if (!isCommitConflict(err)) {
    return { verb: 'failed', reason: explainGciError(err) || `error ${err.number}` };
  }
  return { verb: 'refused', ...describeRefusal(conflicts) };
}
