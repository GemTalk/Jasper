// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The basic inspector's webview rendering, driven the way the real webview does:
 * millerColumns.js and basicInspectorView.js are evaluated in jsdom so they
 * register their globals, exactly as the two injected <script> tags do.
 *
 * What is pinned here is what the user sees and what the panel is asked for — a
 * tab appears only when the object has that structure, a page is appended rather
 * than replacing what is already loaded, the column's Back/Forward walks its own
 * history, and an edit sends the typed expression rather than a value. The doits
 * themselves belong to the queries module and its own tests.
 */
beforeAll(() => {
  for (const file of ['../../webview/millerColumns.js', '../basicInspectorView.js']) {
    new Function(fs.readFileSync(path.resolve(__dirname, file), 'utf8'))();
  }
});

interface Header {
  className: string;
  superclassName: string;
  namedSize: number;
  itemCount: number;
  entryCount: number;
  isBytes: boolean;
  isDictionary: boolean;
  printString: string;
}

interface Tab {
  id: string;
  label: string;
}

interface Row {
  label: string;
  value: string;
  oop: string;
  className: string;
  index: number;
  keyOop?: string;
  revertible?: boolean;
}

interface Column {
  id: number;
  oop: string;
  history: { oop: string; label: string }[];
  historyIndex: number;
  activeTab: string;
  tabData: Record<string, unknown>;
  el: { root: HTMLElement; contentPane: HTMLElement; navBack: HTMLButtonElement };
}

interface View {
  columns: { get(id: number): Column | undefined; columns: Column[] };
  tabsFor(header: Header | null): Tab[];
  handleHostMessage(msg: Record<string, unknown>): void;
}

function api(): { init(opts: unknown): View; tabsFor(h: Header | null): Tab[] } {
  return (
    globalThis as unknown as {
      BasicInspectorView: { init(o: unknown): View; tabsFor(h: Header | null): Tab[] };
    }
  ).BasicInspectorView;
}

function header(over: Partial<Header> = {}): Header {
  return {
    className: 'Account',
    superclassName: 'Object',
    namedSize: 0,
    itemCount: 0,
    entryCount: 0,
    isBytes: false,
    isDictionary: false,
    printString: 'an Account',
    ...over,
  };
}

function row(over: Partial<Row> = {}): Row {
  return {
    label: 'balance',
    value: '42',
    oop: '900',
    className: 'SmallInteger',
    index: 1,
    ...over,
  };
}

let posted: Record<string, unknown>[];
let view: View;

function setup() {
  document.body.innerHTML =
    '<div id="strip"></div><div id="ctx" class="ctx-menu"><div class="ctx-item" data-action="inspect"></div></div>';
  posted = [];
  // jsdom implements neither layout nor scrolling; the strip asks for both, and
  // the Meta tab's scroll preservation can only be observed if scrollTop is a
  // property that remembers what was written to it.
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: { _top?: number }) {
      return this._top ?? 0;
    },
    set(this: { _top?: number }, top: number) {
      this._top = top;
    },
  });
  view = api().init({
    strip: document.getElementById('strip'),
    ctxMenu: document.getElementById('ctx'),
    vscode: { postMessage: (m: Record<string, unknown>) => posted.push(m) },
    pageSize: 100,
    defaultColumnWidth: 340,
    minColumnWidth: 280,
  });
}

/** Open a root column showing `header`, as the panel does on `ready`. */
function openRoot(over: Partial<Header> = {}, label = 'anAccount'): Column {
  view.handleHostMessage({
    command: 'addRoot',
    columnId: 0,
    oop: '100',
    label,
    header: header(over),
  });
  return view.columns.get(0)!;
}

function sendRows(columnId: number, tab: string, rows: Row[], from = 1) {
  view.handleHostMessage({ command: 'tabData', columnId, tab, from, rows });
}

function sendBytes(columnId: number, bytes: number[], from = 1) {
  view.handleHostMessage({ command: 'tabData', columnId, tab: 'bytes', from, bytes });
}

