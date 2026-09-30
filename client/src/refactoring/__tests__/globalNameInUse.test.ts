import { describe, it, expect, vi } from 'vitest';
import { globalNameInUse } from '../queries/globalNameInUse';

describe('globalNameInUse query', () => {
  it('reports true when the stone says the name is bound', async () => {
    const execute = vi.fn().mockReturnValue('true\n');

    expect(await globalNameInUse(execute, 'Account')).toBe(true);
  });

  it('reports false when the name is free', async () => {
    const execute = vi.fn().mockReturnValue('false');

    expect(await globalNameInUse(execute, 'Nope')).toBe(false);
  });

  it('checks the whole symbol list for the name', async () => {
    const execute = vi.fn().mockReturnValue('false');

    await globalNameInUse(execute, 'Account');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList objectNamed:');
    expect(code).toContain("#'Account'");
  });
});
