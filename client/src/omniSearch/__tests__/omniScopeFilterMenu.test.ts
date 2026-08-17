// @vitest-environment jsdom
/**
 * #428 item #41 — the in-panel scope filter (the ▽ menu).
 *
 * The engine side is covered in omniAllScopeFilter.test.ts; this covers the control itself, where
 * the subtle requirements live: the menu must offer only the categories that are genuinely a choice,
 * it must show a narrowed "All" without being opened (otherwise a missing category reads as a search
 * bug), and its Escape must dismiss the MENU rather than the whole panel.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../omniSearchView.js'), 'utf8');
  new Function(source)();
  Element.prototype.scrollIntoView = vi.fn();
});

interface WiredView {
  onMessage: (event: { data: unknown }) => void;
  scopeMenuOpen: () => boolean;
  excludedFromAll: () => string[];
}

interface ViewApi {
  wire(doc: Document, vscode: { postMessage: (m: unknown) => void }): WiredView;
}

function api(): ViewApi {
  return (globalThis as unknown as { OmniSearchView: ViewApi }).OmniSearchView;
}

const SHELL =
  '<div id="omni">' +
  '<div id="tabs"></div>' +
  '<div id="field"><input id="query" type="text"><button id="clear" style="display:none">×</button></div>' +
  '<button id="case">Aa</button>' +
  '<button id="previewToggle" aria-pressed="true">◧</button>' +
  '<span id="scopeFilterWrap"><button id="scopeFilter" aria-expanded="false">▽</button>' +
  '<div id="scopeFilterMenu" hidden></div></span>' +
  '<div id="breadcrumb"></div>' +
  '<div id="error"></div>' +
  '<div id="body"><ul id="results"></ul><div id="preview"></div></div>' +
  '<span id="count"></span>' +
  '<button id="loadMore" style="display:none">Load more</button>' +
  '<button id="loadAll" style="display:none">Load all</button>' +
  '</div>';

const CATEGORIES = [
  { id: 'classes', label: 'Classes', explicitOnly: false },
  { id: 'methods', label: 'Methods', explicitOnly: false },
  { id: 'dictionaries', label: 'Dictionaries', explicitOnly: false },
  { id: 'globals', label: 'Globals', explicitOnly: false },
  { id: 'source', label: 'Source', explicitOnly: true },
  { id: 'literals', label: 'Literals', explicitOnly: true },
  { id: 'categories', label: 'Categories', explicitOnly: true },
];

function mount(over: Record<string, unknown> = {}) {
  document.body.innerHTML = SHELL;
  document.body.className = '';
  const posted: Array<Record<string, unknown>> = [];
  const view = api().wire(document, {
    postMessage: (m: unknown) => posted.push(m as Record<string, unknown>),
  });
  view.onMessage({
    data: { command: 'config', categories: CATEGORIES, excludedFromAll: [], ...over },
  });
  posted.length = 0;
  return { view, posted };
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
const options = () => Array.from(document.querySelectorAll('#scopeFilterMenu .scope-opt'));
const optionFor = (id: string) =>
  document.querySelector(`#scopeFilterMenu [data-scope-id="${id}"]`) as HTMLElement;

describe('scope filter menu (#41)', () => {
  it('starts closed and opens on click', () => {
    const { view } = mount();
    expect(view.scopeMenuOpen()).toBe(false);

    el('scopeFilter').click();

    expect(view.scopeMenuOpen()).toBe(true);
    expect(el('scopeFilter').getAttribute('aria-expanded')).toBe('true');
  });

  it('offers only the categories that are genuinely a choice', () => {
    // Source/Literals/Categories are already outside All permanently — listing them would present a
    // choice that does nothing.
    mount();
    el('scopeFilter').click();

    expect(options().map((o) => o.getAttribute('data-scope-id'))).toEqual([
      'classes',
      'methods',
      'dictionaries',
      'globals',
    ]);
  });

  it('shows every scope as included by default', () => {
    mount();
    el('scopeFilter').click();

    for (const o of options()) expect(o.getAttribute('aria-checked')).toBe('true');
    expect(el('scopeFilter').classList.contains('active')).toBe(false);
  });

  it('reflects an exclusion that came from settings', () => {
    mount({ excludedFromAll: ['methods'] });
    el('scopeFilter').click();

    expect(optionFor('methods').getAttribute('aria-checked')).toBe('false');
    expect(optionFor('classes').getAttribute('aria-checked')).toBe('true');
  });

  it('unchecking a scope tells the host', () => {
    const { posted } = mount();
    el('scopeFilter').click();

    optionFor('methods').click();

    expect(posted).toContainEqual({
      command: 'setExcludedFromAll',
      excludedFromAll: ['methods'],
    });
  });

  it('re-checking a scope puts it back', () => {
    const { posted, view } = mount({ excludedFromAll: ['methods'] });
    el('scopeFilter').click();

    optionFor('methods').click();

    expect(view.excludedFromAll()).toEqual([]);
    expect(posted).toContainEqual({ command: 'setExcludedFromAll', excludedFromAll: [] });
  });

  it('stays open while several scopes are toggled', () => {
    // Deselecting two scopes shouldn't cost two trips to the menu.
    const { view } = mount();
    el('scopeFilter').click();

    optionFor('methods').click();
    optionFor('globals').click();

    expect(view.scopeMenuOpen()).toBe(true);
    expect(view.excludedFromAll()).toEqual(['methods', 'globals']);
  });

  it('marks the button when All is narrowed, so it shows without opening the menu', () => {
    mount();
    el('scopeFilter').click();
    optionFor('methods').click();

    expect(el('scopeFilter').classList.contains('active')).toBe(true);
    expect(el('scopeFilter').title).toContain('narrowed');
  });

  it('Escape closes the menu and NOT the panel', () => {
    const { view, posted } = mount();
    el('scopeFilter').click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(view.scopeMenuOpen()).toBe(false);
    expect(posted.map((m) => m.command)).not.toContain('close');
  });

  it('Escape still closes the panel when the menu is not open', () => {
    const { posted } = mount();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(posted.map((m) => m.command)).toContain('close');
  });

  it('a click elsewhere dismisses the menu', () => {
    const { view } = mount();
    el('scopeFilter').click();

    el('query').click();

    expect(view.scopeMenuOpen()).toBe(false);
  });

  it('takes the engine as the authority on every results message', () => {
    // Drift guard: if the engine refused an exclusion (an explicit-only id, say), the menu must
    // follow the engine rather than keep showing the user's optimistic click.
    const { view } = mount();
    el('scopeFilter').click();
    optionFor('methods').click();
    expect(view.excludedFromAll()).toEqual(['methods']);

    view.onMessage({
      data: {
        command: 'results',
        rows: [],
        shownCount: 0,
        hasMore: false,
        exact: false,
        pivot: false,
        categories: CATEGORIES,
        scopeId: null,
        caseSensitive: false,
        pinned: false,
        excludedFromAll: [],
      },
    });

    expect(view.excludedFromAll()).toEqual([]);
    expect(el('scopeFilter').classList.contains('active')).toBe(false);
  });
});