function sendMeta(columnId: number, over: Record<string, unknown> = {}) {
  view.handleHostMessage({
    command: 'tabData',
    columnId,
    tab: 'meta',
    from: 1,
    meta: {
      className: 'Account',
      superclassName: 'Object',
      category: 'Kernel',
      comment: '',
      definition: 'Object subclass: #Account',
      instanceSelectors: ['balance', 'balance:', 'deposit:'],
      classSelectors: ['new'],
      ...over,
    },
  });
}

/** Open a tab by clicking it, the way the user does. */
function openTab(col: Column, tab: string) {
  (col.el.root.querySelector(`[data-tab="${tab}"]`) as HTMLElement).click();
}

const tabIds = (col: Column) =>
  Array.from(col.el.root.querySelectorAll('.tab')).map((t) => (t as HTMLElement).dataset.tab);
const sent = (command: string) => posted.filter((m) => m.command === command);

beforeEach(setup);

describe('which tabs an object gets', () => {
  const ids = (h: Header | null) =>
    api()
      .tabsFor(h)
      .map((t) => t.id);

  it('always offers to print an object and to evaluate against it', () => {
    expect(ids(header())).toEqual(['print', 'meta', 'eval']);
  });

  it('offers slots only when the object has named instance variables', () => {
    expect(ids(header({ namedSize: 3 }))).toContain('slots');
    expect(ids(header({ namedSize: 0 }))).not.toContain('slots');
  });

  it('offers items only when the object holds elements', () => {
    expect(ids(header({ itemCount: 12 }))).toContain('items');
    expect(ids(header({ itemCount: 0 }))).not.toContain('items');
  });

  it('offers entries rather than items for a dictionary', () => {
    const dict = header({ isDictionary: true, entryCount: 5, itemCount: 5 });

    expect(ids(dict)).toContain('entries');
    expect(ids(dict)).not.toContain('items');
  });

  it('offers bytes only for a byte-format object', () => {
    expect(ids(header({ isBytes: true }))).toContain('bytes');
    expect(ids(header({ isBytes: false }))).not.toContain('bytes');
  });

  it('falls back to printing an object the stone would not describe', () => {
    expect(ids(null)).toEqual(['print']);
  });
});

describe('opening a column', () => {
  it('shows the object class and label in the header', () => {
    const col = openRoot({ namedSize: 2 });

    expect(col.el.root.querySelector('.obj-class')!.textContent).toBe('Account');
    expect(col.el.root.querySelector('.obj-label')!.textContent).toBe('anAccount');
    expect(col.el.root.querySelector('.header-oop')!.textContent).toBe('oop 100');
  });

  it('builds the tab bar from the object structure and opens the first tab', () => {
    const col = openRoot({ namedSize: 2 });

    expect(tabIds(col)).toEqual(['slots', 'print', 'meta', 'eval']);
    expect(col.activeTab).toBe('slots');
  });

  it('asks the panel for the first tab as soon as the column opens', () => {
    openRoot({ namedSize: 2 });

    expect(sent('fetchTab')[0]).toMatchObject({ columnId: 0, oop: '100', tab: 'slots', from: 1 });
  });
});

