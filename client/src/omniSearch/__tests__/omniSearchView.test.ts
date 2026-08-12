// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../omniSearchView.js'), 'utf8');
  new Function(source)();
  // jsdom has no layout, so scrollIntoView is unimplemented — stub it so keyboard navigation can call
  // it without noise.
  Element.prototype.scrollIntoView = vi.fn();
});

interface ViewApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    renderResults: (view: unknown) => void;
    renderTabs: (categories: unknown, scopeId: string | null) => void;
    onMessage: (event: { data: unknown }) => void;
    setActive: (i: number, scroll?: boolean) => void;
    activeRowId: () => number | null;
    rowCount: () => number;
  };
}

function api(): ViewApi {
  return (globalThis as unknown as { OmniSearchView: ViewApi }).OmniSearchView;
}

const SHELL =
  '<div id="omni">' +
  '<div id="tabs"></div>' +
  '<div id="field"><input id="query" type="text"><button id="clear" style="display:none">×</button></div>' +
  '<button id="case">Aa</button>' +
  '<button id="pin">📌</button>' +
  '<div id="breadcrumb"></div>' +
  '<div id="error"></div>' +
  '<div id="body"><ul id="results"></ul><div id="preview"></div></div>' +
  '<span id="hints"></span><span id="count"></span>' +
  '<button id="loadMore" style="display:none">Load more</button>' +
  '<button id="loadAll" style="display:none">Load all</button>' +
  '</div>';

function row(id: number, label: string, over: Record<string, unknown> = {}) {
  return {
    id,
    label,
    ranges: [],
    referenceable: false,
    categoryId: 'classes',
    categoryLabel: 'Class',
    icon: 'symbol-class',
    ...over,
  };
}

function resultsMsg(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

function mount() {
  document.body.innerHTML = SHELL;
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  vscode.postMessage.mockClear(); // drop the initial `ready`
  return { handle, vscode };
}

beforeEach(() => {
  document.body.className = '';
});

describe('Omni Search view — tabs', () => {
  it('renders an "All" tab plus one labeled tab per category, marking the active scope', () => {
    const { handle } = mount();
    handle.renderTabs(
      [
        { id: 'classes', label: 'Classes', explicitOnly: false },
        { id: 'source', label: 'Source', explicitOnly: true },
      ],
      'classes',
    );
    const tabs = Array.from(document.querySelectorAll('#tabs .tab'));
    expect(tabs.map((t) => t.textContent)).toEqual(['All', 'Classes', 'Source']);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(tabs[0].classList.contains('active')).toBe(false);
    expect(tabs[2].classList.contains('explicit')).toBe(true);
  });

  it('separates the filter tabs from the explicit search tabs with a divider', () => {
    const { handle } = mount();
    handle.renderTabs(
      [
        { id: 'classes', label: 'Classes', explicitOnly: false },
        { id: 'source', label: 'Source', explicitOnly: true },
      ],
      null,
    );
    expect(document.querySelector('#tabs .tabsep')).not.toBeNull();
    const source = Array.from(document.querySelectorAll<HTMLButtonElement>('#tabs .tab')).find(
      (t) => t.textContent === 'Source',
    )!;
    expect(source.classList.contains('explicit')).toBe(true);
  });

  it('gives every tab a tooltip describing whether it filters or searches', () => {
    const { handle } = mount();
    handle.renderTabs(
      [
        { id: 'classes', label: 'Classes', explicitOnly: false },
        { id: 'source', label: 'Source', explicitOnly: true },
      ],
      null,
    );
    const byText = (t: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('#tabs .tab')).find(
        (b) => b.textContent === t,
      )!;
    expect(byText('All').title).toBe('Search everything');
    expect(byText('Classes').title).toContain('Filter');
    expect(byText('Source').title).toContain('Search');
  });

  it('a tab click posts setScope with that category id (and null for All)', () => {
    const { handle, vscode } = mount();
    handle.renderTabs([{ id: 'methods', label: 'Methods', explicitOnly: false }], null);
    const [allTab, methodsTab] = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#tabs .tab'),
    );
    methodsTab.click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'setScope', scopeId: 'methods' });
    allTab.click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'setScope', scopeId: null });
  });
});

