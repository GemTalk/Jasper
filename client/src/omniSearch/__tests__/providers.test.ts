import { describe, it, expect, vi } from 'vitest';
import { OMNI_DEFAULTS } from '../omniConfig';
import { NEVER_CANCELLED, OmniConfig } from '../omniTypes';
import { createClassesProvider } from '../providers/classesProvider';
import { createDictionariesProvider } from '../providers/dictionariesProvider';
import { createGlobalsProvider } from '../providers/globalsProvider';
import { createSourceProvider } from '../providers/sourceProvider';
import { createLiteralsProvider, isSymbolLiteral } from '../providers/literalsProvider';
import { createCategoriesProvider } from '../providers/categoriesProvider';
import { createMethodsProvider, SERVER_OVERFETCH } from '../providers/methodsProvider';
import { MethodSearchResult } from '../../queries/methodSearch';
import { ClassNameEntry } from '../../queries/getAllClassNames';
import { SelectorSearchResult } from '../../queries/searchSelectors';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

describe('classesProvider', () => {
  const entries: ClassNameEntry[] = [
    { dictIndex: 1, dictName: 'Globals', className: 'OrderedCollection' },
    { dictIndex: 1, dictName: 'Globals', className: 'Object' },
    { dictIndex: 3, dictName: 'Python', className: 'object' },
  ];

  it('loads the corpus in prime(), then matches client-side WITHOUT reloading on each search', () => {
    const load = vi.fn(() => entries);
    const p = createClassesProvider(42, load);
    void p.prime?.(NEVER_CANCELLED);
    const r1 = p.search('oc', cfg(), NEVER_CANCELLED) as ReturnType<typeof Array.prototype.slice>;
    const r2 = p.search('obj', cfg(), NEVER_CANCELLED);
    // Load happened once (in prime); neither search re-queried — this is the caching guarantee.
    expect(load).toHaveBeenCalledTimes(1);
    expect((r1 as { label: string }[])[0].label).toBe('OrderedCollection');
    expect((r2 as { label: string }[]).map((x) => x.label)).toContain('Object');
  });

  it('produces an openClass action carrying the picked entry + session', () => {
    const p = createClassesProvider(7, () => entries);
    void p.prime?.(NEVER_CANCELLED);
    const [top] = p.search('OrderedCollection', cfg(), NEVER_CANCELLED) as {
      action: { kind: string; sessionId: number; className: string; dictIndex: number };
    }[];
    expect(top.action).toEqual({
      kind: 'openClass',
      sessionId: 7,
      dictName: 'Globals',
      className: 'OrderedCollection',
      dictIndex: 1,
    });
  });

  it('respects maxResultsPerCategory', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      dictIndex: 1,
      dictName: 'Globals',
      className: `Widget${i}`,
    }));
    const p = createClassesProvider(1, () => many);
    void p.prime?.(NEVER_CANCELLED);
    expect(p.search('widget', cfg({ maxResultsPerCategory: 5 }), NEVER_CANCELLED)).toHaveLength(5);
  });
});

describe('dictionariesProvider', () => {
  it('matches names and produces a revealDictionary action', () => {
    const p = createDictionariesProvider(9, () => ['Globals', 'Published', 'UserGlobals']);
    void p.prime?.(NEVER_CANCELLED);
    const results = p.search('glob', cfg(), NEVER_CANCELLED) as {
      label: string;
      action: unknown;
    }[];
    expect(results.map((r) => r.label)).toContain('Globals');
    expect(results[0].action).toEqual({
      kind: 'revealDictionary',
      sessionId: 9,
      dictName: results[0].label,
    });
  });
});

describe('globalsProvider', () => {
  it('matches non-class names and produces a revealGlobal action carrying the value class', () => {
    const p = createGlobalsProvider(9, () => [
      { dictIndex: 1, dictName: 'Globals', name: 'Transcript', className: 'GsTerminalStream' },
      { dictIndex: 1, dictName: 'Globals', name: 'AllUsers', className: 'UserProfileSet' },
    ]);
    void p.prime?.(NEVER_CANCELLED);

    const results = p.search('trans', cfg(), NEVER_CANCELLED) as {
      label: string;
      description?: string;
      action: unknown;
    }[];

    expect(results[0].label).toBe('Transcript');
    expect(results[0].description).toBe('Globals · GsTerminalStream');
    expect(results[0].action).toEqual({
      kind: 'revealGlobal',
      sessionId: 9,
      dictName: 'Globals',
      name: 'Transcript',
      className: 'GsTerminalStream',
    });
  });
});

