import { describe, it, expect } from 'vitest';
import { GciLibraryError, explainGciError } from '../gciLibraryError';
import {
  ERR_GEM_AUTO_ABORT,
  ERR_GEM_AUTO_LOST_OT,
  ERR_NOT_IN_TRANSACTION,
} from '../queries/transactionMode';

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
      expect(text).toContain('try it again');
      expect(text).toContain(String(number));
    },
  );

  // What the gem serviced is an abort, and a session outside a transaction can
  // still be holding writes — GemStone allows the write and refuses only the
  // commit. Reassuring that nothing was lost would be reassuring over exactly the
  // work the abort discarded.
  it('does not claim nothing was lost, because the abort discards uncommitted writes', () => {
    const text = explainGciError(gciError(ERR_GEM_AUTO_ABORT, 'a TransactionBacklog occurred'));

    expect(text).toContain('not committed was discarded');
  });

  // 2030 is what a manualBegin session hits on its first save, and the stone's
  // wording states the problem without naming the remedy.
  it('names Begin Transaction when the session is refused for being outside one', () => {
    const text = explainGciError(gciError(ERR_NOT_IN_TRANSACTION, 'not inside of a transaction'));

    expect(text).toContain('not inside of a transaction');
    expect(text).toContain('Begin Transaction');
    expect(text).toContain(String(ERR_NOT_IN_TRANSACTION));
  });

  // Begin is offered only under manualBegin — canBegin hides it under
  // transactionless on purpose — so a hint that named it alone would send a
  // transactionless session after a button that is not on screen.
  it('names the switch a transactionless session needs, not just Begin', () => {
    const text = explainGciError(gciError(ERR_NOT_IN_TRANSACTION, 'not inside of a transaction'));

    expect(text).toContain('Transactionless');
    expect(text).toContain('switch modes');
  });

  it('leaves every other error in the stone’s own words', () => {
    expect(explainGciError(gciError(2318, 'does not understand #foo'))).toBe(
      'does not understand #foo',
    );
  });
});

describe('GciLibraryError', () => {
  it('carries the GemStone error number, so callers need not match on message text', () => {
    const error = GciLibraryError.fromGciError(gciError(2318, 'does not understand #foo'));

    expect(error.number).toBe(2318);
    expect(error.message).toBe('does not understand #foo');
  });

  it('has no number for a failure that did not come from a GCI call', () => {
    expect(GciLibraryError.withMessage('bad argument').number).toBeUndefined();
  });
});
