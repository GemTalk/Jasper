import { describe, it, expect, vi } from 'vitest';

import {
  CONFLICT_OBJECT_LIMIT,
  conflictReason,
  conflictReport,
  conflictSummary,
  describeCommitResult,
  hasConflictDetail,
  parseTransactionConflicts,
  transactionConflicts,
} from '../transactionConflicts';

// The shape the doit emits: one record per line, tab-separated, R/K/O/T.
const line = (...fields: string[]) => fields.join('\t');
const raw = (...lines: string[]) => lines.join('\n') + '\n';

const WRITE_WRITE = raw(
  line('R', 'failure'),
  line('K', 'Write-Write', '2'),
  line('O', '12200193', 'SymbolDictionary'),
  line('O', '12200449', 'Account'),
);

describe('parseTransactionConflicts', () => {
  it('reads the commit result and each kind with its objects', () => {
    expect(parseTransactionConflicts(WRITE_WRITE)).toEqual({
      commitResult: 'failure',
      categories: [
        {
          key: 'Write-Write',
          total: 2,
          objects: [
            { oop: '12200193', className: 'SymbolDictionary' },
            { oop: '12200449', className: 'Account' },
          ],
        },
      ],
    });
  });

  it('keeps each kind separate, and attaches objects to the kind above them', () => {
    const parsed = parseTransactionConflicts(
      raw(
        line('R', 'failure'),
        line('K', 'Write-Write', '1'),
        line('O', '1', 'Account'),
        line('K', 'Write-Dependency', '1'),
        line('O', '2', 'IdentitySet'),
      ),
    );
    expect(parsed.categories.map((c) => [c.key, c.objects.map((o) => o.className)])).toEqual([
      ['Write-Write', ['Account']],
      ['Write-Dependency', ['IdentitySet']],
    ]);
  });

  // A conflict on a big indexed collection lists far more objects than the doit
  // sends back, so `total` is the stone's count and is deliberately allowed to
  // exceed the number of rows.
  it('keeps the stone’s total when more objects conflicted than were listed', () => {
    const parsed = parseTransactionConflicts(
      raw(line('R', 'failure'), line('K', 'Write-Write', '400'), line('O', '1', 'Account')),
    );
    expect(parsed.categories[0]).toMatchObject({ total: 400 });
    expect(parsed.categories[0].objects).toHaveLength(1);
  });

  // "If there are no conflicts for the transaction, the returned symbol
  // dictionary has no additional Associations" — a refusal with nothing named.
  it('reads a commit result that came with no conflict keys', () => {
    expect(parseTransactionConflicts(raw(line('R', 'lockFailure')))).toEqual({
      commitResult: 'lockFailure',
      categories: [],
    });
  });

  it('treats a nil commit result as absent', () => {
    expect(parseTransactionConflicts(raw(line('R', 'nil'))).commitResult).toBeUndefined();
  });

  it('survives an empty reply', () => {
    expect(parseTransactionConflicts('')).toEqual({ commitResult: undefined, categories: [] });
  });

  // Table 9.1's #'Synchronized-Commit' is "details of the synchronized commit
  // failure", not an Array, so the doit renders it as text instead.
  it('carries a non-collection value through as text', () => {
    const parsed = parseTransactionConflicts(
      raw(line('R', 'failure'), line('K', 'Synchronized-Commit', '0'), line('T', 'peer timed out')),
    );
    expect(parsed.categories[0]).toEqual({
      key: 'Synchronized-Commit',
      total: 0,
      objects: [],
      text: 'peer timed out',
    });
  });

  it('keeps tabs inside a rendered text value', () => {
    const parsed = parseTransactionConflicts(
      raw(line('K', 'Synchronized-Commit', '0'), line('T', 'a\tb')),
    );
    expect(parsed.categories[0].text).toBe('a\tb');
  });

  // An O or T record with no K before it would otherwise index off the end.
  it('ignores an object record that names no kind', () => {
    expect(parseTransactionConflicts(raw(line('O', '1', 'Account'), line('T', 'x')))).toEqual({
      commitResult: undefined,
      categories: [],
    });
  });

  it('defaults an unreadable count to zero rather than NaN', () => {
    expect(parseTransactionConflicts(raw(line('K', 'Write-Write', 'lots'))).categories[0]).toEqual({
      key: 'Write-Write',
      total: 0,
      objects: [],
    });
  });
});

describe('transactionConflicts', () => {
  it('asks the stone once and parses what comes back', () => {
    const execute = vi.fn((_code: string) => WRITE_WRITE);
    const result = transactionConflicts(execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.categories[0].key).toBe('Write-Write');
  });

  // Not a style point: `printString` on a conflicting object runs application
  // code inside the doit, on the very objects two sessions are fighting over.
  it('sends the conflicting objects nothing but asOop and class name', () => {
    const execute = vi.fn((_code: string) => WRITE_WRITE);
    transactionConflicts(execute);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('each asOop printString');
    expect(code).toContain('each class name asString');
    expect(code).not.toContain('each printString');
  });

  // §9.2: "If you save a reference to the conflict set, be sure to clear this
  // reference to avoid making the conflict set persistent."
  it('drops the doit’s own reference to the conflict set', () => {
    const execute = vi.fn((_code: string) => WRITE_WRITE);
    transactionConflicts(execute);
    expect(execute.mock.calls[0][0]).toContain('conflicts := nil');
  });

  it('caps how many objects the doit sends back', () => {
    const execute = vi.fn((_code: string) => WRITE_WRITE);
    transactionConflicts(execute);
    expect(execute.mock.calls[0][0]).toContain(`shown <= ${CONFLICT_OBJECT_LIMIT}`);
  });
});

