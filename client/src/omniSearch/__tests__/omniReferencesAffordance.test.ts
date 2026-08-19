// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderOmniHtml } from '../omniSearchShared';

// "It isn't obvious when you're searching by references. Consider a visual affordance similar to the
// case-sensitivity toggle button." We add a #refindicator chip (styled like #case) that
// appears whenever the panel is showing references/senders — in BOTH the classic list pivot and the
// default sticky preview-pane list — and clicking it exits back to the normal search. We also repair
// the #breadcrumb, which the stylesheet hid with `display:none` while the view "showed" it by clearing
// the inline style (so it never actually appeared).

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../omniSearchView.js'), 'utf8');
  new Function(source)();
  Element.prototype.scrollIntoView = vi.fn();
});

interface ViewApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    renderResults: (view: unknown) => void;
    onMessage: (event: { data: unknown }) => void;
    setActive: (i: number, scroll?: boolean) => void;
    activeRowId: () => number | null;
  };
}

function api(): ViewApi {
  return (globalThis as unknown as { OmniSearchView: ViewApi }).OmniSearchView;
}

// Same element set the real HTML renders, including the new #refindicator chip.
const SHELL =
  '<div id="omni">' +
  '<div id="tabs"></div>' +
  '<div id="searchbar">' +
  '<div id="field"><input id="query" type="text"><button id="clear" style="display:none">×</button></div>' +
  '<button id="case">Aa</button>' +
  '<button id="refindicator" aria-pressed="false" style="display:none">↗ References</button>' +
  '<button id="pin">📌</button>' +
  '</div>' +
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
    referenceable: true,
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
  const chip = document.getElementById('refindicator')!;
  const crumb = document.getElementById('breadcrumb')!;
  return { handle, vscode, chip, crumb };
}

beforeEach(() => {
  document.body.className = '';
});

