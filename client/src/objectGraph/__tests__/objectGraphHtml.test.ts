// What the reference graph draws, given a walk.
//
// The queries' tests say the data is true; these say the picture of it is. Most of what
// follows pins a rule that exists because the drawing was once wrong in a specific way --
// an edge behind a box, a floating slot name belonging to nothing visible, a node in the
// model with nowhere on the page -- and each of those is a way for a correct answer to be
// presented as a false one.
import { describe, it, expect } from 'vitest';

import { renderObjectGraphHtml, ObjectGraphView } from '../objectGraphHtml';
import type { CanvasNode } from '../objectGraphHtml';
import type { ReferrerGroup, SlotEdge } from '../../queries/objectGraph';

const node = (
  oop: string,
  label: string,
  className: string,
  parentOop?: string,
  viaClass?: string,
): CanvasNode => ({ oop, label, className, parentOop, viaClass });

const group = (referrerClass: string, referrerClassOop: string, count: number): ReferrerGroup => ({
  referrerClass,
  referrerClassOop,
  count,
});

/** A view centred on `Product(Widget)`, with whatever else the test puts around it. */
const viewOf = (over: Partial<ObjectGraphView> = {}): ObjectGraphView => ({
  trail: [{ oop: '10', label: 'GraphDemoProduct' }] as ObjectGraphView['trail'],
  targetLabel: 'Product(Widget)',
  targetClass: 'GraphDemoProduct',
  targetOop: '10',
  groups: [],
  groupsByOop: {},
  scanMillis: 20,
  canvas: { nodes: [node('10', 'Product(Widget)', 'GraphDemoProduct')], edges: [] },
  positions: {},
  removedCount: 0,
  nonce: 'n',
  script: '',
  ...over,
});

/** Just the drawing, so a match cannot come from the table or the legend below it. */
const svgOf = (view: ObjectGraphView): string => {
  const html = renderObjectGraphHtml(view);
  const start = html.indexOf('<svg');
  return start === -1 ? '' : html.slice(start, html.indexOf('</svg>', start));
};

const attrs = (svg: string, re: RegExp): string[] => [...svg.matchAll(re)].map((m) => m[1]);

/** Every `data-tip` on the drawing, decoded back from attribute escaping. */
const tips = (svg: string): string[] =>
  attrs(svg, /data-tip="([^"]*)"/g).map((t) =>
    t
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&'),
  );

/** The text drawn ON the edges -- counts only, since nothing else belongs there. */
const edgeText = (svg: string): string[] => attrs(svg, /<text class="count"[^>]*>([^<]*)<\/text>/g);

describe('what carries text on the drawing', () => {
  // Three or four slot names floating between the boxes belong to nothing you can see:
  // each sits near two lines and describes one. They moved to the selected edge's tooltip,
  // which also has room for the whole answer -- `[7]` on a line never said which array.
  const oneOfEach = viewOf({
    groupsByOop: {
      '10': [
        group('GraphDemoLineItem', '100', 1),
        group('Array', '200', 1),
        group('GraphDemoOrder', '400', 12),
      ],
    },
    canvas: {
      nodes: [
        node('10', 'Product(Widget)', 'GraphDemoProduct'),
        node(
          '20',
          'LineItem(SO-1197: 39 x Widget)',
          'GraphDemoLineItem',
          '10',
          'GraphDemoLineItem',
        ),
        node('30', 'anArray( Product(Widget), … )', 'Array', '10', 'Array'),
        node('50', 'Order(SO-1001)', 'GraphDemoOrder', '10', 'GraphDemoOrder'),
        node('51', 'Order(SO-1002)', 'GraphDemoOrder', '10', 'GraphDemoOrder'),
      ],
      edges: [
        { fromOop: '20', toOop: '10', via: 'product' },
        { fromOop: '30', toOop: '10', via: '[7]' },
        { fromOop: '50', toOop: '10', via: 'items' },
        { fromOop: '51', toOop: '10', via: 'items' },
      ] as SlotEdge[],
    },
  });

  it('prints a count on a class box’s edge and nothing on an object’s', () => {
    expect(edgeText(svgOf(oneOfEach))).toEqual(['12']);
  });

  it('tells a selected object edge which instance variable it is', () => {
    expect(tips(svgOf(oneOfEach))).toContain(
      'Instance variable "product" of LineItem(SO-1197: 39 x Widget) → Product(Widget)',
    );
  });

  it('names the array as well as the index, since [7] alone does not', () => {
    expect(tips(svgOf(oneOfEach))).toContain(
      'Slot 7 of anArray( Product(Widget), … ) → Product(Widget)',
    );
  });

  it('says why an unordered collection has no slot to name', () => {
    const view = viewOf({
      groupsByOop: { '10': [group('IdentitySet', '300', 1)] },
      canvas: {
        nodes: [
          node('10', 'Product(Widget)', 'GraphDemoProduct'),
          node('40', 'anIdentitySet( … )', 'IdentitySet', '10', 'IdentitySet'),
        ],
        edges: [{ fromOop: '40', toOop: '10', via: '(element)' }],
      },
    });

    expect(tips(svgOf(view))).toEqual([
      'An element of anIdentitySet( … ) → Product(Widget) — unordered storage, so no addressable slot',
    ]);
  });

  it('offers a class box’s edge no tooltip, having no one variable to name', () => {
    // It stands for many references from many objects. Something vague would be worse than
    // nothing, and the count it already carries is the honest answer.
    const svg = svgOf(oneOfEach);
    const groupEdge = /data-edge="sg:[^"]*"( data-tip=)?/.exec(svg);

    expect(groupEdge?.[1]).toBeUndefined();
  });
});

