import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  canBegin,
  canCommit,
  getGemAutoServiceSigAbort,
  getTransactionMode,
  getTransactionState,
  isInTransaction,
  isTransactionMode,
  modeDescription,
  modeLabel,
  setGemAutoServiceSigAbort,
  setTransactionMode,
  shouldPromptOnLogout,
  transactionStateLabel,
  TRANSACTION_MODES,
  VIEW_REFRESH_CODE,
} from '../transactionMode';

describe('reading the transaction mode', () => {
  it('answers the mode the stone reports', () => {
    const execute = vi.fn<QueryExecutor>(() => 'manualBegin\n');

    expect(getTransactionMode(execute)).toBe('manualBegin');
    // asString, not printString: the latter answers #'manualBegin', quotes and all.
    expect(execute.mock.calls[0][0]).toContain('System transactionMode asString');
  });

  it('answers undefined for a mode it does not recognize, rather than passing it on', () => {
    const execute = vi.fn<QueryExecutor>(() => 'someFutureMode');

    expect(getTransactionMode(execute)).toBeUndefined();
  });

  it('recognizes exactly the three modes GemStone defines', () => {
    expect([...TRANSACTION_MODES]).toEqual(['autoBegin', 'manualBegin', 'transactionless']);
    expect(isTransactionMode('autoBegin')).toBe(true);
    expect(isTransactionMode('manual')).toBe(false);
  });
});

describe('reading whether the session is in a transaction', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('reads %s as %s', (answer, expected) => {
    expect(isInTransaction(vi.fn<QueryExecutor>(() => answer))).toBe(expected);
  });

  it('answers undefined when the stone says something else', () => {
    expect(isInTransaction(vi.fn<QueryExecutor>(() => 'nil'))).toBeUndefined();
  });
});

