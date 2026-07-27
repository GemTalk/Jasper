// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate enhancedInspectorColumns.js in jsdom so it registers the global
// EnhancedInspectorColumns, exactly as the webview does when it injects the file
// as a <script> tag. These tests pin the miller-column display/business
// decisions made for #39: additive drill that inserts immediately to the right
// of its source, independent per-column close, focus-tracks-title, and width
// inherit/pin. Rendering (headers/tabs/tables) is out of scope here — the model
// takes it as injected callbacks — so we stub them minimally.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../enhancedInspectorColumns.js'), 'utf8');
  new Function(source)();
});

interface ColMsg {
  columnId: number;
  sourceColumnId?: number;
  oop: string;
  title?: string;
  className?: string;
}

interface Column {
  id: number;
  oop: string;
  title: string;
  className: string;
  width: number;
  el: { root: HTMLElement };
}

interface ColumnStrip {
  columns: Column[];
  get(id: number): Column | undefined;
  columnOf(el: Element): Column | undefined;
  addRoot(msg: ColMsg): Column;
  addChild(msg: ColMsg): Column;
  close(col: Column): void;
  focus(col: Column, force?: boolean): void;
  pinWidth(col: Column, px: number): number;
  focusedId(): number | null;
}

const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 280;

function api(): { createColumnStrip(opts: unknown): ColumnStrip } {
  return (
    globalThis as unknown as {
      EnhancedInspectorColumns: { createColumnStrip(o: unknown): ColumnStrip };
    }
  ).EnhancedInspectorColumns;
}

// Minimal DOM builder + content populate, standing in for the inline webview's
// createColumnDom/populateColumn. Just enough for the model: a `.column` root
// carrying its id, and the title/class the focus→title logic reads.
function buildColumnDom(col: Column): HTMLElement {
  const root = document.createElement('div');
  root.className = 'column';
  root.dataset.colId = String(col.id);
  root.scrollIntoView = () => {}; // jsdom has no real scrollIntoView
  col.el = { root };
  return root;
}

function populate(col: Column, msg: ColMsg): void {
  col.title = msg.title || '';
  col.className = msg.className || '';
}

function setup() {
  document.body.innerHTML = '<div id="strip"></div>';
  const strip = document.getElementById('strip')!;
  const posted: Array<{ command: string; title?: string }> = [];
  const mgr = api().createColumnStrip({
    strip,
    postMessage: (m: { command: string }) => posted.push(m),
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    buildColumnDom,
    populate,
  });
  return { mgr, strip, posted };
}

function rootMsg(id: number, over: Partial<ColMsg> = {}): ColMsg {
  return { columnId: id, oop: String(id), title: 't' + id, className: 'C' + id, ...over };
}

function childMsg(id: number, sourceColumnId: number, over: Partial<ColMsg> = {}): ColMsg {
  return {
    columnId: id,
    sourceColumnId,
    oop: String(id),
    title: 't' + id,
    className: 'C' + id,
    ...over,
  };
}

const order = (mgr: ColumnStrip) => mgr.columns.map((c) => c.id);
const domOrder = (strip: HTMLElement) =>
  Array.from(strip.querySelectorAll('.column')).map((el) =>
    Number((el as HTMLElement).dataset.colId),
  );

describe('root column', () => {
  it('starts the strip with a single column', () => {
    const { mgr, strip } = setup();

    mgr.addRoot(rootMsg(0));

    expect(order(mgr)).toEqual([0]);
    expect(domOrder(strip)).toEqual([0]);
  });

  it('replaces the whole strip when a new root is inspected', () => {
    const { mgr, strip } = setup();
    mgr.addRoot(rootMsg(0));
    mgr.addChild(childMsg(1, 0));

    mgr.addRoot(rootMsg(2));

    expect(order(mgr)).toEqual([2]);
    expect(domOrder(strip)).toEqual([2]);
    expect(mgr.get(0)).toBeUndefined();
  });
});

