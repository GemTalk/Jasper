import { describe, it, expect, vi } from 'vitest';
import {
  createOmniEngine,
  LOAD_ALL_LIMIT,
  providersInScope,
  PIVOT_EXIT_HINT,
  ReferenceView,
} from '../omniEngine';
import { createMethodsProvider, SERVER_OVERFETCH } from '../providers/methodsProvider';
import { SelectorSearchResult } from '../../queries/searchSelectors';
import { OMNI_DEFAULTS } from '../omniConfig';
import { CATEGORY_BY_ID, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

function classResult(name: string, score = 1): OmniResult {
  return {
    categoryId: 'classes',
    label: name,
    description: 'UserGlobals',
    score,
    ranges: [[0, 1]],
    action: {
      kind: 'openClass',
      sessionId: 1,
      dictName: 'UserGlobals',
      className: name,
      dictIndex: 1,
    },
  };
}

function methodResult(label: string, selector: string, score = 1): OmniResult {
  return {
    categoryId: 'methods',
    label,
    score,
    ranges: [],
    action: {
      kind: 'openMethod',
      sessionId: 1,
      dictName: 'UserGlobals',
      className: 'Foo',
      isMeta: false,
      category: 'accessing',
      selector,
      environmentId: 0,
      dictIndex: 0,
    },
  };
}

function dictResult(name: string): OmniResult {
  return {
    categoryId: 'dictionaries',
    label: name,
    score: 1,
    ranges: [],
    action: { kind: 'revealDictionary', sessionId: 1, dictName: name },
  };
}

/** A fake provider that returns a fixed list, honoring the effective per-category cap (so
 *  hasMore/load-more can be exercised) and recording the queries it saw. */
function fakeProvider(
  id: OmniResult['categoryId'],
  pool: OmniResult[],
  opts: { primes?: boolean } = {},
): OmniProvider & { searched: string[]; primedCount: () => number } {
  const searched: string[] = [];
  let primed = 0;
  const p: OmniProvider = {
    category: CATEGORY_BY_ID[id],
    search(query: string, c: OmniConfig) {
      searched.push(query);
      return pool.slice(0, c.maxResultsPerCategory);
    },
  };
  if (opts.primes) p.prime = () => void primed++;
  return Object.assign(p, { searched, primedCount: () => primed });
}

describe('providersInScope', () => {
  it('excludes explicit-only categories under the all-scope, includes them when scoped', () => {
    const classes = fakeProvider('classes', []);
    const source = fakeProvider('source', []); // source is explicitOnly
    const all = [classes, source];
    expect(providersInScope(all, null)).toEqual([classes]);
    expect(providersInScope(all, 'source')).toEqual([source]);
    expect(providersInScope(all, 'classes')).toEqual([classes]);
  });
});

describe('createOmniEngine', () => {
  it('presents results as one flat list with stable ids that map back to the original results', async () => {
    const engine = createOmniEngine({
      providers: [
        fakeProvider('classes', [classResult('Signal', 5)]),
        fakeProvider('methods', [methodResult('X>>size', 'size', 10)]),
      ],
      config: cfg(),
    });
    const view = await engine.search('si');
    expect(view).not.toBeNull();
    expect(view!.rows.map((r) => r.categoryLabel).sort()).toEqual(['Class', 'Method']);
    expect(view!.shownCount).toBe(2);
    // The row id is the ORIGINAL index, so it resolves back regardless of display order.
    const sizeRow = view!.rows.find((r) => r.label === 'X>>size')!;
    expect(engine.resultFor(sizeRow.id)!.label).toBe('X>>size');
  });

  it('leads with prefix matches over mere substring matches, in every case (F)', async () => {
    const engine = createOmniEngine({
      providers: [
        fakeProvider('classes', [classResult('Signal', 9), classResult('Repository', 50)]),
        fakeProvider('methods', [methodResult('X>>size', 'size', 1)]),
      ],
      config: cfg(),
    });
    const view = await engine.search('si');
    // "size" (method prefix) and "Signal" (class prefix) both beat "Repository" (only contains "si"),
    // even though Repository has the highest matcher score.
    expect(view!.rows[view!.rows.length - 1].label).toBe('Repository');
    expect(view!.rows.slice(0, 2).map((r) => r.label)).toContain('X>>size');
    expect(view!.rows.slice(0, 2).map((r) => r.label)).toContain('Signal');
  });

  it('orders implementors of the same selector alphabetically by class name (K)', async () => {
    const method = (className: string) => ({
      categoryId: 'methods' as const,
      label: `${className} class>>withAll:`,
      score: 7,
      ranges: [] as Array<[number, number]>,
      action: {
        kind: 'openMethod' as const,
        sessionId: 1,
        dictName: 'Globals',
        className,
        isMeta: true,
        category: 'Instance Creation',
        selector: 'withAll:',
        environmentId: 0,
        dictIndex: 0,
      },
    });
    // Deliberately out of order, and with class names of different LENGTHS (so the old label-length
    // tiebreak would have interleaved them: Path, Utf8, String, Collection).
    const engine = createOmniEngine({
      providers: [
        fakeProvider('methods', [
          method('Utf8'),
          method('Collection'),
          method('Path'),
          method('String'),
        ]),
      ],
      config: cfg(),
    });
    const view = await engine.search('withAll:');
    expect(view!.rows.map((r) => r.label)).toEqual([
      'Collection class>>withAll:',
      'Path class>>withAll:',
      'String class>>withAll:',
      'Utf8 class>>withAll:',
    ]);
  });

  it('a lowercase first letter leads with methods; an uppercase one leads with names (E)', async () => {
    const providers = [
      fakeProvider('classes', [classResult('Signal', 5)]),
      fakeProvider('methods', [methodResult('X>>size', 'size', 5)]),
    ];
    const lower = createOmniEngine({ providers, config: cfg() });
    const lowerView = await lower.search('si');
    // Both are prefix matches, so the case rule breaks the tie: lowercase → method first.
    expect(lowerView!.rows[0].label).toBe('X>>size');

    const upper = createOmniEngine({ providers, config: cfg() });
    const upperView = await upper.search('Si');
    expect(upperView!.rows[0].label).toBe('Signal'); // uppercase → name first
  });

  it('orders score-0 Source hits by class then selector, not by the order they arrived', async () => {
    // Source hits match a method BODY, so they all carry score 0 and there is no label match to rank
    // on. The rows below are the shape that used to come back in the stone's own traversal order —
    // and whose same-selector-only class tiebreak made the comparator cyclic (issue #532).
    const sourceHit = (className: string, selector: string): OmniResult => ({
      categoryId: 'source',
      label: `${className}>>${selector}`,
      score: 0,
      ranges: [],
      action: {
        kind: 'openMethod',
        sessionId: 1,
        dictName: 'Globals',
        className,
        isMeta: false,
        category: 'accessing',
        selector,
        environmentId: 0,
        dictIndex: 0,
      },
    });
    const engine = createOmniEngine({
      providers: [
        fakeProvider('source', [
          sourceHit('Array', 'at:'),
          sourceHit('Bag', 'at:'),
          sourceHit('Array', 'at:put:'),
          sourceHit('Array', '_basicAt:put:'),
          sourceHit('AbstractDictionary', '_at:'),
          sourceHit('AppendableString', 'at:put:'),
        ]),
      ],
      config: cfg(),
    });
    await engine.setScope('source');
    const view = await engine.search('anIndex');
    expect(view!.rows.map((r) => r.label)).toEqual([
      'AbstractDictionary>>_at:',
      'AppendableString>>at:put:',
      'Array>>_basicAt:put:',
      'Array>>at:',
      'Array>>at:put:',
      'Bag>>at:',
    ]);
  });

  it('puts a class-side method after the instance-side one of the same name', async () => {
    const sided = (className: string, isMeta: boolean): OmniResult => ({
      categoryId: 'methods',
      label: `${className}${isMeta ? ' class' : ''}>>at:`,
      score: 5,
      ranges: [],
      action: {
        kind: 'openMethod',
        sessionId: 1,
        dictName: 'Globals',
        className,
        isMeta,
        category: 'accessing',
        selector: 'at:',
        environmentId: 0,
        dictIndex: 0,
      },
    });
    const engine = createOmniEngine({
      providers: [fakeProvider('methods', [sided('Array', true), sided('Array', false)])],
      config: cfg(),
    });

    const view = await engine.search('at:');

    expect(view!.rows.map((r) => r.label)).toEqual(['Array>>at:', 'Array class>>at:']);
  });

  it('still leads with the better match when scores differ', async () => {
    const engine = createOmniEngine({
      providers: [
        fakeProvider('methods', [
          methodResult('Zebra>>at:', 'at:', 9),
          methodResult('Apple>>at:', 'at:', 1),
        ]),
      ],
      config: cfg(),
    });

    const view = await engine.search('at:');

    // Alphabetically Apple leads; the score outranks that, and only breaks ties below it.
    expect(view!.rows.map((r) => r.label)).toEqual(['Zebra>>at:', 'Apple>>at:']);
  });

  it('keeps a total order over method-like rows that are not method opens', async () => {
    // Nothing produces one today — Methods, Source and Literals all open a method. The key falls
    // back to the label so that stays true of a row some later provider puts in that bucket, rather
    // than the comparator quietly going cyclic again.
    const oddity = (label: string): OmniResult => ({
      categoryId: 'source',
      label,
      score: 0,
      ranges: [],
      action: {
        kind: 'openClass',
        sessionId: 1,
        dictName: 'Globals',
        className: label,
        dictIndex: 1,
      },
    });
    const engine = createOmniEngine({
      providers: [fakeProvider('source', [oddity('Zebra'), oddity('Apple'), oddity('Mango')])],
      config: cfg(),
    });
    await engine.setScope('source');

    const view = await engine.search('anIndex');

    expect(view!.rows.map((r) => r.label)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('ranks the same rows the same way whatever order the provider hands them back in', async () => {
    // A transitive comparator is one whose output doesn't depend on the input permutation. A cyclic
    // one lets Array.prototype.sort return anything — which is how the stone's traversal order used
    // to survive the sort untouched.
    const methods = [
      methodResult('AppendableString>>at:put:', 'at:put:', 0),
      methodResult('Array>>at:put:', 'at:put:', 0),
      methodResult('Array>>_basicAt:put:', '_basicAt:put:', 0),
      methodResult('Bag>>at:', 'at:', 0),
    ].map((m, i) => ({
      ...m,
      action: { ...m.action, className: m.label.split('>>')[0] },
      // Keep every score equal so only the tiebreaks decide, as in a Source search.
      score: 0,
      ranges: [] as Array<[number, number]>,
      categoryId: 'methods' as const,
      description: `row ${i}`,
    }));
    const rank = async (rows: OmniResult[]) => {
      const engine = createOmniEngine({
        providers: [fakeProvider('methods', rows)],
        config: cfg(),
      });
      const view = await engine.search('at');
      return view!.rows.map((r) => r.label);
    };
    const forwards = await rank(methods);
    const backwards = await rank([...methods].reverse());
    expect(forwards).toEqual(backwards);
    // Prefix matches still lead (`_basicAt:put:` merely contains "at"); the rest is class A→Z.
    expect(forwards).toEqual([
      'AppendableString>>at:put:',
      'Array>>at:put:',
      'Bag>>at:',
      'Array>>_basicAt:put:',
    ]);
  });

  it('includes only categories that returned results', async () => {
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')]), fakeProvider('methods', [])],
      config: cfg(),
    });
    const view = await engine.search('foo');
    expect(view!.rows.map((r) => r.categoryId)).toEqual(['classes']);
  });

  it('empty term yields no rows', async () => {
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')])],
      config: cfg(),
    });
    const view = await engine.search('   ');
    expect(view!.rows).toEqual([]);
    expect(view!.shownCount).toBe(0);
  });

  it('marks classes and methods referenceable (with a breadcrumb) but not dictionaries', async () => {
    const engine = createOmniEngine({
      providers: [
        fakeProvider('classes', [classResult('Foo')]),
        fakeProvider('methods', [methodResult('Foo>>bar', 'bar')]),
        fakeProvider('dictionaries', [dictResult('UserGlobals')]),
      ],
      config: cfg(),
      resolveReferences: () => null,
    });
    const view = await engine.search('x');
    const rowFor = (id: string) => view!.rows.find((r) => r.categoryId === id)!;
    expect(rowFor('classes').referenceable).toBe(true);
    expect(rowFor('classes').referenceTitle).toBe('References to Foo');
    expect(rowFor('methods').referenceTitle).toBe('Senders of bar');
    expect(rowFor('dictionaries').referenceable).toBe(false);
  });

  it('never marks rows referenceable when no reference resolver is wired', async () => {
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')])],
      config: cfg(),
    });
    const view = await engine.search('x');
    expect(view!.rows[0].referenceable).toBe(false);
  });

  it('flags hasMore when a category fills its cap; loadMore grows it; loadAll makes the count exact', async () => {
    const pool = Array.from({ length: 50 }, (_, i) => classResult(`C${i}`));
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', pool)],
      config: cfg({ maxResultsPerCategory: 5 }),
    });
    const first = await engine.search('c');
    expect(first!.shownCount).toBe(5);
    expect(first!.hasMore).toBe(true);
    expect(first!.exact).toBe(false);

    const more = await engine.loadMore(); // cap 5 -> 10
    expect(more!.shownCount).toBe(10);
    expect(more!.hasMore).toBe(true);

    const all = await engine.loadAll(); // cap jumps past the pool
    expect(all!.shownCount).toBe(50);
    expect(all!.hasMore).toBe(false);
    expect(all!.exact).toBe(true);
    expect(all!.truncations).toEqual([]); // nothing was cut off, so the count really is the total
  });

  // A provider with a server fetch ceiling (methods) can never return more than a few
  // hundred rows however high the display cap goes, so "Load all" does NOT make its count a total.
  // The engine used to derive `exact` from the cap alone, and the footer printed a bare "N results"
  // over a slice that had been cut off — the one thing it definitely wasn't.
  describe('a provider bounded by its own fetch ceiling', () => {
    /** A provider whose server slice stops at `ceiling` rows and says so, like methodsProvider. */
    function cappedProvider(id: OmniResult['categoryId'], pool: OmniResult[], ceiling: number) {
      return {
        category: CATEGORY_BY_ID[id],
        search(
          _q: string,
          c: OmniConfig,
          _t: unknown,
          report?: (t: {
            categoryId: string;
            scanned: number;
            ceiling: number;
            atCeiling: boolean;
          }) => void,
        ) {
          const fetched = pool.slice(0, Math.min(c.maxResultsPerCategory, ceiling));
          if (fetched.length >= ceiling) {
            report?.({ categoryId: id, scanned: ceiling, ceiling, atCeiling: true });
          }
          return fetched;
        },
      } as OmniProvider;
    }

    it('never reports exact after loadAll, and marks the count as a floor', async () => {
      const pool = Array.from({ length: 500 }, (_, i) => methodResult(`Foo>>m${i}`, `m${i}`));
      const engine = createOmniEngine({
        providers: [cappedProvider('methods', pool, 200)],
        config: cfg({ maxResultsPerCategory: 20 }),
      });

      const first = await engine.search('m');
      expect(first!.shownCount).toBe(20); // the display cap binds first, well under the ceiling
      expect(first!.truncations).toEqual([]);

      const all = await engine.loadAll();
      expect(all!.shownCount).toBe(200); // the ceiling bound it, not the 100_000 display cap
      // Names the scope and the number, so the footer can say "Methods scan capped at 200".
      expect(all!.truncations).toEqual([
        {
          categoryId: 'methods',
          categoryLabel: 'Methods',
          scanned: 200,
          ceiling: 200,
          atCeiling: true,
        },
      ]);
      expect(all!.exact).toBe(false); // <- the bug: this used to be true
    });

    it('marks the count as a floor even when the display cap was not filled', async () => {
      // The Load-more path that walks the cap PAST the ceiling: 60 -> 120 -> 180 -> 240 with only 200
      // rows reachable. `hasMore` goes false (200 < 240) and the cap is nowhere near LOAD_ALL_LIMIT,
      // so without `truncated` the footer fell through to a bare, exact-looking "200 results".
      const pool = Array.from({ length: 500 }, (_, i) => methodResult(`Foo>>m${i}`, `m${i}`));
      const engine = createOmniEngine({
        providers: [cappedProvider('methods', pool, 200)],
        config: cfg({ maxResultsPerCategory: 60 }),
      });

      await engine.search('m');
      await engine.loadMore(); // 120
      await engine.loadMore(); // 180
      const view = await engine.loadMore(); // 240 — past the ceiling

      expect(view!.shownCount).toBe(200);
      expect(view!.hasMore).toBe(false);
      expect(view!.exact).toBe(false);
      expect(view!.truncations).toHaveLength(1);
    });

    it('does not mark a term whose results fit under the ceiling', async () => {
      const pool = Array.from({ length: 3 }, (_, i) => methodResult(`Foo>>m${i}`, `m${i}`));
      const engine = createOmniEngine({
        providers: [cappedProvider('methods', pool, 200)],
        config: cfg({ maxResultsPerCategory: 20 }),
      });

      await engine.search('m');
      const all = await engine.loadAll();
      expect(all!.shownCount).toBe(3);
      expect(all!.truncations).toEqual([]);
      expect(all!.exact).toBe(true);
    });

    // The JOIN: every test above uses a FAKE capped provider, so none of them exercises the real clamp
    // `min(maxResultsPerCategory × SERVER_OVERFETCH, maxServerScan)`. This wires the REAL
    // methodsProvider into the REAL engine and drives Load All, which is the gesture a user reaches for
    // when they want everything — the exact path where the old code claimed an exact total.
    describe('Load All against the real methodsProvider', () => {
      const selectorRows = (n: number): SelectorSearchResult[] =>
        Array.from({ length: n }, (_, i) => ({
          dictName: 'Globals',
          className: 'Object',
          isMeta: false,
          selector: `addThing${i}`,
          category: 'accessing',
        }));

      it('asks the stone for exactly maxServerScan and reports it as the ceiling', async () => {
        const SCAN = 400;
        // Far more matches than the ceiling, so the scan is genuinely cut off.
        const runSearch = vi.fn((_t: string, limit: number) => selectorRows(limit));
        const engine = createOmniEngine({
          providers: [createMethodsProvider(1, runSearch)],
          config: cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 20, maxServerScan: SCAN }),
        });

        await engine.search('add');
        const all = await engine.loadAll();

        // Load All raises the display cap to LOAD_ALL_LIMIT, whose over-fetch dwarfs the ceiling — so
        // the ceiling is provably the binding limit here, and the stone is asked for exactly it.
        expect(LOAD_ALL_LIMIT * SERVER_OVERFETCH).toBeGreaterThan(SCAN);
        expect(runSearch).toHaveBeenLastCalledWith('add', SCAN, true);

        // ...and the view carries what the footer needs to SHOW the message: the scope, the configured
        // number, and atCeiling (Load-more cannot get past it).
        expect(all!.truncations).toEqual([
          {
            categoryId: 'methods',
            categoryLabel: 'Methods',
            scanned: SCAN,
            ceiling: SCAN,
            atCeiling: true,
          },
        ]);
        expect(all!.exact).toBe(false); // never an exact total over a cut-off scan
        expect(all!.shownCount).toBe(SCAN);
      });

      it('reports NO truncation from Load All when the term fits under the ceiling', async () => {
        const runSearch = vi.fn(() => selectorRows(12)); // fewer matches than any limit asked for
        const engine = createOmniEngine({
          providers: [createMethodsProvider(1, runSearch)],
          config: cfg({ methodMinQueryLength: 3, maxResultsPerCategory: 20, maxServerScan: 400 }),
        });

        await engine.search('add');
        const all = await engine.loadAll();

        expect(all!.truncations).toEqual([]);
        expect(all!.exact).toBe(true); // Load All really did fetch everything
        expect(all!.shownCount).toBe(12);
      });
    });

    it('taints the whole run when only ONE of several in-scope providers is truncated', async () => {
      // The all-scope fan-out: classes is exhaustive, methods is not. The footer speaks for the whole
      // list, so one bounded provider is enough to make the total a floor.
      const methods = Array.from({ length: 500 }, (_, i) => methodResult(`Foo>>m${i}`, `m${i}`));
      const engine = createOmniEngine({
        providers: [
          fakeProvider('classes', [classResult('Foo')]),
          cappedProvider('methods', methods, 200),
        ],
        config: cfg({ maxResultsPerCategory: 20 }),
      });

      await engine.search('m');
      const all = await engine.loadAll();
      expect(all!.truncations).toEqual([
        {
          categoryId: 'methods',
          categoryLabel: 'Methods',
          scanned: 200,
          ceiling: 200,
          atCeiling: true,
        },
      ]);
      expect(all!.exact).toBe(false);
    });
  });

  it('a fresh search term after Load-all restarts at the base cap instead of staying exhaustive', async () => {
    const pool = Array.from({ length: 50 }, (_, i) => classResult(`C${i}`));
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', pool)],
      config: cfg({ maxResultsPerCategory: 5 }),
    });

    await engine.search('C');
    await engine.loadAll();
    const fresh = await engine.search('c');

    expect(fresh!.shownCount).toBe(5);
    expect(fresh!.hasMore).toBe(true);
    expect(fresh!.exact).toBe(false);
  });

  it('setScope narrows to a single category and re-runs the current term', async () => {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    const source = fakeProvider('source', [
      { ...methodResult('Foo>>bar', 'bar'), categoryId: 'source' },
    ]);
    const engine = createOmniEngine({ providers: [classes, source], config: cfg() });
    await engine.search('foo');
    expect(classes.searched).toEqual(['foo']); // source excluded from the all-scope
    expect(source.searched).toEqual([]);

    await engine.setScope('source');
    expect(source.searched).toEqual(['foo']); // now the explicit-only source runs
    expect(engine.state().scopeId).toBe('source');
  });

  it('toggleCase flips the flag and re-runs', async () => {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    const engine = createOmniEngine({ providers: [classes], config: cfg() });
    await engine.search('foo');
    expect(engine.state().caseSensitive).toBe(false);
    await engine.toggleCase();
    expect(engine.state().caseSensitive).toBe(true);
    expect(classes.searched).toEqual(['foo', 'foo']); // re-ran the same term
  });

  it('prime runs each provider prime once', async () => {
    const classes = fakeProvider('classes', [], { primes: true });
    const engine = createOmniEngine({ providers: [classes], config: cfg() });
    await engine.prime();
    expect(classes.primedCount()).toBe(1);
  });

  it('pivots to a row references view, filters within it, then restores the prior search', async () => {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    const refView: ReferenceView = {
      title: 'References to Foo',
      results: [methodResult('A>>useFoo', 'useFoo'), methodResult('B>>alsoFoo', 'alsoFoo')],
    };
    const engine = createOmniEngine({
      providers: [classes],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const search = await engine.search('foo');
    const classRowId = search!.rows[0].id;

    const pivot = await engine.pivot(classRowId);
    expect(pivot!.pivot).toBe(true);
    expect(pivot!.pivotTitle).toBe('References to Foo');
    expect(pivot!.shownCount).toBe(2);
    // Reference rows are not themselves further pivotable.
    expect(pivot!.rows.every((r) => !r.referenceable)).toBe(true);
    expect(engine.state().pivot).toBe(true);

    // Typing filters the loaded reference rows client-side (no new provider fan-out).
    const filtered = await engine.search('also');
    expect(filtered!.shownCount).toBe(1);
    expect(filtered!.rows[0].label).toBe('B>>alsoFoo');
    expect(classes.searched).toEqual(['foo']); // provider not re-queried during the pivot

    const back = await engine.exitPivot();
    expect(back!.pivot).toBe(false);
    expect(back!.rows[0].label).toBe('Foo'); // prior search restored
  });

  it('loads a row references into a sticky preview list without disturbing the search list', async () => {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    const refView: ReferenceView = {
      title: 'References to Foo',
      target: 'Foo',
      results: [methodResult('A>>useFoo', 'useFoo'), methodResult('B>>alsoFoo', 'alsoFoo')],
    };
    const engine = createOmniEngine({
      providers: [classes],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const search = await engine.search('foo');
    const classRowId = search!.rows[0].id;

    const preview = await engine.referencesFor(classRowId);

    expect(preview!.title).toBe('References to Foo');
    expect(preview!.highlightTerm).toBe('Foo');
    expect(preview!.rows.map((r) => r.label)).toEqual(['A>>useFoo', 'B>>alsoFoo']);
    expect(engine.state().pivot).toBe(false);
    expect(engine.resultFor(classRowId)!.label).toBe('Foo'); // search list + ids untouched
    expect(classes.searched).toEqual(['foo']); // no re-query of the search providers
  });

  it('resolves a preview reference row back to its result for opening its source', async () => {
    const refView: ReferenceView = {
      title: 'References to Foo',
      results: [methodResult('A>>useFoo', 'useFoo'), methodResult('B>>alsoFoo', 'alsoFoo')],
    };
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')])],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const search = await engine.search('foo');

    const preview = await engine.referencesFor(search!.rows[0].id);
    const secondRow = preview!.rows.find((r) => r.label === 'B>>alsoFoo')!;

    expect(engine.referenceResultFor(secondRow.id)!.label).toBe('B>>alsoFoo');
  });

  it('references preview is null without a resolver or on a non-referenceable row', async () => {
    const withResolver = createOmniEngine({
      providers: [fakeProvider('dictionaries', [dictResult('UserGlobals')])],
      config: cfg(),
      resolveReferences: () => null,
    });
    const dictView = await withResolver.search('user');
    expect(await withResolver.referencesFor(dictView!.rows[0].id)).toBeNull(); // not referenceable

    const noResolver = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')])],
      config: cfg(),
    });
    const classView = await noResolver.search('foo');
    expect(await noResolver.referencesFor(classView!.rows[0].id)).toBeNull(); // no resolver wired
  });

  it('pivot is a no-op without a resolver or on a non-referenceable row', async () => {
    const engine = createOmniEngine({
      providers: [fakeProvider('dictionaries', [dictResult('UserGlobals')])],
      config: cfg(),
      resolveReferences: () => null,
    });
    const view = await engine.search('user');
    const rowId = view!.rows[0].id;
    expect(await engine.pivot(rowId)).toBeNull(); // dictionary → not referenceable
    expect(engine.state().pivot).toBe(false);
  });

  it('the pivot breadcrumb names its own way out (Esc), so the exit is discoverable', async () => {
    const refView: ReferenceView = {
      title: 'References to Foo',
      results: [methodResult('A>>useFoo', 'useFoo'), methodResult('B>>alsoFoo', 'alsoFoo')],
    };
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')])],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const search = await engine.search('foo');

    const pivot = await engine.pivot(search!.rows[0].id);
    expect(pivot!.pivotHint).toBe(PIVOT_EXIT_HINT);
    expect(PIVOT_EXIT_HINT).toContain('Esc');
    // The hint is its OWN field, so the title stays the plain name of the list and each host decides
    // how (or whether) to show the way out. Glued into the title, the only way to style or drop the
    // hint would be to split the string back apart.
    expect(pivot!.pivotTitle).toBe('References to Foo');

    // The hint must survive filtering inside the pivot — that is exactly when a user is looking for
    // the way out, and the pivot branch of runSearch rebuilds the view.
    const filtered = await engine.search('also');
    expect(filtered!.pivotTitle).toBe('References to Foo');
    expect(filtered!.pivotHint).toBe(PIVOT_EXIT_HINT);
  });

  it('the sticky preview references list keeps a CLEAN title (no Esc hint)', async () => {
    // In `referencesInPreview` mode there is no pivot to escape from — Esc closes the panel — so the
    // hint would be a lie in the preview pane's header.
    const refView: ReferenceView = {
      title: 'References to Foo',
      target: 'Foo',
      results: [methodResult('A>>useFoo', 'useFoo')],
    };
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')])],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const search = await engine.search('foo');

    const preview = await engine.referencesFor(search!.rows[0].id);
    expect(preview!.title).toBe('References to Foo');
    expect(preview!.title).not.toContain('Esc');
  });

  it('supersedes a slow in-flight search (returns null for the stale run)', async () => {
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((res) => (releaseFirst = res));
    let call = 0;
    const slow: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      async search() {
        call++;
        if (call === 1) await gate; // first call blocks until released
        return [classResult('Foo')];
      },
    };
    const engine = createOmniEngine({ providers: [slow], config: cfg() });
    const firstP = engine.search('fo');
    const secondP = engine.search('foo'); // supersedes the first
    releaseFirst!();
    const [first, second] = await Promise.all([firstP, secondP]);
    expect(first).toBeNull(); // stale run discarded
    expect(second).not.toBeNull();
  });
});

