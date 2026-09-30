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
  it('parses newline-separated names', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'Globals\nUserGlobals\n');
    expect(await getDictionaryNames(execute)).toEqual(['Globals', 'UserGlobals']);
  });

  it('returns [] for empty output', async () => {
    expect(await getDictionaryNames(vi.fn<QueryExecutor>(async () => ''))).toEqual([]);
  });
});

describe('getClassNames', () => {
  it('sorts class names alphabetically', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'Zebra\nApple\nMango\n');
    expect(await getClassNames(execute, 1)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('embeds dictIndex in the Smalltalk code when given a number', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getClassNames(execute, 7);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 7');
  });

  it('uses objectNamed: when given a dictionary name', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'Array\n');
    await getClassNames(execute, 'Globals');
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'Globals'");
  });

  it('escapes single quotes in dictionary names', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getClassNames(execute, "it's");
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'it''s'");
  });

  it('returns [] for unknown dictionary names (Smalltalk returns empty)', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    expect(await getClassNames(execute, 'NoSuchDict')).toEqual([]);
  });
});

describe('getDictionaryClassFileOutOrder', () => {
  it('orders shallower classes before deeper ones', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '2\tAnimal\n3\tDog\n1\tObject\n');
    expect(await getDictionaryClassFileOutOrder(execute, 1)).toEqual(['Object', 'Animal', 'Dog']);
  });

  it('breaks depth ties alphabetically', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '2\tZebra\n2\tApple\n2\tMango\n');
    expect(await getDictionaryClassFileOutOrder(execute, 1)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('walks the superclass chain to compute depth', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getDictionaryClassFileOutOrder(execute, 1);
    expect(execute.mock.calls[0][0]).toContain('sc := sc superclass');
  });

  it('embeds dictIndex in the Smalltalk code when given a number', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getDictionaryClassFileOutOrder(execute, 7);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 7');
  });

  it('uses objectNamed: when given a dictionary name', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getDictionaryClassFileOutOrder(execute, 'Globals');
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'Globals'");
  });

  it('returns [] for an unknown dictionary', async () => {
    expect(
      await getDictionaryClassFileOutOrder(
        vi.fn<QueryExecutor>(async () => ''),
        'NoSuchDict',
      ),
    ).toEqual([]);
  });
});

describe('getMethodCategories', () => {
  it('uses "<class>" receiver for instance side', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'accessing\nprinting\n');
    expect(await getMethodCategories(execute, 'Array', false)).toEqual(['accessing', 'printing']);
    expect(execute.mock.calls[0][0]).toContain('Array categoryNames');
  });

  it('uses "<class> class" receiver for class side', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getMethodCategories(execute, 'Array', true);
    expect(execute.mock.calls[0][0]).toContain('Array class categoryNames');
  });
});

describe('getInstVarNames', () => {
  it('parses allInstVarNames output, resolving the class through the symbol list', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'name\nsize\n');
    expect(await getInstVarNames(execute, 'Foo')).toEqual(['name', 'size']);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('allInstVarNames');
    expect(code).toContain("objectNamed: #'Foo'"); // dict-scoped/escaped lookup, not a bareword
  });

  it('scopes the lookup to a given SymbolList index', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getInstVarNames(execute, 'Foo', 3);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 3');
  });
});

describe('getAllSelectors', () => {
  it('parses allSelectors sorted output', async () => {
    const execute = vi.fn<QueryExecutor>(async () => 'at:\nsize\n');
    expect(await getAllSelectors(execute, 'Foo')).toEqual(['at:', 'size']);
    expect(execute.mock.calls[0][0]).toContain('Foo allSelectors asSortedCollection');
  });
});

describe('getSourceOffsets', () => {
  it('parses integer offsets from lines', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '1\n5\n12\n');
    expect(await getSourceOffsets(execute, 'Array', false, 'size')).toEqual([1, 5, 12]);
  });

  it('passes environmentId to compiledMethodAt:', async () => {
    const execute = vi.fn<QueryExecutor>(async () => '');
    await getSourceOffsets(execute, 'Array', false, 'size', 2);
    expect(execute.mock.calls[0][0]).toContain('environmentId: 2');
  });
});
