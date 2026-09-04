import { describe, it, expect, vi } from 'vitest';
import * as bi from '../queries/basicInspectorQueries';

/**
 * The basic inspector's wire format, both halves.
 *
 * The parsers are exported separately from the fetchers so the payload shape can
 * be pinned without a stone; the fetchers are checked here only for the
 * properties that must hold whatever the stone answers — the guards that keep a
 * bad page request off the wire, and the fact that a stone error degrades a tab
 * to empty rather than throwing into the webview. That the doits actually run on
 * an old stone is proven live, in enhancedInspectorRouting.integration.test.ts.
 */

/** A QueryExecutor that answers one canned payload and records what it was sent. */
function executorAnswering(payload: string) {
  return vi.fn((_code: string) => payload);
}

const HEADER = ['Account', 'Object', '3', '0', '0', 'false', 'false', 'an Account', ''].join('\t');

describe('object header', () => {
  it('reads the class, slot counts and format flags of an object', () => {
    const header = bi.parseObjectHeader(HEADER);

    expect(header).toEqual({
      className: 'Account',
      superclassName: 'Object',
      namedSize: 3,
      itemCount: 0,
      entryCount: 0,
      isBytes: false,
      isDictionary: false,
      printString: 'an Account',
      sizeUnit: '',
    });
  });

  it('reads a dictionary as a dictionary, with its entry count', () => {
    const header = bi.parseObjectHeader(
      [
        'SymbolDictionary',
        'AbstractDictionary',
        '2',
        '0',
        '412',
        'false',
        'true',
        'a Sym',
        '',
      ].join('\t'),
    );

    expect(header!.isDictionary).toBe(true);
    expect(header!.entryCount).toBe(412);
  });

  it('reports no object when the stone answers nothing usable', () => {
    expect(bi.parseObjectHeader('')).toBeNull();
    expect(bi.parseObjectHeader('Account\tObject')).toBeNull();
  });

  it('treats an unreadable count as zero rather than a broken tab', () => {
    const header = bi.parseObjectHeader(
      ['Account', 'Object', 'nope', '-4', '', 'false', 'false', 'an Account', ''].join('\t'),
    );

    expect(header!.namedSize).toBe(0);
    expect(header!.itemCount).toBe(0);
    expect(header!.entryCount).toBe(0);
  });

  it('restores a printString that contained tabs and newlines', () => {
    const header = bi.parseObjectHeader(
      ['Account', 'Object', '0', '0', '0', 'false', 'false', 'a\\tb\\nc\\\\d', ''].join('\t'),
    );

    expect(header!.printString).toBe('a\tb\nc\\d');
  });

  it('records what a size counts, for the classes where the count is the point', () => {
    const str = [
      'String',
      'CharacterCollection',
      '0',
      '17',
      '0',
      'true',
      'false',
      "'hi'",
      'characters',
    ];
    const bytes = ['ByteArray', 'Object', '0', '32', '0', 'true', 'false', 'a ByteArray', 'bytes'];

    expect(bi.parseObjectHeader(str.join('\t'))!.sizeUnit).toBe('characters');
    expect(bi.parseObjectHeader(bytes.join('\t'))!.sizeUnit).toBe('bytes');
    expect(bi.parseObjectHeader(HEADER)!.sizeUnit).toBe('');
  });

  it('ignores a size unit it does not know', () => {
    const odd = ['Account', 'Object', '0', '0', '0', 'false', 'false', 'an Account', 'furlongs'];

    expect(bi.parseObjectHeader(odd.join('\t'))!.sizeUnit).toBe('');
  });

  it('degrades to no header when the stone refuses the query', () => {
    const failing = vi.fn(() => {
      throw new Error('stone said no');
    });

    expect(bi.fetchObjectHeader(failing, 100n)).toBeNull();
  });
});

describe('row payloads', () => {
  it('reads a slot row with the class that declares it', () => {
    const rows = bi.parseSlotRows('balance\t42\t1234\tSmallInteger\t2\tAccount\n');

    expect(rows).toEqual([
      {
        label: 'balance',
        value: '42',
        oop: '1234',
        className: 'SmallInteger',
        index: 2,
        definingClass: 'Account',
      },
    ]);
  });

  it('keeps an inherited slot pointing at the superclass that declares it', () => {
    const rows = bi.parseSlotRows(
      ['name\tx\t1\tString\t1\tObject', 'balance\t42\t2\tSmallInteger\t2\tAccount', ''].join('\n'),
    );

    expect(rows.map((r) => r.definingClass)).toEqual(['Object', 'Account']);
  });

  it('reads a slot row as label, value, oop, class and write index', () => {
    const rows = bi.parseRows('balance\t42\t1234\tSmallInteger\t2\n');

    expect(rows).toEqual([
      { label: 'balance', value: '42', oop: '1234', className: 'SmallInteger', index: 2 },
    ]);
  });

  it('skips a malformed record instead of losing the whole page', () => {
    const rows = bi.parseRows(
      'good\t1\t10\tSmallInteger\t1\ntruncated\trecord\ngood2\t2\t20\tX\t2\n',
    );

    expect(rows.map((r) => r.label)).toEqual(['good', 'good2']);
  });

  it('restores values that contained the field and record separators', () => {
    const rows = bi.parseRows("name\t'a\\tb\\nc'\t99\tString\t1\n");

    expect(rows[0].value).toBe("'a\tb\nc'");
  });

  it('marks a row unwritable when the stone reports no index for it', () => {
    const rows = bi.parseRows('[1]\t42\t10\tSmallInteger\tnot-a-number\n');

    expect(rows[0].index).toBe(0);
  });

  it('carries a dictionary key oop so an entry can be written back', () => {
    const rows = bi.parseEntries('#Array\tArray\t900\tMetaclass3\t800\n');

    expect(rows[0]).toEqual({
      label: '#Array',
      value: 'Array',
      oop: '900',
      className: 'Metaclass3',
      index: 0,
      keyOop: '800',
    });
  });
});