/**
 * The references pivot used to ignore the selected scope while CLAIMING to apply it.
 *
 * Before the fix: `runSearch` returned early through its pivot branch, so a `setScope` during a pivot
 * changed nothing on screen, yet the reply's chrome carried the new `scopeId` and the tab lit up as
 * active. The scope was then applied silently when the pivot was dismissed, narrowing a search the
 * user never asked to narrow.
 *
 * The decision these tests pin: a scope belongs to the SEARCH, not to a references view (every pivot
 * row is a method — see `methodRowsToResults` — so filtering them by scope is meaningless), therefore
 * picking a scope LEAVES the pivot and applies the scope to the restored search.
 */
describe('createOmniEngine — scope vs. the references pivot', () => {
  const refView: ReferenceView = {
    title: 'References to Foo',
    results: [methodResult('A>>useFoo', 'useFoo'), methodResult('B>>alsoFoo', 'alsoFoo')],
  };

  /** Search 'foo' in the all-scope (a class hit AND a method hit), then pivot on the class row. */
  async function pivotedEngine() {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    const methods = fakeProvider('methods', [methodResult('Bar>>foo', 'foo')]);
    const engine = createOmniEngine({
      providers: [classes, methods],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const search = await engine.search('foo');
    expect(search!.rows.map((r) => r.label).sort()).toEqual(['Bar>>foo', 'Foo']);
    const classRow = search!.rows.find((r) => r.label === 'Foo')!;
    const pivot = await engine.pivot(classRow.id);
    expect(pivot!.pivot).toBe(true);
    expect(pivot!.rows.map((r) => r.label)).toEqual(['A>>useFoo', 'B>>alsoFoo']);
    return { engine, classes, methods };
  }

  it('picking a scope during a pivot LEAVES the pivot instead of silently doing nothing', async () => {
    const { engine } = await pivotedEngine();

    const view = await engine.setScope('classes');

    expect(view!.pivot).toBe(false); // no longer a references view…
    expect(engine.state().pivot).toBe(false); // …and the engine agrees
    expect(view!.pivotTitle).toBeUndefined();
    expect(view!.pivotHint).toBeUndefined(); // no pivot, so nothing to escape from
    // The reference rows are gone: what is shown is the SEARCH, narrowed to the chosen scope.
    expect(view!.rows.map((r) => r.label)).toEqual(['Foo']);
    expect(engine.state().scopeId).toBe('classes');
  });

  it('the tab no longer lies: the shown rows match the scope the chrome reports', async () => {
    const { engine } = await pivotedEngine();

    const view = await engine.setScope('methods');

    // Before the fix this returned the 2 reference rows while reporting scopeId 'methods'.
    expect(engine.state().scopeId).toBe('methods');
    expect(view!.rows.map((r) => r.label)).toEqual(['Bar>>foo']);
    expect(view!.rows.some((r) => r.label.endsWith('useFoo'))).toBe(false);
  });

  it('no silent narrowing on the way out — there is no pivot left to exit', async () => {
    const { engine } = await pivotedEngine();

    await engine.setScope('classes');

    // The old bug's second half: Esc/← after a scope click re-ran the search THEN, applying a filter
    // the user could not see. The scope change already restored the list, so the exit is a no-op.
    expect(await engine.exitPivot()).toBeNull();
    expect(engine.state().pivot).toBe(false);
  });

  it('re-runs the restored search itself rather than reusing the pivot rows', async () => {
    const { engine, classes, methods } = await pivotedEngine();
    expect(classes.searched).toEqual(['foo']); // pivoting does not re-query
    expect(methods.searched).toEqual(['foo']);

    await engine.setScope('classes');

    expect(classes.searched).toEqual(['foo', 'foo']); // the restored search really ran
    expect(methods.searched).toEqual(['foo']); // out of scope now, so not re-queried
  });

  it('a scope chosen BEFORE the pivot still survives an Esc exit (unchanged behavior)', async () => {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    const methods = fakeProvider('methods', [methodResult('Bar>>foo', 'foo')]);
    const engine = createOmniEngine({
      providers: [classes, methods],
      config: cfg(),
      resolveReferences: () => refView,
    });
    await engine.setScope('classes');
    const search = await engine.search('foo');
    expect(search!.rows.map((r) => r.label)).toEqual(['Foo']);

    await engine.pivot(search!.rows[0].id);
    const back = await engine.exitPivot();

    // Deliberate: this scope was applied to a search the user could SEE being narrowed, so Esc must
    // put that same narrowed search back. Only a scope picked *during* a pivot is the bug.
    expect(back!.pivot).toBe(false);
    expect(back!.rows.map((r) => r.label)).toEqual(['Foo']);
    expect(engine.state().scopeId).toBe('classes');
  });

  it('clearing the box stays a FILTER RESET inside the pivot — Esc is the way out', async () => {
    const { engine } = await pivotedEngine();

    const filtered = await engine.search('also');
    expect(filtered!.rows.map((r) => r.label)).toEqual(['B>>alsoFoo']);

    const cleared = await engine.search('');

    // Deliberate decision (Eric's call): clearing widens back to every reference row rather than
    // escaping, because an empty filter matching everything is the honest reading of "clear". The
    // discoverability half is handled by the breadcrumb naming Esc — see PIVOT_EXIT_HINT.
    expect(cleared!.pivot).toBe(true);
    expect(engine.state().pivot).toBe(true);
    expect(cleared!.rows.map((r) => r.label)).toEqual(['A>>useFoo', 'B>>alsoFoo']);

    const back = await engine.exitPivot();
    expect(back!.pivot).toBe(false);
    expect(back!.rows.map((r) => r.label).sort()).toEqual(['Bar>>foo', 'Foo']);
  });
});

describe('createOmniEngine — out-of-order reference and pivot results', () => {
  it("supersedes a slow reference load so its rows cannot overwrite a newer row's", async () => {
    const rowA = classResult('Alpha');
    const rowB = classResult('Beta');
    const refsForA: ReferenceView = {
      title: 'References to Alpha',
      target: 'Alpha',
      results: [methodResult('X>>usesAlpha', 'usesAlpha')],
    };
    const refsForB: ReferenceView = {
      title: 'References to Beta',
      target: 'Beta',
      results: [methodResult('Y>>usesBeta', 'usesBeta')],
    };
    let releaseA: (() => void) | undefined;
    const gate = new Promise<void>((res) => (releaseA = res));
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [rowA, rowB])],
      config: cfg(),
      // Alpha is the slow one and resolves LAST, exactly the order that used to corrupt the list.
      resolveReferences: async (r) => {
        if (r.label === 'Alpha') {
          await gate;
          return refsForA;
        }
        return refsForB;
      },
    });
    const search = await engine.search('a');
    const idA = search!.rows.find((r) => r.label === 'Alpha')!.id;
    const idB = search!.rows.find((r) => r.label === 'Beta')!.id;

    const slowA = engine.referencesFor(idA);
    const fastB = await engine.referencesFor(idB); // arrowed on to Beta while Alpha still resolves
    releaseA!();

    expect(await slowA).toBeNull(); // stale load discarded rather than written
    expect(fastB!.rows.map((r) => r.label)).toEqual(['Y>>usesBeta']);
    // The rows behind the ids the UI is showing are still Beta's — opening one cannot land in Alpha's.
    expect(engine.referenceResultFor(fastB!.rows[0].id)!.label).toBe('Y>>usesBeta');
  });

  it('a new search supersedes a reference load the previous term left in flight', async () => {
    let releaseRefs: (() => void) | undefined;
    const gate = new Promise<void>((res) => (releaseRefs = res));
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Alpha'), classResult('Beta')])],
      config: cfg(),
      resolveReferences: async () => {
        await gate; // still resolving when the next search lands
        return {
          title: 'References to Alpha',
          target: 'Alpha',
          results: [methodResult('X>>usesAlpha', 'usesAlpha')],
        };
      },
    });
    const search = await engine.search('a');
    const idA = search!.rows.find((r) => r.label === 'Alpha')!.id;

    const slowRefs = engine.referencesFor(idA);
    const next = await engine.search('al'); // a new term starts while the reference load is mid-flight
    releaseRefs!();

    expect(await slowRefs).toBeNull(); // superseded by the search — its rows never overwrite the list
    expect(next!.rows.map((r) => r.label).sort()).toEqual(['Alpha', 'Beta']); // the search landed intact
  });

  it('a reference load neither cancels nor is cancelled by an in-flight search', async () => {
    let releaseSearch: (() => void) | undefined;
    const gate = new Promise<void>((res) => (releaseSearch = res));
    let call = 0;
    const slow: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      async search() {
        call++;
        if (call === 2) await gate; // the SECOND search blocks, with a reference load landing meanwhile
        return [classResult('Foo')];
      },
    };
    const refView: ReferenceView = {
      title: 'References to Foo',
      target: 'Foo',
      results: [methodResult('A>>useFoo', 'useFoo')],
    };
    const engine = createOmniEngine({
      providers: [slow],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const first = await engine.search('fo');

    const searchP = engine.search('foo');
    const preview = await engine.referencesFor(first!.rows[0].id);
    releaseSearch!();

    expect(preview!.rows.map((r) => r.label)).toEqual(['A>>useFoo']); // not cancelled by the search
    // ...and it did not cancel the search either: the search's own rows land intact, not clobbered by
    // the reference load's row.
    expect((await searchP)!.rows.map((r) => r.label)).toEqual(['Foo']);
  });

  it('supersedes an earlier pivot when a second pivot is started', async () => {
    let releaseAlpha: (() => void) | undefined;
    const gate = new Promise<void>((res) => (releaseAlpha = res));
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Alpha'), classResult('Beta')])],
      config: cfg(),
      // Alpha resolves LAST — the ordering that used to let the abandoned pivot win.
      resolveReferences: async (r) => {
        if (r.label === 'Alpha') {
          await gate;
          return {
            title: 'References to Alpha',
            results: [methodResult('X>>usesAlpha', 'usesAlpha')],
          };
        }
        return { title: 'References to Beta', results: [methodResult('Y>>usesBeta', 'usesBeta')] };
      },
    });
    const search = await engine.search('a');
    const idAlpha = search!.rows.find((r) => r.label === 'Alpha')!.id;
    const idBeta = search!.rows.find((r) => r.label === 'Beta')!.id;

    const slowPivot = engine.pivot(idAlpha);
    const fastPivot = await engine.pivot(idBeta); // pivoted somewhere else before Alpha came back
    releaseAlpha!();

    expect(await slowPivot).toBeNull(); // stale pivot discarded
    expect(fastPivot!.pivotTitle).toBe('References to Beta');
    // The live list is still Beta's, so activating a row cannot open one of Alpha's references.
    expect(engine.resultFor(fastPivot!.rows[0].id)!.label).toBe('Y>>usesBeta');
    expect(engine.state().pivot).toBe(true);
  });

  it('supersedes a slow pivot so it cannot snap the view back to an abandoned reference view', async () => {
    let releasePivot: (() => void) | undefined;
    const gate = new Promise<void>((res) => (releasePivot = res));
    const engine = createOmniEngine({
      providers: [fakeProvider('classes', [classResult('Foo')])],
      config: cfg(),
      resolveReferences: async () => {
        await gate;
        return { title: 'References to Foo', results: [methodResult('A>>useFoo', 'useFoo')] };
      },
    });
    const search = await engine.search('foo');

    const pivotP = engine.pivot(search!.rows[0].id);
    const retyped = await engine.search('fo'); // a new term while the pivot is still resolving
    releasePivot!();

    expect(await pivotP).toBeNull(); // stale pivot discarded
    expect(retyped!.pivot).toBe(false);
    expect(engine.state().pivot).toBe(false); // the view stayed on the search the user asked for
    expect(engine.resultFor(retyped!.rows[0].id)!.label).toBe('Foo');
  });
});

