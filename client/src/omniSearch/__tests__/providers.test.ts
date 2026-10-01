import { describe, it, expect, vi } from 'vitest';
import { OMNI_DEFAULTS } from '../omniConfig';
// The cap Load All raises the display limit to — imported rather than hard-coded, so these tests
// exercise the value the engine really uses on that gesture (triage #14).
import { LOAD_ALL_LIMIT } from '../omniEngine';
import { NEVER_CANCELLED, OmniConfig } from '../omniTypes';
import { createClassesProvider } from '../providers/classesProvider';
import { createDictionariesProvider } from '../providers/dictionariesProvider';
import { createGlobalsProvider } from '../providers/globalsProvider';
import { createSourceProvider, SourceSearchRunner } from '../providers/sourceProvider';
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

  it('loads the corpus in prime(), then matches client-side WITHOUT reloading on each search', async () => {
    const load = vi.fn(async () => entries);
    const p = createClassesProvider(42, load);
    await p.prime?.(NEVER_CANCELLED);
    const r1 = (await p.search('oc', cfg(), NEVER_CANCELLED)) as ReturnType<
      typeof Array.prototype.slice
    >;
    const r2 = await p.search('obj', cfg(), NEVER_CANCELLED);
    // Load happened once (in prime); neither search re-queried — this is the caching guarantee.
    expect(load).toHaveBeenCalledTimes(1);
    expect((r1 as { label: string }[])[0].label).toBe('OrderedCollection');
    expect((r2 as { label: string }[]).map((x) => x.label)).toContain('Object');
  });

  it('produces an openClass action carrying the picked entry + session', async () => {
    const p = createClassesProvider(7, async () => entries);
    await p.prime?.(NEVER_CANCELLED);
    const [top] = (await p.search('OrderedCollection', cfg(), NEVER_CANCELLED)) as {
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

  it('respects maxResultsPerCategory', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      dictIndex: 1,
      dictName: 'Globals',
      className: `Widget${i}`,
    }));
    const p = createClassesProvider(1, async () => many);
    await p.prime?.(NEVER_CANCELLED);
    expect(
      await p.search('widget', cfg({ maxResultsPerCategory: 5 }), NEVER_CANCELLED),
    ).toHaveLength(5);
  });
});

