import { describe, it, expect, vi } from 'vitest';
import { getClassHistory, revertClassToVersion, removeClassVersion } from '../queries/classHistory';

describe('classHistory queries', () => {
  it('builds a read-only history query for a class', async () => {
    const execute = vi.fn().mockReturnValue('[]');

    await getClassHistory(execute, 'Account');

    expect(execute.mock.calls[0][0]).toContain("GsClassHistory forClassNamed: 'Account'");
  });

  it('builds a revert-to-version query', async () => {
    const execute = vi.fn().mockReturnValue('{}');

    await revertClassToVersion(execute, 'Account', 2);

    expect(execute.mock.calls[0][0]).toContain("revertClassNamed: 'Account' toIndex: 2");
  });

  it('builds a remove-version query', async () => {
    const execute = vi.fn().mockReturnValue('{}');

    await removeClassVersion(execute, 'Account', 1);

    expect(execute.mock.calls[0][0]).toContain("removeVersionOf: 'Account' index: 1");
  });
});