describe('drawing a table', () => {
  it('shows a row per slot, with its value and class', () => {
    const col = openRoot({ namedSize: 2 });

    sendRows(0, 'slots', [row(), row({ label: 'owner', value: "'Fred'", className: 'String' })]);

    const cells = Array.from(col.el.contentPane.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()),
    );
    expect(cells).toEqual([
      ['balance', '42', 'SmallInteger'],
      ['owner', "'Fred'", 'String'],
    ]);
  });

  it('escapes a value that looks like markup', () => {
    const col = openRoot({ namedSize: 1 });

    sendRows(0, 'slots', [row({ value: "'<img onerror=x>'" })]);

    expect(col.el.contentPane.querySelector('img')).toBeNull();
    expect(col.el.contentPane.querySelector('.cell-value')!.textContent).toContain('<img');
  });

  it('offers to load more only while rows are still unfetched', () => {
    const col = openRoot({ itemCount: 250 });

    sendRows(0, 'items', [row({ label: '[1]' })]);

    expect(col.el.contentPane.querySelector('.load-more-row')).not.toBeNull();
  });

  it('stops offering to load more once every row is showing', () => {
    const col = openRoot({ itemCount: 1 });

    sendRows(0, 'items', [row({ label: '[1]' })]);

    expect(col.el.contentPane.querySelector('.load-more-row')).toBeNull();
  });

  it('appends a later page instead of replacing what is already loaded', () => {
    const col = openRoot({ itemCount: 4 });

    sendRows(0, 'items', [row({ label: '[1]' }), row({ label: '[2]' })], 1);
    sendRows(0, 'items', [row({ label: '[3]' }), row({ label: '[4]' })], 3);

    expect(
      Array.from(col.el.contentPane.querySelectorAll('tbody .cell-label')).map(
        (c) => c.textContent,
      ),
    ).toEqual(['[1]', '[2]', '[3]', '[4]']);
  });

  it('asks for the next page starting after the rows already loaded', () => {
    const col = openRoot({ itemCount: 250 });
    sendRows(0, 'items', [row({ label: '[1]' }), row({ label: '[2]' })]);

    (col.el.contentPane.querySelector('.load-more-row td') as HTMLElement).click();

    expect(sent('fetchTab').at(-1)).toMatchObject({ tab: 'items', from: 3 });
  });

  it('marks an edited row so its original value can be restored', () => {
    const col = openRoot({ namedSize: 1 });

    sendRows(0, 'slots', [row({ revertible: true })]);

    expect(col.el.contentPane.querySelector('.revert-btn')).not.toBeNull();
  });
});

describe('switching tabs', () => {
  it('fetches a tab the first time it is opened', () => {
    const col = openRoot({ namedSize: 1 });

    (col.el.root.querySelector('[data-tab="print"]') as HTMLElement).click();

    expect(sent('fetchTab').at(-1)).toMatchObject({ tab: 'print' });
  });

  it('does not refetch a tab whose data it already holds', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row()]);
    (col.el.root.querySelector('[data-tab="print"]') as HTMLElement).click();
    view.handleHostMessage({
      command: 'tabData',
      columnId: 0,
      tab: 'print',
      from: 1,
      text: 'an A',
    });
    const before = sent('fetchTab').length;

    (col.el.root.querySelector('[data-tab="slots"]') as HTMLElement).click();

    expect(sent('fetchTab')).toHaveLength(before);
  });

  it('never asks the panel for the evaluation pane — it needs no data', () => {
    const col = openRoot();

    (col.el.root.querySelector('[data-tab="eval"]') as HTMLElement).click();

    expect(sent('fetchTab').some((m) => m.tab === 'eval')).toBe(false);
    expect(col.el.contentPane.querySelector('.eval-input')).not.toBeNull();
  });
});

describe('drilling in', () => {
  it('opens a new column to the right when a row is double-clicked', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row({ oop: '900' })]);

    col.el.contentPane
      .querySelector('tr[data-row="0"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(sent('inspectRow').at(-1)).toMatchObject({
      sourceColumnId: 0,
      oop: '900',
      label: 'balance',
    });
  });

  it('replaces the column in place, and remembers where it was, on a dive', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row({ oop: '900' })]);

    col.el.contentPane
      .querySelector('tr[data-row="0"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    (document.querySelector('[data-action="inspect"]') as HTMLElement).click();

    expect(sent('inspectRow').at(-1)).toMatchObject({ oop: '900' });
  });
});

