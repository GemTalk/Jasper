import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import { getDictionaryNames } from '../getDictionaryNames';
import { getClassNames } from '../getClassNames';
import { getDictionaryClassFileOutOrder } from '../getDictionaryClassFileOutOrder';
import { getMethodCategories } from '../getMethodCategories';
import { getInstVarNames } from '../getInstVarNames';
import { getAllSelectors } from '../getAllSelectors';
import { getSourceOffsets } from '../getSourceOffsets';

describe('getDictionaryNames', () => {
  it('parses newline-separated names', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Globals\nUserGlobals\n');
    expect(getDictionaryNames(execute)).toEqual(['Globals', 'UserGlobals']);
  });

  it('returns [] for empty output', () => {
    expect(getDictionaryNames(vi.fn<QueryExecutor>(() => ''))).toEqual([]);
  });
});

describe('getClassNames', () => {
  it('sorts class names alphabetically', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Zebra\nApple\nMango\n');
    expect(getClassNames(execute, 1)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('embeds dictIndex in the Smalltalk code when given a number', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassNames(execute, 7);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 7');
  });

  it('uses objectNamed: when given a dictionary name', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Array\n');
    getClassNames(execute, 'Globals');
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'Globals'");
  });

  it('escapes single quotes in dictionary names', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassNames(execute, "it's");
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'it''s'");
  });

  it('returns [] for unknown dictionary names (Smalltalk returns empty)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    expect(getClassNames(execute, 'NoSuchDict')).toEqual([]);
  });
});

describe('getDictionaryClassFileOutOrder', () => {
  it('orders shallower classes before deeper ones', () => {
    const execute = vi.fn<QueryExecutor>(() => '2\tAnimal\n3\tDog\n1\tObject\n');
    expect(getDictionaryClassFileOutOrder(execute, 1)).toEqual(['Object', 'Animal', 'Dog']);
  });

  it('breaks depth ties alphabetically', () => {
    const execute = vi.fn<QueryExecutor>(() => '2\tZebra\n2\tApple\n2\tMango\n');
    expect(getDictionaryClassFileOutOrder(execute, 1)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('walks the superclass chain to compute depth', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getDictionaryClassFileOutOrder(execute, 1);
    expect(execute.mock.calls[0][0]).toContain('sc := sc superclass');
  });

  it('embeds dictIndex in the Smalltalk code when given a number', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getDictionaryClassFileOutOrder(execute, 7);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 7');
  });

  it('uses objectNamed: when given a dictionary name', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getDictionaryClassFileOutOrder(execute, 'Globals');
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'Globals'");
  });

  it('returns [] for an unknown dictionary', () => {
    expect(
      getDictionaryClassFileOutOrder(
        vi.fn<QueryExecutor>(() => ''),
        'NoSuchDict',
      ),
    ).toEqual([]);
  });
});

describe('getMethodCategories', () => {
  it('uses "<class>" receiver for instance side', () => {
    const execute = vi.fn<QueryExecutor>(() => 'accessing\nprinting\n');
    expect(getMethodCategories(execute, 'Array', false)).toEqual(['accessing', 'printing']);
    expect(execute.mock.calls[0][0]).toContain('Array categoryNames');
  });

  it('uses "<class> class" receiver for class side', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getMethodCategories(execute, 'Array', true);
    expect(execute.mock.calls[0][0]).toContain('Array class categoryNames');
  });
});

describe('getInstVarNames', () => {
  it('parses allInstVarNames output', () => {
    const execute = vi.fn<QueryExecutor>(() => 'name\nsize\n');
    expect(getInstVarNames(execute, 'Foo')).toEqual(['name', 'size']);
    expect(execute.mock.calls[0][0]).toContain('Foo allInstVarNames');
  });
});

describe('getAllSelectors', () => {
  it('parses allSelectors sorted output', () => {
    const execute = vi.fn<QueryExecutor>(() => 'at:\nsize\n');
    expect(getAllSelectors(execute, 'Foo')).toEqual(['at:', 'size']);
    expect(execute.mock.calls[0][0]).toContain('Foo allSelectors asSortedCollection');
  });
});

describe('getSourceOffsets', () => {
  it('parses integer offsets from lines', () => {
    const execute = vi.fn<QueryExecutor>(() => '1\n5\n12\n');
    expect(getSourceOffsets(execute, 'Array', false, 'size')).toEqual([1, 5, 12]);
  });

  it('passes environmentId to compiledMethodAt:', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getSourceOffsets(execute, 'Array', false, 'size', 2);
    expect(execute.mock.calls[0][0]).toContain('environmentId: 2');
  });
});
