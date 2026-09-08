// The webview half of the reference graph, driven against the real rendered document.
//
// objectGraphView.js is read from disk at runtime rather than compiled into the bundle, so
// nothing else in the build would notice it breaking. What it owns is small but load-
// bearing: which message a click becomes, the tooltip that only a selected edge offers,
// and where the page is scrolled after the host replaces the whole document -- and that
// last one is invisible to every other kind of test, because it is a property of the
// SECOND render, not the first.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

import { renderObjectGraphHtml, ObjectGraphView } from '../objectGraphHtml';
import type { CanvasNode } from '../objectGraphHtml';

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'objectGraphView.js'), 'utf8');

const node = (
  oop: string,
  label: string,
  className: string,
  parentOop?: string,
  viaClass?: string,
): CanvasNode => ({ oop, label, className, parentOop, viaClass });

/** A chain `1 <- 2 <- ... <- depth`, centred on the outermost, so the drawing is wide. */
const chain = (depth: number, targetOop = String(depth)): ObjectGraphView => {
  const nodes = [node('1', 'Emp(E1001 Camila Halloran)', 'DemoEmployee')];
  const edges = [];
  const groupsByOop: ObjectGraphView['groupsByOop'] = {};
  for (let i = 2; i <= depth; i += 1) {
    nodes.push(node(String(i), `Emp(E100${i})`, 'DemoEmployee', String(i - 1), 'DemoEmployee'));
    edges.push({ fromOop: String(i), toOop: String(i - 1), via: 'manager' });
    groupsByOop[String(i - 1)] = [
      { referrerClass: 'DemoEmployee', referrerClassOop: '99', count: 1 },
    ];
  }
  return {
    trail: [{ oop: targetOop, label: 'DemoEmployee' }] as ObjectGraphView['trail'],
    targetLabel: 'Emp',
    targetClass: 'DemoEmployee',
    targetOop,
    groups: [],
    groupsByOop,
    scanMillis: 20,
    canvas: { nodes, edges },
    positions: {},
    removedCount: 0,
    nonce: 'n',
    script: SOURCE,
  };
};

/** One webview store, kept across loads exactly as VS Code keeps it across an HTML swap. */
let stored: Record<string, unknown> | undefined;
let posted: { command: string; oop?: string }[];

beforeEach(() => {
  stored = undefined;
  posted = [];
});

const vscode = {
  postMessage: (m: { command: string; oop?: string }) => posted.push(m),
  getState: () => stored,
  setState: (s: Record<string, unknown>) => {
    stored = s;
  },
};

type Loaded = { doc: Document; window: JSDOM['window']; wrap: HTMLElement };

/** Render a view and wire the view script to it, as one host redraw. */
const load = (view: ObjectGraphView): Loaded => {
  const dom = new JSDOM(renderObjectGraphHtml(view), { runScripts: 'outside-only' });
  const doc = dom.window.document;
  const wrap = doc.querySelector('.graphwrap') as HTMLElement;
  // jsdom lays nothing out, so scrollLeft is inert unless we give it somewhere to live.
  let scrollLeft = 0;
  Object.defineProperty(wrap, 'scrollLeft', {
    get: () => scrollLeft,
    set: (v: number) => {
      scrollLeft = v;
      wrap.dispatchEvent(new dom.window.Event('scroll'));
    },
  });
  dom.window.eval(SOURCE);
  (
    dom.window as unknown as { ObjectGraphView: { wire: (d: Document, v: unknown) => void } }
  ).ObjectGraphView.wire(doc, vscode);
  return { doc, window: dom.window, wrap };
};

const click = (loaded: Loaded, el: Element): void => {
  el.dispatchEvent(new loaded.window.MouseEvent('click', { bubbles: true }));
};

describe('clicking an object', () => {
  it('asks the host what points at it, and says nothing else', () => {
    const page = load(chain(4));

    click(page, page.doc.querySelector('[data-box="o:3"]')!);

    expect(posted).toEqual([{ command: 'focusNode', oop: '3' }]);
  });

  it('offers the centre no such click, being already the question', () => {
    const page = load(chain(4));

    click(page, page.doc.querySelector('[data-box="o:4"]')!);

    expect(posted).toEqual([]);
  });
});