describe('a column’s own history', () => {
  /** Dive `col` to `oop`, letting the panel's reply land. */
  function dive(col: Column, oop: string, label: string) {
    view.handleHostMessage({
      command: 'replaceColumn',
      columnId: col.id,
      oop,
      label,
      remember: true,
      header: header(),
    });
  }

  it('cannot go back from the object a column opened on', () => {
    const col = openRoot();

    expect(col.historyIndex).toBe(0);
    expect(col.el.navBack.disabled).toBe(true);
  });

  it('records each dive so it can be stepped back through', () => {
    const col = openRoot();

    dive(col, '200', 'second');
    dive(col, '300', 'third');

    expect(col.history.map((h) => h.oop)).toEqual(['100', '200', '300']);
    expect(col.historyIndex).toBe(2);
    expect(col.el.navBack.disabled).toBe(false);
  });

  it('asks the panel for the previous object when going back', () => {
    const col = openRoot();
    dive(col, '200', 'second');

    col.el.navBack.click();

    expect(sent('diveHere').at(-1)).toMatchObject({ oop: '100', remember: false });
  });

  it('leaves the history unchanged when stepping through it', () => {
    const col = openRoot();
    dive(col, '200', 'second');

    col.el.navBack.click();
    view.handleHostMessage({
      command: 'replaceColumn',
      columnId: 0,
      oop: '100',
      label: 'anAccount',
      remember: false,
      header: header(),
    });

    expect(col.history.map((h) => h.oop)).toEqual(['100', '200']);
    expect(col.historyIndex).toBe(0);
  });

  it('discards the forward trail when a new dive branches off it', () => {
    const col = openRoot();
    dive(col, '200', 'second');
    dive(col, '300', 'third');
    col.historyIndex = 0;

    dive(col, '400', 'elsewhere');

    expect(col.history.map((h) => h.oop)).toEqual(['100', '400']);
  });
});

describe('editing a value', () => {
  function openEditor(col: Column) {
    col.el.contentPane
      .querySelector('tr[data-row="0"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    document.querySelector<HTMLElement>('[data-action="edit"]')?.click();
    return col.el.contentPane.querySelector<HTMLInputElement>('.row-editor');
  }

  beforeEach(() => {
    document
      .getElementById('ctx')!
      .insertAdjacentHTML('beforeend', '<div class="ctx-item" data-action="edit"></div>');
  });

  it('sends the typed expression, not a value, so the stone evaluates it', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row()]);
    const input = openEditor(col)!;

    input.value = 'self balance * 2';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(sent('setSlot').at(-1)).toMatchObject({
      oop: '100',
      kind: 'instvar',
      index: 1,
      expression: 'self balance * 2',
    });
  });

  it('abandons an edit on Escape without asking the stone for anything', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row()]);
    const input = openEditor(col)!;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(sent('setSlot')).toHaveLength(0);
    expect(col.el.contentPane.querySelector('.row-editor')).toBeNull();
  });

  it('refuses to edit a slot the stone gave no write index for', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row({ index: 0 })]);

    expect(openEditor(col)).toBeNull();
  });

  it('refetches the tab after a write, since every value on it is now stale', () => {
    openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row()]);
    const before = sent('fetchTab').length;

    view.handleHostMessage({ command: 'setSlotResult', columnId: 0, ok: true });

    expect(sent('fetchTab').length).toBe(before + 1);
  });

  it('shows why a write failed, and leaves the stone unread', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row()]);
    const before = sent('fetchTab').length;

    view.handleHostMessage({
      command: 'setSlotResult',
      columnId: 0,
      ok: false,
      error: 'doesNotUnderstand',
    });

    expect(col.el.contentPane.querySelector('.edit-error')!.textContent).toContain(
      'doesNotUnderstand',
    );
    expect(sent('fetchTab').length).toBe(before);
  });

  it('restores the original value when a revert is asked for', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row({ revertible: true })]);

    (col.el.contentPane.querySelector('.revert-btn') as HTMLElement).click();

    expect(sent('revertSlot').at(-1)).toMatchObject({ oop: '100', kind: 'instvar', index: 1 });
  });
});

