import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  parseScope,
  providersInScope,
  gatherResults,
  buildItems,
  createOmniController,
  OmniQuickItem,
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
  return { categoryId, label, score, ranges: [], action: { kind: 'focusEditor', uri: label } };
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
  placeholder: string;
  busy: boolean;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  items: OmniQuickItem[];
  selectedItems: OmniQuickItem[];
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  __accept: () => Promise<void>;
}

describe('parseScope', () => {
  const enabled = OMNI_DEFAULTS.enabledCategories;
  it('strips a valid, enabled sigil into a scope + term', () => {
    expect(parseScope('c Order', enabled)).toEqual({ scopeId: 'classes', term: 'Order' });
    expect(parseScope('M at:', enabled)).toEqual({ scopeId: 'methods', term: 'at:' });
  });
  it('treats an unknown or disabled sigil as part of the term', () => {
    expect(parseScope('x foo', enabled)).toEqual({ scopeId: null, term: 'x foo' });
    expect(parseScope('c foo', ['methods'])).toEqual({ scopeId: null, term: 'c foo' });
  });
  it('returns the trimmed term with no scope for a plain query', () => {
    expect(parseScope('  Order  ', enabled)).toEqual({ scopeId: null, term: 'Order' });
  });
});

describe('providersInScope', () => {
  it('returns all when scope is null, else just the scoped category', () => {
    const ps = [fakeProvider('classes', []), fakeProvider('methods', [])];
    expect(providersInScope(ps, null)).toHaveLength(2);
    expect(providersInScope(ps, 'methods').map((p) => p.category.id)).toEqual(['methods']);
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
});

function makeController(providers: OmniProvider[], over: Partial<OmniConfig> = {}) {
  const qp = vscode.window.createQuickPick() as unknown as MockQP;
  const activate = vi.fn();
  const ctl = createOmniController({
    quickPick: qp as unknown as vscode.QuickPick<OmniQuickItem>,
    providers,
    config: cfg({ debounceMs: 0, ...over }),
    activate,
  });
  return { qp, activate, ctl };
}

describe('createOmniController', () => {
  it('primes load-once providers on start and shows the picker', async () => {
    const cls = fakeProvider('classes', [], { primes: true });
    const { qp, ctl } = makeController([cls]);
    await ctl.start();
    expect(cls.primedCount()).toBe(1);
    expect(qp.show).toHaveBeenCalled();
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
});
