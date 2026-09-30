import { describe, it, expect, vi } from 'vitest';
import { isKernelClass } from '../queries/isKernelClass';

describe('isKernelClass query', () => {
  it('reports a class bound in Globals as kernel', async () => {
    const execute = vi.fn().mockReturnValue('true\n');

    expect(await isKernelClass(execute, 'Object')).toBe(true);
  });

  it('reports a class not in Globals (user code) as not kernel', async () => {
    const execute = vi.fn().mockReturnValue('false\n');

    expect(await isKernelClass(execute, 'R3DemoAccount')).toBe(false);
  });

  it('keys on Globals membership, not on isModifiable (which is false for user classes too)', async () => {
    const execute = vi.fn().mockReturnValue('false');

    await isKernelClass(execute, 'Foo');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('Globals at:');
    expect(code).not.toContain('isModifiable');
  });
});