describe('the evaluation pane', () => {
  function typeExpression(col: Column, text: string) {
    (col.el.root.querySelector('[data-tab="eval"]') as HTMLElement).click();
    const input = col.el.contentPane.querySelector('.eval-input') as HTMLTextAreaElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  }

  it('evaluates the typed expression against the inspected object', () => {
    const col = openRoot();
    typeExpression(col, 'self class name');

    (col.el.contentPane.querySelector('[data-eval="display"]') as HTMLElement).click();

    expect(sent('evaluate').at(-1)).toMatchObject({
      oop: '100',
      expression: 'self class name',
      mode: 'display',
    });
  });

  it('opens the result in a new column when asked to inspect it', () => {
    const col = openRoot();
    typeExpression(col, 'self class');

    (col.el.contentPane.querySelector('[data-eval="inspect"]') as HTMLElement).click();

    expect(sent('evaluate').at(-1)).toMatchObject({ mode: 'inspect' });
  });

  it('runs an expression without showing its result when asked to execute it', () => {
    const col = openRoot();
    typeExpression(col, 'self commit');

    (col.el.contentPane.querySelector('[data-eval="execute"]') as HTMLElement).click();

    expect(sent('evaluate').at(-1)).toMatchObject({ mode: 'execute' });
  });

  it('does not send an empty expression to the stone', () => {
    const col = openRoot();
    typeExpression(col, '   ');

    (col.el.contentPane.querySelector('[data-eval="display"]') as HTMLElement).click();

    expect(sent('evaluate')).toHaveLength(0);
  });

  it('shows the result of an evaluation', () => {
    const col = openRoot();
    typeExpression(col, 'self class name');

    view.handleHostMessage({ command: 'evalResult', columnId: 0, ok: true, text: "'Account'" });

    expect(col.el.contentPane.querySelector('.eval-out')!.textContent).toBe("'Account'");
  });

  it('marks a failed evaluation as an error rather than a result', () => {
    const col = openRoot();
    typeExpression(col, 'self nope');

    view.handleHostMessage({ command: 'evalResult', columnId: 0, ok: false, text: 'doesNotUnder' });

    expect(col.el.contentPane.querySelector('.eval-out')!.classList).toContain('error');
  });
});

/**
 * The pane answers to the editor's own bindings, so the keys that run an
 * expression are the same wherever it was typed. Nothing here can reach VS
 * Code's keybindings — they are all `when: editorTextFocus` — so the pane has
 * to recognise the two-key chord itself.
 */
describe('the evaluation pane’s hot keys', () => {
  function typeExpression(col: Column, text: string) {
    (col.el.root.querySelector('[data-tab="eval"]') as HTMLElement).click();
    const input = col.el.contentPane.querySelector('.eval-input') as HTMLTextAreaElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input;
  }

  function press(input: HTMLElement, key: string, ctrl = false): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', {
      key,
      ctrlKey: ctrl,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    return ev;
  }

  const chord = (input: HTMLElement, key: string) => {
    press(input, 'k', true);
    return press(input, key);
  };

  it.each([
    ['d', 'display'],
    ['e', 'execute'],
    ['i', 'inspect'],
  ])('runs the editor’s Ctrl+K %s against this object', (key, mode) => {
    const col = openRoot();
    const input = typeExpression(col, 'self class name');

    chord(input, key);

    expect(sent('evaluate').at(-1)).toMatchObject({ mode, expression: 'self class name' });
  });

  it('takes the chord with the platform’s own modifier', () => {
    const col = openRoot();
    const input = typeExpression(col, 'self class name');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    press(input, 'd');

    expect(sent('evaluate').at(-1)).toMatchObject({ mode: 'display' });
  });

  it('swallows the closing key rather than typing it into the expression', () => {
    const col = openRoot();
    const input = typeExpression(col, 'self');

    expect(chord(input, 'd').defaultPrevented).toBe(true);
  });

  it('types a key that closes no chord it knows, and runs nothing', () => {
    const col = openRoot();
    const input = typeExpression(col, 'self');

    expect(chord(input, 'x').defaultPrevented).toBe(false);
    expect(sent('evaluate')).toHaveLength(0);
  });

  it('forgets a half-typed chord, so the next key is an ordinary one', () => {
    const col = openRoot();
    const input = typeExpression(col, 'self');
    chord(input, 'x');

    expect(press(input, 'd').defaultPrevented).toBe(false);
    expect(sent('evaluate')).toHaveLength(0);
  });

  it('still displays a result on Ctrl+Enter', () => {
    const col = openRoot();
    const input = typeExpression(col, 'self class name');

    press(input, 'Enter', true);

    expect(sent('evaluate').at(-1)).toMatchObject({ mode: 'display' });
  });

  it('says the chord is waiting for its second key', () => {
    const col = openRoot();
    const input = typeExpression(col, 'self');

    press(input, 'k', true);

    expect(col.el.contentPane.querySelector('.eval-hint')!.classList).toContain('armed');
  });
});

