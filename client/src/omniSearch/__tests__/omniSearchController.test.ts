import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  buildScopeButtons,
  titleForScope,
  providersInScope,
  gatherResults,
  buildItems,
  createOmniController,
  OmniControllerDeps,
  OmniQuickItem,
  ReferenceView,
} from '../omniSearchController';
import { OMNI_DEFAULTS } from '../omniConfig';
import {
  NEVER_CANCELLED,
  OmniConfig,
  OmniProvider,
  OmniResult,
  CATEGORY_BY_ID,
} from '../omniTypes';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

function result(categoryId: OmniResult['categoryId'], label: string, score = 1): OmniResult {
  return {
    categoryId,
    label,
    score,
    ranges: [],
    action: { kind: 'revealDictionary', sessionId: 1, dictName: label },
  };
}

/** A fake provider for a category returning a fixed list, recording prime()/search() calls. */
function fakeProvider(
  id: OmniResult['categoryId'],
  results: OmniResult[],
  opts: { primes?: boolean } = {},
): OmniProvider & { searched: string[]; primedCount: () => number } {
  const searched: string[] = [];
  let primed = 0;
  const p: OmniProvider = {
    category: CATEGORY_BY_ID[id],
    search(query: string) {
      searched.push(query);
      return results;
    },
  };
  if (opts.primes) p.prime = () => void primed++;
  return Object.assign(p, { searched, primedCount: () => primed });
}

/** The subset of QuickPick the controller touches, as the mock exposes it. */
interface MockQP {
  title: string;
  placeholder: string;
  value: string;
  busy: boolean;
  buttons: readonly unknown[];
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  items: OmniQuickItem[];
  selectedItems: OmniQuickItem[];
  activeItems: OmniQuickItem[];
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  __accept: () => Promise<void>;
}

const scopeIds = (buttons: readonly unknown[]): (string | null)[] =>
  buttons
    .filter(
      (b): b is { scopeId: string | null } => typeof b === 'object' && b !== null && 'scopeId' in b,
    )
    .map((b) => b.scopeId);

describe('buildScopeButtons', () => {
  it('shows one button per enabled category and no clear button when nothing is filtered', () => {
    const buttons = buildScopeButtons(OMNI_DEFAULTS.enabledCategories, null);

    expect(scopeIds(buttons)).toEqual([...OMNI_DEFAULTS.enabledCategories]);
    expect(buttons.every((b) => typeof b.tooltip === 'string' && b.tooltip.length > 0)).toBe(true);
  });

  it('prepends a clear-filter button while a scope is active', () => {
    const buttons = buildScopeButtons(OMNI_DEFAULTS.enabledCategories, 'methods');

    expect(scopeIds(buttons)).toEqual([null, ...OMNI_DEFAULTS.enabledCategories]);
  });

  it('draws a divider (a button with no scopeId) between the filter and search groups', () => {
    const buttons = buildScopeButtons(OMNI_DEFAULTS.enabledCategories, null);

    const dividerIndex = buttons.findIndex((b) => !('scopeId' in b));
    expect(dividerIndex).toBeGreaterThan(0); // after the filter buttons
    // Everything before the divider filters; everything after starts a search.
    expect(scopeIds(buttons.slice(0, dividerIndex))).toEqual([
      'classes',
      'methods',
      'dictionaries',
      'globals',
    ]);
    expect(scopeIds(buttons.slice(dividerIndex + 1))).toEqual(['source', 'literals', 'categories']);
  });
});

describe('titleForScope', () => {
  it('names the active category, or plain "Omni Search" for all', () => {
    expect(titleForScope(null)).toBe('Omni Search');
    expect(titleForScope('methods')).toBe('Omni Search — Methods');
  });
});

