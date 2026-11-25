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
  '<div id="scopehint" style="display:none"></div>' +
  '<div id="breadcrumb"></div>' +
  '<div id="error"></div>' +
  '<div id="body"><ul id="results"></ul><div id="preview"></div></div>' +
  '<span id="hints"></span><span id="count"></span><span id="capnote"></span>' +
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

/** The category payload the host really sends: four plain scopes + the three explicit-only ones. */
const CATEGORIES = [
  { id: 'classes', label: 'Classes', explicitOnly: false },
  { id: 'methods', label: 'Methods', explicitOnly: false },
  { id: 'dictionaries', label: 'Dictionaries', explicitOnly: false },
  { id: 'globals', label: 'Globals', explicitOnly: false },
  {
    id: 'source',
    label: 'Source',
    explicitOnly: true,
    searchHint: 'Type text to find inside method source',
  },
  { id: 'literals', label: 'Literals', explicitOnly: true },
  { id: 'categories', label: 'Class Categories', explicitOnly: true },
];

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

describe('GemStone Search view — tabs', () => {
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

describe('GemStone Search view — results rendering (flat, no grouping)', () => {
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

  describe('folding the rows nested under a row', () => {
    const classList = (over: Record<string, unknown> = {}) =>
      resultsMsg({
        rows: [
          row(0, 'Library'),
          row(1, 'addBook:', { nested: true }),
          row(2, 'lend:to:', { nested: true }),
          row(3, 'Book'),
        ],
        shownCount: 4,
        pivot: true,
        pivotTitle: 'Classes for the lending library',
        ...over,
      });
    const shown = () =>
      [...document.querySelectorAll<HTMLElement>('#results .row')]
        .filter((r) => r.style.display !== 'none')
        .map((r) => r.querySelector('.label')!.textContent);
    const twisty = () => document.querySelector<HTMLButtonElement>('#results .twisty')!;
    const arrowDown = () =>
      document
        .getElementById('query')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    it('gives a twisty only to a row with rows nested under it', () => {
      const { handle } = mount();

      handle.renderResults(classList());

      expect(document.querySelectorAll('#results .twisty').length).toBe(1);
      expect(twisty().closest('.row')!.querySelector('.label')!.textContent).toBe('Library');
    });

    it('hides and shows the nested rows from the twisty', () => {
      const { handle } = mount();
      handle.renderResults(classList());

      twisty().click();
      const folded = shown();
      twisty().click();

      expect(folded).toEqual(['Library', 'Book']);
      expect(shown()).toEqual(['Library', 'addBook:', 'lend:to:', 'Book']);
    });

    it('skips folded rows when arrowing down', () => {
      const { handle } = mount();
      handle.renderResults(classList());
      twisty().click();

      arrowDown();

      expect(handle.activeRowId()).toBe(3);
    });

    it('selects the parent when the selected row is folded away', () => {
      const { handle } = mount();
      handle.renderResults(classList());
      handle.setActive(2);

      twisty().click();

      expect(handle.activeRowId()).toBe(0);
    });

    it('keeps a fold when the same list is drawn again, but not for another list', () => {
      const { handle } = mount();
      handle.renderResults(classList());
      twisty().click();

      handle.renderResults(classList());
      const sameList = shown();
      handle.renderResults(classList({ pivotTitle: 'Classes for something else' }));

      expect(sameList).toEqual(['Library', 'Book']);
      expect(shown()).toEqual(['Library', 'addBook:', 'lend:to:', 'Book']);
    });
  });

  describe('the card that guides a reader through a trail', () => {
    const trail = (over: Record<string, unknown> = {}) =>
      resultsMsg({
        rows: [
          row(0, '1. Library>>lend:to:', { coach: 'checks the book is in, then records the loan' }),
          row(1, '2. Book>>isOnLoan', { coach: 'a book is out while it has a borrower' }),
          row(2, '3. Member>>canBorrow', { coach: 'fewer than three loans' }),
        ],
        shownCount: 3,
        pivot: true,
        pivotTitle: 'How lending works',
        ...over,
      });
    const card = () => document.querySelector<HTMLElement>('#results .coach');
    const cardButton = (label: string) =>
      [...card()!.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === label,
      );

    it('opens at the first step, under it, without hovering', () => {
      const { handle } = mount();

      handle.renderResults(trail());

      expect(card()!.textContent).toContain('Step 1 of 3');
      expect(card()!.textContent).toContain('checks the book is in, then records the loan');
      expect(card()!.previousElementSibling!.querySelector('.label')!.textContent).toBe(
        '1. Library>>lend:to:',
      );
    });

    it('moves one step at a time with Next and Back, and the selection with it', () => {
      const { handle } = mount();
      handle.renderResults(trail());

      cardButton('Next')!.click();
      const afterNext = [handle.activeRowId(), card()!.textContent];
      cardButton('Back')!.click();

      expect(afterNext[0]).toBe(1);
      expect(afterNext[1]).toContain('Step 2 of 3');
      expect(handle.activeRowId()).toBe(0);
      expect(cardButton('Back')).toBeUndefined();
    });

    it('ends with Done, which hides the card until a step is clicked', () => {
      const { handle } = mount();
      handle.renderResults(trail());
      handle.setActive(2);

      cardButton('Done')!.click();
      const hidden = card();
      document.querySelectorAll<HTMLElement>('#results .row')[1].click();

      expect(hidden).toBeNull();
      expect(card()!.textContent).toContain('Step 2 of 3');
    });

    it('opens the step it is on in an editor', () => {
      const { handle, vscode } = mount();
      handle.renderResults(trail());
      cardButton('Next')!.click();

      cardButton('Open')!.click();

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'activate', id: 1, side: false });
    });

    it('indents a step inside another, and gives its outline number on its card', () => {
      const { handle } = mount();
      handle.renderResults(
        trail({
          rows: [
            row(0, '1. Library>>lend:to:', { coach: 'a' }),
            row(1, '1.1. Book>>isOnLoan', { coach: 'b', depth: 1 }),
          ],
          shownCount: 2,
        }),
      );

      cardButton('Next')!.click();

      const inner = document.querySelectorAll<HTMLElement>('#results .row')[1];
      expect(inner.style.paddingLeft).toBe('30px');
      expect(card()!.textContent).toContain('Step 1.1 · 2 of 2');
    });

    it("marks in a step's source the sends that lead to the next steps", () => {
      const { handle } = mount();
      handle.renderResults(
        trail({
          rows: [
            row(0, '1. Regex>>run', { coach: 'a', highlight: 'pattern:ignoreCase: spansLines:' }),
            row(1, '1.1. Regex class>>pattern:ignoreCase:', { coach: 'b', depth: 1 }),
          ],
          shownCount: 2,
          pivotTarget: undefined,
        }),
      );

      handle.onMessage({
        data: {
          command: 'preview',
          id: 0,
          source:
            'run\n  m := Regex pattern: p ignoreCase: true.\n  w := Regex spansLines: p.\n  ^m size',
          title: 'Regex>>run',
        },
      });

      const marked = [...document.querySelectorAll('#preview mark')].map((m) => m.textContent);
      expect(marked).toEqual(['pattern:', 'ignoreCase:', 'spansLines:']);
    });

    it('asks the assistant about the step it is on', () => {
      const { handle, vscode } = mount();
      handle.renderResults(trail());
      cardButton('Next')!.click();

      cardButton('Ask about this')!.click();

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'askAbout', id: 1 });
    });

    it('shows no card for a list that is not a trail', () => {
      const { handle } = mount();

      handle.renderResults(resultsMsg({ rows: [row(0, 'Library')], shownCount: 1 }));

      expect(card()).toBeNull();
    });
  });

  describe('the row of tabs in Assistant Results', () => {
    const strip = () => {
      const el = document.createElement('div');
      el.id = 'resulttabs';
      document.body.prepend(el);
      return el;
    };
    const tabsMsg = (active: number) => ({
      data: {
        command: 'resultTabs',
        active,
        tabs: [
          {
            id: 1,
            label: 'Results 1',
            title: 'Methods in Library',
            question: 'What does Library do?',
          },
          { id: 2, label: 'Results 2', title: 'How lending works' },
        ],
      },
    });

    it('shows the question the selected list answers', () => {
      const { handle } = mount();
      const el = strip();

      handle.onMessage(tabsMsg(1));

      expect(el.querySelector('.results-asked')!.textContent).toBe('Asked: What does Library do?');
    });

    it('selects a tab on a click, and closes one from its ×', () => {
      const { handle, vscode } = mount();
      const el = strip();
      handle.onMessage(tabsMsg(1));
      const [, second] = el.querySelectorAll<HTMLElement>('.result-tab');

      second.click();
      second.querySelector<HTMLButtonElement>('.close')!.click();

      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'selectTab', tab: 2 });
      expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'closeTab', tab: 2 });
    });

    it('names each tab by its number, with its title and question on hover', () => {
      const { handle } = mount();
      const el = strip();

      handle.onMessage(tabsMsg(1));

      const first = el.querySelector<HTMLElement>('.result-tab')!;
      expect(first.textContent).toContain('Results 1');
      expect(first.title).toBe('Methods in Library\nAsked: What does Library do?');
    });

    it('says what goes there when there are no lists', () => {
      const { handle } = mount();
      const el = strip();

      handle.onMessage({ data: { command: 'resultTabs', tabs: [] } });

      expect(el.textContent).toMatch(/Lists the Jasper Assistant shows open here/);
    });
  });

  it('indents a row that belongs to the one above it', () => {
    const { handle } = mount();

    handle.renderResults(
      resultsMsg({
        rows: [row(0, 'Library'), row(1, 'addBook:', { nested: true })],
        shownCount: 2,
      }),
    );

    const rows = document.querySelectorAll('#results .row');
    expect([...rows].map((r) => r.classList.contains('nested'))).toEqual([false, true]);
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

  it('labels the reference button with the platform key hint the host supplies', () => {
    const { handle } = mount();

    handle.onMessage({ data: { command: 'config', categories: [], scopeId: null, keyHint: '⌥↩' } });
    handle.renderResults(
      resultsMsg({
        rows: [row(7, 'Foo', { referenceable: true, referenceTitle: 'References to Foo' })],
        shownCount: 1,
      }),
    );

    const refBtn = document.querySelector('#results .row .refbtn') as HTMLButtonElement;
    expect(refBtn.title).toContain('⌥↩');
    expect(refBtn.title).not.toContain('Alt+Enter');
  });
});