describe('reading the bytes of an object', () => {
  const dump = (col: Column) => col.el.contentPane.querySelector('.bytes')!.textContent;
  const openBytes = (bytes: number[], itemCount = bytes.length) => {
    const col = openRoot({ isBytes: true, itemCount });
    openTab(col, 'bytes');
    sendBytes(0, bytes);
    return col;
  };

  it('heads the dump with what each of its columns is', () => {
    const col = openBytes([98, 109]);

    const head = col.el.contentPane.querySelector('.bytes-head')!.textContent;
    expect(head).toContain('Index');
    expect(head).toContain('Text');
  });

  it('numbers each line with the index the object counts that byte at', () => {
    const col = openBytes(Array.from({ length: 20 }, () => 98));

    const indices = Array.from(col.el.contentPane.querySelectorAll('.bytes .off')).map((o) =>
      o.textContent.trim(),
    );
    expect(indices).toEqual(['1', '17']);
  });

  it('shows a byte in hex, and in decimal when decimal is asked for', () => {
    const col = openBytes([98, 109]);
    expect(dump(col)).toContain('62 6d');

    (col.el.contentPane.querySelector('[data-radix="10"]') as HTMLElement).click();

    expect(dump(col)).toContain('98 109');
  });

  it('reads the printable bytes out as text, and the rest as dots', () => {
    const col = openBytes([98, 109, 0]);

    expect(dump(col)).toContain('bm.');
  });

  it('says how much of the object it is showing even when that is all of it', () => {
    const col = openBytes([98, 109]);

    expect(col.el.contentPane.querySelector('.toolbar-label')!.textContent).toBe(
      'Showing 2 of 2 bytes',
    );
  });

  it('offers to load more, and to load all, while bytes are unfetched', () => {
    const col = openBytes([98, 109], 500);

    expect(col.el.contentPane.querySelector('[data-more="page"]')).not.toBeNull();
    expect(col.el.contentPane.querySelector('[data-more="all"]')).not.toBeNull();
  });

  it('asks for the bytes after the ones it holds', () => {
    const col = openBytes([98, 109], 500);

    (col.el.contentPane.querySelector('[data-more="page"]') as HTMLElement).click();

    expect(sent('fetchTab').at(-1)).toMatchObject({ tab: 'bytes', from: 3, all: false });
  });
});

describe('loading the rest of a tab', () => {
  it('takes one page when Load more is clicked', () => {
    const col = openRoot({ itemCount: 250 });
    sendRows(0, 'items', [row({ label: '[1]' })]);

    (col.el.contentPane.querySelector('[data-more="page"]') as HTMLElement).click();

    expect(sent('fetchTab').at(-1)).toMatchObject({ tab: 'items', from: 2, all: false });
  });

  it('asks for every remaining page when Load all is clicked', () => {
    const col = openRoot({ itemCount: 250 });
    sendRows(0, 'items', [row({ label: '[1]' })]);

    (col.el.contentPane.querySelector('[data-more="all"]') as HTMLElement).click();

    expect(sent('fetchTab').at(-1)).toMatchObject({ tab: 'items', from: 2, all: true });
  });

  it('offers neither once the whole tab is loaded', () => {
    const col = openRoot({ itemCount: 1 });
    sendRows(0, 'items', [row({ label: '[1]' })]);

    expect(col.el.contentPane.querySelector('[data-more]')).toBeNull();
  });
});