describe('drilling — additive, inserted to the right of the source', () => {
  it('opens the drilled column immediately to the right of its source', () => {
    const { mgr, strip } = setup();
    mgr.addRoot(rootMsg(0));

    mgr.addChild(childMsg(1, 0));

    expect(order(mgr)).toEqual([0, 1]);
    expect(domOrder(strip)).toEqual([0, 1]);
  });

  it('pushes later columns rightward when drilling an earlier column again', () => {
    const { mgr, strip } = setup();
    mgr.addRoot(rootMsg(0));
    mgr.addChild(childMsg(1, 0));

    mgr.addChild(childMsg(2, 0));

    expect(order(mgr)).toEqual([0, 2, 1]);
    expect(domOrder(strip)).toEqual([0, 2, 1]);
  });

  it('keeps both siblings open when two rows are drilled from the same column', () => {
    const { mgr } = setup();
    mgr.addRoot(rootMsg(0));

    mgr.addChild(childMsg(1, 0));
    mgr.addChild(childMsg(2, 0));

    expect(mgr.get(1)).toBeDefined();
    expect(mgr.get(2)).toBeDefined();
    expect(mgr.columns).toHaveLength(3);
  });

  it('a new column inherits the width of the column it was drilled from', () => {
    const { mgr } = setup();
    const root = mgr.addRoot(rootMsg(0));
    mgr.pinWidth(root, 500);

    const child = mgr.addChild(childMsg(1, 0));

    expect(child.width).toBe(500);
    expect(child.el.root.style.flexBasis).toBe('500px');
  });

  it('appends at the far right when the source column is gone', () => {
    const { mgr } = setup();
    mgr.addRoot(rootMsg(0));
    mgr.addChild(childMsg(1, 0));

    mgr.addChild(childMsg(2, 999));

    expect(order(mgr)).toEqual([0, 1, 2]);
  });
});

describe('close — each column is independent', () => {
  it('closing a column removes only that column and leaves the rest', () => {
    const { mgr, strip } = setup();
    mgr.addRoot(rootMsg(0));
    mgr.addChild(childMsg(1, 0));
    mgr.addChild(childMsg(2, 1));

    mgr.close(mgr.get(1)!);

    expect(order(mgr)).toEqual([0, 2]);
    expect(domOrder(strip)).toEqual([0, 2]);
  });

  it('disposes the whole panel when the last column is closed', () => {
    const { mgr, posted } = setup();
    mgr.addRoot(rootMsg(0));

    mgr.close(mgr.get(0)!);

    expect(posted.some((m) => m.command === 'closePanel')).toBe(true);
  });

  it('does not dispose the panel while other columns remain', () => {
    const { mgr, posted } = setup();
    mgr.addRoot(rootMsg(0));
    mgr.addChild(childMsg(1, 0));

    mgr.close(mgr.get(1)!);

    expect(posted.some((m) => m.command === 'closePanel')).toBe(false);
  });

  it('focuses a neighbor after closing the focused column', () => {
    const { mgr } = setup();
    mgr.addRoot(rootMsg(0));
    mgr.addChild(childMsg(1, 0));
    mgr.addChild(childMsg(2, 1));

    mgr.close(mgr.get(2)!);

    expect(mgr.focusedId()).toBe(1);
  });
});

describe('focus tracks the title', () => {
  it('posts the focused column title when focus changes', () => {
    const { mgr, posted } = setup();
    const root = mgr.addRoot(rootMsg(0, { title: 'an Array(3)' }));
    const child = mgr.addChild(childMsg(1, 0, { title: 'a Character' }));

    mgr.focus(root, true);
    mgr.focus(child, true);

    const titles = posted.filter((m) => m.command === 'setTitle').map((m) => m.title);
    expect(titles).toContain('an Array(3)');
    expect(titles).toContain('a Character');
  });

  it('does not repost the title when the same column is refocused', () => {
    const { mgr, posted } = setup();
    mgr.addRoot(rootMsg(0));
    const col = mgr.columns[0];
    posted.length = 0;

    mgr.focus(col);

    expect(posted.filter((m) => m.command === 'setTitle')).toHaveLength(0);
  });

  it('marks the focused column and only that column', () => {
    const { mgr } = setup();
    mgr.addRoot(rootMsg(0));
    mgr.addChild(childMsg(1, 0));

    mgr.focus(mgr.get(0)!, true);

    expect(mgr.get(0)!.el.root.classList.contains('focused')).toBe(true);
    expect(mgr.get(1)!.el.root.classList.contains('focused')).toBe(false);
  });
});

describe('width — fill by default, pin on resize', () => {
  it('a new column starts at the default flex-basis and can grow', () => {
    const { mgr } = setup();
    const root = mgr.addRoot(rootMsg(0));

    expect(root.el.root.style.flexBasis).toBe(DEFAULT_WIDTH + 'px');
    expect(root.el.root.style.flexGrow).toBe('');
  });

  it('a manual resize pins the column to an exact width', () => {
    const { mgr } = setup();
    const root = mgr.addRoot(rootMsg(0));

    mgr.pinWidth(root, 500);

    expect(root.width).toBe(500);
    expect(root.el.root.style.flexBasis).toBe('500px');
    expect(root.el.root.style.flexGrow).toBe('0');
    expect(root.el.root.style.flexShrink).toBe('0');
  });

  it('a resize never shrinks a column below the minimum width', () => {
    const { mgr } = setup();
    const root = mgr.addRoot(rootMsg(0));

    mgr.pinWidth(root, 50);

    expect(root.width).toBe(MIN_WIDTH);
    expect(root.el.root.style.flexBasis).toBe(MIN_WIDTH + 'px');
  });
});
