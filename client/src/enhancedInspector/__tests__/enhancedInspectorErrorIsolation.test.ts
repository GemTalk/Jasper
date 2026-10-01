import { describe, it, expect, vi } from 'vitest';
import { fetchObjectMeta } from '../queries/getEnhancedInspectorViewSpecs';

// enhancedInspectorExecute is private — tested here through fetchObjectMeta (simplest exported
// function with no selector validation to interfere with error path coverage).

describe('enhancedInspectorExecute error isolation', () => {
  it('wraps user code in AbstractException handler before sending to GemStone', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '{}');
    await fetchObjectMeta(execute, 1000n);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('on: AbstractException do:');
    expect(code).toContain("'EIError:'");
  });

  it('returns null for "EIError:" with no message', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:');
    expect(await fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('returns null for "EIError:" with a message', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:something went wrong');
    expect(await fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('passes through an empty string result — not treated as null', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '');
    expect(await fetchObjectMeta(execute, 1000n)).toBe('');
  });

  it('returns null when execute throws a JavaScript error', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('GCI connection lost');
    });
    expect(await fetchObjectMeta(execute, 1000n)).toBeNull();
  });
});