describe('reading mode and transaction state together', () => {
  it('takes both from one round trip', () => {
    const execute = vi.fn<QueryExecutor>(() => 'manualBegin false\n');

    expect(getTransactionState(execute)).toEqual({
      mode: 'manualBegin',
      inTransaction: false,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('leaves each half undefined on its own when the stone answers oddly', () => {
    expect(getTransactionState(vi.fn<QueryExecutor>(() => 'manualBegin nil'))).toEqual({
      mode: 'manualBegin',
      inTransaction: undefined,
    });
    expect(getTransactionState(vi.fn<QueryExecutor>(() => 'somethingElse true'))).toEqual({
      mode: undefined,
      inTransaction: true,
    });
  });

  it('survives an empty answer without throwing', () => {
    expect(getTransactionState(vi.fn<QueryExecutor>(() => ''))).toEqual({
      mode: undefined,
      inTransaction: undefined,
    });
  });
});

describe('switching the transaction mode', () => {
  it('asks for the mode and answers what the stone reports afterwards', () => {
    const execute = vi.fn<QueryExecutor>(() => 'transactionless');

    expect(setTransactionMode(execute, 'transactionless')).toBe('transactionless');
    expect(execute.mock.calls[0][0]).toContain('System transactionMode: #transactionless');
  });

  it('answers undefined when the switch did not land, so no caller caches a mode that was never reached', () => {
    // The stone still reports the old mode — the switch silently did not take.
    const execute = vi.fn<QueryExecutor>(() => 'notAMode');

    expect(setTransactionMode(execute, 'manualBegin')).toBeUndefined();
  });
});

describe('the gem’s own SigAbort servicing', () => {
  it('arms it', () => {
    const execute = vi.fn<QueryExecutor>(() => 'GemAutoServiceSigAbort set');

    setGemAutoServiceSigAbort(execute, true);

    expect(execute.mock.calls[0][0]).toContain(
      'System gemConfigurationAt: #GemAutoServiceSigAbort put: true',
    );
  });

  it('reads it back', () => {
    expect(getGemAutoServiceSigAbort(vi.fn<QueryExecutor>(() => 'true'))).toBe(true);
    expect(getGemAutoServiceSigAbort(vi.fn<QueryExecutor>(() => 'false'))).toBe(false);
    expect(getGemAutoServiceSigAbort(vi.fn<QueryExecutor>(() => 'nil'))).toBeUndefined();
  });
});

describe('the view-refresh guard', () => {
  it('skips the abort while the session holds uncommitted changes', () => {
    expect(VIEW_REFRESH_CODE).toContain('System needsCommit');
    expect(VIEW_REFRESH_CODE).toContain('skipped: uncommitted changes present');
  });

  it('also skips it inside a manual transaction, which the abort would end', () => {
    // Under autoBegin the abort immediately opens a fresh transaction, so only
    // manualBegin can lose one this way.
    expect(VIEW_REFRESH_CODE).toContain(
      'System transactionMode == #manualBegin and: [System inTransaction]',
    );
    expect(VIEW_REFRESH_CODE).toContain('skipped: session is inside a manual transaction');
  });

  it('aborts to refresh when neither applies', () => {
    expect(VIEW_REFRESH_CODE).toContain("System abortTransaction. 'refreshed'");
  });
});

describe('what the session can do', () => {
  // The stone raises 2030 from commitTransaction exactly when the session is not
  // in a transaction, in every mode — so that, and not the mode, is the rule.
  it('enables Commit whenever the session is in a transaction', () => {
    expect(canCommit(true)).toBe(true);
  });

  it('disables Commit outside a transaction', () => {
    expect(canCommit(false)).toBe(false);
  });

  it('leaves Commit enabled when the transaction state could not be read', () => {
    expect(canCommit(undefined)).toBe(true);
  });

  it('offers Begin only in manual mode, outside a transaction', () => {
    expect(canBegin('manualBegin', false)).toBe(true);
    expect(canBegin('manualBegin', true)).toBe(false);
    expect(canBegin('autoBegin', false)).toBe(false);
    expect(canBegin('autoBegin', true)).toBe(false);
    // A begin does work under transactionless, but the mode exists to pin no
    // commit record; entering a transaction under it is not something to invite.
    expect(canBegin('transactionless', false)).toBe(false);
    expect(canBegin('transactionless', true)).toBe(false);
  });

  it('does not offer Begin on an unknown mode or unknown transaction state', () => {
    expect(canBegin(undefined, false)).toBe(false);
    expect(canBegin('manualBegin', undefined)).toBe(false);
  });

  it('prompts on logout only where a commit could have landed', () => {
    expect(shouldPromptOnLogout(true)).toBe(true);
    expect(shouldPromptOnLogout(false)).toBe(false);
    expect(shouldPromptOnLogout(undefined)).toBe(true);
  });
});

describe('how the state reads', () => {
  it('spells out the in-transaction half only where it varies', () => {
    expect(transactionStateLabel('autoBegin', true)).toBe('Auto-Begin');
    expect(transactionStateLabel('manualBegin', true)).toBe('Manual · in transaction');
    expect(transactionStateLabel('manualBegin', false)).toBe('Manual · not in transaction');
    expect(transactionStateLabel('transactionless', false)).toBe('Transactionless');
  });

  it('falls back to the bare mode when the transaction state is unknown', () => {
    expect(transactionStateLabel('manualBegin', undefined)).toBe('Manual');
  });

  it('names a transactionless session that has been walked into a transaction', () => {
    // Not what the mode implies, and it changes what Commit does — so it is said.
    expect(transactionStateLabel('transactionless', true)).toBe('Transactionless · in transaction');
  });

  it('says so plainly when the mode could not be read', () => {
    expect(modeLabel(undefined)).toBe('Unknown');
    expect(transactionStateLabel(undefined, undefined)).toBe('Unknown');
    expect(modeDescription(undefined)).toContain('could not be read');
  });

  it('describes every mode it offers', () => {
    for (const mode of TRANSACTION_MODES) {
      expect(modeLabel(mode)).not.toBe('Unknown');
      expect(modeDescription(mode).length).toBeGreaterThan(0);
    }
  });
});