describe('sourceProvider', () => {
  const rows: MethodSearchResult[] = [
    {
      dictName: 'Globals',
      className: 'Foo',
      isMeta: false,
      selector: 'bar',
      category: 'accessing',
    },
  ];

  it('does not run below the method-min-query length (it is heavyweight)', () => {
    const runSearch = vi.fn(() => rows);
    const p = createSourceProvider(1, runSearch);

    expect(p.search('ab', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED)).toEqual([]);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it('groups its hits under the source category but still opens the method', () => {
    const p = createSourceProvider(7, () => rows);

    const results = p.search('doSomething', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED) as {
      label: string;
      categoryId: string;
      action: { kind: string; selector: string };
    }[];

    expect(results[0].label).toBe('Foo>>bar');
    expect(results[0].categoryId).toBe('source');
    expect(results[0].action).toMatchObject({ kind: 'openMethod', selector: 'bar' });
  });
});

describe('literalsProvider', () => {
  const rows: MethodSearchResult[] = [
    {
      dictName: 'Globals',
      className: 'Foo',
      isMeta: false,
      selector: 'bar',
      category: 'accessing',
    },
  ];

  it('rejects anything that is not a #symbol or a quoted string', () => {
    const runSymbol = vi.fn(() => rows);
    const runString = vi.fn(() => rows);
    const p = createLiteralsProvider(1, runSymbol, runString);

    expect(p.search('42', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(p.search('$a', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(p.search('   ', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(runSymbol).not.toHaveBeenCalled();
    expect(runString).not.toHaveBeenCalled();
  });

  it('reference-searches a #symbol, under the literals category', () => {
    const runSymbol = vi.fn(() => rows);
    const p = createLiteralsProvider(7, runSymbol, vi.fn());

    const results = p.search('#at:put:', cfg(), NEVER_CANCELLED) as {
      label: string;
      categoryId: string;
      action: { kind: string };
    }[];

    expect(runSymbol).toHaveBeenCalledWith('#at:put:');
    expect(results[0].label).toBe('Foo>>bar');
    expect(results[0].categoryId).toBe('literals');
    expect(results[0].action).toMatchObject({ kind: 'openMethod' });
  });

  it('never evaluates a # entry that is not a complete symbol literal', () => {
    const runSymbol = vi.fn(() => rows);
    const p = createLiteralsProvider(1, runSymbol, vi.fn());

    expect(p.search('#foo. System abortTransaction', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(p.search('#at:put: bar', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(p.search('#', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(runSymbol).not.toHaveBeenCalled();
  });

  it("routes a closed 'string' to a source search of its content (case per config)", () => {
    const runString = vi.fn(() => rows);
    const p = createLiteralsProvider(1, vi.fn(), runString);

    const results = p.search("'no such element'", cfg({ caseSensitive: true }), NEVER_CANCELLED);

    expect(runString).toHaveBeenCalledWith('no such element', false);
    expect(results).toHaveLength(1);
  });

  it('waits for a complete, non-empty string before searching', () => {
    const runString = vi.fn(() => rows);
    const p = createLiteralsProvider(1, vi.fn(), runString);

    expect(p.search("'unterminated", cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(p.search("''", cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(runString).not.toHaveBeenCalled();
  });

  it('shows nothing (no throw) when the runner raises', () => {
    const p = createLiteralsProvider(
      1,
      () => {
        throw new Error('compile error');
      },
      vi.fn(),
    );

    expect(p.search('#at:put:', cfg(), NEVER_CANCELLED)).toEqual([]);
  });
});

describe('isSymbolLiteral', () => {
  it('accepts unary, keyword, binary, and quoted symbol literals', () => {
    expect(isSymbolLiteral('#foo')).toBe(true);
    expect(isSymbolLiteral('#_bar1')).toBe(true);
    expect(isSymbolLiteral('#at:put:')).toBe(true);
    expect(isSymbolLiteral('#+')).toBe(true);
    expect(isSymbolLiteral('#<=')).toBe(true);
    expect(isSymbolLiteral("#'has spaces and ''quotes'''")).toBe(true);
  });

  it('rejects a bare # or a term that is more than a single symbol literal', () => {
    expect(isSymbolLiteral('#')).toBe(false);
    expect(isSymbolLiteral('#foo bar')).toBe(false);
    expect(isSymbolLiteral('#foo. System abortTransaction')).toBe(false);
    expect(isSymbolLiteral("#'unterminated")).toBe(false);
    expect(isSymbolLiteral("#'a'; evil")).toBe(false);
    expect(isSymbolLiteral('foo')).toBe(false);
  });
});

describe('categoriesProvider', () => {
  const entries = [
    { dictIndex: 1, dictName: 'Globals', category: 'Kernel-Objects' },
    { dictIndex: 5, dictName: 'UserGlobals', category: 'MyApp-Model' },
  ];

  it('loads the corpus lazily — only on the first search, not before', () => {
    const load = vi.fn(() => entries);
    const p = createCategoriesProvider(1, load);

    expect(p.prime).toBeUndefined();
    expect(load).not.toHaveBeenCalled(); // constructing the provider must not scan the image

    void p.search('kernel', cfg(), NEVER_CANCELLED);
    void p.search('app', cfg(), NEVER_CANCELLED);
    expect(load).toHaveBeenCalledTimes(1); // loaded once, then matched client-side
  });

  it('matches category names and produces a revealCategory action', () => {
    const p = createCategoriesProvider(7, () => entries);

    const results = p.search('MyApp', cfg(), NEVER_CANCELLED) as {
      label: string;
      description?: string;
      action: unknown;
    }[];

    expect(results[0].label).toBe('MyApp-Model');
    expect(results[0].description).toBe('UserGlobals');
    expect(results[0].action).toEqual({
      kind: 'revealCategory',
      sessionId: 7,
      dictName: 'UserGlobals',
      dictIndex: 5,
      category: 'MyApp-Model',
    });
  });
});

describe('methodsProvider', () => {
  const rows: SelectorSearchResult[] = [
    {
      dictName: 'Globals',
      className: 'OrderedCollection',
      isMeta: false,
      selector: 'add:',
      category: 'adding',
    },
    {
      dictName: 'Globals',
      className: 'Array',
      isMeta: true,
      selector: 'with:',
      category: 'instance creation',
    },
  ];

  it('does not hit the stone below methodMinQueryLength', () => {
    const runSearch = vi.fn(() => rows);
    const p = createMethodsProvider(1, runSearch);
    expect(p.search('ad', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED)).toEqual([]);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it('queries the stone (case-folded per config) and builds Class>>selector labels', () => {
    const runSearch = vi.fn(() => rows);
    const p = createMethodsProvider(5, runSearch);
    const results = p.search('add', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED) as {
      label: string;
      description?: string;
      action: { kind: string; selector: string; isMeta: boolean };
    }[];
    // Over-fetches (SERVER_OVERFETCH ×) so ranking has a wider pool, then client-caps.
    expect(runSearch).toHaveBeenCalledWith(
      'add',
      OMNI_DEFAULTS.maxResultsPerCategory * SERVER_OVERFETCH,
      true,
    );
    const add = results.find((r) => r.label === 'OrderedCollection>>add:');
    expect(add).toBeDefined();
    expect(add?.description).toBe('Globals'); // home dictionary only — no method category
    expect(add?.action).toMatchObject({ kind: 'openMethod', selector: 'add:', isMeta: false });
  });

  it('labels the class side as `Class class>>selector`', () => {
    const p = createMethodsProvider(1, () => rows);
    const results = p.search('with', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED) as {
      label: string;
    }[];
    expect(results.some((r) => r.label === 'Array class>>with:')).toBe(true);
  });

  it('shifts highlight ranges from selector into label coordinates', () => {
    const p = createMethodsProvider(1, () => [rows[0]]);
    const [r] = p.search(
      'add',
      cfg({ methodMinQueryLength: 3, matchMode: 'prefix' }),
      NEVER_CANCELLED,
    ) as {
      label: string;
      ranges: [number, number][];
    }[];
    // label = 'OrderedCollection>>add:'; 'add' starts at index 18 (after 'OrderedCollection>>').
    expect(r.label.slice(r.ranges[0][0], r.ranges[0][1])).toBe('add');
  });
});
