// What to say when a commit does not land.
//
// GemStone draws a line Jasper did not: a commit can be REFUSED because another
// session got there first, or it can FAIL with an error. GemBuilder for C 3.7
// spells out how to tell them apart, in the `GciCommit` example itself —
// `GciErr` answering false after a false commit means "commit failed due to
// transaction conflicts":
//
//     if ( ! GciCommit()) {
//       if (GciErr(&errInfo)) { ...error... } else { ...conflict... }
//     }
//
// `GciTsCommit` is the same call ("implemented in client library as message
// send" — gcits.hf), so the same rule reads its result.
import { ReportedGciError, explainGciError } from './gciLibraryError';
import {
  TransactionConflicts,
  conflictReason,
  conflictReport,
  hasConflictDetail,
} from './queries/transactionConflicts';

/**
 * Whether a `GciTsCommit` that answered false was refused over a concurrency
 * conflict rather than having errored.
 *
 * No error number is the signal, exactly as `GciErr` reports it. `err` itself may
 * be an unfilled out-struct — the GCI need not touch it when there is nothing to
 * report — so a missing `number` counts the same as a zero one.
 */
export function isCommitConflict(err: ReportedGciError | undefined): boolean {
  return !err?.number;
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
  return {
    verb: 'refused',
    reason: conflictReason(conflicts),
    details: conflicts && hasConflictDetail(conflicts) ? conflictReport(conflicts) : undefined,
  };
}
