import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getMethodInstVarAccess } from '../getMethodInstVarAccess';

describe('getMethodInstVarAccess', () => {
  it('parses reader, writer, multi-ivar, and class-side rows', () => {
    const raw =
      '0\tkey\tkey\t\n' + '0\tkey:\t\tkey\n' + '0\t=\tkey,value\t\n' + '1\tnew\t\tcount\n';

    const rows = getMethodInstVarAccess(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Association',
      0,
    );

    expect(rows).toEqual([
      { isMeta: false, selector: 'key', reads: ['key'], writes: [] },
      { isMeta: false, selector: 'key:', reads: [], writes: ['key'] },
      { isMeta: false, selector: '=', reads: ['key', 'value'], writes: [] },
      { isMeta: true, selector: 'new', reads: [], writes: ['count'] },
    ]);
  });

  it('skips blank and malformed lines', () => {
    const raw = '\n0\tkey\tkey\t\nnotenoughtabs\n';

    const rows = getMethodInstVarAccess(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'C',
      0,
    );

    expect(rows).toEqual([{ isMeta: false, selector: 'key', reads: ['key'], writes: [] }]);
  });
});