describe('the tooltip on a selected edge', () => {
  const edgeOf = (page: Loaded): Element => page.doc.querySelector('[data-edge][data-tip]')!;

  it('is not there until the edge is selected', () => {
    // A <title> on every edge would fire on any sweep of the pointer across the picture,
    // which is the chatter the drawing was quietened to avoid.
    const page = load(chain(4));

    expect(page.doc.querySelector('[data-edge] > title')).toBeNull();
  });

  it('appears when the edge is clicked, saying which variable the reference sits in', () => {
    const page = load(chain(4));
    const edge = edgeOf(page);

    click(page, edge.querySelector('.edgehit')!);

    expect(edge.classList.contains('hl')).toBe(true);
    expect(edge.querySelector(':scope > title')?.textContent).toContain(
      'Instance variable "manager"',
    );
  });

  it('leads the group, since a title is only a tooltip when it comes first', () => {
    const page = load(chain(4));
    const edge = edgeOf(page);

    click(page, edge.querySelector('.edgehit')!);

    expect(edge.firstElementChild?.tagName.toLowerCase()).toBe('title');
  });

  it('goes away again when the edge is let go', () => {
    const page = load(chain(4));
    const edge = edgeOf(page);

    click(page, edge.querySelector('.edgehit')!);
    click(page, edge.querySelector('.edgehit')!);

    expect(edge.classList.contains('hl')).toBe(false);
    expect(edge.querySelector(':scope > title')).toBeNull();
  });
});

describe('where the page is scrolled after a redraw', () => {
  // The host replaces the whole document on every action, so the wrapper comes back at 0.
  // A referrer is drawn one column OUT from the object it points at, so on a picture wider
  // than the panel the boxes just asked for were the one thing off the right-hand edge --
  // and the click read as having done nothing at all.

  it('starts at the left with nothing remembered', () => {
    expect(load(chain(4)).wrap.scrollLeft).toBe(0);
  });

  it('remembers where you scrolled to', () => {
    const page = load(chain(4));

    page.wrap.scrollLeft = 300;

    expect(stored).toMatchObject({ scrollLeft: 300 });
  });

  it('keeps your place across a redraw that did not grow the graph', () => {
    // A drag, a layout reset and a restore all redraw too, and none of them should throw
    // the picture back to the left.
    load(chain(5)).wrap.scrollLeft = 410;

    expect(load(chain(5)).wrap.scrollLeft).toBe(410);
  });

  it('scrolls to the object you grew from, so its new column is beside it', () => {
    const first = load(chain(4));
    first.wrap.scrollLeft = 300;
    click(first, first.doc.querySelector('[data-box="o:3"]')!);
    expect(stored).toMatchObject({ growFrom: '3' });

    const second = load(chain(5));
    const grown = second.doc.querySelector('[data-box="o:3"]')!;
    const x = Number(grown.getAttribute('data-bx'));

    // Just inside the left edge -- which is where everything drawn to its right, the new
    // column included, becomes visible.
    expect(second.wrap.scrollLeft).toBe(x - 24);
    expect(x).toBeGreaterThan(0);
  });

  it('only does that once, not on every later redraw', () => {
    const first = load(chain(4));
    click(first, first.doc.querySelector('[data-box="o:3"]')!);
    const second = load(chain(5));
    const revealed = second.wrap.scrollLeft;

    second.wrap.scrollLeft = 12;

    expect(load(chain(5)).wrap.scrollLeft).toBe(12);
    expect(revealed).not.toBe(12);
  });

  it('falls back to your old place when the object it grew from is not drawn', () => {
    const first = load(chain(4));
    first.wrap.scrollLeft = 250;
    click(first, first.doc.querySelector('[data-box="o:3"]')!);

    // A redraw that no longer holds that object at all -- it was removed, say.
    expect(load(chain(2)).wrap.scrollLeft).toBe(250);
  });

  it('needs no webview store to render, so a stub host still works', () => {
    const dom = new JSDOM(renderObjectGraphHtml(chain(4)), { runScripts: 'outside-only' });
    dom.window.eval(SOURCE);

    expect(() =>
      (
        dom.window as unknown as { ObjectGraphView: { wire: (d: unknown, v: unknown) => void } }
      ).ObjectGraphView.wire(dom.window.document, { postMessage: vi.fn() }),
    ).not.toThrow();
  });
});
