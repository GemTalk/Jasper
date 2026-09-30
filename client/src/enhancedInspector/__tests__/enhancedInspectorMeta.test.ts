import { describe, it, expect, vi } from 'vitest';
import {
  fetchObjectMeta,
  fetchMethodBrowseLocation,
  fetchMethodSource,
} from '../queries/getEnhancedInspectorViewSpecs';

describe('fetchObjectMeta', () => {
  it('returns the JSON string on happy path', async () => {
    expect.assertions(1);
    const json =
      '{"className":"Array","superclassName":"SequenceableCollection","category":"Collections","comment":"","definition":"...","methodSelectors":[],"classMethodSelectors":[]}';
    const execute = vi.fn(async () => json);
    expect(await fetchObjectMeta(execute, 1000n)).toBe(json);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:object not found');
    expect(await fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(await fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('embeds oop in emitted Smalltalk', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '{}');
    await fetchObjectMeta(execute, 99999n);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
  });
});

describe('fetchMethodBrowseLocation', () => {
  it('returns parsed { dictName, className, category } on happy path', async () => {
    expect.assertions(3);
    const json = '{"dictName":"Globals","className":"Array","category":"accessing"}';
    const execute = vi.fn(async () => json);
    const result = await fetchMethodBrowseLocation(execute, 1000n, 'size', false);
    expect(result?.dictName).toBe('Globals');
    expect(result?.className).toBe('Array');
    expect(result?.category).toBe('accessing');
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #size');
    expect(await fetchMethodBrowseLocation(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(await fetchMethodBrowseLocation(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when methodSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => '{}');
    expect(await fetchMethodBrowseLocation(execute, 1000n, 'bad selector!', false)).toBeNull();
  });

  it('returns null when JSON is malformed', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'not valid json {{{');
    expect(await fetchMethodBrowseLocation(execute, 1000n, 'size', false)).toBeNull();
  });

  it.each([
    { isClassSide: false, expected: 'baseCls categoryOfSelector:' },
    { isClassSide: true, expected: 'baseCls class categoryOfSelector:' },
  ])(
    'isClassSide $isClassSide — Smalltalk contains "$expected"',
    async ({ isClassSide, expected }) => {
      expect.assertions(1);
      const execute = vi.fn(async () => '{}');
      await fetchMethodBrowseLocation(execute, 1000n, 'size', isClassSide);
      const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(code).toContain(expected);
    },
  );

  it('embeds oop and methodSelector in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '{}');
    await fetchMethodBrowseLocation(execute, 99999n, 'size', false);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('size');
  });

  /**
   * The owning dictionary comes from the shared symbol-list rule — the slot that
   * binds the class object under its own name — not from
   * `dictionariesAndSymbolsOf:`, which answers alias bindings too (so its first
   * pair can name a dictionary that merely references the class) and whose
   * `first first` raises when nothing binds it at all.
   */
  it('resolves the dictionary through the shared symbol-list rule', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => '{}');
    await fetchMethodBrowseLocation(execute, 1000n, 'size', false);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('baseCls name asSymbol ifAbsent: [nil]) == baseCls');
    expect(code).not.toContain('dictionariesAndSymbolsOf:');
  });
});

describe('fetchMethodSource', () => {
  it('returns the source string on happy path', async () => {
    expect.assertions(1);
    const source = 'size\n  ^ self basicSize';
    const execute = vi.fn(async () => source);
    expect(await fetchMethodSource(execute, 1000n, 'size', false)).toBe(source);
  });

  it('returns null when execute returns a EIError string', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'EIError:does not understand #size');
    expect(await fetchMethodSource(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when execute throws', async () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(await fetchMethodSource(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when methodSelector is invalid', async () => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'some source');
    expect(await fetchMethodSource(execute, 1000n, 'bad selector!', false)).toBeNull();
  });

  it.each([
    { isClassSide: false, expected: 'theNonMetaClass sourceCodeAt:' },
    { isClassSide: true, expected: 'theNonMetaClass class sourceCodeAt:' },
  ])('isClassSide $isClassSide — recv contains "$expected"', async ({ isClassSide, expected }) => {
    expect.assertions(1);
    const execute = vi.fn(async () => 'source');
    await fetchMethodSource(execute, 1000n, 'size', isClassSide);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain(expected);
  });

  it('embeds oop and methodSelector in emitted Smalltalk', async () => {
    expect.assertions(2);
    const execute = vi.fn(async () => 'source');
    await fetchMethodSource(execute, 99999n, 'size', false);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('size');
  });
});
