// @vitest-environment jsdom
/**
 * #428 item #40 — the preview-pane toggle.
 *
 * The pane is `flex: 1 1 45%` of the body row, which the bottom-docked panel (wide but short) can
 * least afford, so the toggle hands that width back to the result labels. Two behaviours matter and
 * neither is visible from the CSS alone: turning the pane off must also STOP the per-row source
 * fetches (that is the "lighter mode" half of the item), and the toggle must never post to the host,
 * because hiding a pane has no effect on the search.
 *
 * jsdom has no layout engine, so these assert the mechanism (class, aria, messages) rather than a
 * measured width — the width itself is what Eric verifies at F5.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../omniSearchView.js'), 'utf8');
  new Function(source)();
  Element.prototype.scrollIntoView = vi.fn();
});

interface WiredView {
  renderResults: (view: unknown) => void;
  onMessage: (event: { data: unknown }) => void;
  setActive: (i: number, scroll?: boolean) => void;
  previewEnabled: () => boolean;
}

interface ViewApi {
  wire(doc: Document, vscode: { postMessage: (m: unknown) => void }): WiredView;
}

function api(): ViewApi {
  return (globalThis as unknown as { OmniSearchView: ViewApi }).OmniSearchView;
}

// The real chrome from renderOmniHtml, trimmed to what this file touches — including the two
// Round-6 controls, which the older view test's shell predates.
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

function row(id: number, label: string) {
  return {
    id,
    label,
    ranges: [],
    referenceable: false,
    categoryId: 'classes',
    categoryLabel: 'Class',
    icon: 'symbol-class',
  };
}

function mount() {
  document.body.innerHTML = SHELL;
  document.body.className = '';
  const posted: Array<Record<string, unknown>> = [];
  const view = api().wire(document, {
    postMessage: (m: unknown) => posted.push(m as Record<string, unknown>),
  });
  return { view, posted };
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
const commands = (posted: Array<Record<string, unknown>>) => posted.map((m) => m.command);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('preview-pane toggle (#40)', () => {
  it('starts from the host config — previewPane:false hides the pane before anything is searched', () => {
    const { view } = mount();

    view.onMessage({ data: { command: 'config', previewPane: false, categories: [] } });

    expect(view.previewEnabled()).toBe(false);
    expect(document.body.classList.contains('no-preview')).toBe(true);
    expect(el('previewToggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('defaults to shown when the config says previewPane:true', () => {
    const { view } = mount();

    view.onMessage({ data: { command: 'config', previewPane: true, categories: [] } });

    expect(view.previewEnabled()).toBe(true);
    expect(document.body.classList.contains('no-preview')).toBe(false);
    expect(el('previewToggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('turning it off stops the per-row source fetch — the point of the "lighter mode"', () => {
    const { view, posted } = mount();
    view.onMessage({ data: { command: 'config', previewPane: true, categories: [] } });
    view.renderResults({ rows: [row(0, 'Array'), row(1, 'Association')], shownCount: 2 });

    // Baseline: with the pane on, moving the active row asks the host for source.
    posted.length = 0;
    view.setActive(1);
    vi.advanceTimersByTime(500);
    expect(commands(posted)).toContain('preview');

    el('previewToggle').click();
    expect(view.previewEnabled()).toBe(false);

    posted.length = 0;
    view.setActive(0);
    vi.advanceTimersByTime(500);
    expect(commands(posted)).not.toContain('preview');
  });

  it('turning it back on refills the pane for the active row', () => {
    const { view, posted } = mount();
    view.onMessage({ data: { command: 'config', previewPane: false, categories: [] } });
    view.renderResults({ rows: [row(0, 'Array')], shownCount: 1 });

    posted.length = 0;
    el('previewToggle').click();
    vi.advanceTimersByTime(500);

    expect(view.previewEnabled()).toBe(true);
    expect(document.body.classList.contains('no-preview')).toBe(false);
    expect(commands(posted)).toContain('preview');
  });

  it('never tells the host — hiding a pane has no effect on the search', () => {
    const { view, posted } = mount();
    view.onMessage({ data: { command: 'config', previewPane: true, categories: [] } });

    posted.length = 0;
    el('previewToggle').click();
    el('previewToggle').click();
    vi.advanceTimersByTime(500);

    // Only the preview refill may go out; nothing that would re-run or reconfigure the search.
    for (const c of commands(posted)) expect(c).toBe('preview');
  });

  it('a results message does not undo the toggle', () => {
    // resultsMessage deliberately omits previewPane; this pins that, because re-sending it would
    // silently restore the pane on the user's next keystroke.
    const { view } = mount();
    view.onMessage({ data: { command: 'config', previewPane: true, categories: [] } });
    el('previewToggle').click();
    expect(view.previewEnabled()).toBe(false);

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
      },
    });

    expect(view.previewEnabled()).toBe(false);
    expect(document.body.classList.contains('no-preview')).toBe(true);
  });

  it('asking for references with the pane hidden switches it back on', () => {
    // The references list lives in this pane, so the gesture would otherwise do nothing visible.
    const { view } = mount();
    view.onMessage({ data: { command: 'config', previewPane: false, categories: [] } });
    view.renderResults({ rows: [row(0, 'Array')], shownCount: 1 });
    view.setActive(0, false);

    view.onMessage({
      data: {
        command: 'refPreview',
        forId: 0,
        title: 'Senders of foo',
        rows: [],
        highlightTerm: 'foo',
      },
    });

    expect(view.previewEnabled()).toBe(true);
    expect(document.body.classList.contains('no-preview')).toBe(false);
    expect(el('preview').textContent).toContain('Senders of foo');
  });
});
