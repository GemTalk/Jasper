// @vitest-environment jsdom
/**
 * #428 item #42 — switching the match algorithm from the panel.
 *
 * `gemstone.omniSearch.matchMode` was settings-only, so comparing fuzzy against prefix meant leaving
 * the search, editing settings.json, and starting over. The engine owns the live value exactly as it
 * owns case-sensitivity.
 *
 * The subtle one is the pivot: `filterPivot` used to read `config.matchMode` — the value baked in at
 * engine construction — so a live change would silently do nothing while a references list was open.
 * That is pinned below.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOmniView, mountOmniView, WiredOmniView } from './omniViewHarness';
import { createOmniEngine, ReferenceView } from '../omniEngine';
import { OMNI_DEFAULTS } from '../omniConfig';
import { CATEGORY_BY_ID, OmniCategoryId, OmniConfig, OmniProvider, OmniResult } from '../omniTypes';

const cfg = (over: Partial<OmniConfig> = {}): OmniConfig => ({ ...OMNI_DEFAULTS, ...over });

function classResult(name: string): OmniResult {
  return {
    categoryId: 'classes',
    label: name,
    score: 1,
    ranges: [],
    action: {
      kind: 'openClass',
      sessionId: 1,
      dictName: 'UserGlobals',
      className: name,
      dictIndex: 1,
    },
  };
}

/** A provider that reports the config it was handed, so a test can prove the LIVE mode reached it. */
function modeSpyProvider(id: OmniCategoryId, names: string[]) {
  const modes: string[] = [];
  const p: OmniProvider = {
    category: CATEGORY_BY_ID[id],
    search(_query: string, c: OmniConfig) {
      modes.push(c.matchMode);
      return names.map(classResult);
    },
  };
  return Object.assign(p, { modes });
}

describe('engine.setMatchMode (#42)', () => {
  it('hands the live algorithm to the providers', async () => {
    const provider = modeSpyProvider('classes', ['Array']);
    const engine = createOmniEngine({ providers: [provider], config: cfg({ matchMode: 'fuzzy' }) });

    await engine.search('arr');
    expect(provider.modes).toEqual(['fuzzy']);

    await engine.setMatchMode('prefix');
    expect(provider.modes).toEqual(['fuzzy', 'prefix']);
    expect(engine.state().matchMode).toBe('prefix');
  });

  it('seeds itself from the setting', () => {
    const engine = createOmniEngine({ providers: [], config: cfg({ matchMode: 'substring' }) });
    expect(engine.state().matchMode).toBe('substring');
  });

  it('re-runs the current term without being asked again', async () => {
    const provider = modeSpyProvider('classes', ['Array']);
    const engine = createOmniEngine({ providers: [provider], config: cfg() });
    await engine.search('arr');

    const view = await engine.setMatchMode('prefix');

    expect(view).not.toBeNull();
    expect(view?.rows.length).toBe(1);
  });

  it('keeps a raised page cap, matching toggleCase', async () => {
    // Changing HOW the same corpus is matched is not a new question, so a Load-all is not undone.
    // (Contrast setScope / setExcludedFromAll, which do reset it.)
    const provider = modeSpyProvider('classes', ['Array']);
    const engine = createOmniEngine({ providers: [provider], config: cfg() });
    await engine.search('arr');
    await engine.loadAll();

    const view = await engine.setMatchMode('prefix');

    expect(view?.exact).toBe(true);
  });

  it('applies to the reference pivot filter too', async () => {
    // The regression this file exists for: filterPivot once read the CONSTRUCTION-time matchMode, so
    // switching algorithms did nothing while a references list was open.
    const provider = modeSpyProvider('classes', ['Array']);
    const references: ReferenceView = {
      title: 'Senders of foo',
      results: [classResult('Collection'), classResult('OrderedCollection')],
    };
    const engine = createOmniEngine({
      providers: [provider],
      config: cfg({ matchMode: 'fuzzy' }),
      resolveReferences: () => references,
    });
    await engine.search('arr');
    await engine.pivot(0);

    // Fuzzy: "oc" matches OrderedCollection as a subsequence, and Collection too (o@1, c@5) — so on
    // its own it can't tell the live mode from the construction-time one. The prefix assertion below
    // is the unambiguous discriminator.
    const fuzzy = await engine.search('oc');
    expect(fuzzy?.rows.some((r) => r.label === 'OrderedCollection')).toBe(true);

    await engine.setMatchMode('prefix');
    const prefixed = await engine.search('oc');

    // Under prefix, neither name starts with "oc" — so the live mode demonstrably reached the pivot.
    expect(prefixed?.rows.length).toBe(0);
  });
});

// ── The panel chip ──────────────────────────────────────────────────

beforeAll(loadOmniView);

const mount = (matchMode = 'fuzzy') => mountOmniView({ categories: [], matchMode });

const chip = () => document.getElementById('matchMode') as HTMLElement;

/** Push the mode the engine settled on back to the view, as a real results message would. */
function echo(view: WiredOmniView, matchMode: string) {
  view.onMessage({
    data: {
      command: 'results',
      rows: [],
      shownCount: 0,
      hasMore: false,
      exact: false,
      pivot: false,
      categories: [],
      scopeId: null,
      caseSensitive: false,
      pinned: false,
      matchMode,
    },
  });
}

describe('match-algorithm chip (#42)', () => {
  it('shows the current algorithm as its label, so it needs no legend', () => {
    mount('substring');
    expect(chip().textContent).toBe('Substring');
    expect(chip().title).toContain('the text must appear as-is');
  });

  it('cycles fuzzy → substring → prefix → fuzzy', () => {
    const { view, posted } = mount('fuzzy');

    chip().click();
    expect(posted.at(-1)).toEqual({ command: 'setMatchMode', mode: 'substring' });

    // The engine is the authority: the chip advances from whatever it last echoed back, not from
    // its own optimistic guess — so each step is driven by a real results message.
    echo(view, 'substring');
    chip().click();
    expect(posted.at(-1)).toEqual({ command: 'setMatchMode', mode: 'prefix' });

    echo(view, 'prefix');
    chip().click();
    expect(posted.at(-1)).toEqual({ command: 'setMatchMode', mode: 'fuzzy' });
  });

  it('follows the engine rather than its own optimistic click', () => {
    const { view } = mount('fuzzy');
    chip().click();

    view.onMessage({
      data: {
        command: 'results',
        rows: [],
        shownCount: 0,
        hasMore: false,
        exact: false,
        pivot: false,
        categories: [],
        scopeId: null,
        caseSensitive: false,
        pinned: false,
        matchMode: 'substring',
      },
    });

    expect(view.matchMode()).toBe('substring');
    expect(chip().textContent).toBe('Substring');
  });

  it('ignores an unknown mode instead of showing a blank chip', () => {
    const { view } = mount('fuzzy');
    view.onMessage({ data: { command: 'config', categories: [], matchMode: 'nonsense' } });
    expect(view.matchMode()).toBe('fuzzy');
    expect(chip().textContent).toBe('Fuzzy');
  });
});
