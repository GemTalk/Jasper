import { describe, it, expect } from 'vitest';
import { GciLibraryError, explainGciError } from '../gciLibraryError';
import { ERR_GEM_AUTO_ABORT, ERR_GEM_AUTO_LOST_OT } from '../queries/transactionMode';

function gciError(number: number, message: string) {
  return { number, message } as Parameters<typeof explainGciError>[0];
}

describe('explaining a GCI error', () => {
  // Jasper asks for this one: entering manualBegin arms GemAutoServiceSigAbort so
  // the gem answers the stone's SigAbort itself rather than the session being
  // force-aborted with every cache reinitialized. The price is that the next call
  // reports 3007 — which GemStone words as a TransactionBacklog, reading exactly
  // like the failure it is not.
  it.each([ERR_GEM_AUTO_ABORT, ERR_GEM_AUTO_LOST_OT])(
    'says error %i refreshed the view rather than failing',
    (number) => {
      const text = explainGciError(gciError(number, 'a TransactionBacklog occurred'));

      expect(text).toContain('view of the repository was refreshed');
      expect(text).toContain('Nothing was lost');
      expect(text).toContain('try it again');
      expect(text).toContain(String(number));
    },
  );

  it('leaves every other error in the stone’s own words', () => {
    expect(explainGciError(gciError(2030, 'not inside of a transaction'))).toBe(
      'not inside of a transaction',
    );
  });
});

describe('GciLibraryError', () => {
  it('carries the GemStone error number, so callers need not match on message text', () => {
    const error = GciLibraryError.fromGciError(gciError(2030, 'not inside of a transaction'));

    expect(error.number).toBe(2030);
    expect(error.message).toBe('not inside of a transaction');
  });

  it('has no number for a failure that did not come from a GCI call', () => {
    expect(GciLibraryError.withMessage('bad argument').number).toBeUndefined();
  });
});
