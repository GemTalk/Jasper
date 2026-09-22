import { describe, it, expect } from 'vitest';

import { COMMIT_CONFLICTS_REASON, commitFailureMessage, isCommitConflict } from '../commitFailure';
import { GciError } from '../gciLibrary';
import { parseTransactionConflicts } from '../queries/transactionConflicts';

/** GemStone's whole TransactionError family (`ERR_TransactionError`, gcierr.ht). */
const ERR_TRANSACTION_ERROR = 2738;

// The GciErrSType koffi fills in. Only number, message and reason decide anything here.
function gciError(number: number, message = '', reason = ''): GciError {
  return {
    category: 0n,
    context: 0n,
    exceptionObj: 0n,
    args: [],
    number,
    argCount: 0,
    fatal: 0,
    message,
    reason,
  };
}

/**
 * What a live 3.7.5 stone hands back when a second session committed first —
 * copied from a real refusal, reason field and all.
 */
const REFUSED = gciError(
  ERR_TRANSACTION_ERROR,
  `a TransactionError occurred (error ${ERR_TRANSACTION_ERROR}), ` +
    `reason:${COMMIT_CONFLICTS_REASON}, commit conflicts`,
  COMMIT_CONFLICTS_REASON,
);

const WRITE_WRITE = parseTransactionConflicts(
  ['R\tfailure', 'K\tWrite-Write\t2', 'O\t12200193\tSymbolDictionary', 'O\t12200449\tAccount'].join(
    '\n',
  ),
);

describe('isCommitConflict', () => {
  // The shape a live 3.7.5 stone actually sends. This is the case the feature
  // exists for, and the one that used to read as an unexplained failure.
  it('reads a TransactionError whose reason is commitConflicts as a refusal', () => {
    expect(isCommitConflict(REFUSED)).toBe(true);
  });

  // 2738 is the whole TransactionError family, so the number alone cannot decide:
  // gating on it would call every TransactionError somebody else's fault.
  it('does not read every TransactionError as a refusal', () => {
    expect(
      isCommitConflict(gciError(ERR_TRANSACTION_ERROR, 'commit disallowed', 'commitDisallowed')),
    ).toBe(false);
  });

  // GemBuilder for C documents the older GciCommit as answering false with no
  // error set at all when the cause is a conflict.
  it('reads a commit that left no error as a refusal', () => {
    expect(isCommitConflict(gciError(0))).toBe(true);
  });

  // The GCI need not touch the out-struct when it has nothing to report, so the
  // object koffi hands back can be missing `number` entirely.
  it('reads an untouched error struct as a refusal', () => {
    expect(isCommitConflict({} as GciError)).toBe(true);
    expect(isCommitConflict(undefined)).toBe(true);
  });

  it('reads an ordinary error as an error', () => {
    expect(isCommitConflict(gciError(2030, 'not inside of a transaction'))).toBe(false);
  });

  // The harness's own commit guard, and the proof that a populated struct is not
  // treated as a refusal just for being populated.
  it('reads the commit guard’s refusal as an error, since nothing conflicted', () => {
    expect(isCommitConflict(gciError(2249, 'commits are disabled'))).toBe(false);
  });

  // Not every release need fill the struct's `reason`, but the message carries
  // the same symbol inside the stone's sentence about it.
  it('falls back to the message when the struct carries no reason', () => {
    expect(
      isCommitConflict(
        gciError(ERR_TRANSACTION_ERROR, `reason:${COMMIT_CONFLICTS_REASON}, commit conflicts`),
      ),
    ).toBe(true);
  });

  // A populated `reason` is the structured answer and settles it, so a message
  // that happens to mention conflicts cannot overrule it.
  it('trusts the reason field over the message when both are present', () => {
    expect(
      isCommitConflict(
        gciError(ERR_TRANSACTION_ERROR, 'mentions commitConflicts in passing', 'someOtherReason'),
      ),
    ).toBe(false);
  });
});

describe('commitFailureMessage, on a commit the stone refused', () => {
  it('calls it refused rather than failed', () => {
    expect(commitFailureMessage(REFUSED, WRITE_WRITE).verb).toBe('refused');
  });

  it('names the conflict and says to abort', () => {
    expect(commitFailureMessage(REFUSED, WRITE_WRITE).reason).toBe(
      'Write-Write on 2 objects. Abort for a fresh view, then try again.',
    );
  });

  it('carries the conflicting objects as details for the output channel', () => {
    const details = commitFailureMessage(REFUSED, WRITE_WRITE).details;
    expect(details).toContain('12200193  SymbolDictionary');
    expect(details).toContain('12200449  Account');
  });

  // The conflict set is a second round trip and can fail on its own (busy
  // session, dropped connection). Losing it must not lose the refusal.
  it('still reports the refusal when the conflict set could not be read', () => {
    const failure = commitFailureMessage(REFUSED, undefined);
    expect(failure.verb).toBe('refused');
    expect(failure.reason).toContain('Abort for a fresh view');
    expect(failure.details).toBeUndefined();
  });

  it('offers no details when the stone named nothing', () => {
    expect(
      commitFailureMessage(REFUSED, { commitResult: undefined, categories: [] }).details,
    ).toBeUndefined();
  });
});

describe('commitFailureMessage, on a commit that errored', () => {
  it('calls it failed, and keeps the stone’s own wording', () => {
    const failure = commitFailureMessage(gciError(4051, 'the session is busy'), undefined);
    expect(failure.verb).toBe('failed');
    expect(failure.reason).toBe('the session is busy');
  });

  // explainGciError turns 2030 into a sentence naming Begin Transaction; the
  // conflict path must not swallow that.
  it('keeps the explained wording for an error that has one', () => {
    const failure = commitFailureMessage(gciError(2030, 'not inside of a transaction'), undefined);
    expect(failure.reason).toContain('Begin Transaction');
  });

  it('falls back to the error number when the stone sent no message', () => {
    expect(commitFailureMessage(gciError(1234), undefined).reason).toBe('error 1234');
  });

  // A conflict set belongs to a refusal. An errored commit is handed none, and
  // must not grow a details block by accident.
  it('has no details block', () => {
    expect(commitFailureMessage(gciError(4051, 'busy'), WRITE_WRITE).details).toBeUndefined();
  });
});
