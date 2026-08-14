import { describe, it, expect, vi } from 'vitest';

import { getAllGlobalNames } from '../getAllGlobalNames';

describe('getAllGlobalNames', () => {
  it('parses dictIndex / dictName / name / value-class from the tab-separated rows', () => {
    const exec = vi.fn(
      () =>
        '1\tGlobals\tTranscript\tGsTerminalStream\n1\tGlobals\tAllUsers\tUserProfileSet\n5\tUserGlobals\tMyGlobal\tArray\n',
    );

    const globals = getAllGlobalNames(exec);

    expect(globals).toEqual([
      { dictIndex: 1, dictName: 'Globals', name: 'Transcript', className: 'GsTerminalStream' },
      { dictIndex: 1, dictName: 'Globals', name: 'AllUsers', className: 'UserProfileSet' },
      { dictIndex: 5, dictName: 'UserGlobals', name: 'MyGlobal', className: 'Array' },
    ]);
  });

  it('scans the whole symbol list for non-class values', () => {
    const exec = vi.fn((_code: string) => '');

    getAllGlobalNames(exec);

    const code = exec.mock.calls[0][0];
    expect(code).toContain('symbolList');
    expect(code).toContain('isBehavior ifFalse:');
  });

  it('returns nothing for an empty image slice', () => {
    expect(getAllGlobalNames(vi.fn(() => ''))).toEqual([]);
  });
});
