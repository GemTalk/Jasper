import { describe, it, expect } from 'vitest';

import { commitFailureMessage, isCommitConflict } from '../commitFailure';
import { GciError } from '../gciLibrary';
import { parseTransactionConflicts } from '../queries/transactionConflicts';

// The GciErrSType koffi fills in. Only `number` and `message` decide anything here.
function gciError(number: number, message = ''): GciError {
  return {
    category: 0n,
    context: 0n,
    exceptionObj: 0n,
    args: [],
    number,
    argCount: 0,
    fatal: 0,
    message,
    reason: '',
  };
}

const WRITE_WRITE = parseTransactionConflicts(
  ['R\tfailure', 'K\tWrite-Write\t2', 'O\t12200193\tSymbolDictionary', 'O\t12200449\tAccount'].join(
    '\n',
  ),
);

// GemBuilder for C 3.7, the GciCommit example: after a commit answers false,
// `GciErr` answering false — no error to report — is the conflict case, and
// anything else is a real error.
describe('isCommitConflict', () => {
  it('reads a commit that left no error as a conflict', () => {
    expect(isCommitConflict(gciError(0))).toBe(true);
  });

  it('reads a commit that left an error as an error', () => {
    expect(isCommitConflict(gciError(2030, 'not inside of a transaction'))).toBe(false);
  });

  // The GCI need not touch the out-struct when it has nothing to report, so the
  // object koffi hands back can be missing `number` entirely.
  it('reads an untouched error struct as a conflict', () => {
    expect(isCommitConflict({} as GciError)).toBe(true);
    expect(isCommitConflict(undefined)).toBe(true);
  });
});

describe('commitFailureMessage, on a commit the stone refused', () => {
  it('calls it refused rather than failed', () => {
    expect(commitFailureMessage(gciError(0), WRITE_WRITE).verb).toBe('refused');
  });

  it('names the conflict and says to abort', () => {
    expect(commitFailureMessage(gciError(0), WRITE_WRITE).reason).toBe(
      'Write-Write on 2 objects. Abort for a fresh view, then try again.',
    );
  });

  it('carries the conflicting objects as details for the output channel', () => {
    const details = commitFailureMessage(gciError(0), WRITE_WRITE).details;
    expect(details).toContain('12200193  SymbolDictionary');
    expect(details).toContain('12200449  Account');
  });

  // The conflict set is a second round trip and can fail on its own (busy
  // session, dropped connection). Losing it must not lose the refusal.
  it('still reports the refusal when the conflict set could not be read', () => {
    const failure = commitFailureMessage(gciError(0), undefined);
    expect(failure.verb).toBe('refused');
    expect(failure.reason).toContain('Abort for a fresh view');
    expect(failure.details).toBeUndefined();
  });

  it('offers no details when the stone named nothing', () => {
    expect(
      commitFailureMessage(gciError(0), { commitResult: undefined, categories: [] }).details,
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