describe('which references become lines', () => {
  // Every reference among the drawn objects used to be lined, the ones the columns did not
  // express routed over the top of the picture. A handful of those turns the drawing into
  // a thicket, so only the layout's own edges are drawn now -- but the count of the rest is
  // still reported, so the picture never claims the lines are the whole story.
  const twoHops = viewOf({
    targetOop: '30',
    groupsByOop: {
      '10': [group('GraphDemoLineItem', '100', 1)],
      '20': [group('GraphDemoOrder', '400', 1)],
    },
    canvas: {
      nodes: [
        node('10', 'Product(Widget)', 'GraphDemoProduct'),
        node('20', 'LineItem(SO-1197)', 'GraphDemoLineItem', '10', 'GraphDemoLineItem'),
        node('30', 'Order(SO-1197)', 'GraphDemoOrder', '20', 'GraphDemoOrder'),
      ],
      edges: [
        { fromOop: '20', toOop: '10', via: 'product' },
        { fromOop: '30', toOop: '20', via: 'items' },
        // The line item points at the order as well -- a real reference the columns do not
        // express, because the two are not neighbours in the layout.
        { fromOop: '20', toOop: '30', via: 'order' },
      ],
    },
  });

  it('draws a line only where the layout already stands the two boxes side by side', () => {
    const svg = svgOf(twoHops);

    // One edge per box that points at the box on its left; the third reference gets none.
    expect(attrs(svg, /data-edge="(s[^"]*)"/g)).toHaveLength(2);
  });

  it('still reports how many references there are among the boxes', () => {
    expect(renderObjectGraphHtml(twoHops)).toContain(
      '<strong>3</strong> reference(s) between them',
    );
  });
});