describe('Omni Search view — results rendering (flat, no grouping)', () => {
  it('renders a single flat row list with no group dividers', () => {
    const { handle } = mount();
    handle.renderResults(
      resultsMsg({
        rows: [row(0, 'Foo'), row(2, 'Foo>>x', { categoryId: 'methods', categoryLabel: 'Method' })],
        shownCount: 2,
      }),
    );
    expect(document.querySelectorAll('#results .divider').length).toBe(0);
    expect(handle.rowCount()).toBe(2);
    // First result becomes active automatically.
    expect(handle.activeRowId()).toBe(0);
  });

  it('wears a per-row category tag so you can tell what each row is', () => {
    const { handle } = mount();
    handle.renderResults(
      resultsMsg({
        rows: [row(0, 'Foo', { categoryLabel: 'Class' })],
        shownCount: 1,
      }),
    );
    expect(document.querySelector('#results .row .cat')!.textContent).toBe('Class');
  });

  it('highlights the matched ranges in the label with <mark>, escaping via text nodes', () => {
    const { handle } = mount();
    handle.renderResults(
      resultsMsg({
        rows: [row(0, 'Foo', { ranges: [[0, 1]] })],
        shownCount: 1,
      }),
    );
    const mark = document.querySelector('#results .row mark');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe('F');
    expect(document.querySelector('#results .row .label')!.textContent).toBe('Foo');
  });

  it('shows a ↗ reference button only on referenceable rows and posts references on click', () => {
    const { handle, vscode } = mount();
    handle.renderResults(
      resultsMsg({
        rows: [
          row(7, 'Foo', { referenceable: true, referenceTitle: 'References to Foo' }),
          row(8, 'Bar'),
        ],
        shownCount: 2,
      }),
    );
    const refBtns = document.querySelectorAll('#results .row .refbtn');
    expect(refBtns.length).toBe(1);
    (refBtns[0] as HTMLButtonElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'references', id: 7 });
  });
});

describe('Omni Search view — footer count + load controls', () => {
  it('shows "N results" and hides load buttons when nothing more is available', () => {
    const { handle } = mount();
    handle.renderResults(resultsMsg({ rows: [row(0, 'Foo')], shownCount: 1 }));
    expect(document.getElementById('count')!.textContent).toBe('1 result');
    expect((document.getElementById('loadMore') as HTMLElement).style.display).toBe('none');
  });

  it('shows "N+ shown" with load buttons when more is available, and an exact count after load-all', () => {
    const { handle } = mount();
    const rows = [row(0, 'a'), row(1, 'b')];
    handle.renderResults(resultsMsg({ rows, shownCount: 2, hasMore: true }));
    expect(document.getElementById('count')!.textContent).toBe('2+ shown');
    expect((document.getElementById('loadMore') as HTMLElement).style.display).toBe('');

    handle.renderResults(resultsMsg({ rows, shownCount: 2, hasMore: false, exact: true }));
    expect(document.getElementById('count')!.textContent).toBe('2 results');
    expect((document.getElementById('loadMore') as HTMLElement).style.display).toBe('none');
  });
});

describe('Omni Search view — case + pin indicators', () => {
  it('a config message reflects the case-sensitivity state on the always-on chip', () => {
    const { handle } = mount();
    handle.onMessage({
      data: { command: 'config', categories: [], scopeId: null, caseSensitive: true },
    });
    expect(document.getElementById('case')!.classList.contains('active')).toBe(true);
    handle.onMessage({
      data: { command: 'config', categories: [], scopeId: null, caseSensitive: false },
    });
    expect(document.getElementById('case')!.classList.contains('active')).toBe(false);
  });

  it('a pinned message reflects the pin state on the pin button', () => {
    const { handle } = mount();
    handle.onMessage({ data: { command: 'pinned', pinned: true } });
    expect(document.getElementById('pin')!.classList.contains('active')).toBe(true);
    handle.onMessage({ data: { command: 'pinned', pinned: false } });
    expect(document.getElementById('pin')!.classList.contains('active')).toBe(false);
  });

  it('the pin button click posts togglePin', () => {
    const { vscode } = mount();
    (document.getElementById('pin') as HTMLButtonElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'togglePin' });
  });
});

describe('Omni Search view — preview pane', () => {
  it('a preview message for the active row fills the preview pane', () => {
    const { handle } = mount();
    handle.renderResults(
      resultsMsg({
        rows: [row(4, 'Foo>>bar', { categoryId: 'methods', categoryLabel: 'Method' })],
        shownCount: 1,
      }),
    );
    handle.onMessage({
      data: { command: 'preview', id: 4, source: 'bar\n  ^42', title: 'Foo>>bar' },
    });
    const preview = document.getElementById('preview')!;
    expect(preview.classList.contains('has-content')).toBe(true);
    expect(preview.querySelector('.preview-src')!.textContent).toBe('bar\n  ^42');
  });

  it('ignores a stale preview for a row that is no longer active', () => {
    const { handle } = mount();
    handle.renderResults(resultsMsg({ rows: [row(4, 'Foo>>bar')], shownCount: 1 }));
    handle.onMessage({ data: { command: 'preview', id: 999, source: 'stale', title: 't' } });
    expect(document.getElementById('preview')!.classList.contains('has-content')).toBe(false);
  });

  it('highlights the searched term in the preview source (so you can see where it matched)', () => {
    const { handle } = mount();
    (document.getElementById('query') as HTMLInputElement).value = 'foo';
    handle.renderResults(
      resultsMsg({
        rows: [row(3, 'Bar>>baz', { categoryId: 'source', categoryLabel: 'Source' })],
        shownCount: 1,
      }),
    );
    handle.onMessage({
      data: { command: 'preview', id: 3, source: 'baz\n  ^self foo + fooBar', title: 'Bar>>baz' },
    });
    const marks = document.querySelectorAll('#preview .preview-src mark');
    expect(marks.length).toBe(2); // both "foo" occurrences (the second inside "fooBar")
    expect(marks[0].textContent).toBe('foo');
  });
});

