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

function refRow(id: number, label: string, description?: string) {
  return { id, label, ranges: [], description, categoryId: 'methods', categoryLabel: 'Method' };
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
    expect((refBtns[0] as HTMLButtonElement).title).toContain('Alt+Enter');
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

  it('keeps working when focus is on a chrome button, not the field (e.g. after Load More)', () => {
    const { handle, vscode } = mount();
    seed(handle);

    document
      .getElementById('loadMore')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'references', id: 0 });
  });

  it('leaves a plain Enter on a focused button to that button (no row activation)', () => {
    const { handle, vscode } = mount();
    seed(handle);
    vscode.postMessage.mockClear();

    document
      .getElementById('loadMore')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: 'activate',
      id: 0,
      side: false,
    });
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

describe('Omni Search view — references in the preview pane', () => {
  function seedActive(handle: ReturnType<ViewApi['wire']>) {
    handle.renderResults(
      resultsMsg({
        rows: [row(7, 'Foo', { referenceable: true, referenceTitle: 'References to Foo' })],
        shownCount: 1,
        referencesInPreview: true,
      }),
    );
  }

  const refPreviewMsg = (forId: number, rows: unknown[]) => ({
    data: { command: 'refPreview', forId, title: 'References to Foo', highlightTerm: 'Foo', rows },
  });

  it('Alt+Enter requests references inline (not a pivot) when the mode is on', () => {
    const { handle, vscode } = mount();
    seedActive(handle);

    document
      .getElementById('query')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true }));

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'referencesInline', id: 7 });
  });

  it('the ↗ button requests references inline when the mode is on', () => {
    const { handle, vscode } = mount();
    seedActive(handle);

    (document.querySelector('#results .row .refbtn') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'referencesInline', id: 7 });
  });

  it('fills the preview pane with the senders list; clicking a row expands its inline source', () => {
    const { handle, vscode } = mount();
    seedActive(handle);

    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo'), refRow(1, 'B>>alsoFoo')]));

    const preview = document.getElementById('preview')!;
    expect(preview.querySelector('.preview-title')!.textContent).toBe('References to Foo');
    const items = preview.querySelectorAll('.preview-ref');
    expect(Array.from(items).map((i) => i.querySelector('.label')!.textContent)).toEqual([
      'A>>useFoo',
      'B>>alsoFoo',
    ]);
    (items[1] as HTMLElement).click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'previewReference', refId: 1 });
  });

  it('shows an expanded reference source with the searched symbol highlighted', () => {
    const { handle } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));

    (document.querySelector('#preview .preview-ref') as HTMLElement).click();
    handle.onMessage({
      data: { command: 'referenceSource', refId: 0, source: 'useFoo\n  ^self Foo new' },
    });

    const src = document.querySelector('#preview .preview-ref-src')!;
    expect(src.textContent).toBe('useFoo\n  ^self Foo new');
    expect(src.querySelector('mark')!.textContent).toBe('Foo');
  });

  it('collapses an expanded reference source on a second click (no reload)', () => {
    const { handle, vscode } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));
    const row = document.querySelector('#preview .preview-ref') as HTMLElement;

    row.click();
    handle.onMessage({ data: { command: 'referenceSource', refId: 0, source: 'useFoo' } });
    const src = document.querySelector('#preview .preview-ref-src') as HTMLElement;
    expect(src.style.display).not.toBe('none');

    vscode.postMessage.mockClear();
    row.click();
    expect(src.style.display).toBe('none');
    expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: 'previewReference', refId: 0 });
  });

  it('double-clicking a reference opens it in a real editor', () => {
    const { handle, vscode } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));

    (document.querySelector('#preview .preview-ref') as HTMLElement).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'openReference', refId: 0 });
  });

  it('ignores a references list whose row is no longer the active one', () => {
    const { handle } = mount();
    seedActive(handle);

    handle.onMessage(refPreviewMsg(999, [refRow(0, 'X>>y')]));

    expect(document.querySelectorAll('#preview .preview-ref').length).toBe(0);
  });

  it('shows "No references" when the list is empty', () => {
    const { handle } = mount();
    seedActive(handle);

    handle.onMessage(refPreviewMsg(7, []));

    expect(document.querySelector('#preview .preview-empty')!.textContent).toBe('No references');
  });

  it('a stale source preview for the same row does not overwrite the shown references list', () => {
    const { handle } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));

    handle.onMessage({ data: { command: 'preview', id: 7, source: 'foo def', title: 'Foo' } });

    expect(document.querySelectorAll('#preview .preview-ref').length).toBe(1);
    expect(document.querySelector('#preview .preview-src')).toBeNull();
  });

  it('a new left-row selection dismisses the references list and restores the source preview', () => {
    const { handle } = mount();
    handle.renderResults(
      resultsMsg({
        rows: [row(7, 'Foo', { referenceable: true }), row(8, 'Bar')],
        shownCount: 2,
        referencesInPreview: true,
      }),
    );
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));
    expect(document.querySelectorAll('#preview .preview-ref').length).toBe(1);

    handle.setActive(1);
    handle.onMessage({ data: { command: 'preview', id: 8, source: 'bar def', title: 'Bar' } });

    expect(document.querySelectorAll('#preview .preview-ref').length).toBe(0);
    expect(document.querySelector('#preview .preview-src')!.textContent).toBe('bar def');
  });

  it('Tab from the field dives into the open references list (not the chrome buttons)', () => {
    const { handle } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo'), refRow(1, 'B>>alsoFoo')]));
    const input = document.getElementById('query') as HTMLInputElement;
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    const items = document.querySelectorAll('#preview .preview-ref');
    expect(document.activeElement).toBe(items[0]);
  });

  it('Right arrow from the field dives into the open references list (mirror of Left)', () => {
    const { handle } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo'), refRow(1, 'B>>alsoFoo')]));
    const input = document.getElementById('query') as HTMLInputElement;
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    const items = document.querySelectorAll('#preview .preview-ref');
    expect(document.activeElement).toBe(items[0]);
  });

  it('arrows move within the list, and Up from the top hands focus back to the field', () => {
    const { handle } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo'), refRow(1, 'B>>alsoFoo')]));
    const items = document.querySelectorAll<HTMLElement>('#preview .preview-ref');
    items[0].focus();

    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);

    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);

    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(document.getElementById('query'));
  });

  it('Enter on a focused reference expands its inline source; Ctrl+Enter opens the editor', () => {
    const { handle, vscode } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo'), refRow(1, 'B>>alsoFoo')]));
    const items = document.querySelectorAll<HTMLElement>('#preview .preview-ref');
    items[1].focus();

    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'previewReference', refId: 1 });

    items[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'openReference', refId: 1 });
  });

  it('Left arrow from the list returns focus to the search field (back to the results)', () => {
    const { handle } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));
    const item = document.querySelector<HTMLElement>('#preview .preview-ref')!;
    item.focus();

    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

    expect(document.activeElement).toBe(document.getElementById('query'));
  });

  it('Escape from the list returns to the field without closing the search', () => {
    const { handle, vscode } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));
    const item = document.querySelector<HTMLElement>('#preview .preview-ref')!;
    item.focus();

    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.activeElement).toBe(document.getElementById('query'));
    expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: 'close' });
  });

  it('typing in the search bar dismisses the references list', () => {
    const { handle } = mount();
    seedActive(handle);
    handle.onMessage(refPreviewMsg(7, [refRow(0, 'A>>useFoo')]));
    expect(document.querySelectorAll('#preview .preview-ref').length).toBe(1);

    const input = document.getElementById('query') as HTMLInputElement;
    input.value = 'fo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    handle.onMessage({ data: { command: 'preview', id: 7, source: 'foo def', title: 'Foo' } });

    expect(document.querySelectorAll('#preview .preview-ref').length).toBe(0);
    expect(document.querySelector('#preview .preview-src')!.textContent).toBe('foo def');
  });
});