describe('providersInScope', () => {
  it('returns all when scope is null, else just the scoped category', () => {
    const ps = [fakeProvider('classes', []), fakeProvider('methods', [])];
    expect(providersInScope(ps, null)).toHaveLength(2);
    expect(providersInScope(ps, 'methods').map((p) => p.category.id)).toEqual(['methods']);
  });

  it('excludes an explicit-only category from the all-scope fan-out but runs it when scoped', () => {
    const ps = [fakeProvider('classes', []), fakeProvider('source', [])];
    expect(providersInScope(ps, null).map((p) => p.category.id)).toEqual(['classes']);
    expect(providersInScope(ps, 'source').map((p) => p.category.id)).toEqual(['source']);
  });
});

describe('gatherResults', () => {
  it('flattens results across providers in order', async () => {
    const ps = [
      fakeProvider('classes', [result('classes', 'A')]),
      fakeProvider('methods', [result('methods', 'B>>x')]),
    ];
    const out = await gatherResults('q', ps, cfg(), NEVER_CANCELLED);
    expect(out.map((r) => r.label)).toEqual(['A', 'B>>x']);
  });
  it('stops early when the token is already cancelled', async () => {
    const p = fakeProvider('classes', [result('classes', 'A')]);
    const out = await gatherResults('q', [p], cfg(), { isCancelled: true });
    expect(out).toEqual([]);
    expect(p.searched).toEqual([]); // never queried
  });
});

describe('buildItems', () => {
  it('groups by category order with a separator per non-empty category and attaches results', () => {
    const results = [result('methods', 'A>>x'), result('classes', 'A'), result('classes', 'B')];
    const items = buildItems(results);
    expect(items.map((i) => i.label)).toEqual(['Classes', 'A', 'B', 'Methods', 'A>>x']);
    const seps = items.filter((i) => i.kind === vscode.QuickPickItemKind.Separator);
    expect(seps.map((s) => s.label)).toEqual(['Classes', 'Methods']);
    const rows = items.filter((i) => i.result);
    expect(rows.every((r) => r.alwaysShow === true)).toBe(true);
    expect(rows.find((r) => r.label === 'A')?.result?.categoryId).toBe('classes');
  });
  it('omits a separator for a category with no results', () => {
    expect(buildItems([result('classes', 'A')]).map((i) => i.label)).toEqual(['Classes', 'A']);
  });

  it('puts a reference button on a method row but not on a dictionary row', () => {
    const items = buildItems([
      methodResult('Object>>printString'),
      {
        categoryId: 'dictionaries',
        label: 'UserGlobals',
        score: 1,
        ranges: [],
        action: { kind: 'revealDictionary', sessionId: 1, dictName: 'UserGlobals' },
      },
    ]);

    const method = items.find((i) => i.result?.label === 'Object>>printString');
    const dict = items.find((i) => i.result?.label === 'UserGlobals');
    expect(method?.buttons?.length).toBe(1);
    expect(dict?.buttons).toBeUndefined();
  });
});

function makeController(
  providers: OmniProvider[],
  over: Partial<OmniConfig> = {},
  resolveReferences?: OmniControllerDeps['resolveReferences'],
) {
  const qp = vscode.window.createQuickPick() as unknown as MockQP;
  const activate = vi.fn();
  const ctl = createOmniController({
    quickPick: qp as unknown as vscode.QuickPick<OmniQuickItem>,
    providers,
    config: cfg({ debounceMs: 0, ...over }),
    activate,
    resolveReferences,
  });
  return { qp, activate, ctl };
}

/** A method OmniResult (opens the method) — the shape reference rows and method hits share. */
function methodResult(label: string): OmniResult {
  const [className, selector] = label.split('>>');
  return {
    categoryId: 'methods',
    label,
    score: 0,
    ranges: [],
    action: {
      kind: 'openMethod',
      sessionId: 1,
      dictName: 'Globals',
      className,
      isMeta: false,
      category: '',
      selector,
      environmentId: 0,
      dictIndex: 0,
    },
  };
}