describe('Omni Search view — clear button', () => {
  it('is hidden when the field is empty and shown once there is text', () => {
    mount();
    const input = document.getElementById('query') as HTMLInputElement;
    const clear = document.getElementById('clear') as HTMLElement;
    expect(clear.style.display).toBe('none');
    input.value = 'foo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(clear.style.display).toBe('');
  });

  it('clears the field and posts an empty query without closing the panel', () => {
    const { vscode } = mount();
    const input = document.getElementById('query') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vscode.postMessage.mockClear();

    (document.getElementById('clear') as HTMLButtonElement).click();
    expect(input.value).toBe('');
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'query', value: '' });
    expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: 'close' });
  });
});

describe('Omni Search view — scroll reset', () => {
  it('scrolls the result list back to the top on a fresh query but not on load-more', () => {
    const { handle } = mount();
    // jsdom does no layout, so scrollTop stays 0 — record every write instead of reading it back.
    const list = document.getElementById('results') as HTMLElement;
    const writes: number[] = [];
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: (v: number) => void writes.push(v),
    });
    const manyRows = Array.from({ length: 30 }, (_, i) => row(i, 'R' + i));

    // The initial search render resets to the top.
    handle.renderResults(resultsMsg({ rows: manyRows, shownCount: 30, hasMore: true }));
    expect(writes).toEqual([0]);

    // Load-more re-renders WITHOUT resetting scroll (keeps your place) — no new write.
    handle.renderResults(resultsMsg({ rows: manyRows, shownCount: 30, hasMore: true }));
    expect(writes).toEqual([0]);

    // A fresh query (input event) marks the next render to reset to the top again.
    const input = document.getElementById('query') as HTMLInputElement;
    input.value = 'r';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    handle.renderResults(resultsMsg({ rows: manyRows, shownCount: 30, hasMore: true }));
    expect(writes).toEqual([0, 0]);
  });
});

describe('Omni Search view — keyboard', () => {
  function keydown(over: Partial<KeyboardEventInit> & { key: string }) {
    document
      .getElementById('query')!
      .dispatchEvent(new KeyboardEvent('keydown', { ...over, bubbles: true }));
  }

  function seed(handle: ReturnType<ViewApi['wire']>) {
    handle.renderResults(resultsMsg({ rows: [row(0, 'A'), row(1, 'B')], shownCount: 2 }));
  }

  it('ArrowDown/ArrowUp move the active row', () => {
    const { handle } = mount();
    seed(handle);
    expect(handle.activeRowId()).toBe(0);
    keydown({ key: 'ArrowDown' });
    expect(handle.activeRowId()).toBe(1);
    keydown({ key: 'ArrowUp' });
    expect(handle.activeRowId()).toBe(0);
  });

  it('Enter opens the active row; Ctrl+Enter opens it beside (side=true)', () => {
    const { handle, vscode } = mount();
    seed(handle);
    keydown({ key: 'Enter' });
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'activate', id: 0, side: false });
    keydown({ key: 'Enter', ctrlKey: true });
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'activate', id: 0, side: true });
  });

  it('Alt+Enter pivots to references of the active row', () => {
    const { handle, vscode } = mount();
    seed(handle);
    keydown({ key: 'Enter', altKey: true });
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'references', id: 0 });
  });

  it('input change posts the query and marks the field busy', () => {
    const { vscode } = mount();
    const input = document.getElementById('query') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'query', value: 'foo' });
    expect(document.body.classList.contains('busy')).toBe(true);
  });

  it('the case chip click posts toggleCase', () => {
    const { vscode } = mount();
    (document.getElementById('case') as HTMLButtonElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'toggleCase' });
  });

  it('Escape closes the search view (posts close)', () => {
    const { handle, vscode } = mount();
    seed(handle);
    keydown({ key: 'Escape' });
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'close' });
  });
});
