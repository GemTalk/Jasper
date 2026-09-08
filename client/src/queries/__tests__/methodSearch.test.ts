import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';
import {
  searchMethodSource,
  sendersOf,
  implementorsOf,
  referencesToObject,
  referencesToClassInDict,
  literalSymbolReferences,
  stringLiteralReferences,
  hierarchyImplementorsOf,
  dedupeMethodResults,
  type MethodSearchResult,
} from '../methodSearch';
import { getClassHierarchy } from '../getClassHierarchy';
import { getSiblingClassNames } from '../../refactoring/queries/getSiblingClassNames';
import { getClassDescendantNames } from '../../refactoring/queries/getClassDescendantNames';

const row = 'Globals\tArray\t0\tsize\taccessing\n';

describe('environment on a result row', () => {
  it('reads the environment column when the scan reports one', () => {
    const results = searchMethodSource(
      vi.fn<QueryExecutor>(() => 'Globals\tArray\t0\tsize\taccessing\t3\n'),
      'size',
      true,
    );

    expect(results[0].environmentId).toBe(3);
  });

  it('falls back to environment 0 rather than dropping a row that has no column', () => {
    const results = searchMethodSource(
      vi.fn<QueryExecutor>(() => 'Globals\tArray\t0\tsize\taccessing\n'),
      'size',
      true,
    );

    expect(results).toHaveLength(1);
    expect(results[0].environmentId).toBe(0);
  });

  it('serializes the environment it was asked for', () => {
    const execute = vi.fn<QueryExecutor>(() => '');

    sendersOf(execute, 'size', 2);

    expect(execute.mock.calls[0][0]).toContain("nextPutAll: '2'");
  });
});

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
        environmentId: 0,
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

describe('referencesToClassInDict', () => {
  it('scopes the organizer to the environment, not just the serialization', () => {
    // A bare `ClassOrganizer new` scans environment 0 whatever the caller asked for, so a
    // class referenced only from another environment came back unreferenced — and safe
    // delete would then report that nothing referenced it and delete without asking.
    // The environment is now set where the organizer gathers its classes rather than
    // afterwards, and the cache is keyed by it so environments cannot share one.
    const execute = vi.fn<QueryExecutor>(() => '');

    referencesToClassInDict(execute, 'Account', 3, 2);

    const code = execute.mock.calls[0][0];
    expect(code).toContain('ClassOrganizer newForEnvironment: 2');
    expect(code).toContain('JasperClassOrganizer_2');
    expect(code).not.toMatch(/ClassOrganizer new /);
  });

  it('reuses one organizer per session rather than building one per query', () => {
    // `ClassOrganizer new` indexes the whole image, so its cost follows the image
    // rather than the question. One per query filled the gem's temporary object
    // memory on a large image, which killed the session — and everything else in
    // it then reported a broken connection instead of its own result.
    const execute = vi.fn<QueryExecutor>(() => '');

    searchMethodSource(execute, 'printOn', false);

    const code = execute.mock.calls[0][0];
    expect(code).toContain('SessionTemps current');
    expect(code).toContain('JasperClassOrganizer_0');
    expect(code).not.toMatch(/ClassOrganizer new /);
  });

  it('shares the organizer with the hierarchy queries', () => {
    // They ask `subclassesOf:` and `allSuperclassesOf:`, which read the same
    // snapshot the searches do, and paid the same per-image build for it. Every
    // refactoring that creates the class they would then ask about compiles it
    // through `compileClassDefinition`, which drops the cache in the doit that
    // creates it — so the snapshot they read is never one short.
    const execute = vi.fn<QueryExecutor>(() => '');

    getClassHierarchy(execute, 'Account');
    getSiblingClassNames(execute, 'Account');
    getClassDescendantNames(execute, 'Account');

    for (const [code] of execute.mock.calls) {
      expect(code).toContain('JasperClassOrganizer_0');
      expect(code).not.toMatch(/ClassOrganizer new\b/);
    }
  });

  it('reports the environment each row was found in', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Globals\tArray\t0\tsize\taccessing\t2\n');

    expect(referencesToClassInDict(execute, 'Array', 1, 2)[0].environmentId).toBe(2);
  });

  it('resolves the class through its dictionary rather than by bare name', () => {
    const execute = vi.fn<QueryExecutor>(() => '');

    referencesToClassInDict(execute, 'Account', 3);

    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList at: 3');
    expect(code).toContain('referencesToObject:');
    // A bare objectNamed: would answer the first binding of the name anywhere in the
    // symbol list — the wrong class when the name is shadowed.
    expect(code).not.toContain('objectNamed:');
  });

  it('reports nothing when the dictionary does not bind the class', () => {
    const execute = vi.fn<QueryExecutor>(() => '');

    expect(referencesToClassInDict(execute, 'Missing', 3)).toEqual([]);
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
        environmentId: 0,
      },
    ]);
  });
});

// Every caller that sweeps environments runs one query per environment and folds the rounds
// into one list, so the same method can come back more than once. What must NOT fold together
// is two methods that merely look alike: a selector on both sides of a class, on two classes,
// or in two environments is more than one method, and merging them under-reports the results
// and leaves one of them unreachable from the list that is shown.
describe('folding repeated scan results together', () => {
  const found = (
    className: string,
    isMeta: boolean,
    selector: string,
    environmentId = 0,
  ): MethodSearchResult => ({
    dictName: 'UserGlobals',
    className,
    isMeta,
    selector,
    category: 'accessing',
    environmentId,
  });

  it('keeps one entry for a method found more than once', () => {
    const hit = found('Account', false, 'balance');

    expect(dedupeMethodResults([hit, { ...hit }])).toEqual([hit]);
  });

  it('keeps the same selector on both sides of a class, which are different methods', () => {
    const instance = found('Account', false, 'reset');
    const classSide = found('Account', true, 'reset');

    expect(dedupeMethodResults([instance, classSide])).toEqual([instance, classSide]);
  });

  it('keeps the same selector implemented by different classes', () => {
    const account = found('Account', false, 'balance');
    const savings = found('Savings', false, 'balance');

    expect(dedupeMethodResults([account, savings])).toEqual([account, savings]);
  });

  it('lists a selector found in two environments once per environment', () => {
    const env0 = found('Account', false, 'balance', 0);
    const env1 = found('Account', false, 'balance', 1);

    expect(dedupeMethodResults([env0, env1])).toEqual([env0, env1]);
  });

  it('keeps the first sighting, so the earliest environment wins', () => {
    const first = found('Account', false, 'balance');
    const later = { ...first, category: 'a different category' };

    expect(dedupeMethodResults([first, later])).toEqual([first]);
  });

  it('answers nothing for nothing', () => {
    expect(dedupeMethodResults([])).toEqual([]);
  });
});
