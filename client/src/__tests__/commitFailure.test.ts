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
  [
    'R\tfailure',
    'K\tWrite-Write\t2',
    "O\t12086785\tSymbolDictionary\taSymbolDictionary( name: #'UserGlobals' )",
    'O\t12200449\tAccount\tan Account',
  ].join('\n'),
);

describe('isCommitConflict', () => {
  it.each<[string, GciError | undefined, boolean]>([
    // The shape a live 3.7.5 stone actually sends. This is the case the feature
    // exists for, and the one that used to read as an unexplained failure.
    ['a TransactionError whose reason is commitConflicts', REFUSED, true],
    // 2738 is the whole TransactionError family, so the number alone cannot
    // decide: gating on it would call every TransactionError somebody else's fault.
    [
      'another reason in the same TransactionError family',
      gciError(ERR_TRANSACTION_ERROR, 'commit disallowed', 'commitDisallowed'),
      false,
    ],
    // GemBuilder for C documents the older GciCommit as answering false with no
    // error set at all when the cause is a conflict.
    ['a commit that left no error at all', gciError(0), true],
    // The GCI need not touch the out-struct when it has nothing to report, so the
    // object koffi hands back can be missing `number` entirely.
    ['an untouched error struct', {} as GciError, true],
    ['no error struct at all', undefined, true],
    ['an ordinary error', gciError(2030, 'not inside of a transaction'), false],
    // The harness's own commit guard, and the proof that a populated struct is
    // not treated as a refusal just for being populated.
    [
      'the commit guard’s refusal, where nothing conflicted',
      gciError(2249, 'commits are disabled'),
      false,
    ],
    // Not every release need fill the struct's `reason`, but the message carries
    // the same symbol inside the stone's sentence about it.
    [
      'the reason only in the message',
      gciError(ERR_TRANSACTION_ERROR, `reason:${COMMIT_CONFLICTS_REASON}, commit conflicts`),
      true,
    ],
    // A populated `reason` is the structured answer and settles it, so a message
    // that happens to mention conflicts cannot overrule it.
    [
      'a reason field that disagrees with the message',
      gciError(ERR_TRANSACTION_ERROR, 'mentions commitConflicts in passing', 'someOtherReason'),
      false,
    ],
  ])('reads %s as %s', (_why, err, expected) => {
    expect(isCommitConflict(err)).toBe(expected);
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
    expect(details).toContain('12086785  SymbolDictionary');
    expect(details).toContain('12200449  Account  ');
  });

  // The toast stays one line; what the objects ARE belongs in the channel.
  it('keeps the printStrings out of the toast and in the details', () => {
    const failure = commitFailureMessage(REFUSED, WRITE_WRITE);
    expect(failure.reason).not.toContain('UserGlobals');
    expect(failure.details).toContain("aSymbolDictionary( name: #'UserGlobals' )");
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
