import { describe, it, expect, vi } from 'vitest';
import {
  fetchEnhancedInspectorRowOop,
  fetchEnhancedInspectorForwardRowOop,
} from '../queries/getEnhancedInspectorViewSpecs';

type RowOopFn = (
  execute: ReturnType<typeof vi.fn>,
  oop: bigint,
  selector: string,
  nodeId: number,
) => Promise<bigint | null>;

describe.each([
  { name: 'fetchEnhancedInspectorRowOop', fn: fetchEnhancedInspectorRowOop as unknown as RowOopFn },
  {
    name: 'fetchEnhancedInspectorForwardRowOop',
    fn: fetchEnhancedInspectorForwardRowOop as unknown as RowOopFn,
  },
])('$name', ({ fn }) => {
  it('returns a bigint OOP on happy path', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '12345');
    expect(await fn(execute, 1000n, 'gtItemsFor:', 5)).toBe(12345n);
  });

  it('returns null when Smalltalk error handler returns empty string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '');
    expect(await fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when result is non-numeric — BigInt() throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'not a number');
    expect(await fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #gtItemsFor:');
    expect(await fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => {
      throw new Error('connection lost');
    });
    expect(await fn(execute, 1000n, 'gtItemsFor:', 5)).toBeNull();
  });

  it('returns null when selector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '12345');
    expect(await fn(execute, 1000n, 'bad selector!', 5)).toBeNull();
  });

  it('embeds oop, selector, and nodeId in emitted Smalltalk', async () => {
    expect.assertions(3);
    const execute = vi.fn(async () => '12345');
    await fn(execute, 99999n, 'gtItemsFor:', 7);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('gtItemsFor:');
    expect(code).toContain('7');
  });
});

describe('fetchEnhancedInspectorRowOop drills into the send-block result', () => {
  it('resolves the row to its sent item, not the raw list node', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '338');
    await fetchEnhancedInspectorRowOop(execute, 1000n, 'gtRawFor:', 3);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('retrieveSentItemAt: 3');
    expect(code).not.toContain('targetObject');
  });
});