describe('createOmniController', () => {
  it('primes load-once providers on start and shows the picker', async () => {
    const cls = fakeProvider('classes', [], { primes: true });
    const { qp, ctl } = makeController([cls]);
    await ctl.start();
    expect(cls.primedCount()).toBe(1);
    expect(qp.show).toHaveBeenCalled();
  });

  it('publishes a category button each and the unfiltered title on start', async () => {
    const { qp, ctl } = makeController([fakeProvider('classes', []), fakeProvider('methods', [])], {
      enabledCategories: ['classes', 'methods'],
    });
    await ctl.start();
    expect(qp.title).toBe('Omni Search');
    // Classes + Methods + the case-sensitivity toggle (no clear yet; no divider without a search cat).
    expect(scopeIds(qp.buttons)).toEqual(['classes', 'methods']);
  });

  it('shows a clear-filter button while scoped and removes it when the filter is cleared', async () => {
    const { qp, ctl } = makeController([fakeProvider('classes', []), fakeProvider('methods', [])], {
      enabledCategories: ['classes', 'methods'],
    });
    await ctl.start();
    expect(scopeIds(qp.buttons)).toEqual(['classes', 'methods']);

    await ctl.setScope('methods');
    expect(scopeIds(qp.buttons)).toEqual([null, 'classes', 'methods']); // clear prepended
    expect((qp.buttons as ReadonlyArray<{ scopeId?: unknown }>)[0].scopeId).toBeNull();

    await ctl.setScope(null);
    expect(scopeIds(qp.buttons)).toEqual(['classes', 'methods']); // clear gone
  });

  it('toggles case-sensitivity for subsequent searches', async () => {
    let seen: boolean | undefined;
    const provider: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      search: (_q, c) => {
        seen = c.caseSensitive;
        return [];
      },
    };
    const { qp, ctl } = makeController([provider]);
    await ctl.start();

    await ctl.refresh('x');
    expect(seen).toBe(false); // default from settings

    await ctl.toggleCase();
    expect(seen).toBe(true); // toggle re-runs the search with the new setting
    expect(qp.title).toContain('Aa'); // ON is shown in the title, not just the button tooltip

    await ctl.toggleCase();
    expect(qp.title).not.toContain('Aa'); // OFF removes the marker
  });

  it('appends a Load more row when a scoped search fills its cap, and grows on loadMore', async () => {
    const pool = Array.from({ length: 100 }, (_, i) => result('classes', `C${i}`));
    const provider: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      search: (_q, c) => pool.slice(0, c.maxResultsPerCategory),
    };
    const { qp, ctl } = makeController([provider], { maxResultsPerCategory: 5 });
    await ctl.start();
    await ctl.setScope('classes');

    await ctl.refresh('C');
    const rows = () => qp.items.filter((i) => i.result).length;
    expect(rows()).toBe(5);
    expect(qp.items.some((i) => i.loadMore)).toBe(true);
    expect(qp.items.some((i) => i.loadAll)).toBe(true); // both rows offered
    expect(qp.items.find((i) => i.loadMore)?.detail).toContain('Showing 5'); // running count

    await ctl.loadMore();
    expect(rows()).toBe(10); // cap grew by the base page size
  });

  it('loadAll shows everything and drops the load rows', async () => {
    const pool = Array.from({ length: 42 }, (_, i) => result('classes', `C${i}`));
    const provider: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      search: (_q, c) => pool.slice(0, c.maxResultsPerCategory),
    };
    const { qp, ctl } = makeController([provider], { maxResultsPerCategory: 5 });
    await ctl.start();
    await ctl.setScope('classes');
    await ctl.refresh('C');

    await ctl.loadAll();
    expect(qp.items.filter((i) => i.result).length).toBe(42); // all of them
    expect(qp.items.some((i) => i.loadMore || i.loadAll)).toBe(false); // nothing left to load
  });

  it('offers Load more in the all-scope when any category fills its cap', async () => {
    const pool = Array.from({ length: 100 }, (_, i) => result('classes', `C${i}`));
    const provider: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      search: (_q, c) => pool.slice(0, c.maxResultsPerCategory),
    };
    const { qp, ctl } = makeController([provider], { maxResultsPerCategory: 5 });
    await ctl.start(); // no scope set — the all-scope

    await ctl.refresh('C');
    expect(qp.items.some((i) => i.loadMore)).toBe(true);
  });

  it('narrows the search to the scoped category and re-runs the current term', async () => {
    const cls = fakeProvider('classes', [result('classes', 'OrderedCollection')]);
    const methods = fakeProvider('methods', [result('methods', 'Object>>printString')]);
    const { qp, ctl } = makeController([cls, methods]);
    await ctl.start();
    await ctl.refresh('pr');

    await ctl.setScope('methods');

    expect(cls.searched).toEqual(['pr']); // not searched again once scoped out
    expect(methods.searched).toEqual(['pr', 'pr']); // searched on refresh, then on the re-run
    expect(qp.title).toBe('Omni Search — Methods');
    expect(qp.items.some((i) => i.result?.categoryId === 'classes')).toBe(false);
  });

  it('widens back to all categories when scope is set to null', async () => {
    const cls = fakeProvider('classes', [result('classes', 'OrderedCollection')]);
    const methods = fakeProvider('methods', [result('methods', 'Object>>printString')]);
    const { qp, ctl } = makeController([cls, methods]);
    await ctl.start();
    await ctl.refresh('pr');
    await ctl.setScope('methods');

    await ctl.setScope(null);

    expect(qp.title).toBe('Omni Search');
    expect(qp.items.some((i) => i.result?.categoryId === 'classes')).toBe(true);
  });

  it('pivots to references: breadcrumb title, a Back button, and the reference rows', async () => {
    const view: ReferenceView = {
      title: 'References to OrderedCollection',
      results: [methodResult('Foo>>usesOc')],
    };
    const resolve = vi.fn(() => view);
    const { qp, ctl } = makeController([fakeProvider('classes', [])], {}, resolve);
    await ctl.start();

    await ctl.pivotToReferences(result('classes', 'OrderedCollection'));

    expect(resolve).toHaveBeenCalled();
    expect(qp.title).toBe('References to OrderedCollection');
    expect((qp.buttons as ReadonlyArray<{ back?: boolean }>)[0].back).toBe(true);
    expect(qp.items.some((i) => i.result?.label === 'Foo>>usesOc')).toBe(true);
  });

  it('filters the reference rows as you type, and Back restores the prior search', async () => {
    const cls = fakeProvider('classes', [result('classes', 'OrderedCollection')]);
    const view: ReferenceView = {
      title: 'Senders of bar',
      results: [methodResult('Foo>>bar'), methodResult('Zed>>bar')],
    };
    const { qp, ctl } = makeController([cls], {}, () => view);
    await ctl.start();
    await ctl.refresh('Order');

    await ctl.pivotToReferences(result('classes', 'OrderedCollection'));
    await ctl.refresh('Foo');
    expect(qp.items.filter((i) => i.result).map((i) => i.result!.label)).toEqual(['Foo>>bar']);

    await ctl.exitPivot();
    expect(qp.title).toBe('Omni Search');
    expect(qp.items.some((i) => i.result?.label === 'OrderedCollection')).toBe(true);
  });

  it('pivots on the highlighted row for the Alt+Enter path', async () => {
    const view: ReferenceView = { title: 'Senders of foo', results: [methodResult('X>>y')] };
    const { qp, ctl } = makeController([fakeProvider('methods', [])], {}, () => view);
    await ctl.start();
    qp.activeItems = [{ label: 'A>>foo', result: methodResult('A>>foo') }];

    await ctl.pivotActiveItem();

    expect(qp.title).toBe('Senders of foo');
    expect(qp.items.some((i) => i.result?.label === 'X>>y')).toBe(true);
  });

  it('signals pivot enter/exit so the Left-arrow back binding can scope itself', async () => {
    const onPivotChange = vi.fn();
    const view: ReferenceView = { title: 'Senders of x', results: [methodResult('A>>x')] };
    const qp = vscode.window.createQuickPick() as unknown as MockQP;
    const ctl = createOmniController({
      quickPick: qp as unknown as vscode.QuickPick<OmniQuickItem>,
      providers: [fakeProvider('methods', [])],
      config: cfg({ debounceMs: 0 }),
      activate: vi.fn(),
      resolveReferences: () => view,
      onPivotChange,
    });
    await ctl.start();

    await ctl.pivotToReferences(methodResult('A>>x'));
    expect(onPivotChange).toHaveBeenLastCalledWith(true);

    await ctl.exitPivot();
    expect(onPivotChange).toHaveBeenLastCalledWith(false);
  });

  it('does nothing on Alt+Enter when no row is highlighted', async () => {
    const resolve = vi.fn();
    const { qp, ctl } = makeController([fakeProvider('methods', [])], {}, resolve);
    await ctl.start();
    qp.activeItems = [];

    await ctl.pivotActiveItem();

    expect(resolve).not.toHaveBeenCalled();
  });

  it('refresh() populates grouped items for a term and clears them for an empty term', async () => {
    const cls = fakeProvider('classes', [result('classes', 'OrderedCollection')]);
    const { qp, ctl } = makeController([cls]);
    await ctl.start();

    await ctl.refresh('Order');
    expect(qp.items.some((i) => i.result?.label === 'OrderedCollection')).toBe(true);

    await ctl.refresh('   ');
    expect(qp.items).toEqual([]);
  });

  it('activates the picked result and hides on accept', async () => {
    const cls = fakeProvider('classes', [result('classes', 'Object')]);
    const { qp, activate, ctl } = makeController([cls]);
    await ctl.start();
    await ctl.refresh('Object');

    const row = qp.items.find((i) => i.result);
    qp.selectedItems = [row as OmniQuickItem];
    await qp.__accept();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(activate).mock.calls[0][0]).toMatchObject({ label: 'Object' });
    expect(qp.hide).toHaveBeenCalled();
  });

  it('ignores a stale (superseded) search result', async () => {
    const calls: Array<(r: OmniResult[]) => void> = [];
    const provider: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      search: () => new Promise<OmniResult[]>((res) => calls.push(res)),
    };
    const { qp, ctl } = makeController([provider]);
    await ctl.start();

    const first = ctl.refresh('old'); // generation 1
    const second = ctl.refresh('new'); // generation 2 supersedes
    calls[0]([result('classes', 'StaleHit')]); // first resolves LAST
    calls[1]([result('classes', 'FreshHit')]);
    await Promise.all([first, second]);

    expect(qp.items.filter((i) => i.result).map((i) => i.result!.label)).toEqual(['FreshHit']);
  });

  it('does NOT let an in-flight search repopulate the list after the field is cleared', async () => {
    // Regression for the empty-term generation-bump fix: clearing the box must supersede a query
    // that was dispatched just before, so its late result can't flash stale hits back in.
    const calls: Array<(r: OmniResult[]) => void> = [];
    const provider: OmniProvider = {
      category: CATEGORY_BY_ID.classes,
      search: () => new Promise<OmniResult[]>((res) => calls.push(res)),
    };
    const { qp, ctl } = makeController([provider]);
    await ctl.start();

    const inflight = ctl.refresh('Order'); // dispatches a (pending) search
    await ctl.refresh('   '); // user clears the field → must bump generation
    expect(qp.items).toEqual([]);
    calls[0]([result('classes', 'StaleHit')]); // the old search finally resolves
    await inflight;

    expect(qp.items).toEqual([]); // still cleared — the stale result was discarded
  });
});