describe('describeCommitResult', () => {
  it.each([
    ['failure', 'the commit conflicted with another session'],
    ['lockFailure', 'a lock held by another session blocked the commit'],
    ['retryLimitExceeded', 'the commit used up its retry attempts (GemStone allows 15)'],
  ])('glosses %s', (result, gloss) => {
    expect(describeCommitResult(result)).toBe(gloss);
  });

  it('has no wording for a result GemStone has not documented', () => {
    expect(describeCommitResult('somethingNew')).toBeUndefined();
    expect(describeCommitResult(undefined)).toBeUndefined();
  });
});

describe('conflictSummary', () => {
  it('names each kind and how many objects it covered', () => {
    expect(conflictSummary(parseTransactionConflicts(WRITE_WRITE))).toBe(
      'Write-Write on 2 objects',
    );
  });

  it('says "1 object" rather than "1 objects"', () => {
    expect(conflictSummary(parseTransactionConflicts(raw(line('K', 'Write-Write', '1'))))).toBe(
      'Write-Write on 1 object',
    );
  });

  it('joins several kinds', () => {
    expect(
      conflictSummary(
        parseTransactionConflicts(
          raw(line('K', 'Write-Write', '2'), line('K', 'Write-Dependency', '1')),
        ),
      ),
    ).toBe('Write-Write on 2 objects, Write-Dependency on 1 object');
  });

  it('is empty when the refusal named no kinds', () => {
    expect(conflictSummary(parseTransactionConflicts(raw(line('R', 'failure'))))).toBe('');
  });
});

describe('conflictReason', () => {
  const ADVICE = 'Abort for a fresh view, then try again.';

  it('names what collided, and always says to abort first', () => {
    expect(conflictReason(parseTransactionConflicts(WRITE_WRITE))).toBe(
      `Write-Write on 2 objects. ${ADVICE}`,
    );
  });

  // #failure glosses as "conflicted with another session" — which the kinds
  // beside it already say, in more detail.
  it('does not repeat the generic #failure gloss beside the kinds', () => {
    expect(conflictReason(parseTransactionConflicts(WRITE_WRITE))).not.toContain(
      'conflicted with another session',
    );
  });

  it('leads with the gloss when the result says something the kinds do not', () => {
    expect(
      conflictReason(
        parseTransactionConflicts(raw(line('R', 'lockFailure'), line('K', 'Write-ReadLock', '1'))),
      ),
    ).toBe(
      `a lock held by another session blocked the commit. Write-ReadLock on 1 object. ${ADVICE}`,
    );
  });

  // The conflict set may be unreadable (busy session, a stone that dropped the
  // connection) — the refusal still has to be reported, and still has to say abort.
  it('still words a refusal whose conflict set could not be read', () => {
    expect(conflictReason(undefined)).toBe(
      `another session committed a change this transaction also made. ${ADVICE}`,
    );
  });

  it('falls back to the same sentence when the stone named nothing at all', () => {
    expect(conflictReason({ commitResult: undefined, categories: [] })).toBe(
      `another session committed a change this transaction also made. ${ADVICE}`,
    );
  });
});

describe('hasConflictDetail', () => {
  it('is true once there is a kind or a commit result to show', () => {
    expect(hasConflictDetail(parseTransactionConflicts(WRITE_WRITE))).toBe(true);
    expect(hasConflictDetail(parseTransactionConflicts(raw(line('R', 'failure'))))).toBe(true);
  });

  it('is false when the stone named nothing', () => {
    expect(hasConflictDetail({ commitResult: undefined, categories: [] })).toBe(false);
  });
});

describe('conflictReport', () => {
  it('lists every kind with its objects', () => {
    expect(conflictReport(parseTransactionConflicts(WRITE_WRITE))).toBe(
      [
        'commitResult: failure — the commit conflicted with another session',
        '',
        'Write-Write — 2 objects',
        '  12200193  SymbolDictionary',
        '  12200449  Account',
      ].join('\n'),
    );
  });

  // The OOP is the point of the report: it is what the user takes to the
  // Inspector to see which object the other session wrote.
  it('keeps the OOP beside the class name', () => {
    expect(conflictReport(parseTransactionConflicts(WRITE_WRITE))).toContain('12200449  Account');
  });

  it('says how many objects it did not list', () => {
    const report = conflictReport(
      parseTransactionConflicts(
        raw(line('R', 'failure'), line('K', 'Write-Write', '400'), line('O', '1', 'Account')),
      ),
    );
    expect(report).toContain('… and 399 objects not listed');
  });

  it('does not claim objects were withheld when they were all listed', () => {
    expect(conflictReport(parseTransactionConflicts(WRITE_WRITE))).not.toContain('not listed');
  });

  it('renders a text-valued kind instead of an empty object list', () => {
    const report = conflictReport(
      parseTransactionConflicts(
        raw(line('K', 'Synchronized-Commit', '0'), line('T', 'peer timed out')),
      ),
    );
    expect(report).toContain('Synchronized-Commit — peer timed out');
    expect(report).not.toContain('0 objects');
  });
});
