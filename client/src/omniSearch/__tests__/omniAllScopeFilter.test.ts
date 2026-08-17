/**
 * #428 item #41 — scopes the user holds back from the "All" fan-out.
 *
 * The defect is that one switch (`gemstone.omniSearch.categories`) conflates two different wishes:
 * "don't spend a stone round-trip on Methods while I type" and "don't offer Methods at all". The
 * first is what people actually want, so these tests pin the distinguishing behaviour — an excluded
 * category is skipped in "All" but STILL RUNS when scoped to directly. If that ever regresses, the
 * feature has silently become a duplicate of the setting it was meant to replace.
 */
import { describe, it, expect } from 'vitest';
import { createOmniEngine, providersInScope } from '../omniEngine';
import { OMNI_DEFAULTS, readOmniConfig } from '../omniConfig';
import { resultsMessage, configMessage } from '../omniSearchShared';
import { CATEGORY_BY_ID, OmniCategoryId, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

function result(categoryId: OmniCategoryId, label: string): OmniResult {
  return {
    categoryId,
    label,
    score: 1,
    ranges: [],
    action: { kind: 'revealDictionary', sessionId: 1, dictName: label },
  };
}

/** A provider that records every query it was asked to run — so a test can prove a category was
 *  skipped entirely rather than merely producing no rows. */
function spyProvider(id: OmniCategoryId, labels: string[]) {
  const searched: string[] = [];
  const p: OmniProvider = {
    category: CATEGORY_BY_ID[id],
    search(query: string) {
      searched.push(query);
      return labels.map((l) => result(id, l));
    },
  };
  return Object.assign(p, { searched });
}

function fakeSettings(values: Record<string, unknown>) {
  return {
    get<T>(section: string, defaultValue: T): T {
      return section in values ? (values[section] as T) : defaultValue;
    },
  };
}

describe('providersInScope — the All fan-out (#41)', () => {
  const classes = spyProvider('classes', ['Array']);
  const methods = spyProvider('methods', ['Foo>>bar']);
  const source = spyProvider('source', ['Foo>>baz']);
  const all = [classes, methods, source];

  it('holds back explicit-only categories, as it always has', () => {
    const inScope = providersInScope(all, null);
    expect(inScope.map((p) => p.category.id)).toEqual(['classes', 'methods']);
  });

  it('also holds back the categories the user excluded', () => {
    const inScope = providersInScope(all, null, new Set<OmniCategoryId>(['methods']));
    expect(inScope.map((p) => p.category.id)).toEqual(['classes']);
  });

  it('still runs an excluded category when it is the chosen scope', () => {
    // The whole point: excluded from All must not mean unreachable.
    const inScope = providersInScope(all, 'methods', new Set<OmniCategoryId>(['methods']));
    expect(inScope.map((p) => p.category.id)).toEqual(['methods']);
  });

  it('defaults to excluding nothing when no set is passed (existing callers unchanged)', () => {
    expect(providersInScope(all, null).map((p) => p.category.id)).toEqual(['classes', 'methods']);
  });
});

describe('engine.setExcludedFromAll (#41)', () => {
  function engineWith(excluded: OmniCategoryId[] = []) {
    const classes = spyProvider('classes', ['Array']);
    const methods = spyProvider('methods', ['Foo>>bar']);
    const engine = createOmniEngine({
      providers: [classes, methods],
      config: cfg({ excludedFromAll: excluded }),
    });
    return { engine, classes, methods };
  }

  it('skips the excluded provider entirely — not just its rows', async () => {
    const { engine, classes, methods } = engineWith();
    await engine.search('a');
    expect(methods.searched).toEqual(['a']);

    await engine.setExcludedFromAll(['methods']);

    // The re-run asked classes again but never touched methods a second time: the cost is gone,
    // which is the point — filtering rows afterwards would still have paid the round-trip.
    expect(classes.searched).toEqual(['a', 'a']);
    expect(methods.searched).toEqual(['a']);
  });

  it('drops the excluded category from the results', async () => {
    const { engine } = engineWith();
    const before = await engine.search('a');
    expect(before?.rows.some((r) => r.categoryId === 'methods')).toBe(true);

    const after = await engine.setExcludedFromAll(['methods']);
    expect(after?.rows.some((r) => r.categoryId === 'methods')).toBe(false);
    expect(after?.rows.some((r) => r.categoryId === 'classes')).toBe(true);
  });

  it('an excluded category still searches when scoped to it', async () => {
    const { engine, methods } = engineWith(['methods']);
    await engine.search('a');
    expect(methods.searched).toEqual([]);

    const scoped = await engine.setScope('methods');
    expect(methods.searched).toEqual(['a']);
    expect(scoped?.rows.some((r) => r.categoryId === 'methods')).toBe(true);
  });

  it('seeds itself from config and reports the set in state()', async () => {
    const { engine } = engineWith(['methods']);
    expect(engine.state().excludedFromAll).toEqual(['methods']);

    await engine.setExcludedFromAll([]);
    expect(engine.state().excludedFromAll).toEqual([]);
  });

  it('ignores explicit-only ids rather than storing a no-op', async () => {
    // Source is never in All to begin with; keeping it would show a ticked-off box that changed
    // nothing.
    const { engine } = engineWith();
    await engine.setExcludedFromAll(['source', 'methods']);
    expect(engine.state().excludedFromAll).toEqual(['methods']);
  });

  it('resets the page cap, so narrowing All is a fresh question', async () => {
    const { engine } = engineWith();
    await engine.search('a');
    await engine.loadAll();
    expect((await engine.search('a'))?.exact).toBe(true);

    const after = await engine.setExcludedFromAll(['methods']);
    expect(after?.exact).toBe(false);
  });
});

describe('readOmniConfig — excludeFromAll (#41)', () => {
  it('defaults to excluding nothing', () => {
    expect(readOmniConfig(fakeSettings({})).excludedFromAll).toEqual([]);
  });

  it('keeps known ordinary categories', () => {
    const c = readOmniConfig(fakeSettings({ excludeFromAll: ['methods', 'globals'] }));
    expect(c.excludedFromAll).toEqual(['methods', 'globals']);
  });

  it('drops unknown ids from a hand-edited settings.json', () => {
    const c = readOmniConfig(fakeSettings({ excludeFromAll: ['methods', 'nonsense'] }));
    expect(c.excludedFromAll).toEqual(['methods']);
  });

  it('drops explicit-only ids, which are already outside All', () => {
    const c = readOmniConfig(
      fakeSettings({ excludeFromAll: ['source', 'literals', 'categories'] }),
    );
    expect(c.excludedFromAll).toEqual([]);
  });

  it('survives a non-array value', () => {
    const c = readOmniConfig(fakeSettings({ excludeFromAll: 'methods' }));
    expect(c.excludedFromAll).toEqual([]);
  });

  it('reads previewPane, defaulting to shown (#40)', () => {
    expect(readOmniConfig(fakeSettings({})).previewPane).toBe(true);
    expect(readOmniConfig(fakeSettings({ previewPane: false })).previewPane).toBe(false);
  });
});

describe('webview message payloads (#40 / #41)', () => {
  const view = {
    rows: [],
    shownCount: 0,
    hasMore: false,
    exact: false,
    pivot: false,
  };

  it('results messages carry the exclusions, so the menu cannot drift from the engine', () => {
    const msg = resultsMessage(view, {
      config: cfg(),
      scopeId: null,
      caseSensitive: false,
      pinned: false,
      excludedFromAll: ['methods'],
      matchMode: 'fuzzy',
    });
    expect(msg.excludedFromAll).toEqual(['methods']);
  });

  it('results messages do NOT carry previewPane', () => {
    // Guard, not a formality: the toggle is the webview's own once config has been sent, so a
    // previewPane field here would silently restore the pane on the user's next keystroke.
    const msg = resultsMessage(view, {
      config: cfg({ previewPane: true }),
      scopeId: null,
      caseSensitive: false,
      pinned: false,
      excludedFromAll: [],
      matchMode: 'fuzzy',
    });
    expect(Object.keys(msg)).not.toContain('previewPane');
  });

  it('the config message carries both starting values', () => {
    const msg = configMessage(cfg({ previewPane: false, excludedFromAll: ['methods'] }), false);
    expect(msg.previewPane).toBe(false);
    expect(msg.excludedFromAll).toEqual(['methods']);
  });
});
