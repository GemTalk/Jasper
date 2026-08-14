import { describe, it, expect, vi } from 'vitest';

import { getAllClassCategories } from '../getAllClassCategories';

describe('getAllClassCategories', () => {
  it('parses dictIndex / dictName / category rows', () => {
    const exec = vi.fn(
      () => '1\tGlobals\tKernel-Objects\n1\tGlobals\tKernel-Numbers\n5\tUserGlobals\tMyApp\n',
    );

    expect(getAllClassCategories(exec)).toEqual([
      { dictIndex: 1, dictName: 'Globals', category: 'Kernel-Objects' },
      { dictIndex: 1, dictName: 'Globals', category: 'Kernel-Numbers' },
      { dictIndex: 5, dictName: 'UserGlobals', category: 'MyApp' },
    ]);
  });

  it('dedupes distinct (dict, category) pairs on the server and buckets the unclassified', () => {
    const exec = vi.fn((_code: string) => '');

    getAllClassCategories(exec);

    const code = exec.mock.calls[0][0];
    expect(code).toContain('seen := Set new');
    expect(code).toContain('as yet unclassified');
  });
});
