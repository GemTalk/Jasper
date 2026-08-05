import { describe, it, expect, vi } from 'vitest';
import {
  fetchObjectMeta,
  fetchMethodBrowseLocation,
  fetchMethodSource,
} from '../queries/getEnhancedInspectorViewSpecs';

describe('fetchObjectMeta', () => {
  it('returns the JSON string on happy path', () => {
    expect.assertions(1);
    const json =
      '{"className":"Array","superclassName":"SequenceableCollection","category":"Collections","comment":"","definition":"...","methodSelectors":[],"classMethodSelectors":[]}';
    const execute = vi.fn(() => json);
    expect(fetchObjectMeta(execute, 1000n)).toBe(json);
  });

  it('returns null when execute returns a EIError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'EIError:object not found');
    expect(fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(fetchObjectMeta(execute, 1000n)).toBeNull();
  });

  it('embeds oop in emitted Smalltalk', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '{}');
    fetchObjectMeta(execute, 99999n);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
  });
});

describe('fetchMethodBrowseLocation', () => {
  it('returns parsed { dictName, className, category } on happy path', () => {
    expect.assertions(3);
    const json = '{"dictName":"Globals","className":"Array","category":"accessing"}';
    const execute = vi.fn(() => json);
    const result = fetchMethodBrowseLocation(execute, 1000n, 'size', false);
    expect(result?.dictName).toBe('Globals');
    expect(result?.className).toBe('Array');
    expect(result?.category).toBe('accessing');
  });

  it('returns null when execute returns a EIError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'EIError:does not understand #size');
    expect(fetchMethodBrowseLocation(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(fetchMethodBrowseLocation(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when methodSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => '{}');
    expect(fetchMethodBrowseLocation(execute, 1000n, 'bad selector!', false)).toBeNull();
  });

  it('returns null when JSON is malformed', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'not valid json {{{');
    expect(fetchMethodBrowseLocation(execute, 1000n, 'size', false)).toBeNull();
  });

  it.each([
    { isClassSide: false, expected: 'baseCls categoryOfSelector:' },
    { isClassSide: true, expected: 'baseCls class categoryOfSelector:' },
  ])('isClassSide $isClassSide — Smalltalk contains "$expected"', ({ isClassSide, expected }) => {
    expect.assertions(1);
    const execute = vi.fn(() => '{}');
    fetchMethodBrowseLocation(execute, 1000n, 'size', isClassSide);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain(expected);
  });

  it('embeds oop and methodSelector in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => '{}');
    fetchMethodBrowseLocation(execute, 99999n, 'size', false);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('size');
  });
});

describe('fetchMethodSource', () => {
  it('returns the source string on happy path', () => {
    expect.assertions(1);
    const source = 'size\n  ^ self basicSize';
    const execute = vi.fn(() => source);
    expect(fetchMethodSource(execute, 1000n, 'size', false)).toBe(source);
  });

  it('returns null when execute returns a EIError string', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'EIError:does not understand #size');
    expect(fetchMethodSource(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when execute throws', () => {
    expect.assertions(1);
    const execute = vi.fn(() => {
      throw new Error('connection lost');
    });
    expect(fetchMethodSource(execute, 1000n, 'size', false)).toBeNull();
  });

  it('returns null when methodSelector is invalid', () => {
    expect.assertions(1);
    const execute = vi.fn(() => 'some source');
    expect(fetchMethodSource(execute, 1000n, 'bad selector!', false)).toBeNull();
  });

  it.each([
    { isClassSide: false, expected: 'theNonMetaClass sourceCodeAt:' },
    { isClassSide: true, expected: 'theNonMetaClass class sourceCodeAt:' },
  ])('isClassSide $isClassSide — recv contains "$expected"', ({ isClassSide, expected }) => {
    expect.assertions(1);
    const execute = vi.fn(() => 'source');
    fetchMethodSource(execute, 1000n, 'size', isClassSide);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain(expected);
  });

  it('embeds oop and methodSelector in emitted Smalltalk', () => {
    expect.assertions(2);
    const execute = vi.fn(() => 'source');
    fetchMethodSource(execute, 99999n, 'size', false);
    const code = (execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(code).toContain('99999');
    expect(code).toContain('size');
  });
});