describe('the Meta tab', () => {
  const items = (col: Column) => col.el.contentPane.querySelectorAll('.method-item');
  const scroller = (col: Column) => col.el.contentPane.querySelector('.meta') as HTMLElement;

  function openMeta(): Column {
    const col = openRoot();
    openTab(col, 'meta');
    sendMeta(0);
    return col;
  }

  it('lists the selectors of the side being shown', () => {
    const col = openMeta();

    expect(Array.from(items(col)).map((i) => i.textContent)).toEqual([
      'balance',
      'balance:',
      'deposit:',
    ]);
  });

  it('marks the selector whose source is open, so the list does not run together', () => {
    const col = openMeta();

    (items(col)[1] as HTMLElement).click();

    expect(items(col)[1].classList).toContain('open');
    expect(items(col)[0].classList).not.toContain('open');
  });

  it('leaves the reader where they were when a selector is opened', () => {
    const col = openMeta();
    scroller(col).scrollTop = 120;

    (items(col)[1] as HTMLElement).click();

    expect(scroller(col).scrollTop).toBe(120);
  });

  it('holds that position when the source itself arrives', () => {
    const col = openMeta();
    (items(col)[1] as HTMLElement).click();
    scroller(col).scrollTop = 120;

    view.handleHostMessage({
      command: 'methodSource',
      columnId: 0,
      selector: 'balance:',
      isClassSide: false,
      source: 'balance: aNumber\n  balance := aNumber',
    });

    expect(scroller(col).scrollTop).toBe(120);
  });

  it('starts at the top when the other side of the class is chosen', () => {
    const col = openMeta();
    scroller(col).scrollTop = 120;

    (col.el.contentPane.querySelector('[data-side="class"]') as HTMLElement).click();

    expect(scroller(col).scrollTop).toBe(0);
  });
});

describe('acting on a row', () => {
  function openMenuOnFirstRow(col: Column) {
    col.el.contentPane
      .querySelector('tr[data-row="0"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  }

  beforeEach(() => {
    document
      .getElementById('ctx')!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="ctx-item" data-action="copyValue"></div>' +
          '<div class="ctx-item" data-action="copyOop"></div>' +
          '<div class="ctx-item" data-action="browse"></div>',
      );
  });

  it('copies the value a row is showing', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row({ value: "'Fred'" })]);
    openMenuOnFirstRow(col);

    (document.querySelector('[data-action="copyValue"]') as HTMLElement).click();

    expect(sent('copyText').at(-1)).toMatchObject({ text: "'Fred'" });
  });

  it('copies the oop of the object a row points at', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row({ oop: '900' })]);
    openMenuOnFirstRow(col);

    (document.querySelector('[data-action="copyOop"]') as HTMLElement).click();

    expect(sent('copyText').at(-1)).toMatchObject({ text: '900' });
  });

  it('browses the class of the value, not of the inspected object', () => {
    const col = openRoot({ namedSize: 1 });
    sendRows(0, 'slots', [row({ oop: '900' })]);
    openMenuOnFirstRow(col);

    (document.querySelector('[data-action="browse"]') as HTMLElement).click();

    expect(sent('browseClass').at(-1)).toMatchObject({ oop: '900' });
  });
});

describe('closing a column', () => {
  it('asks the panel to close when the last column goes', () => {
    const col = openRoot();

    (col.el.root.querySelector('.col-close') as HTMLElement).click();

    expect(sent('closePanel')).toHaveLength(1);
  });

  it('leaves the panel open while another column remains', () => {
    const root = openRoot();
    view.handleHostMessage({
      command: 'addChild',
      columnId: 1,
      sourceColumnId: 0,
      oop: '900',
      label: 'balance',
      header: header(),
    });

    (root.el.root.querySelector('.col-close') as HTMLElement).click();

    expect(sent('closePanel')).toHaveLength(0);
    expect(view.columns.columns.map((c) => c.id)).toEqual([1]);
  });
});
