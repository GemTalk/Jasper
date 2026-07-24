import { describe, it, expect, vi } from 'vitest';
import { isKernelClass } from '../queries/isKernelClass';

describe('isKernelClass query', () => {
  it('reports a class bound in Globals as kernel', () => {
    const execute = vi.fn().mockReturnValue('true\n');

    expect(isKernelClass(execute, 'Object')).toBe(true);
  });

  it('reports a class not in Globals (user code) as not kernel', () => {
    const execute = vi.fn().mockReturnValue('false\n');

    expect(isKernelClass(execute, 'R3DemoAccount')).toBe(false);
  });

  it('keys on Globals membership, not on isModifiable (which is false for user classes too)', () => {
    const execute = vi.fn().mockReturnValue('false');

    isKernelClass(execute, 'Foo');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('Globals at:');
    expect(code).not.toContain('isModifiable');
  });
});