describe('boxes', () => {
  it('draws a class holding one object as that object, not a box around it', () => {
    const view = viewOf({
      groupsByOop: { '10': [group('ClassHistory', '100', 1)] },
      canvas: {
        nodes: [
          node('10', 'SdDemoShadow', 'SdDemoShadow class'),
          node('20', 'aClassHistory( SdDemoShadow )', 'ClassHistory', '10', 'ClassHistory'),
        ],
        edges: [{ fromOop: '20', toOop: '10', via: '[1]' }],
      },
    });
    const svg = svgOf(view);

    expect(attrs(svg, /data-box="(o:[^"]*)"/g)).toContain('o:20');
    expect(attrs(svg, /data-box="(g:[^"]*)"/g)).toHaveLength(0);
  });

  it('gives a class holding several a box, with its objects inside it', () => {
    // Containment is what says "these are its referrers", so no line has to run back past
    // the group box -- which is what used to make an object look as though it referenced
    // the class Array itself.
    const view = viewOf({
      groupsByOop: { '10': [group('GraphDemoOrder', '400', 12)] },
      canvas: {
        nodes: [
          node('10', 'Product(Widget)', 'GraphDemoProduct'),
          node('50', 'Order(SO-1001)', 'GraphDemoOrder', '10', 'GraphDemoOrder'),
          node('51', 'Order(SO-1002)', 'GraphDemoOrder', '10', 'GraphDemoOrder'),
        ],
        edges: [],
      },
    });
    const svg = svgOf(view);

    expect(attrs(svg, /data-box="(g:[^"]*)"/g)).toEqual(['g:10:GraphDemoOrder']);
    // Both members are reachable from inside the group, not as boxes of their own.
    expect(attrs(svg, /data-focus-oop="(5[01])"/g).sort()).toEqual(['50', '51']);
    expect(attrs(svg, /data-box="(o:5[01])"/g)).toHaveLength(0);
  });

  it('draws every node on the graph, even one no group accounts for', () => {
    // Rendering is total on purpose. A node was once drawn only if its (parent, class) pair
    // matched one of the parent's groups, so removing a box in the middle left its children
    // with nowhere to go: they vanished from the page while staying in the model, and it
    // looked as though the wrong object had been removed.
    const view = viewOf({
      groupsByOop: {},
      canvas: {
        nodes: [
          node('10', 'Product(Widget)', 'GraphDemoProduct'),
          node('99', 'Orphan(re-parented)', 'GraphDemoOrder', '10', 'GraphDemoOrder'),
        ],
        edges: [],
      },
    });

    expect(attrs(svgOf(view), /data-box="(o:[^"]*)"/g).sort()).toEqual(['o:10', 'o:99']);
  });

  it('keeps drawing the picture when the centre has no referrers of its own', () => {
    // The layout is rooted at the objects that arrived without a parent, not at whatever is
    // centred: rooting at the centre emptied the page whenever you focused a leaf, since
    // nothing descends from it, while the counter still claimed four objects.
    const view = viewOf({
      targetOop: '20',
      groupsByOop: { '10': [group('GraphDemoLineItem', '100', 1)] },
      canvas: {
        nodes: [
          node('10', 'Product(Widget)', 'GraphDemoProduct'),
          node('20', 'LineItem(SO-1197)', 'GraphDemoLineItem', '10', 'GraphDemoLineItem'),
        ],
        edges: [{ fromOop: '20', toOop: '10', via: 'product' }],
      },
    });

    expect(attrs(svgOf(view), /data-box="(o:[^"]*)"/g).sort()).toEqual(['o:10', 'o:20']);
  });

  it('honours a box placed by hand over the one the layout computed', () => {
    // A drag has to outlive the redraw it causes, so the position is held by the walk and
    // applied after the automatic pass -- the layout stays the one source of truth for
    // every box nobody has touched.
    const view = viewOf({
      positions: { 'o:10': { x: 400, y: 250 } },
      groupsByOop: { '10': [group('ClassHistory', '100', 1)] },
      canvas: {
        nodes: [
          node('10', 'Product(Widget)', 'GraphDemoProduct'),
          node('20', 'aClassHistory( … )', 'ClassHistory', '10', 'ClassHistory'),
        ],
        edges: [],
      },
    });

    expect(svgOf(view)).toContain('data-bx="400" data-by="250"');
  });
});

describe('what the panel says about itself', () => {
  it('reports an object nothing points at as an answer, not as an empty screen', () => {
    // Most often it is reachable only from a session temporary or a stack frame, neither of
    // which is a repository reference. Saying so is the useful reply.
    expect(renderObjectGraphHtml(viewOf())).toContain(
      'Nothing in the repository points at this object',
    );
  });

  it('says when it is drawing fewer classes than it found', () => {
    const many = Array.from({ length: 40 }, (_, i) => group(`Class${i}`, String(i), 40 - i));

    expect(renderObjectGraphHtml(viewOf({ groups: many }))).toContain('referrer classes');
  });

  it('escapes a printString rather than letting it close a tag', () => {
    // Labels are arbitrary text from the stone.
    const view = viewOf({
      canvas: { nodes: [node('10', '<script>alert(1)</script>', 'Evil')], edges: [] },
    });

    expect(svgOf(view)).not.toContain('<script>');
  });
});
