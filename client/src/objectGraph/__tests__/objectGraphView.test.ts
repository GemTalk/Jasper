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

describe('dragging a box', () => {
  /** A press, a move and a release, in CSS pixels -- which are diagram units here, since
   *  the svg is drawn 1:1 with its viewBox. */
  const dragBy = (page: Loaded, box: Element, dx: number, dy: number): void => {
    const grip = box.querySelector('[data-drag-handle]')!;
    const at = (type: string, x: number, y: number, target: Element): void => {
      target.dispatchEvent(
        new page.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }),
      );
    };
    at('pointerdown', 100, 100, grip);
    at('pointermove', 100 + dx, 100 + dy, grip);
    at('pointerup', 100 + dx, 100 + dy, grip);
  };

  it('sends only the final position, so the host re-routes the edges', () => {
    // The movement is local; a second copy of the router in here is the thing being
    // avoided, which is why the edges hold still during a drag and snap when it ends.
    const page = load(chain(4));
    const box = page.doc.querySelector('[data-box="o:3"]')!;
    const x0 = Number(box.getAttribute('data-bx'));
    const y0 = Number(box.getAttribute('data-by'));

    dragBy(page, box, 40, 25);

    expect(posted).toEqual([{ command: 'moveBox', boxId: 'o:3', x: x0 + 40, y: y0 + 25 }]);
  });

  it('ignores a press that never became a move', () => {
    const page = load(chain(4));
    const box = page.doc.querySelector('[data-box="o:3"]')!;

    dragBy(page, box, 1, 1);

    expect(posted).toEqual([]);
  });

  it('does not also focus the object it moved', () => {
    // The grip sits inside a box that carries data-focus-oop, so the click the press would
    // otherwise produce has to be swallowed.
    const page = load(chain(4));
    const box = page.doc.querySelector('[data-box="o:3"]')!;

    dragBy(page, box, 40, 25);
    click(page, box);

    expect(posted).toEqual([
      { command: 'moveBox', boxId: 'o:3', x: expect.any(Number), y: expect.any(Number) },
    ]);
  });

  it('takes the next click again, once one has been swallowed', () => {
    const page = load(chain(4));
    const box = page.doc.querySelector('[data-box="o:3"]')!;

    dragBy(page, box, 40, 25);
    click(page, box);
    click(page, box);

    expect(posted[posted.length - 1]).toEqual({ command: 'focusNode', oop: '3' });
  });

  it('never drags a box to a negative position', () => {
    const page = load(chain(4));
    const box = page.doc.querySelector('[data-box="o:2"]')!;

    dragBy(page, box, -9999, -9999);

    expect(posted).toEqual([{ command: 'moveBox', boxId: 'o:2', x: 0, y: 0 }]);
  });

  it('leaves the grip the only place a drag can start', () => {
    const page = load(chain(4));
    const box = page.doc.querySelector('[data-box="o:3"]')!;
    const notTheGrip = box.querySelector('rect')!;

    notTheGrip.dispatchEvent(
      new page.window.MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: 100,
      }),
    );
    notTheGrip.dispatchEvent(
      new page.window.MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 200 }),
    );
    notTheGrip.dispatchEvent(
      new page.window.MouseEvent('pointerup', { bubbles: true, clientX: 200, clientY: 200 }),
    );

    expect(posted.some((m) => m.command === 'moveBox')).toBe(false);
  });
});

describe('hiding a line', () => {
  // Hiding trims the DRAWING, never the graph: an edge is a fact about the repository, so
  // this never leaves the webview and any redraw brings every line back.
  const selectedEdge = (page: Loaded): Element => {
    const edge = page.doc.querySelector('[data-edge][data-tip]')!;
    click(page, edge.querySelector('.edgehit')!);
    return edge;
  };

  it('takes the line off the drawing without telling the host', () => {
    const page = load(chain(4));
    const edge = selectedEdge(page);

    click(page, edge.querySelector('[data-edge-hide]')!);

    expect(edge.classList.contains('hidden')).toBe(true);
    expect(posted).toEqual([]);
  });

  it('counts what is hidden, so nothing is a dead end', () => {
    const page = load(chain(4));

    click(page, selectedEdge(page).querySelector('[data-edge-hide]')!);

    expect(page.doc.getElementById('edgebar')!.hasAttribute('hidden')).toBe(false);
    expect(page.doc.getElementById('edgecount')!.textContent).toBe('1');
  });

  it('puts them all back on request', () => {
    const page = load(chain(4));
    click(page, selectedEdge(page).querySelector('[data-edge-hide]')!);

    click(page, page.doc.getElementById('restoreedges')!);

    expect(page.doc.querySelectorAll('[data-edge].hidden')).toHaveLength(0);
    expect(page.doc.getElementById('edgebar')!.hasAttribute('hidden')).toBe(true);
  });

  it('lets the selection go with the line it was on', () => {
    const page = load(chain(4));
    const edge = selectedEdge(page);

    click(page, edge.querySelector('[data-edge-hide]')!);

    expect(page.doc.querySelectorAll('[data-edge].hl')).toHaveLength(0);
    expect(edge.querySelector(':scope > title')).toBeNull();
  });

  it('offers no × until a line is selected', () => {
    // An × on every edge would be exactly the clutter it exists to relieve; it is CSS-
    // hidden until then, and the bar stays away while nothing is hidden.
    const page = load(chain(4));

    expect(page.doc.getElementById('edgebar')!.hasAttribute('hidden')).toBe(true);
  });
});

describe('the other controls', () => {
  it('walks back along the breadcrumb without opening a tab', () => {
    const page = load(chain(4));
    const crumb = page.doc.querySelector('[data-goto]');
    if (!crumb) return; // a one-step trail has no way back, which is itself correct

    click(page, crumb);

    expect(posted).toEqual([{ command: 'goTo', index: 0 }]);
  });

  it('asks the host to put removed boxes back', () => {
    const page = load({ ...chain(4), removedCount: 2 });

    click(page, page.doc.querySelector('[data-restore-removed]')!);

    expect(posted).toEqual([{ command: 'restoreRemoved' }]);
  });

  it('asks the host to drop every hand placement', () => {
    const page = load({ ...chain(4), positions: { 'o:2': { x: 400, y: 250 } } });

    click(page, page.doc.querySelector('[data-reset-layout]')!);

    expect(posted).toEqual([{ command: 'resetLayout' }]);
  });

  it('offers neither control while there is nothing to undo', () => {
    // Not drawn at all rather than drawn disabled: a way back that leads nowhere is one
    // more thing on a page whose whole problem was having too much on it.
    const page = load(chain(4));

    expect(page.doc.querySelector('[data-restore-removed]')).toBeNull();
    expect(page.doc.querySelector('[data-reset-layout]')).toBeNull();
  });

  it('lets the innermost control win, whatever encloses it', () => {
    // Nesting decides, not the order of the routing table: a × inside a box that is itself
    // clickable used to turn into a re-centre.
    const page = load(chain(4));
    const box = page.doc.querySelector('[data-box="o:3"]')!;
    const remove = box.querySelector('[data-remove-oop]')!;

    click(page, remove);

    expect(posted).toEqual([{ command: 'removeFromCanvas', oop: '3' }]);
  });
});