describe('dictionariesProvider', () => {
  it('matches names and produces a revealDictionary action', async () => {
    const p = createDictionariesProvider(9, async () => ['Globals', 'Published', 'UserGlobals']);
    await p.prime?.(NEVER_CANCELLED);
    const results = (await p.search('glob', cfg(), NEVER_CANCELLED)) as {
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
  it('matches non-class names and produces a revealGlobal action carrying the value class', async () => {
    const p = createGlobalsProvider(9, async () => [
      { dictIndex: 1, dictName: 'Globals', name: 'Transcript', className: 'GsTerminalStream' },
      { dictIndex: 1, dictName: 'Globals', name: 'AllUsers', className: 'UserProfileSet' },
    ]);
    await p.prime?.(NEVER_CANCELLED);

    const results = (await p.search('trans', cfg(), NEVER_CANCELLED)) as {
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
      environmentId: 0,
    },
  ];

  it('does not run below the method-min-query length (it is heavyweight)', async () => {
    const runSearch = vi.fn(async () => rows);
    const p = createSourceProvider(1, runSearch);

    expect(await p.search('ab', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED)).toEqual([]);
    expect(runSearch).not.toHaveBeenCalled();
  });

  /**
   * The chip is one global control, so a scope that silently ignores it tells the
   * user something untrue — setting Prefix and getting `barfoo` back. Source used
   * to run the identical substring scan in all three positions.
   */
  describe('honours the match-algorithm chip', () => {
    const runWith = async (matchMode: OmniConfig['matchMode']) => {
      const runSearch = vi.fn<SourceSearchRunner>(async () => rows);
      const p = createSourceProvider(1, runSearch);
      await p.search('foo', cfg({ methodMinQueryLength: 3, matchMode }), NEVER_CANCELLED);
      return runSearch;
    };

    // Each chip position gets its own reading over a method body, and all three are
    // distinct — the defect was that Source ran one scan whatever the chip said.
    it.each([
      ['prefix', 'wordStart'],
      ['fuzzy', 'fuzzyToken'],
      ['substring', 'substring'],
    ] as const)('asks for the %s reading of the chip', async (chip, scan) => {
      expect(await runWith(chip)).toHaveBeenCalledWith('foo', true, scan);
    });

    it('maps the three chip positions onto three different scans', async () => {
      const scans: unknown[] = [];
      for (const m of ['prefix', 'fuzzy', 'substring'] as const) {
        scans.push((await runWith(m)).mock.calls[0][2]);
      }
      expect(new Set(scans).size).toBe(3);
    });

    // The scan mode is independent of case sensitivity; both reach the stone.
    it('still passes case sensitivity alongside it', async () => {
      const runSearch = vi.fn(async () => rows);
      const p = createSourceProvider(1, runSearch);

      await p.search(
        'foo',
        cfg({ methodMinQueryLength: 3, matchMode: 'prefix', caseSensitive: true }),
        NEVER_CANCELLED,
      );

      expect(runSearch).toHaveBeenCalledWith('foo', false, 'wordStart');
    });
  });

  it('groups its hits under the source category but still opens the method', async () => {
    const p = createSourceProvider(7, async () => rows);

    const results = (await p.search(
      'doSomething',
      cfg({ methodMinQueryLength: 3 }),
      NEVER_CANCELLED,
    )) as {
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
      environmentId: 0,
    },
  ];

  it('rejects anything that is not a #symbol or a quoted string', async () => {
    const runSymbol = vi.fn(async () => rows);
    const runString = vi.fn(async () => rows);
    const p = createLiteralsProvider(1, runSymbol, runString);

    expect(await p.search('42', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(await p.search('$a', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(await p.search('   ', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(runSymbol).not.toHaveBeenCalled();
    expect(runString).not.toHaveBeenCalled();
  });

  it('reference-searches a #symbol, under the literals category', async () => {
    const runSymbol = vi.fn(async () => rows);
    const p = createLiteralsProvider(7, runSymbol, vi.fn());

    const results = (await p.search('#at:put:', cfg(), NEVER_CANCELLED)) as {
      label: string;
      categoryId: string;
      action: { kind: string };
    }[];

    expect(runSymbol).toHaveBeenCalledWith('#at:put:');
    expect(results[0].label).toBe('Foo>>bar');
    expect(results[0].categoryId).toBe('literals');
    expect(results[0].action).toMatchObject({ kind: 'openMethod' });
  });

  it('never evaluates a # entry that is not a complete symbol literal', async () => {
    const runSymbol = vi.fn(async () => rows);
    const p = createLiteralsProvider(1, runSymbol, vi.fn());

    expect(await p.search('#foo. System abortTransaction', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(await p.search('#at:put: bar', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(await p.search('#', cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(runSymbol).not.toHaveBeenCalled();
  });

  it("routes a closed 'string' to a source search of its content (case per config)", async () => {
    const runString = vi.fn(async () => rows);
    const p = createLiteralsProvider(1, vi.fn(), runString);

    const results = await p.search(
      "'no such element'",
      cfg({ caseSensitive: true }),
      NEVER_CANCELLED,
    );

    expect(runString).toHaveBeenCalledWith('no such element', false);
    expect(results).toHaveLength(1);
  });

  it('waits for a complete, non-empty string before searching', async () => {
    const runString = vi.fn(async () => rows);
    const p = createLiteralsProvider(1, vi.fn(), runString);

    expect(await p.search("'unterminated", cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(await p.search("''", cfg(), NEVER_CANCELLED)).toEqual([]);
    expect(runString).not.toHaveBeenCalled();
  });

  it('shows nothing (no throw) when the runner raises', async () => {
    const p = createLiteralsProvider(
      1,
      () => {
        throw new Error('compile error');
      },
      vi.fn(),
    );

    expect(await p.search('#at:put:', cfg(), NEVER_CANCELLED)).toEqual([]);
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

  it('loads the corpus lazily — only on the first search, not before', async () => {
    const load = vi.fn(async () => entries);
    const p = createCategoriesProvider(1, load);

    expect(p.prime).toBeUndefined();
    expect(load).not.toHaveBeenCalled(); // constructing the provider must not scan the image

    await p.search('kernel', cfg(), NEVER_CANCELLED);
    await p.search('app', cfg(), NEVER_CANCELLED);
    expect(load).toHaveBeenCalledTimes(1); // loaded once, then matched client-side
  });

  it('matches category names and produces a revealCategory action', async () => {
    const p = createCategoriesProvider(7, async () => entries);

    const results = (await p.search('MyApp', cfg(), NEVER_CANCELLED)) as {
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

  it('does not hit the stone below methodMinQueryLength', async () => {
    const runSearch = vi.fn(async () => rows);
    const p = createMethodsProvider(1, runSearch);
    expect(await p.search('ad', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED)).toEqual([]);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it('queries the stone (case-folded per config) and builds Class>>selector labels', async () => {
    const runSearch = vi.fn(async () => rows);
    const p = createMethodsProvider(5, runSearch);
    const results = (await p.search('add', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED)) as {
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

  it('labels the class side as `Class class>>selector`', async () => {
    const p = createMethodsProvider(1, async () => rows);
    const results = (await p.search('with', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED)) as {
      label: string;
    }[];
    expect(results.some((r) => r.label === 'Array class>>with:')).toBe(true);
  });

  it('shifts highlight ranges from selector into label coordinates', async () => {
    const p = createMethodsProvider(1, async () => [rows[0]]);
    const [r] = (await p.search(
      'add',
      cfg({ methodMinQueryLength: 3, matchMode: 'prefix' }),
      NEVER_CANCELLED,
    )) as {
      label: string;
      ranges: [number, number][];
    }[];
    // label = 'OrderedCollection>>add:'; 'add' starts at index 18 (after 'OrderedCollection>>').
    expect(r.label.slice(r.ranges[0][0], r.ranges[0][1])).toBe('add');
  });

  // The cap below this sort decides which rows survive, so the provider's order and the engine's
  // must be ONE key. A label tiebreak would not be: 'Array class>>at:' sorts before 'Array>>at:',
  // so it would keep and hide the two sides in opposite orders at the cap boundary.
  describe('orders rows by the same key the engine displays them in', () => {
    const sides: SelectorSearchResult[] = [
      { dictName: 'Globals', className: 'Array', isMeta: true, selector: 'at:', category: 'a' },
      { dictName: 'Globals', className: 'Array', isMeta: false, selector: 'at:', category: 'a' },
    ];

    it('puts the instance side before the class side of the same selector', async () => {
      const p = createMethodsProvider(1, async () => sides);
      const results = (await p.search(
        'at:',
        cfg({ methodMinQueryLength: 2 }),
        NEVER_CANCELLED,
      )) as {
        label: string;
      }[];
      expect(results.map((r) => r.label)).toEqual(['Array>>at:', 'Array class>>at:']);
    });

    it('keeps the instance side, not the class side, when the display cap admits only one', async () => {
      const p = createMethodsProvider(1, async () => sides);
      const results = (await p.search(
        'at:',
        cfg({ methodMinQueryLength: 2, maxResultsPerCategory: 1 }),
        NEVER_CANCELLED,
      )) as { label: string }[];
      expect(results.map((r) => r.label)).toEqual(['Array>>at:']);
    });
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

    it('clamps the server slice to the configured scan ceiling, not the display cap', async () => {
      const runSearch = vi.fn(async () => manyRows(200));
      const p = createMethodsProvider(1, runSearch);
      // At the Load-All cap, SERVER_OVERFETCH would ask for hundreds of thousands; the clamp must win.
      await p.search(
        'add',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: LOAD_ALL_LIMIT, maxServerScan: 200 }),
        NEVER_CANCELLED,
      );
      expect(runSearch).toHaveBeenCalledWith('add', 200, true);
    });

    it('honors a RAISED maxServerScan setting', async () => {
      const runSearch = vi.fn(async () => manyRows(1000));
      const p = createMethodsProvider(1, runSearch);
      await p.search(
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

    it('reports the CONFIGURED ceiling in the truncation, so the note shows the real number', async () => {
      const p = createMethodsProvider(1, async () => manyRows(1000));
      const report = vi.fn();
      await p.search(
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

    it('still overfetches when the display cap leaves room under the ceiling', async () => {
      const runSearch = vi.fn(async () => manyRows(4));
      const p = createMethodsProvider(1, runSearch);
      await p.search(
        'add',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 10 }),
        NEVER_CANCELLED,
      );
      expect(runSearch).toHaveBeenCalledWith('add', 10 * SERVER_OVERFETCH, true);
      expect(10 * SERVER_OVERFETCH).toBeLessThan(OMNI_DEFAULTS.maxServerScan); // clamp didn't bind
    });

    it('reports truncation when the server slice comes back full', async () => {
      const p = createMethodsProvider(1, async () => manyRows(OMNI_DEFAULTS.maxServerScan));
      const report = vi.fn();
      await p.search(
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

    it('reports NO truncation when the server returns fewer rows than it was allowed', async () => {
      const p = createMethodsProvider(1, async () => manyRows(3));
      const report = vi.fn();
      await p.search(
        'add',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: LOAD_ALL_LIMIT }),
        NEVER_CANCELLED,
        report,
      );
      expect(report).not.toHaveBeenCalled(); // no call at all IS the "nothing was cut off" signal
    });

    it('reports truncation from the RAW row count, not the post-filter count', async () => {
      // Every row comes back, filling the slice, but the client matcher rejects all but one — the
      // count the user sees is 1, yet the scan still stopped early, so this IS truncated.
      const rowsIn = manyRows(8);
      rowsIn[0].selector = 'addThing0'; // the only one matching the term below
      const p = createMethodsProvider(1, async () => rowsIn);
      const report = vi.fn();
      const out = (await p.search(
        'addThing0',
        cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 2, matchMode: 'prefix' }),
        NEVER_CANCELLED,
        report,
      )) as unknown[];
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
    it("reports the setting's value, not the over-fetch slice, as the ceiling", async () => {
      const p = createMethodsProvider(1, async () => manyRows(1000));
      const report = vi.fn();
      const at = async (maxResultsPerCategory: number) => {
        report.mockClear();
        await p.search(
          'add',
          cfg({ methodMinQueryLength: 3, maxResultsPerCategory, maxServerScan: 400 }),
          NEVER_CANCELLED,
          report,
        );
        return report.mock.calls[0]?.[0];
      };

      // cap 60 → slice min(240, 400) = 240: the OVER-FETCH bound it, so not a ceiling hit — but the
      // reported ceiling is still 400, the number the user set.
      expect(await at(60)).toEqual({
        categoryId: 'methods',
        scanned: 240,
        ceiling: 400,
        atCeiling: false,
      });

      // One Load-more later (cap 120) → slice min(480, 400) = 400: NOW the setting is the wall.
      expect(await at(120)).toEqual({
        categoryId: 'methods',
        scanned: 400,
        ceiling: 400,
        atCeiling: true,
      });

      // And it stays 400 however far the cap is raised — the number no longer drifts.
      expect(await at(LOAD_ALL_LIMIT)).toEqual({
        categoryId: 'methods',
        scanned: 400,
        ceiling: 400,
        atCeiling: true,
      });
    });

    it('does not report at all below methodMinQueryLength (no fetch happened)', async () => {
      const p = createMethodsProvider(1, async () => manyRows(5));
      const report = vi.fn();
      await p.search('ad', cfg({ methodMinQueryLength: 3 }), NEVER_CANCELLED, report);
      expect(report).not.toHaveBeenCalled();
    });
  });
});
