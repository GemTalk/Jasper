import { describe, it, expect, vi } from 'vitest';
import { globalNameInUse } from '../queries/globalNameInUse';

describe('globalNameInUse query', () => {
  it('reports true when the stone says the name is bound', () => {
    const execute = vi.fn().mockReturnValue('true\n');

    expect(globalNameInUse(execute, 'Account')).toBe(true);
  });

  it('reports false when the name is free', () => {
    const execute = vi.fn().mockReturnValue('false');

    expect(globalNameInUse(execute, 'Nope')).toBe(false);
  });

  it('checks the whole symbol list for the name', () => {
    const execute = vi.fn().mockReturnValue('false');

    globalNameInUse(execute, 'Account');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList objectNamed:');
    expect(code).toContain("#'Account'");
  });
});
