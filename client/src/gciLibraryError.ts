import { GciError } from './gciLibrary';
import {
  ERR_GEM_AUTO_ABORT,
  ERR_GEM_AUTO_LOST_OT,
  ERR_NOT_IN_TRANSACTION,
} from './queries/transactionMode';

/**
 * Rewrite the stone's wording for the two errors that are not failures, and for
 * the one whose cause the mode feature made common.
 *
 * 3007 / 3008 are reported on the first GCI call after the gem serviced a
 * SigAbort (or a LostOt) on the session's behalf — something Jasper deliberately
 * asks for when a session enters `manualBegin`, so an idle session outside a
 * transaction is not force-aborted by the stone with every cache reinitialized.
 * The call that reports one did not run, and the session's view moved forward to
 * the newest committed state. GemStone's own text ("a TransactionBacklog
 * occurred") reads as a failure, which is exactly what it is not.
 *
 * What it does NOT say is "nothing was lost". What the gem serviced is an abort,
 * and a session outside a transaction can still be holding writes — GemStone
 * allows them, it is only the commit it refuses (see `canCommit`). Those writes
 * are discarded, so the message says so rather than reassuring over them.
 *
 * 2030 is the other way round: an ordinary refusal whose wording ("not inside of
 * a transaction") states the problem and not the remedy. It is the failure a
 * `manualBegin` session hits on its first save, so the remedy is named.
 *
 * Returns the stone's message unchanged for everything else.
 */
export function explainGciError(gciError: GciError): string {
  if (gciError.number === ERR_GEM_AUTO_ABORT || gciError.number === ERR_GEM_AUTO_LOST_OT) {
    return (
      `Your view of the repository was refreshed: the stone asked for its commit record back ` +
      `while this session was idle outside a transaction, and the gem answered for you ` +
      `(GemStone error ${gciError.number}). This operation did not run, so try it again. ` +
      `Anything this session had written but not committed was discarded, as an abort always does.`
    );
  }
  if (gciError.number === ERR_NOT_IN_TRANSACTION) {
    return (
      `${gciError.message} (GemStone error ${ERR_NOT_IN_TRANSACTION}). ` +
      `This session's transaction mode leaves it outside a transaction. Begin Transaction ` +
      `starts one — from the session row or the Command Palette in Manual mode; a ` +
      `Transactionless session has to switch modes first, which the status bar does in one click.`
    );
  }
  return gciError.message;
}

/**
 * Thrown by {@link GciLibrary} when it cannot complete an operation.
 *
 * The cause may be a communication failure with GemStone, a failed
 * validation, or any other reason — the underlying GCI implementation is
 * intentionally not exposed. Callers can use `instanceof GciLibraryError` to
 * distinguish these failures from unrelated JavaScript errors.
 */
export class GciLibraryError extends Error {
  /**
   * The GemStone error number, when this came from a GCI call; `undefined` for a
   * failed validation, which has no number of its own. Carried so a caller can
   * recognize a specific error — an auto-serviced SigAbort, say — rather than
   * having to match on message text the stone is free to reword.
   */
  readonly number?: number;

  /**
   * Builds a {@link GciLibraryError} from a GCI error struct, carrying its number
   * and its message as {@link explainGciError} words it — which is the stone's own
   * text for all but the handful of errors that read as something they are not.
   */
  static fromGciError(gciError: GciError) {
    return new GciLibraryError(explainGciError(gciError), gciError.number);
  }

  /** Builds a {@link GciLibraryError} with a plain message, for failures that don't originate from a GCI call (e.g. a failed validation). */
  static withMessage(message: string) {
    return new GciLibraryError(message);
  }

  private constructor(message: string, number?: number) {
    super(message);
    this.number = number;
  }
}