describe('references affordance', () => {
  it('keeps the references chip hidden on an ordinary (non-pivot) search', () => {
    const { handle, chip } = mount();
    handle.renderResults(resultsMsg({ rows: [row(0, 'Foo')], shownCount: 1 }));
    expect(chip.style.display).toBe('none');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the chip AND a working breadcrumb in the classic list pivot', () => {
    const { handle, chip, crumb } = mount();
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Foo>>bar', { categoryLabel: 'Method' })],
        shownCount: 1,
        pivot: true,
        pivotTitle: 'References to Foo',
      }),
    });
    expect(chip.style.display).toBe('inline-block');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    // The breadcrumb must actually be visible — the bug was `display:''` falling back to the
    // stylesheet's `display:none`. It is now an explicit 'block'.
    expect(crumb.textContent).toBe('References to Foo');
    expect(crumb.style.display).toBe('block');
  });

  it('shows the chip for the default sticky preview-pane references list', () => {
    const { handle, chip } = mount();
    handle.renderResults(resultsMsg({ rows: [row(0, 'Foo')], shownCount: 1 }));
    expect(chip.style.display).toBe('none'); // source preview → hidden
    handle.onMessage({
      data: {
        command: 'refPreview',
        forId: 0,
        title: 'Senders of #bar',
        rows: [{ id: 100, label: 'Baz>>qux', ranges: [] }],
        highlightTerm: 'bar',
      },
    });
    expect(chip.style.display).toBe('inline-block');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides the chip again once a new left-row selection returns the pane to source', () => {
    const { handle, chip } = mount();
    handle.renderResults(resultsMsg({ rows: [row(0, 'Foo'), row(1, 'Bar')], shownCount: 2 }));
    handle.onMessage({
      data: {
        command: 'refPreview',
        forId: 0,
        title: 'Senders of #bar',
        rows: [],
        highlightTerm: '',
      },
    });
    expect(chip.style.display).toBe('inline-block');
    handle.setActive(1); // pick another result → back to source preview
    expect(chip.style.display).toBe('none');
  });

  it('clicking the chip in the list pivot posts `back`', () => {
    const { handle, vscode, chip } = mount();
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Foo>>bar', { categoryLabel: 'Method' })],
        shownCount: 1,
        pivot: true,
        pivotTitle: 'References to Foo',
      }),
    });
    chip.click();
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'back' }));
  });

  it('clicking the chip in preview-refs mode dismisses the refs list and restores the source preview', () => {
    vi.useFakeTimers();
    try {
      const { handle, vscode, chip } = mount();
      const preview = document.getElementById('preview')!;
      handle.renderResults(resultsMsg({ rows: [row(0, 'Foo')], shownCount: 1 }));
      handle.onMessage({
        data: {
          command: 'refPreview',
          forId: 0,
          title: 'Senders of #bar',
          rows: [{ id: 100, label: 'Baz>>qux', ranges: [] }],
          highlightTerm: 'bar',
        },
      });
      expect(chip.style.display).toBe('inline-block');
      expect(preview.textContent).toContain('Baz>>qux'); // the refs list really is on screen

      vscode.postMessage.mockClear();
      chip.click();
      expect(chip.style.display).toBe('none');
      // The observable dismissal: re-selecting the active row takes the pane out of refs mode and
      // re-requests its source preview (debounced). Without that, the refs rows would linger.
      vi.advanceTimersByTime(300);
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'preview', id: 0 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('in-panel error banner (dead-affordance repair, same bug as the breadcrumb)', () => {
  it('actually shows an error message, then hides on clear', () => {
    const { handle } = mount();
    const err = document.getElementById('error')!;
    handle.onMessage({ data: { command: 'error', message: 'Your session was terminated.' } });
    expect(err.textContent).toBe('Your session was terminated.');
    // Was the bug: `display:''` fell back to the stylesheet's `display:none`. Now explicit 'block'.
    expect(err.style.display).toBe('block');
    handle.onMessage({ data: { command: 'error', message: '' } });
    expect(err.style.display).toBe('none');
  });
});

describe('references affordance — rendered HTML/CSS', () => {
  for (const showPin of [false, true]) {
    it(`renderOmniHtml includes the #refindicator chip and its style (showPin=${showPin})`, () => {
      const html = renderOmniHtml({ showPin });
      expect(html).toContain('id="refindicator"');
      expect(html).toContain('#refindicator {');
    });
  }
});

describe('the pivot breadcrumb carries its exit hint as a separate, quieter aside', () => {
  it('renders the hint in its own element, leaving the title text plain', () => {
    const { handle, crumb } = mount();
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Foo>>bar', { categoryLabel: 'Method' })],
        shownCount: 1,
        pivot: true,
        pivotTitle: 'References to Foo',
        pivotHint: 'Esc to go back',
      }),
    });
    const hint = crumb.querySelector('.crumb-hint');
    expect(hint?.textContent).toBe('Esc to go back');
    // The title is the breadcrumb's own text, NOT a string with the hint concatenated into it: the
    // view can dim the hint (and a host could drop it) without splitting text back apart.
    expect(crumb.firstChild?.textContent).toBe('References to Foo');
    expect(crumb.style.display).toBe('block');
  });

  it('shows the title alone when the host offers no hint', () => {
    const { handle, crumb } = mount();
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Foo>>bar', { categoryLabel: 'Method' })],
        shownCount: 1,
        pivot: true,
        pivotTitle: 'References to Foo',
      }),
    });
    expect(crumb.querySelector('.crumb-hint')).toBeNull();
    expect(crumb.textContent).toBe('References to Foo');
  });

  it('takes the hint away with the breadcrumb when the pivot is left', () => {
    const { handle, crumb } = mount();
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Foo>>bar', { categoryLabel: 'Method' })],
        shownCount: 1,
        pivot: true,
        pivotTitle: 'References to Foo',
        pivotHint: 'Esc to go back',
      }),
    });
    handle.onMessage({ data: resultsMsg({ rows: [row(0, 'Foo')], shownCount: 1 }) });
    expect(crumb.querySelector('.crumb-hint')).toBeNull(); // no stale hint left behind
    expect(crumb.textContent).toBe('');
    expect(crumb.style.display).toBe('none');
  });

  for (const showPin of [false, true]) {
    it(`styles the hint more quietly than the title (showPin=${showPin})`, () => {
      // The stylesheet is a template literal, so a rule is easy to lose; and without a rule of its own
      // the hint would look exactly like the title it is meant to sit beside.
      const html = renderOmniHtml({ showPin });
      expect(html).toMatch(/#breadcrumb \.crumb-hint \{[^}]*opacity/);
    });
  }
});