describe('GemStone Search view — footer count + load controls', () => {
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

  // A scope whose server scan is capped stops early, and before this the UI said nothing:
  // the rows just ended and the count read a bare, authoritative "200 results".
  describe('a capped scan', () => {
    const capped = [
      {
        categoryId: 'methods',
        categoryLabel: 'Methods',
        scanned: 200,
        ceiling: 200,
        atCeiling: true,
      },
    ];

    it('marks the count as a floor even with no display cap left to fill', () => {
      const { handle } = mount();
      handle.renderResults(
        resultsMsg({ rows: [row(0, 'a')], shownCount: 200, hasMore: false, truncations: capped }),
      );
      expect(document.getElementById('count')!.textContent).toBe('200+ shown');
    });

    it('names the capped scope and its limit in a VISIBLE note beside the count', () => {
      const { handle } = mount();
      handle.renderResults(
        resultsMsg({ rows: [row(0, 'a')], shownCount: 200, hasMore: false, truncations: capped }),
      );
      const note = document.getElementById('capnote') as HTMLElement;
      // `visibility`, not `display`: the note must stay a flex item so the Load buttons don't move.
      // And an EXPLICIT value, not a cleared inline style — clearing it would fall back to the
      // stylesheet, where a `display: none` would keep the note invisible while a laxer assertion
      // still passed. That combination is how the note first shipped, silently doing nothing.
      expect(note.style.visibility).toBe('visible');
      expect(note.textContent).toContain('Methods');
      expect(note.textContent).toContain('200');
      expect(note.textContent).toContain('narrow the search');
    });

    it('explains in the hover WHY the cap exists, that loading more cannot help, and the setting', () => {
      const { handle } = mount();
      handle.renderResults(
        resultsMsg({ rows: [row(0, 'a')], shownCount: 200, hasMore: false, truncations: capped }),
      );
      const help = (document.getElementById('capnote') as HTMLElement).title;
      expect(help).toContain('every selector'); // why the scan is bounded at all
      expect(help).toContain('keystroke');
      expect(help).toContain('Load all'); // why the load buttons cannot reach past it
      expect(help).toContain('gemstone.omniSearch.maxServerScan'); // how to raise it
    });

    it('names every capped scope when several cap in the same all-scope run', () => {
      const { handle } = mount();
      handle.renderResults(
        resultsMsg({
          rows: [row(0, 'a')],
          shownCount: 300,
          hasMore: false,
          truncations: [
            {
              categoryId: 'methods',
              categoryLabel: 'Methods',
              scanned: 200,
              ceiling: 200,
              atCeiling: true,
            },
            {
              categoryId: 'source',
              categoryLabel: 'Source',
              scanned: 100,
              ceiling: 100,
              atCeiling: true,
            },
          ],
        }),
      );
      const note = document.getElementById('capnote')!;
      expect(note.textContent).toContain('Methods');
      expect(note.textContent).toContain('Source');
      expect(note.textContent).toContain('100');
    });

    it('hides the note again once a search comes back uncapped', () => {
      const { handle } = mount();
      handle.renderResults(
        resultsMsg({ rows: [row(0, 'a')], shownCount: 200, hasMore: false, truncations: capped }),
      );
      handle.renderResults(
        resultsMsg({ rows: [row(0, 'a')], shownCount: 1, exact: true, truncations: [] }),
      );
      const note = document.getElementById('capnote') as HTMLElement;
      expect(note.style.visibility).toBe('hidden');
      expect(note.style.display).not.toBe('none'); // still a flex item, so the buttons stay put
      expect(note.textContent).toBe('');
      expect(document.getElementById('count')!.textContent).toBe('1 result');
    });

    // Eric's report: setting maxServerScan to 400 with the cap at 60 showed "capped at 240", then 400
    // after Load More. 240 is the over-fetch, not his setting, and it moved on every Load-more.
    it('shows the configured ceiling, not the slice that happened to be scanned', () => {
      const { handle } = mount();
      handle.renderResults(
        resultsMsg({
          rows: [row(0, 'a')],
          shownCount: 240,
          hasMore: false,
          truncations: [
            {
              categoryId: 'methods',
              categoryLabel: 'Methods',
              scanned: 240,
              ceiling: 400,
              atCeiling: true,
            },
          ],
        }),
      );
      const note = document.getElementById('capnote')!;
      expect(note.textContent).toContain('400'); // the setting
      expect(note.textContent).not.toContain('240'); // not the incidental slice
    });

    it('stays silent while the over-fetch — not the ceiling — is the bound, since Load-more helps', () => {
      const { handle } = mount();
      handle.renderResults(
        resultsMsg({
          rows: [row(0, 'a')],
          shownCount: 60,
          hasMore: true,
          truncations: [
            {
              categoryId: 'methods',
              categoryLabel: 'Methods',
              scanned: 240,
              ceiling: 400,
              atCeiling: false,
            },
          ],
        }),
      );
      // No warning: telling the user to narrow the search would be wrong while "Load more" works.
      expect((document.getElementById('capnote') as HTMLElement).style.visibility).toBe('hidden');
      // But the count still admits the results are incomplete.
      expect(document.getElementById('count')!.textContent).toBe('60+ shown');
      expect((document.getElementById('loadMore') as HTMLElement).style.display).toBe('');
    });

    // Eric: "the Load More and Load All buttons shouldn't jump around when you show the message."
    // The note is the footer's slack absorber (flex: 1 1 auto), so removing it from the flow — which is
    // what display:none does — hands the slack elsewhere and drops one of the footer's gaps, sliding the
    // buttons sideways. Both the note and the buttons can be on screen together, so this is visible.
    it('never leaves the flex flow, so the Load buttons do not move when it appears', () => {
      const { handle } = mount();
      const note = document.getElementById('capnote') as HTMLElement;
      const rows = [row(0, 'a')];

      // Capped AND still loadable: note and buttons on screen at the same time.
      handle.renderResults(
        resultsMsg({ rows, shownCount: 240, hasMore: true, truncations: capped }),
      );
      expect(note.style.visibility).toBe('visible');
      expect(note.style.display).not.toBe('none');
      expect((document.getElementById('loadMore') as HTMLElement).style.display).toBe('');

      // Uncapped again: the note goes quiet but MUST still occupy its slot.
      handle.renderResults(resultsMsg({ rows, shownCount: 20, hasMore: true, truncations: [] }));
      expect(note.style.visibility).toBe('hidden');
      expect(note.style.display).not.toBe('none');
      expect((document.getElementById('loadMore') as HTMLElement).style.display).toBe('');
    });

    it('survives a host that sends no truncations field at all (older payload)', () => {
      const { handle } = mount();
      handle.renderResults(resultsMsg({ rows: [row(0, 'a')], shownCount: 1, exact: true }));
      expect((document.getElementById('capnote') as HTMLElement).style.visibility).toBe('hidden');
      expect(document.getElementById('count')!.textContent).toBe('1 result');
    });
  });
});

