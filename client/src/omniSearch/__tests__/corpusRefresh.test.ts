import { describe, it, expect } from 'vitest';
import { createClassesProvider } from '../providers/classesProvider';
import { createCategoriesProvider } from '../providers/categoriesProvider';
import { createOmniEngine } from '../omniEngine';
import { OMNI_DEFAULTS } from '../omniConfig';
import { OmniConfig, OmniProvider } from '../omniTypes';
import { ClassNameEntry } from '../../queries/getAllClassNames';
import { ClassCategoryNameEntry } from '../../queries/getAllClassCategories';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

const entry = (className: string): ClassNameEntry => ({
  className,
  dictName: 'UserGlobals',
  dictIndex: 1,
});

/** An in-memory stand-in for the stone's class corpus, plus a classes provider wired to it and a
 *  count of full reloads so a test can prove the granular path did NOT re-enumerate everything. */
function classCorpus(initial: string[]) {
  const stone = new Set(initial);
  let loads = 0;
  const provider = createClassesProvider(
    1,
    () => {
      loads++;
      return [...stone].map(entry);
    },
    (name) => (stone.has(name) ? [entry(name)] : []),
  );
  return {
    provider,
    loadCount: () => loads,
    compile: (name: string) => stone.add(name),
    remove: (name: string) => stone.delete(name),
  };
}

/** A minimal in-scope provider for a non-classes category, so scope filtering can be exercised. */
function fakeMethods(): OmniProvider {
  return {
    category: { id: 'methods', label: 'Method', explicitOnly: false } as OmniProvider['category'],
    search: () => [],
  };
}

describe('classes provider corpus refresh', () => {
  it('folds a newly compiled class into search without re-enumerating the whole image', () => {
    const corpus = classCorpus(['Foo']);
    void corpus.provider.prime?.({ isCancelled: false });

    corpus.compile('Bar');
    const changed = corpus.provider.applyChange?.(
      { kind: 'class', className: 'Bar' },
      {
        isCancelled: false,
      },
    );

    expect(changed).toBe(true);
    expect(corpus.provider.search('Ba', cfg(), { isCancelled: false })).toHaveLength(1);
    expect(corpus.loadCount()).toBe(1);
  });

  it('reports no change when a class is merely redefined', () => {
    const corpus = classCorpus(['Foo']);
    void corpus.provider.prime?.({ isCancelled: false });

    const changed = corpus.provider.applyChange?.(
      { kind: 'class', className: 'Foo' },
      {
        isCancelled: false,
      },
    );

    expect(changed).toBe(false);
  });

  it('drops a removed class on the next fold', () => {
    const corpus = classCorpus(['Foo', 'Bar']);
    void corpus.provider.prime?.({ isCancelled: false });

    corpus.remove('Bar');
    const changed = corpus.provider.applyChange?.(
      { kind: 'class', className: 'Bar' },
      {
        isCancelled: false,
      },
    );

    expect(changed).toBe(true);
    expect(corpus.provider.search('Ba', cfg(), { isCancelled: false })).toHaveLength(0);
  });

  it('reprime reloads the current corpus from scratch', () => {
    const corpus = classCorpus(['Foo']);
    void corpus.provider.prime?.({ isCancelled: false });

    corpus.compile('Bar');
    void corpus.provider.reprime?.({ isCancelled: false });

    expect(corpus.provider.search('Ba', cfg(), { isCancelled: false })).toHaveLength(1);
    expect(corpus.loadCount()).toBe(2);
  });
});

/** An in-memory class-category corpus + a lazy categories provider wired to it, tracking scans. */
function categoryCorpus(initial: string[]) {
  let bank = [...initial];
  let scans = 0;
  const provider = createCategoriesProvider(1, () => {
    scans++;
    return bank.map((category): ClassCategoryNameEntry => ({
      category,
      dictName: 'UserGlobals',
      dictIndex: 1,
    }));
  });
  return {
    provider,
    scanCount: () => scans,
    add: (category: string) => (bank = [...bank, category]),
  };
}

