import { describe, it, expect } from 'vitest';
import { createOmniEngine, providersInScope, ReferenceView } from '../omniEngine';
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
