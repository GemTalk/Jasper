import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  searchMethodSource,
  sendersOf,
  implementorsOf,
  referencesToObject,
  literalSymbolReferences,
  stringLiteralReferences,
  hierarchyImplementorsOf,
} from '../methodSearch';

const row = 'Globals\tArray\t0\tsize\taccessing\n';

describe('methodSearch shared parser', () => {
  it('parses tab-separated rows into MethodSearchResult', () => {
    const results = searchMethodSource(
      vi.fn<QueryExecutor>(() => row),
      'size',
      true,
    );
    expect(results).toEqual([
      {
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        selector: 'size',
        category: 'accessing',
      },
    ]);
  });

  it('returns [] for empty output', () => {
    expect(
      sendersOf(
        vi.fn<QueryExecutor>(() => ''),
        'nope',
      ),
    ).toEqual([]);
  });

  it('maps isMeta=true when the third column is "1"', () => {
    const raw = 'Globals\tArray\t1\tnew\tinstance creation\n';
    const results = implementorsOf(
      vi.fn<QueryExecutor>(() => raw),
      'new',
    );
    expect(results[0].isMeta).toBe(true);
  });
});

describe('searchMethodSource', () => {
  it('passes ignoreCase flag and escaped term to Smalltalk', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    searchMethodSource(execute, "foo's", false);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("substringSearch: 'foo''s' ignoreCase: false");
  });
});

describe('sendersOf', () => {
  it('uses sendersOf: and "at: 1" to unwrap the result array', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    sendersOf(execute, 'size');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("sendersOf: #'size'");
    expect(code).toMatch(/sendersOf: #'size'\) at: 1/s);
  });

  it('propagates environmentId to both the query and the serialization', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    sendersOf(execute, 'x', 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('environmentId: 3');
    expect(code).toContain('categoryOfSelector: each selector environmentId: 3');
  });
});

describe('implementorsOf', () => {
  it('uses implementorsOf: and asArray to normalize the collection', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    implementorsOf(execute, 'size');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("implementorsOf: #'size'");
    expect(code).toContain('asArray');
  });
});

describe('referencesToObject', () => {
  it('uses ClassOrganizer referencesToObject: with objectNamed: lookup', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    referencesToObject(execute, 'MyGlobal');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('referencesToObject:');
    expect(code).toContain("objectNamed: #'MyGlobal'");
  });
});

describe('literalSymbolReferences', () => {
  it('intersects a source-substring pre-filter with literal-frame membership (data-literal uses only)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    literalSymbolReferences(execute, '#size');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('symLit := #size.');
    expect(code).toContain('referencesToLiteral: symLit');
    // The textual form of the symbol is the substring pre-filter (a send like `x size` has source
    // "size", not "#size", so it's excluded); frame membership then confirms it's a real literal.
    expect(code).toContain("substringSearch: '#size' ignoreCase: false");
    expect(code).toContain('lit includes: m');
    // The old "subtract senders" heuristic is gone — sendersOf: under-reports for some selectors.
    expect(code).not.toContain('sendersOf:');
  });
});

describe('stringLiteralReferences', () => {
  it('filters source candidates to those holding the EXACT String literal (excludes symbols)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    stringLiteralReferences(execute, 'no such element', true);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('substringSearch:');
    expect(code).toContain('m literals detect:');
    expect(code).toContain('isSymbol not');
    expect(code).toContain("'no such element'");
    // Exact equality (not includesString), so 'name' matches only the literal 'name' — not
    // 'className' / 'rename' / etc.
    expect(code).toContain('= needle');
    expect(code).not.toContain('includesString: needle');
  });
});

// Guards the Python-alias navigation fix: a class's home dictionary must be the
// one that stores it under its own name, not merely any dict that references it.
describe('methodSerialization home-dictionary resolution', () => {
  it('only treats a dict as a class home when keyed by the class name', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    implementorsOf(execute, 'size');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('k = v name asSymbol');
  });
});

describe('hierarchyImplementorsOf', () => {
  it('walks the full superclass chain for direction up', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    hierarchyImplementorsOf(execute, 1, 'Array', 'at:', false, 'up');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('superclass');
    expect(code).toContain('[cur notNil] whileTrue:');
    expect(code).toContain("includesSelector: #'at:'");
    expect(code).not.toContain('allSubclasses');
  });

  it('walks all subclasses for direction down', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    hierarchyImplementorsOf(execute, 1, 'Array', 'at:', false, 'down');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('allSubclasses do:');
    expect(code).toContain("includesSelector: #'at:'");
    expect(code).not.toContain('whileTrue:');
  });

  it('targets the metaclass side when isMeta is true (up)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    hierarchyImplementorsOf(execute, 1, 'Array', 'new', true, 'up');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('(class class) superclass');
  });

  it('targets each subclass metaclass when isMeta is true (down)', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    hierarchyImplementorsOf(execute, 1, 'Array', 'new', true, 'down');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('tgt := sub class');
  });

  it('uses the instance side (class / sub) when isMeta is false', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    hierarchyImplementorsOf(execute, 1, 'Array', 'at:', false, 'down');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('tgt := sub.');
    expect(code).not.toContain('sub class');
  });

  it('embeds the dictIndex and escapes class name and selector', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    hierarchyImplementorsOf(execute, 7, "Foo'Bar", "o'clock", false, 'up');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList at: 7');
    expect(code).toContain("#'Foo''Bar'");
    expect(code).toContain("#'o''clock'");
  });

  it('parses returned rows into MethodSearchResult', () => {
    const raw = 'Globals\tObject\t0\tat:\taccessing\n';
    const results = hierarchyImplementorsOf(
      vi.fn<QueryExecutor>(() => raw),
      1,
      'Array',
      'at:',
      false,
      'up',
    );
    expect(results).toEqual([
      {
        dictName: 'Globals',
        className: 'Object',
        isMeta: false,
        selector: 'at:',
        category: 'accessing',
      },
    ]);
  });
});
