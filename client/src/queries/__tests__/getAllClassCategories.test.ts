import { describe, it, expect, vi } from 'vitest';

import { getAllClassCategories } from '../getAllClassCategories';

describe('getAllClassCategories', () => {
  it('parses dictIndex / dictName / category rows', async () => {
    const exec = vi.fn(
      async () => '1\tGlobals\tKernel-Objects\n1\tGlobals\tKernel-Numbers\n5\tUserGlobals\tMyApp\n',
    );

    expect(await getAllClassCategories(exec)).toEqual([
      { dictIndex: 1, dictName: 'Globals', category: 'Kernel-Objects' },
      { dictIndex: 1, dictName: 'Globals', category: 'Kernel-Numbers' },
      { dictIndex: 5, dictName: 'UserGlobals', category: 'MyApp' },
    ]);
  });

  it('dedupes distinct (dict, category) pairs on the server and buckets the unclassified', async () => {
    const exec = vi.fn(async (_code: string) => '');

    await getAllClassCategories(exec);

    const code = exec.mock.calls[0][0];
    expect(code).toContain('seen := Set new');
    expect(code).toContain('as yet unclassified');
  });
});