describe('categories provider corpus refresh', () => {
  it('scans lazily on first use and caches until invalidated', () => {
    const corpus = categoryCorpus(['Kernel-Objects']);

    void corpus.provider.search('Ker', cfg(), { isCancelled: false });
    void corpus.provider.search('Ker', cfg(), { isCancelled: false });

    expect(corpus.scanCount()).toBe(1);
  });

  it('re-scans after reprime so a new category appears', () => {
    const corpus = categoryCorpus(['Kernel-Objects']);
    void corpus.provider.search('Eric', cfg(), { isCancelled: false });

    corpus.add('Eric-Model');
    void corpus.provider.reprime?.({ isCancelled: false });

    expect(corpus.provider.search('Eric', cfg(), { isCancelled: false })).toHaveLength(1);
    expect(corpus.scanCount()).toBe(2);
  });

  it('re-scans on the next search after a class compile invalidates the cache', () => {
    const corpus = categoryCorpus(['Kernel-Objects']);
    void corpus.provider.search('Eric', cfg(), { isCancelled: false });

    corpus.add('Eric-Model');
    const changed = corpus.provider.applyChange?.(
      { kind: 'class', className: 'EricThing' },
      {
        isCancelled: false,
      },
    );

    expect(changed).toBe(false);
    expect(corpus.provider.search('Eric', cfg(), { isCancelled: false })).toHaveLength(1);
  });
});

describe('engine applyChange', () => {
  it('shows a compiled class immediately when it matches the current search', async () => {
    const corpus = classCorpus(['Foo']);
    const engine = createOmniEngine({ providers: [corpus.provider], config: cfg() });
    await engine.prime();
    expect((await engine.search('Ba'))!.rows).toHaveLength(0);

    corpus.compile('Bar');
    const view = await engine.applyChange({ kind: 'class', className: 'Bar' });

    expect(view!.rows.map((r) => r.label)).toEqual(['Bar']);
  });

  it('leaves the view untouched for a change that does not match, but still caches it', async () => {
    const corpus = classCorpus(['Foo']);
    const engine = createOmniEngine({ providers: [corpus.provider], config: cfg() });
    await engine.prime();
    await engine.search('Zz');

    corpus.compile('Bar');
    const view = await engine.applyChange({ kind: 'class', className: 'Bar' });

    expect(view).toBeNull();
    expect((await engine.search('Ba'))!.rows.map((r) => r.label)).toEqual(['Bar']);
  });

  it('ignores a class change while scoped to another category', async () => {
    const corpus = classCorpus(['Foo']);
    const engine = createOmniEngine({
      providers: [corpus.provider, fakeMethods()],
      config: cfg(),
    });
    await engine.prime();
    await engine.setScope('methods');
    await engine.search('Ba');

    corpus.compile('Bar');
    const view = await engine.applyChange({ kind: 'class', className: 'Bar' });

    expect(view).toBeNull();
  });

  it('does not redraw when the search box is empty', async () => {
    const corpus = classCorpus(['Foo']);
    const engine = createOmniEngine({ providers: [corpus.provider], config: cfg() });
    await engine.prime();

    corpus.compile('Bar');
    const view = await engine.applyChange({ kind: 'class', className: 'Bar' });

    expect(view).toBeNull();
  });
});

describe('engine applyChange — Categories scope', () => {
  it('redraws the Categories view when a class compile adds a matching category', async () => {
    const cats = categoryCorpus(['Kernel-Objects']);
    const engine = createOmniEngine({ providers: [cats.provider], config: cfg() });
    await engine.prime();
    await engine.setScope('categories');
    expect((await engine.search('Eric'))!.rows).toHaveLength(0);

    cats.add('Eric-Model');
    const view = await engine.applyChange({ kind: 'class', className: 'EricThing' });

    expect(view!.rows.map((r) => r.label)).toEqual(['Eric-Model']);
  });
});

describe('engine resync', () => {
  it('rebuilds every cached corpus and re-runs the current term', async () => {
    const corpus = classCorpus(['Foo']);
    const engine = createOmniEngine({ providers: [corpus.provider], config: cfg() });
    await engine.prime();
    expect((await engine.search('Ba'))!.rows).toHaveLength(0);

    corpus.compile('Bar');
    const view = await engine.resync();

    expect(view!.rows.map((r) => r.label)).toEqual(['Bar']);
    expect(corpus.loadCount()).toBe(2);
  });
});
