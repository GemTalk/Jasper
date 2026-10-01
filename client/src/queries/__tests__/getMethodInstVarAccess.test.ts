import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getMethodInstVarAccess } from '../getMethodInstVarAccess';

describe('getMethodInstVarAccess', () => {
  it('parses reader, writer, multi-ivar, and class-side rows', async () => {
    const raw =
      '0\tkey\tkey\t\n' + '0\tkey:\t\tkey\n' + '0\t=\tkey,value\t\n' + '1\tnew\t\tcount\n';

    const rows = await getMethodInstVarAccess(
      vi.fn<QueryExecutor>(async () => raw),
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

  it('skips blank and malformed lines', async () => {
    const raw = '\n0\tkey\tkey\t\nnotenoughtabs\n';

    const rows = await getMethodInstVarAccess(
      vi.fn<QueryExecutor>(async () => raw),
      1,
      'C',
      0,
    );

    expect(rows).toEqual([{ isMeta: false, selector: 'key', reads: ['key'], writes: [] }]);
  });
});