describe('GemStone Search view — case + pin indicators', () => {
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

describe('GemStone Search view — preview pane', () => {
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

describe('GemStone Search view — clear button', () => {
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

describe('GemStone Search view — scroll reset', () => {
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

describe('GemStone Search view — keyboard', () => {
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

  it('Shift+Enter asks the host to reveal the active row in the Testing view', () => {
    const { handle, vscode } = mount();
    seed(handle);

    keydown({ key: 'Enter', shiftKey: true });

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'revealTest', id: 0 });
    // and not also opened
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: 'activate',
      id: 0,
      side: false,
    });
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

describe('GemStone Search view — references in the preview pane', () => {
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

// The three explicit-only scopes (Source / Literals / Class Categories) are dropped by
// `providersInScope` whenever the scope is All, so an All-scope search never runs them and nothing said
// so. Verified live: `no such element` finds 4 methods under Source and 0 under All. The hint names the
// skipped scopes and doubles as the one-click way into them.
describe('GemStone Search view — scopes skipped under All', () => {
  const hint = () => document.getElementById('scopehint') as HTMLElement;

  /** Render an All-scope result set with something typed in the field. */
  function searchUnderAll(handle: ReturnType<typeof mount>['handle'], term = 'no such element') {
    (document.getElementById('query') as HTMLInputElement).value = term;
    handle.renderTabs(CATEGORIES, null);
    handle.renderResults(resultsMsg({ rows: [], shownCount: 0, categories: CATEGORIES }));
  }

  it('names every skipped scope while the All scope is active', () => {
    const { handle } = mount();
    searchUnderAll(handle);
    expect(hint().style.display).toBe('block');
    expect(hint().textContent).toContain('Not searched here');
    expect(hint().textContent).toContain('Source');
    expect(hint().textContent).toContain('Literals');
    expect(hint().textContent).toContain('Class Categories');
    // The plain scopes ARE searched under All, so naming them would be a lie.
    expect(hint().textContent).not.toContain('Classes');
    expect(hint().textContent).not.toContain('Globals');
  });

  it('stays silent once a heavy scope is actually active', () => {
    const { handle } = mount();
    (document.getElementById('query') as HTMLInputElement).value = 'no such element';
    handle.renderTabs(CATEGORIES, 'source');
    handle.renderResults(resultsMsg({ rows: [row(0, 'Foo>>bar')], shownCount: 1 }));
    // Scoped to Source the search really does run it — a warning here would be wrong.
    expect(hint().style.display).toBe('none');
    expect(hint().textContent).toBe('');
  });

  it('stays silent with an empty field — nothing typed means nothing is being skipped', () => {
    const { handle } = mount();
    (document.getElementById('query') as HTMLInputElement).value = '';
    handle.renderTabs(CATEGORIES, null);
    handle.renderResults(resultsMsg({ rows: [], shownCount: 0 }));
    expect(hint().style.display).toBe('none');
  });

  it('stays silent when no heavy scope is enabled at all', () => {
    const { handle } = mount();
    const plainOnly = CATEGORIES.filter((c) => !c.explicitOnly);
    (document.getElementById('query') as HTMLInputElement).value = 'foo';
    handle.renderTabs(plainOnly, null);
    handle.renderResults(resultsMsg({ rows: [], shownCount: 0, categories: plainOnly }));
    // A user who turned the heavy scopes off via `categories` is not missing anything.
    expect(hint().style.display).toBe('none');
  });

  it('switches to a skipped scope when its name is clicked', () => {
    const { handle, vscode } = mount();
    searchUnderAll(handle);
    const links = hint().querySelectorAll('button');
    expect(links.length).toBe(3);
    links[0].click();
    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'setScope', scopeId: 'source' });
  });

  it('carries each scope’s own search hint as the link tooltip', () => {
    const { handle } = mount();
    searchUnderAll(handle);
    const source = hint().querySelector('button') as HTMLButtonElement;
    expect(source.title).toBe('Type text to find inside method source');
  });

  it('appears as soon as you type, without waiting for the debounced reply', () => {
    const { handle } = mount();
    handle.renderTabs(CATEGORIES, null);
    const input = document.getElementById('query') as HTMLInputElement;
    input.value = 'no such element';
    input.dispatchEvent(new Event('input'));
    expect(hint().style.display).toBe('block');
  });

  it('disappears again when the field is cleared with the x', () => {
    const { handle } = mount();
    searchUnderAll(handle);
    expect(hint().style.display).toBe('block');
    (document.getElementById('clear') as HTMLButtonElement).click();
    expect(hint().style.display).toBe('none');
    expect(hint().textContent).toBe('');
  });

  it('stays hidden during a references pivot — the rows are fetched senders, not a search', () => {
    const { handle } = mount();
    (document.getElementById('query') as HTMLInputElement).value = 'printString';

    handle.onMessage({
      data: resultsMsg({
        rows: [refRow(0, 'Foo>>bar')],
        shownCount: 1,
        pivot: true,
        pivotTitle: 'Senders of printString',
        pivotHint: 'Esc to go back',
        categories: CATEGORIES,
        scopeId: null,
      }),
    });

    // Nothing is being searched in a pivot, and each scope name would silently discard it.
    expect(hint().style.display).toBe('none');
    expect(hint().textContent).toBe('');
  });

  it('returns after leaving the pivot, back under All with a term still typed', () => {
    const { handle } = mount();
    (document.getElementById('query') as HTMLInputElement).value = 'printString';

    handle.onMessage({
      data: resultsMsg({
        rows: [refRow(0, 'Foo>>bar')],
        shownCount: 1,
        pivot: true,
        categories: CATEGORIES,
        scopeId: null,
      }),
    });
    handle.onMessage({
      data: resultsMsg({
        rows: [],
        shownCount: 0,
        pivot: false,
        categories: CATEGORIES,
        scopeId: null,
      }),
    });

    expect(hint().style.display).toBe('block');
    expect(hint().textContent).toContain('Not searched here');
  });
});

describe('search field debounce', () => {
  /** Mount, then push a host config carrying `debounceMs` (the only way the webview learns it). */
  function mountWithDebounce(debounceMs: number) {
    const m = mount();
    m.handle.onMessage({
      data: { command: 'config', categories: [], scopeId: null, debounceMs },
    });
    m.vscode.postMessage.mockClear();
    return m;
  }

  function type(text: string) {
    const input = document.getElementById('query') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function queries(vscode: { postMessage: ReturnType<typeof vi.fn> }) {
    return vscode.postMessage.mock.calls
      .map((c) => c[0] as { command: string; value?: string })
      .filter((m) => m.command === 'query')
      .map((m) => m.value);
  }

  it('coalesces a burst of keystrokes into ONE search, carrying the final text', () => {
    vi.useFakeTimers();
    try {
      const { vscode } = mountWithDebounce(120);
      type('f');
      type('fo');
      type('foo');
      expect(queries(vscode)).toEqual([]); // nothing sent while the user is still typing

      vi.advanceTimersByTime(120);
      expect(queries(vscode)).toEqual(['foo']); // one search, the finished term
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for quiet — a keystroke inside the window restarts the delay', () => {
    vi.useFakeTimers();
    try {
      const { vscode } = mountWithDebounce(120);
      type('f');
      vi.advanceTimersByTime(100); // not yet
      type('fo');
      vi.advanceTimersByTime(100); // still inside the restarted window
      expect(queries(vscode)).toEqual([]);

      vi.advanceTimersByTime(20);
      expect(queries(vscode)).toEqual(['fo']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('searches immediately when the delay is 0 (opt-out) and before any config arrives', () => {
    const immediate = mountWithDebounce(0);
    type('ab');
    expect(queries(immediate.vscode)).toEqual(['ab']);

    // No config message at all — the field must still work, just uncoalesced.
    const bare = mount();
    type('cd');
    expect(queries(bare.vscode)).toEqual(['cd']);
  });

  it('the clear button searches at once and cancels a keystroke still pending', () => {
    vi.useFakeTimers();
    try {
      const { vscode } = mountWithDebounce(120);
      type('foo');
      (document.getElementById('clear') as HTMLButtonElement).click();
      expect(queries(vscode)).toEqual(['']); // immediate, not waiting out the timer

      vi.advanceTimersByTime(500);
      expect(queries(vscode)).toEqual(['']); // and 'foo' never lands after the clear
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a nonsense debounce value, keeping the last good one in force', () => {
    vi.useFakeTimers();
    try {
      const { handle, vscode } = mountWithDebounce(120);
      // A negative value is not a valid delay; adopting it would drop the coalescing entirely.
      handle.onMessage({
        data: { command: 'config', categories: [], scopeId: null, debounceMs: -5 },
      });
      vscode.postMessage.mockClear();

      type('x');
      expect(queries(vscode)).toEqual([]); // still coalescing, so -5 was not adopted
      vi.advanceTimersByTime(120);
      expect(queries(vscode)).toEqual(['x']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Enter before the results arrive (paste, then Enter)', () => {
  function mountWithDebounce(debounceMs: number) {
    const m = mount();
    m.handle.onMessage({ data: { command: 'config', categories: [], scopeId: null, debounceMs } });
    m.vscode.postMessage.mockClear();
    return m;
  }

  function type(text: string) {
    const input = document.getElementById('query') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function enter(over: Partial<KeyboardEventInit> = {}) {
    document
      .getElementById('query')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...over, bubbles: true }));
  }

  function enterKey(key: string) {
    document
      .getElementById('query')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  function posted(vscode: { postMessage: ReturnType<typeof vi.fn> }, command: string) {
    return vscode.postMessage.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m.command === command);
  }

  it('sends the pending search at once, then opens its top row when it answers', () => {
    vi.useFakeTimers();
    try {
      const { handle, vscode } = mountWithDebounce(120);
      // Rows still on screen from the previous term must not be what Enter opens.
      handle.onMessage({
        data: resultsMsg({ rows: [row(7, 'Stale')], shownCount: 1, term: 'Obj' }),
      });
      type('Object>>printString');
      enter();
      expect(posted(vscode, 'query').map((m) => m.value)).toEqual(['Object>>printString']);
      expect(posted(vscode, 'activate')).toEqual([]);

      handle.onMessage({
        data: resultsMsg({
          rows: [row(0, 'Object>>printString')],
          shownCount: 1,
          term: 'Object>>printString',
        }),
      });
      expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 0, side: false }]);

      vi.advanceTimersByTime(500); // the flushed search does not fire a second time
      expect(posted(vscode, 'query')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits while a sent search is still out to the stone', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString'); // sent immediately, not yet answered
    enter({ ctrlKey: true });
    expect(posted(vscode, 'activate')).toEqual([]);
    handle.onMessage({
      data: resultsMsg({
        rows: [row(3, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 3, side: true }]);
  });

  it('ignores results for an earlier term, and opens on the matching ones', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    enter();
    handle.onMessage({
      data: resultsMsg({ rows: [row(1, 'Obj')], shownCount: 1, term: 'Object>>print' }),
    });
    expect(posted(vscode, 'activate')).toEqual([]);
    handle.onMessage({
      data: resultsMsg({
        rows: [row(2, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 2, side: false }]);
  });

  it('opens nothing when the search finds nothing, and does not open a later search', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>noSuchSelector');
    enter();
    handle.onMessage({
      data: resultsMsg({ rows: [], shownCount: 0, term: 'Object>>noSuchSelector' }),
    });
    type('Object>>printString');
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([]);
  });

  it('typing again cancels the waiting Enter', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    enter();
    type('Object>>printStringOn:');
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([]);
  });

  it('does not wait when no search is out, even if the field and the rows disagree', () => {
    // Leaving a references list re-runs the original search while the field can still hold the
    // filter typed into the list; nothing more is coming, so Enter must act on what is shown.
    const { handle, vscode } = mountWithDebounce(0);
    handle.onMessage({
      data: resultsMsg({
        rows: [row(4, 'Object>>printString')],
        shownCount: 1,
        term: 'printString',
      }),
    });
    (document.getElementById('query') as HTMLInputElement).value = 'filter';
    enter();
    expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 4, side: false }]);
  });

  it('an error drops the waiting Enter, so a later answer for that term opens nothing', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    enter();
    handle.onMessage({ data: { command: 'error', message: 'session busy' } });
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([]);
  });

  it('a session reset drops the waiting Enter, so the new session opens nothing by itself', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    enter();
    handle.onMessage({ data: { command: 'reset' } });
    handle.onMessage({ data: resultsMsg({ rows: [row(0, 'Globals')], shownCount: 1, term: '' }) });
    expect(posted(vscode, 'activate')).toEqual([]);
  });

  it('after a session reset, Enter acts on what is shown rather than waiting', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString'); // out to the stone when the session changes
    handle.onMessage({ data: { command: 'reset' } });
    handle.onMessage({
      data: resultsMsg({ rows: [row(5, 'Object')], shownCount: 1, term: 'Object' }),
    });
    enter();
    expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 5, side: false }]);
  });

  it('leaving the panel drops the waiting Enter, so late results do not take focus back', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    enter();
    window.dispatchEvent(new Event('blur'));
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([]);
  });

  it('the clear button drops the waiting Enter', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    enter();
    (document.getElementById('clear') as HTMLButtonElement).click();
    handle.onMessage({ data: resultsMsg({ rows: [row(0, 'Globals')], shownCount: 1, term: '' }) });
    expect(posted(vscode, 'activate')).toEqual([]);
  });

  it('a failed action other than the search leaves the waiting Enter in place', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    enter();
    handle.onMessage({ data: { command: 'error', message: 'busy', failed: 'references' } });
    handle.onMessage({ data: { command: 'error', message: '' } }); // a notice being cleared
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 0, side: false }]);
  });

  it('a failed action other than the search does not make Enter act on stale rows', () => {
    const { handle, vscode } = mountWithDebounce(0);
    handle.onMessage({ data: resultsMsg({ rows: [row(7, 'Stale')], shownCount: 1, term: 'Obj' }) });
    type('Object>>printString'); // out to the stone
    handle.onMessage({ data: { command: 'error', message: 'busy', failed: 'references' } });
    enter();
    expect(posted(vscode, 'activate')).toEqual([]);
  });

  for (const [gesture, act] of [
    ['Escape', () => enterKey('Escape')],
    ['Alt+Enter', () => enter({ altKey: true })],
    ['Shift+Enter', () => enter({ shiftKey: true })],
  ] as const) {
    it(`${gesture} drops the waiting Enter`, () => {
      const { handle, vscode } = mountWithDebounce(0);
      type('Object>>printString');
      enter();
      act();
      handle.onMessage({
        data: resultsMsg({
          rows: [row(0, 'Object>>printString')],
          shownCount: 1,
          term: 'Object>>printString',
        }),
      });
      expect(posted(vscode, 'activate')).toEqual([]);
    });
  }

  it('double-clicking a row drops the waiting Enter, so only that row opens', () => {
    const { handle, vscode } = mountWithDebounce(0);
    handle.onMessage({ data: resultsMsg({ rows: [row(7, 'Stale')], shownCount: 1, term: 'Obj' }) });
    type('Object>>printString');
    enter();
    document
      .querySelector('#results li')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 7, side: false }]);
  });

  it('in a references list, Enter opens the highlighted row without first sending the filter', () => {
    vi.useFakeTimers();
    try {
      const { handle, vscode } = mountWithDebounce(120);
      handle.onMessage({
        data: resultsMsg({
          rows: [row(0, 'A'), row(1, 'B'), row(2, 'C')],
          shownCount: 3,
          term: 'at:',
          pivot: true,
        }),
      });
      document
        .getElementById('query')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      type('C');
      enter();
      expect(posted(vscode, 'query')).toEqual([]);
      expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 1, side: false }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens at once when the results on screen already answer the term', () => {
    const { handle, vscode } = mountWithDebounce(0);
    type('Object>>printString');
    handle.onMessage({
      data: resultsMsg({
        rows: [row(0, 'Object>>printString')],
        shownCount: 1,
        term: 'Object>>printString',
      }),
    });
    enter();
    expect(posted(vscode, 'activate')).toEqual([{ command: 'activate', id: 0, side: false }]);
  });
});