describe('createOmniEngine — an explicit refresh vs an automatic resync', () => {
  /** A provider that reloads on `reprime`, answering a different pool each time it is asked. */
  function reloadingProvider(pools: OmniResult[][]) {
    let round = 0;
    let pool = pools[0];
    const p: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      prime: () => {
        pool = pools[Math.min(round, pools.length - 1)];
      },
      reprime: () => {
        round += 1;
        pool = pools[Math.min(round, pools.length - 1)];
      },
      search: (_q: string, c: OmniConfig) => pool.slice(0, c.maxResultsPerCategory),
    };
    return p;
  }

  it('reloads the corpora and re-runs the term when nothing is pivoted', async () => {
    // Round 2 is what a class created by a workspace doit looks like: the same query, a bigger image.
    const provider = reloadingProvider([
      [classResult('Foo')],
      [classResult('Foo'), classResult('Foo2')],
    ]);
    const engine = createOmniEngine({ providers: [provider], config: cfg() });
    await engine.prime();
    const before = await engine.search('foo');
    expect(before!.rows.map((r) => r.label)).toEqual(['Foo']);

    const after = await engine.refresh();

    expect(after!.rows.map((r) => r.label)).toEqual(['Foo', 'Foo2']);
  });

  it('re-fetches an open references list, instead of looking like a dead button', async () => {
    // The bug this pins: `resync` deliberately leaves a pivot alone, so wiring the ⟳ to it made the
    // button do nothing visible for anyone reading a senders list — the corpora reloaded silently and
    // the stale senders stayed on screen.
    const classes = fakeProvider('classes', [classResult('Foo')]);
    let senders = [methodResult('A>>useFoo', 'useFoo')];
    const engine = createOmniEngine({
      providers: [classes],
      config: cfg(),
      resolveReferences: () => ({ title: 'References to Foo', results: senders }),
    });
    const search = await engine.search('foo');
    const pivot = await engine.pivot(search!.rows[0].id);
    expect(pivot!.rows.map((r) => r.label)).toEqual(['A>>useFoo']);

    // Someone (this session or another) compiles a second sender.
    senders = [methodResult('A>>useFoo', 'useFoo'), methodResult('B>>alsoFoo', 'alsoFoo')];

    const resynced = await engine.resync();
    expect(resynced).toBeNull(); // a commit must not disturb what the user is reading

    const refreshed = await engine.refresh();

    expect(refreshed!.pivot).toBe(true);
    expect(refreshed!.pivotTitle).toBe('References to Foo');
    expect(refreshed!.rows.map((r) => r.label)).toEqual(['A>>useFoo', 'B>>alsoFoo']);
  });

  it('keeps the filter typed into a pivot when it re-fetches', async () => {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    let senders = [methodResult('A>>useFoo', 'useFoo'), methodResult('B>>alsoFoo', 'alsoFoo')];
    const engine = createOmniEngine({
      providers: [classes],
      config: cfg(),
      resolveReferences: () => ({ title: 'References to Foo', results: senders }),
    });
    const search = await engine.search('foo');
    await engine.pivot(search!.rows[0].id);
    const filtered = await engine.search('also');
    expect(filtered!.rows.map((r) => r.label)).toEqual(['B>>alsoFoo']);

    senders = [...senders, methodResult('C>>alsoFooToo', 'alsoFooToo')];
    const refreshed = await engine.refresh();

    // Re-fetching must not silently widen the list back to every sender — the box still says "also".
    expect(refreshed!.rows.map((r) => r.label)).toEqual(['B>>alsoFoo', 'C>>alsoFooToo']);
  });

  it('leaves the pivot when its target is gone, rather than showing senders of nothing', async () => {
    const classes = fakeProvider('classes', [classResult('Foo')]);
    let refView: ReferenceView | null = {
      title: 'References to Foo',
      results: [methodResult('A>>useFoo', 'useFoo')],
    };
    const engine = createOmniEngine({
      providers: [classes],
      config: cfg(),
      resolveReferences: () => refView,
    });
    const search = await engine.search('foo');
    await engine.pivot(search!.rows[0].id);

    refView = null; // the class or method was deleted out from under the pivot

    const refreshed = await engine.refresh();

    expect(refreshed!.pivot).toBe(false);
    expect(engine.state().pivot).toBe(false);
    expect(refreshed!.rows.map((r) => r.label)).toEqual(['Foo']); // the search is back
  });
});
