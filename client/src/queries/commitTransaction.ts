import { QueryExecutor } from './types';
import { describeRefusal, tryTransactionConflicts } from './transactionConflicts';

/**
 * Commit, and say what happened — naming the conflict when the stone refuses.
 *
 * `System commitTransaction` answers false for a refusal rather than raising, so
 * "it failed" was all this could report; the conflict set behind the refusal is a
 * second round trip, taken only on the refusal path so a successful commit still
 * costs one. Outside a transaction it raises `ERR_NOT_IN_TRANSACTION` (2030)
 * instead of answering at all — reachable under manualBegin and transactionless,
 * and left to the caller's error path, which names Begin Transaction.
 */
export function commitTransaction(execute: QueryExecutor): string {
  const answer = execute(
    `System commitTransaction ifTrue: ['committed'] ifFalse: ['refused']`,
  ).trim();
  if (answer === 'committed') return 'Transaction committed';

  // Read before anything else touches the transaction: GemStone clears the
  // conflict set at the start of the next commit, abort or continue.
  const { reason, details } = describeRefusal(tryTransactionConflicts(execute));
  const headline = `Commit refused — ${reason}`;
  return details ? `${headline}\n\n${details}` : headline;
}