describe('paged fetches', () => {
  it('never asks the stone for a page that starts before the first row', () => {
    const execute = executorAnswering('');

    expect(bi.fetchItems(execute, 100n, 0, 10)).toEqual([]);
    expect(bi.fetchEntries(execute, 100n, -1, 10)).toEqual([]);
    expect(bi.fetchBytes(execute, 100n, 0, 10)).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('never asks the stone for an empty or fractional page', () => {
    const execute = executorAnswering('');

    expect(bi.fetchItems(execute, 100n, 1, 0)).toEqual([]);
    expect(bi.fetchEntries(execute, 100n, 1, 1.5)).toEqual([]);
    expect(bi.fetchBytes(execute, 100n, 1, -3)).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('reads bytes as numbers, one per line', () => {
    expect(bi.fetchBytes(executorAnswering('104\n101\n108\n'), 100n, 1, 16)).toEqual([
      104, 101, 108,
    ]);
  });

  it('shows an empty tab, not an error, when the stone refuses a page', () => {
    const failing = vi.fn(() => {
      throw new Error('stone said no');
    });

    expect(bi.fetchItems(failing, 100n, 1, 10)).toEqual([]);
    expect(bi.fetchEntries(failing, 100n, 1, 10)).toEqual([]);
    expect(bi.fetchSlots(failing, 100n)).toEqual([]);
    expect(bi.fetchBytes(failing, 100n, 1, 10)).toEqual([]);
  });
});

describe('class metadata', () => {
  const META = [
    'cls\tAccount',
    'sup\tObject',
    'cat\tBanking',
    'cmt\tHolds a balance.\\nSecond line.',
    'def\tObject subclass: #Account',
    'inst\tbalance',
    'inst\tdeposit:',
    'meta\tnew',
    '',
  ].join('\n');

  it('reads the class metadata for an object in one round trip', () => {
    const execute = executorAnswering(META);

    const meta = bi.fetchObjectMeta(execute, 100n);

    expect(meta).toMatchObject({
      className: 'Account',
      instanceSelectors: ['balance', 'deposit:'],
    });
    // One doit, naming the object it is about.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain('Object _objectForOop: 100');
  });

  it('degrades to no metadata when the stone refuses the query', () => {
    const failing = vi.fn(() => {
      throw new Error('stone said no');
    });

    expect(bi.fetchObjectMeta(failing, 100n)).toBeNull();
  });

  it('collects the class facts and both selector lists', () => {
    const meta = bi.parseObjectMeta(META);

    expect(meta).toEqual({
      className: 'Account',
      superclassName: 'Object',
      category: 'Banking',
      comment: 'Holds a balance.\nSecond line.',
      definition: 'Object subclass: #Account',
      instanceSelectors: ['balance', 'deposit:'],
      classSelectors: ['new'],
    });
  });

  it('ignores a record kind it does not recognise', () => {
    const meta = bi.parseObjectMeta('cls\tAccount\nnovel\tsomething\n');

    expect(meta.className).toBe('Account');
    expect(meta.instanceSelectors).toEqual([]);
  });

  it('reports empty metadata rather than nothing when a class has no comment', () => {
    const meta = bi.parseObjectMeta('cls\tAccount\ncmt\t\n');

    expect(meta.comment).toBe('');
  });
});

describe('method source', () => {
  it('refuses a selector that is not one, without reaching the stone', () => {
    const execute = executorAnswering('irrelevant');

    expect(bi.fetchMethodSource(execute, 100n, "foo'; System exit", false)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts unary, keyword and binary selectors', () => {
    expect(bi.isValidSelector('size')).toBe(true);
    expect(bi.isValidSelector('at:put:')).toBe(true);
    expect(bi.isValidSelector('+')).toBe(true);
    expect(bi.isValidSelector('foo bar')).toBe(false);
  });

  it('asks the class side for a class-side selector', () => {
    const execute = executorAnswering('new ^super new init');

    bi.fetchMethodSource(execute, 100n, 'new', true);

    expect(execute.mock.calls[0][0]).toContain('theNonMetaClass class');
  });
});

describe('browse location', () => {
  it('reads the dictionary and class a value can be browsed in', () => {
    const location = bi.fetchBrowseLocation(executorAnswering('UserGlobals\tAccount'), 100n);

    expect(location).toEqual({ dictName: 'UserGlobals', className: 'Account' });
  });

  it('reports nowhere to browse when the class cannot be named', () => {
    expect(bi.fetchBrowseLocation(executorAnswering('\t'), 100n)).toBeNull();
    expect(bi.fetchBrowseLocation(executorAnswering(''), 100n)).toBeNull();
  });
});
