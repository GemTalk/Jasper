import { describe, it, expect, vi } from 'vitest';
import { OMNI_DEFAULTS } from '../omniConfig';
// The cap Load All raises the display limit to — imported rather than hard-coded, so these tests
// exercise the value the engine really uses on that gesture (triage #14).
import { LOAD_ALL_LIMIT } from '../omniEngine';
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

  // Triage #14: the clamp had no test, and the truncation it causes was invisible to the engine — so
  // the footer reported a cut-off slice as an exact total once "Load all" raised the display cap.
  describe('server scan ceiling (maxServerScan)', () => {
    /** One synthetic row per selector, so a test can ask for any number of matches. */
    const manyRows = (n: number): SelectorSearchResult[] =>
      Array.from({ length: n }, (_, i) => ({
        dictName: 'Globals',
        className: 'Object',
        isMeta: false,
        selector: `addThing${i}`,
        category: 'accessing',
      }));

    it('clamps the server slice to the configured scan ceiling, not the display cap', () => {
      const runSearch = vi.fn(() => manyRows(200));
      const p = createMethodsProvider(1, runSearch);
      // At the Load-All cap, SERVER_OVERFETCH would ask for hundreds of thousands; the clamp must win.
      void p.search(
        'add',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: LOAD_ALL_LIMIT, maxServerScan: 200 }),
        NEVER_CANCELLED,
      );
      expect(runSearch).toHaveBeenCalledWith('add', 200, true);
    });

    it('honors a RAISED maxServerScan setting', () => {
      const runSearch = vi.fn(() => manyRows(1000));
      const p = createMethodsProvider(1, runSearch);
      void p.search(
        'add',
        cfg({
          methodMinQueryLength: 3,
          maxResultsPerCategory: LOAD_ALL_LIMIT,
          maxServerScan: 1000,
        }),
        NEVER_CANCELLED,
      );
      expect(runSearch).toHaveBeenCalledWith('add', 1000, true);
    });

    it('reports the CONFIGURED ceiling in the truncation, so the note shows the real number', () => {
      const p = createMethodsProvider(1, () => manyRows(1000));
      const report = vi.fn();
      void p.search(
        'add',
        cfg({
          methodMinQueryLength: 3,
          maxResultsPerCategory: LOAD_ALL_LIMIT,
          maxServerScan: 1000,
        }),
        NEVER_CANCELLED,
        report,
      );
      expect(report).toHaveBeenCalledWith({
        categoryId: 'methods',
        scanned: 1000,
        ceiling: 1000,
        atCeiling: true,
      });
    });

    it('still overfetches when the display cap leaves room under the ceiling', () => {
      const runSearch = vi.fn(() => manyRows(4));
      const p = createMethodsProvider(1, runSearch);
      void p.search(
        'add',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 10 }),
        NEVER_CANCELLED,
      );
      expect(runSearch).toHaveBeenCalledWith('add', 10 * SERVER_OVERFETCH, true);
      expect(10 * SERVER_OVERFETCH).toBeLessThan(OMNI_DEFAULTS.maxServerScan); // clamp didn't bind
    });

    it('reports truncation when the server slice comes back full', () => {
      const p = createMethodsProvider(1, () => manyRows(OMNI_DEFAULTS.maxServerScan));
      const report = vi.fn();
      void p.search(
        'add',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: LOAD_ALL_LIMIT }),
        NEVER_CANCELLED,
        report,
      );
      expect(report).toHaveBeenCalledWith({
        categoryId: 'methods',
        scanned: OMNI_DEFAULTS.maxServerScan,
        ceiling: OMNI_DEFAULTS.maxServerScan,
        atCeiling: true,
      });
    });

    it('reports NO truncation when the server returns fewer rows than it was allowed', () => {
      const p = createMethodsProvider(1, () => manyRows(3));
      const report = vi.fn();
      void p.search(
        'add',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: LOAD_ALL_LIMIT }),
        NEVER_CANCELLED,
        report,
      );
      expect(report).not.toHaveBeenCalled(); // no call at all IS the "nothing was cut off" signal
    });

    it('reports truncation from the RAW row count, not the post-filter count', () => {
      // Every row comes back, filling the slice, but the client matcher rejects all but one — the
      // count the user sees is 1, yet the scan still stopped early, so this IS truncated.
      const rowsIn = manyRows(8);
      rowsIn[0].selector = 'addThing0'; // the only one matching the term below
      const p = createMethodsProvider(1, () => rowsIn);
      const report = vi.fn();
      const out = p.search(
        'addThing0',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 2, matchMode: 'prefix' }),
        NEVER_CANCELLED,
        report,
      ) as unknown[];
      expect(out).toHaveLength(1);
      // 8 raw rows >= the 8-row slice (2 × SERVER_OVERFETCH), even though only 1 survived the filter.
      // The over-fetch bound it, not the ceiling, so `atCeiling` is false — incomplete, but Load-more
      // still widens the scan, so the UI must not tell the user to narrow their search.
      expect(report).toHaveBeenCalledWith({
        categoryId: 'methods',
        scanned: 2 * SERVER_OVERFETCH,
        ceiling: OMNI_DEFAULTS.maxServerScan,
        atCeiling: false,
      });
    });

    // Eric's report (2026-08-17): with maxServerScan raised to 400 and the display cap at 60, the note
    // first said "capped at 240" and then changed to 400 after Load More. 240 is `60 × SERVER_OVERFETCH`
    // — the over-fetch, not his setting — and it moves every time the cap grows. So while the over-fetch
    // is the tighter bound this is NOT a ceiling hit (Load-more really does fetch more), and the number
    // shown must be the configured ceiling, which never changes.
    it("reports the setting's value, not the over-fetch slice, as the ceiling", () => {
      const p = createMethodsProvider(1, () => manyRows(1000));
      const report = vi.fn();
      const at = (maxResultsPerCategory: number) => {
        report.mockClear();
        void p.search(
          'add',
          cfg({ methodMinQueryLength: 3, maxResultsPerCategory, maxServerScan: 400 }),
          NEVER_CANCELLED,
          report,
        );
        return report.mock.calls[0]?.[0];
      };

      // cap 60 → slice min(240, 400) = 240: the OVER-FETCH bound it, so not a ceiling hit — but the
      // reported ceiling is still 400, the number the user set.
      expect(at(60)).toEqual({
        categoryId: 'methods',
        scanned: 240,
        ceiling: 400,
        atCeiling: false,
      });

      // One Load-more later (cap 120) → slice min(480, 400) = 400: NOW the setting is the wall.
      expect(at(120)).toEqual({
        categoryId: 'methods',
        scanned: 400,
        ceiling: 400,
        atCeiling: true,
      });

      // And it stays 400 however far the cap is raised — the number no longer drifts.
      expect(at(LOAD_ALL_LIMIT)).toEqual({
        categoryId: 'methods',
        scanned: 400,
        ceiling: 400,
        atCeiling: true,
      });
    });

    it('does not report at all below methodMinQueryLength (no fetch happened)', () => {
      const p = createMethodsProvider(1, () => manyRows(5));
      const report = vi.fn();
      void p.search('ad', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED, report);
      expect(report).not.toHaveBeenCalled();
    });
  });
});
