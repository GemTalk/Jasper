import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({ getAllClassNames: vi.fn() }));

import * as queries from '../../browserQueries';
import { ActiveSession } from '../../sessionManager';
import { loadClassPickItems } from '../classPicker';

const session = {} as ActiveSession;

describe('loadClassPickItems', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists classes alphabetically, not in the order the stone answers them', async () => {
    vi.mocked(queries.getAllClassNames).mockReturnValue([
      { dictIndex: 1, dictName: 'SdScanOtherDict', className: 'SdScanTwin2bbc' },
      { dictIndex: 1, dictName: 'SdScanOtherDict', className: 'Apple' },
      { dictIndex: 2, dictName: 'Globals', className: 'Zebra' },
      { dictIndex: 2, dictName: 'Globals', className: 'Mango' },
    ]);

    const items = await loadClassPickItems(session);

    expect(items?.map((i) => i.label)).toEqual(['Apple', 'Mango', 'SdScanTwin2bbc', 'Zebra']);
  });

  it('lists same-named classes by dictionary name, not symbol-list order', async () => {
    vi.mocked(queries.getAllClassNames).mockReturnValue([
      { dictIndex: 1, dictName: 'Published', className: 'Twin' },
      { dictIndex: 3, dictName: 'GsEnhancedInspector', className: 'Twin' },
    ]);

    const items = await loadClassPickItems(session);

    expect(items?.map((i) => [i.label, i.description, i.entry.dictIndex])).toEqual([
      ['Twin', 'GsEnhancedInspector', 3],
      ['Twin', 'Published', 1],
    ]);
  });

  it('answers undefined, without throwing, when the class list fails to load', async () => {
    vi.mocked(queries.getAllClassNames).mockImplementation(() => {
      throw new Error('stone gone');
    });

    expect(await loadClassPickItems(session)).toBeUndefined();
  });
});
