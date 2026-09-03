/**
 * Pure HTML/SVG rendering for the object-graph panel — the live reference graph of one
 * object: every class that holds a reference to it, how many references each class's
 * instances hold, and the individual referrers you can step to.
 *
 * The panel is a NAVIGATOR, not a report. A class row expands to the actual objects of
 * that class, and stepping into one of those re-centres the whole graph on it, so the
 * repository's reference structure can be walked rather than merely sampled. A breadcrumb
 * records the walk.
 *
 * Rendered whole on every action, host-side. That is deliberate: the host owns the walk
 * state and pushes a complete document, so the view script sends intent and never applies
 * incremental updates — there is no second copy of the state in the webview to drift.
 *
 * Hand-rolled SVG. Jasper carries no charting dependency, and at a couple of dozen nodes a
 * layered layout reads better than a force simulation would: the centre sits on the left,
 * referrer classes stack on the right in descending count order, one curve per edge.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import { ReferrerGroup, ReferrerObject, SlotEdge } from '../queries/objectGraph';

/** One object the walk has visited. The last entry is where the walk currently is. */
export interface WalkStep {
  oop: string;
  /** Short label for the breadcrumb — a class name, or a trimmed printString. */
  label: string;
}

/** One object placed on the graph.
 *
 *  `parentOop` and `viaClass` record HOW it got there: it was found among the referrers
 *  of `parentOop`, grouped under the class `viaClass`. That is what lets one object sit in
 *  the layer beyond its parent instead of floating in a second diagram — the thing that
 *  made the two-picture version incoherent. The root has neither. */
export interface CanvasNode {
  oop: string;
  className: string;
  /** printString, already truncated. */
  label: string;
  parentOop?: string;
  viaClass?: string;
}

/** The objects gathered on the canvas and every reference that runs between them.
 *
 *  The edges are recomputed from the node set on every change rather than accumulated
 *  as you click, so the picture always shows ALL references among these objects — not
 *  just the ones you happened to walk along. That is what makes it a picture of the
 *  layout rather than a record of your clicks. */
export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: SlotEdge[];
}

/** The one class row currently showing its individual referrers. */
export interface ExpandedClass {
  /** The object whose referrers this group belongs to. A group box on the graph belongs to
   *  the object it points at, which is not necessarily the centre — expanding against the
   *  centre regardless is what made a group of Product(Widget) answer "no instance points
   *  at this object any more" once the walk had moved on to a Dictionary. */
  ownerOop: string;
  classOop: string;
  className: string;
  objects: ReferrerObject[];
  /** True count, which may exceed `objects.length`. */
  total: number;
}

/** What the panel needs to draw one object's inbound references. */
export interface ObjectGraphView {
  /** The walk so far; the last entry is the object being shown. Never empty. */
  trail: WalkStep[];
  /** The centre object's `printString`, already truncated by the caller. */
  targetLabel: string;
  targetClass: string;
  targetOop: string;
  /** Referrer classes of the CENTRE, largest count first — what the table lists. */
  groups: ReferrerGroup[];
  /** Referrer classes per object on the graph, keyed by oop. The centre's own entry is
   *  `groups`; an object gains one once it has been asked about. This is what lets the
   *  single picture carry more than one layer of grouping. */
  groupsByOop: Record<string, ReferrerGroup[]>;
  scanMillis: number;
  /** Set when a class row is expanded to show its objects. */
  expanded?: ExpandedClass;
  /** The accumulated canvas. Always holds at least the centre object; once a second
   *  object is added the diagram switches from the referrer-class fan to this. */
  canvas: CanvasGraph;
  /** CSP nonce for the injected view script. */
  nonce: string;
  /** Contents of objectGraphView.js, injected under the nonce. */
  script: string;
}

/** True when `name` names a METACLASS — GemStone spells one `'Foo class'`.
 *
 *  A metaclass has exactly one instance: the class itself. So a row reading
 *  `LibcFcntl class` means the referrer IS the class `LibcFcntl`, and opening that class
 *  in the Explorer is a useful offer alongside stepping into it. Exported so the hint a
 *  row shows and the action the host takes are decided by one predicate. */
export function isMetaclassName(name: string): boolean {
  return name.endsWith(' class');
}

/** The class a metaclass row refers to: `'LibcFcntl class'` -> `'LibcFcntl'`. */
export function classNameFromMetaclass(name: string): string {
  return name.slice(0, -' class'.length);
}

/** How many referrer classes the diagram draws. The rest are named in the table below it —
 *  a class `Object` scan answers 284 groups, which is a fine table and an illegible
 *  picture. */
const MAX_NODES = 20;

const TOP = 24;
/** Space left between the arrowhead's tip and the centre box, so the head reads as
 *  arriving at the box rather than overlapping its border. */
const ARROW_GAP = 3;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function renderBreadcrumb(trail: WalkStep[]): string {
  if (trail.length <= 1) return '';
  // Every step but the last is a way back. The last is where you are, so it is not a
  // button — a breadcrumb whose final crumb navigates is a breadcrumb that lies.
  const crumbs = trail
    .map((step, i) => {
      const last = i === trail.length - 1;
      const label = escapeHtml(truncate(step.label, 34));
      return last
        ? `<span class="crumb here" aria-current="page">${label}</span>`
        : `<button class="crumb" data-goto="${i}" title="Back to ${escapeHtml(step.label)}">${label}</button>`;
    })
    .join('<span class="sep">›</span>');
  return `<nav class="trail" aria-label="Object graph walk">${crumbs}</nav>`;
}

/** The individual referrers of an expanded class, as sub-rows under it. Stepping into one
 *  is the primary action, so the object's own text is the step control. */
function renderObjectRows(expanded: ExpandedClass, canvasOops: Set<string>): string {
  const rows = expanded.objects
    .map((o) => {
      const explorer = o.isClass
        ? `<button class="act" data-reveal-oop="${escapeHtml(o.oop)}" ` +
          `title="Open this class in the GemStone Explorer">Explorer</button>`
        : '';
      const onCanvas = canvasOops.has(o.oop);
      return `<tr class="objrow">
      <td class="obj" colspan="2">
        <button class="dive" data-focus-oop="${escapeHtml(o.oop)}"
                title="Ask what points at this object, keeping everything already drawn: ${escapeHtml(o.printString)}"
        >${escapeHtml(o.printString)}</button>
      </td>
      <td class="acts">
        <button class="act${onCanvas ? ' on' : ''}"
                ${onCanvas ? `data-remove-oop="${escapeHtml(o.oop)}"` : `data-add-oop="${escapeHtml(o.oop)}"`}
                title="${
                  onCanvas
                    ? `On the graph — click to take it off again: ${escapeHtml(o.printString)}`
                    : `Add this object to the graph as the next layer: ${escapeHtml(o.printString)}`
                }"
        >${onCanvas ? '✓ on graph' : '+ graph'}</button>
        <button class="act" data-inspect-oop="${escapeHtml(o.oop)}" title="Inspect this object">Inspect</button>
        <button class="act" data-dive="${escapeHtml(o.oop)}"
                title="Open this object's graph in a NEW tab, leaving this one as it is: ${escapeHtml(o.printString)}"
        >↗ tab</button>
        ${explorer}
      </td>
    </tr>`;
    })
    .join('');

  // Say what is not listed. A list that quietly shows 100 of 854 reads as all of them.
  const cut =
    expanded.total > expanded.objects.length
      ? `<tr class="objrow more"><td colspan="3">Showing ${expanded.objects.length} of
         ${expanded.total}. Use <em>Inspect all</em> for the whole set.</td></tr>`
      : '';
  return rows + cut;
}

function renderTable(view: ObjectGraphView): string {
  if (view.groups.length === 0) return '';
  const canvasOops = new Set(view.canvas.nodes.map((n) => n.oop));
  const rows = view.groups
    .map((g) => {
      const open = view.expanded?.classOop === g.referrerClassOop;
      const meta = isMetaclassName(g.referrerClass);
      const explorer = meta
        ? `<button class="act" data-reveal-class="${escapeHtml(classNameFromMetaclass(g.referrerClass))}" ` +
          `title="Open ${escapeHtml(classNameFromMetaclass(g.referrerClass))} in the GemStone Explorer">Explorer</button>`
        : '';
      const row = `<tr class="row${meta ? ' meta' : ''}${open ? ' open' : ''}">
      <td class="cls">
        <button class="disclose" data-expand="${escapeHtml(g.referrerClassOop)}"
                data-class-name="${escapeHtml(g.referrerClass)}"
                data-expand-of="${escapeHtml(view.targetOop)}" aria-expanded="${open}"
                title="${open ? 'Hide' : 'List'} the ${g.count} ${escapeHtml(g.referrerClass)} referrer(s)"
        ><span class="chev">${open ? '▾' : '▸'}</span> ${escapeHtml(g.referrerClass)}</button>
      </td>
      <td class="num">${g.count}</td>
      <td class="acts">
        <button class="act" data-inspect-collection="${escapeHtml(g.referrerClassOop)}"
                data-class-name="${escapeHtml(g.referrerClass)}"
                title="Inspect all ${g.count} referrer(s) as one collection">Inspect all</button>
        ${explorer}
      </td>
    </tr>`;
      return open && view.expanded ? row + renderObjectRows(view.expanded, canvasOops) : row;
    })
    .join('');

  return `<table>
    <thead><tr><th>Referrer class</th><th class="num">Refs</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** A box on the graph.
 *
 *  Either a lone object, or a GROUP containing the objects of one class that have been
 *  promoted onto the picture. Containment is what expresses "these objects are the
 *  referrers of that class": the group draws one edge to the object it points at, and its
 *  members sit indented inside it rather than each running its own long edge back past the
 *  group box — which is what used to send lines behind other boxes and made an object look
 *  as though it referenced the class `Array` itself. */
interface Box {
  id: string;
  kind: 'object' | 'group';
  /** Header line: the object's printString, or the group's class name. */
  title: string;
  /** Second line: the object's class, or the group's object count. */
  sub: string;
  layer: number;
  /** The object this box points at — always in the layer immediately to its left, so an
   *  edge never has to cross a column. */
  towardOop?: string;
  /** Edge label toward the owner: the reference count for a group, the slot for an object. */
  via?: string;
  oop?: string;
  classOop?: string;
  isCentre?: boolean;
  /** Members drawn inside a group box. */
  rows?: { oop: string; label: string; className: string; via?: string }[];
  /** Objects the group holds that are NOT drawn inside it yet. */
  remaining?: number;
}

const LAYER_W = 230;
const BOX_W = 196;
const OBJECT_H = 38;
const HEADER_H = 34;
const ROW_H = 24;
const BOX_PAD = 6;
const BOX_GAP = 14;
/** Headroom reserved above the boxes for cross-reference edges, and the height they run
 *  at within it. A cross edge can span several layers, and drawn as a direct curve it went
 *  straight THROUGH whatever boxes lay between — 40 of 91 sampled points of one `order`
 *  edge fell inside an unrelated box, taking its label with them, so the line read as
 *  belonging to the box it crossed and its arrowhead was hidden behind it. Routed over the
 *  top, it belongs to nothing it passes and arrives in the open. */
const CROSS_LANE_H = 34;
const CROSS_LANE_Y = 14;

function boxHeight(b: Box): number {
  if (b.kind === 'object') return OBJECT_H;
  return HEADER_H + (b.rows?.length ?? 0) * ROW_H + ((b.rows?.length ?? 0) ? BOX_PAD : 0);
}

/** Build the picture as one layered graph of boxes.
 *
 *  Layer 0 is the object being asked about. Every later layer holds the boxes for one more
 *  hop outward: a class with several referrers becomes a group box containing the ones
 *  promoted onto the graph, and a class with exactly one becomes that object on its own,
 *  since a box around a single thing is just an extra box. */
function layoutBoxes(view: ObjectGraphView): Box[] {
  const promotedOf = (ownerOop: string, className: string) =>
    view.canvas.nodes.filter((n) => n.parentOop === ownerOop && n.viaClass === className);
  const slotOf = (fromOop: string, toOop: string) =>
    view.canvas.edges.find((e) => e.fromOop === fromOop && e.toOop === toOop)?.via;

  const boxes: Box[] = [];
  const layerOfObject = new Map<string, number>();

  // Laid out from the graph's ROOTS — the objects that arrived without a parent — not from
  // whatever is currently centred. Rooting at the centre meant that focusing an object with
  // no referrers of its own emptied the picture, because nothing else descends from it:
  // three boxes vanished while the counter still read "4 objects on the graph". Centring
  // re-aims the question; it does not re-root the drawing.
  const roots = view.canvas.nodes.filter((n) => !n.parentOop).map((n) => n.oop);
  const startFrom = roots.length ? roots : [view.targetOop];

  for (const rootOop of startFrom) {
    const node = view.canvas.nodes.find((n) => n.oop === rootOop);
    layerOfObject.set(rootOop, 0);
    boxes.push({
      id: `o:${rootOop}`,
      kind: 'object',
      title: node?.label ?? view.targetLabel,
      sub: node?.className ?? view.targetClass,
      layer: 0,
      oop: rootOop,
      isCentre: rootOop === view.targetOop,
    });
  }

  // Breadth-first outward, so an owner always has a layer before its groups are placed.
  const queue: string[] = [...startFrom];
  const done = new Set<string>();
  while (queue.length) {
    const ownerOop = queue.shift()!;
    if (done.has(ownerOop)) continue;
    done.add(ownerOop);
    const ownerLayer = layerOfObject.get(ownerOop) ?? 0;
    const groups = view.groupsByOop[ownerOop] ?? [];

    for (const g of groups) {
      const members = promotedOf(ownerOop, g.referrerClass);
      const listed =
        view.expanded?.ownerOop === ownerOop && view.expanded.classOop === g.referrerClassOop
          ? view.expanded.total
          : undefined;

      // One object behind the class: draw the object, not a box around it.
      if (g.count === 1 && members.length === 1) {
        const m = members[0];
        layerOfObject.set(m.oop, ownerLayer + 1);
        boxes.push({
          id: `o:${m.oop}`,
          kind: 'object',
          title: m.label,
          sub: m.className,
          layer: ownerLayer + 1,
          oop: m.oop,
          isCentre: m.oop === view.targetOop,
          towardOop: ownerOop,
          via: slotOf(m.oop, ownerOop),
        });
        queue.push(m.oop);
        continue;
      }

      for (const m of members) layerOfObject.set(m.oop, ownerLayer + 1);
      boxes.push({
        id: `g:${ownerOop}:${g.referrerClass}`,
        kind: 'group',
        title: g.referrerClass,
        sub: `${g.count} object${g.count === 1 ? '' : 's'}`,
        layer: ownerLayer + 1,
        towardOop: ownerOop,
        via: String(g.count),
        classOop: g.referrerClassOop,
        oop: ownerOop,
        rows: members.map((m) => ({
          oop: m.oop,
          label: m.label,
          className: m.className,
          via: slotOf(m.oop, ownerOop),
        })),
        remaining: listed !== undefined ? Math.max(0, listed - members.length) : undefined,
      });
      for (const m of members) queue.push(m.oop);
    }
  }
  return boxes;
}

/** Render the single layered graph. */
function renderGraph(view: ObjectGraphView): string {
  const boxes = layoutBoxes(view);
  if (boxes.length === 0) return '';

  const perLayer = new Map<number, Box[]>();
  for (const b of boxes) {
    perLayer.set(b.layer, [...(perLayer.get(b.layer) ?? []), b]);
  }
  const layerHeight = (list: Box[]) =>
    list.reduce((sum, b) => sum + boxHeight(b) + BOX_GAP, 0) - BOX_GAP;

  // Which references the layout already expresses; anything else is a cross edge that has
  // to be routed over the top, so the headroom must be known before the boxes are placed.
  const structural = new Set<string>();
  const drawnOops = new Set<string>();
  for (const b of boxes) {
    if (b.kind === 'object' && b.oop) {
      drawnOops.add(b.oop);
      if (b.towardOop) structural.add(`${b.oop}->${b.towardOop}`);
    }
    for (const r of b.rows ?? []) {
      drawnOops.add(r.oop);
      if (b.oop) structural.add(`${r.oop}->${b.oop}`);
    }
  }
  const crossRefs = view.canvas.edges.filter(
    (e) =>
      e.fromOop !== e.toOop &&
      drawnOops.has(e.fromOop) &&
      drawnOops.has(e.toOop) &&
      !structural.has(`${e.fromOop}->${e.toOop}`),
  );
  const lane = crossRefs.length ? CROSS_LANE_H : 0;

  const height = lane + TOP * 2 + Math.max(...[...perLayer.values()].map(layerHeight));
  const maxLayer = Math.max(...boxes.map((b) => b.layer));
  const width = 32 + (maxLayer + 1) * LAYER_W;

  // Place every box, and record where each OBJECT sits — the centre and lone objects at
  // their box, a group member at its row — so an edge can aim at the object itself.
  const pos = new Map<string, { x: number; y: number }>();
  // Both sides of every drawn object, because a cross-reference can run in either
  // direction across the picture and has to leave from the correct edge.
  const anchor = new Map<string, { left: number; right: number; y: number }>();
  for (const [layer, list] of perLayer) {
    let y = lane + TOP + (height - lane - TOP * 2 - layerHeight(list)) / 2;
    for (const b of list) {
      const x = 16 + layer * LAYER_W;
      pos.set(b.id, { x, y });
      if (b.kind === 'object' && b.oop) {
        anchor.set(b.oop, { left: x, right: x + BOX_W, y: y + OBJECT_H / 2 });
      }
      b.rows?.forEach((r, i) => {
        anchor.set(r.oop, {
          left: x + 8,
          right: x + BOX_W - 8,
          y: y + HEADER_H + i * ROW_H + ROW_H / 2,
        });
      });
      y += boxHeight(b) + BOX_GAP;
    }
  }

  const edges = boxes
    .map((b) => {
      if (!b.towardOop) return '';
      const from = pos.get(b.id);
      const to = anchor.get(b.towardOop);
      if (!from || !to) return '';
      const sy = from.y + (b.kind === 'group' ? HEADER_H / 2 : OBJECT_H / 2);
      const tx = to.right + ARROW_GAP;
      const midX = (from.x + tx) / 2;
      return (
        `<path class="edge" marker-end="url(#ref-arrow)" stroke-width="1.4" ` +
        `d="M ${from.x} ${sy} C ${midX} ${sy}, ${midX} ${to.y}, ${tx} ${to.y}"/>` +
        (b.via
          ? `<text class="count" x="${midX}" y="${(sy + to.y) / 2 - 4}" text-anchor="middle">` +
            `${escapeHtml(b.via)}</text>`
          : '')
      );
    })
    .join('\n    ');

  // Every OTHER reference between two objects on the picture.
  //
  // The structural edges above only draw a box's own placement — a group to the object it
  // points at, a lone object to its parent — and containment stands in for a member's
  // reference to its group's owner. Anything else is a real reference between two things
  // on screen that nothing would otherwise show: a line item pointing at both a product
  // and that product's order, once both are drawn. Leaving those out does not simplify the
  // picture, it makes it wrong, so they are drawn as thinner dotted links.
  const crossEdges = crossRefs
    .map((e) => {
      const from = anchor.get(e.fromOop);
      const to = anchor.get(e.toOop);
      if (!from || !to) return '';
      // Up out of the source, across the lane, down onto the target. Orthogonal rather than
      // a curve so the vertical runs sit in the gaps BETWEEN layers, where no box lives:
      // that is what keeps the line, its label and its arrowhead all in the open.
      const goingRight = to.left > from.right;
      const sx = goingRight ? from.right : from.left;
      const cx1 = goingRight ? from.right + 12 : from.left - 12;
      const cx2 = goingRight ? to.left - 12 - ARROW_GAP : to.right + 12 + ARROW_GAP;
      const tx = goingRight ? to.left - ARROW_GAP : to.right + ARROW_GAP;
      const midX = (cx1 + cx2) / 2;
      return (
        `<path class="edge cross" marker-end="url(#ref-arrow)" stroke-width="1.2" ` +
        `d="M ${sx} ${from.y} L ${cx1} ${from.y} L ${cx1} ${CROSS_LANE_Y} ` +
        `L ${cx2} ${CROSS_LANE_Y} L ${cx2} ${to.y} L ${tx} ${to.y}"/>` +
        `<text class="count cross" x="${midX}" y="${CROSS_LANE_Y - 4}" ` +
        `text-anchor="middle">${escapeHtml(e.via)}</text>`
      );
    })
    .join('\n    ');

  const objectBox = (b: Box, p: { x: number; y: number }) => {
    const drop = b.isCentre
      ? ''
      : `<g class="drop" role="button" tabindex="0" data-remove-oop="${escapeHtml(b.oop ?? '')}">
        <title>Take this object off the graph: ${escapeHtml(b.title)}</title>
        <rect x="${p.x + BOX_W - 17}" y="${p.y + 3}" width="14" height="14" rx="3"/>
        <text x="${p.x + BOX_W - 13}" y="${p.y + 14}">\u00d7</text>
      </g>`;
    return `<g class="cnode${b.isCentre ? ' centre' : ''}" role="button" tabindex="0"
              ${b.isCentre ? '' : `data-focus-oop="${escapeHtml(b.oop ?? '')}"`}>
      <title>${
        b.isCentre
          ? 'The object this graph is centred on'
          : `Ask what points at this object, keeping everything already drawn: ${escapeHtml(b.title)}`
      }</title>
      <rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${OBJECT_H}" rx="4"/>
      <text x="${p.x + 8}" y="${p.y + 16}">${escapeHtml(truncate(b.title, 22))}</text>
      <text class="sub" x="${p.x + 8}" y="${p.y + 29}">${escapeHtml(truncate(b.sub, 24))}</text>
      ${drop}
    </g>`;
  };

  const groupBox = (b: Box, p: { x: number; y: number }) => {
    const h = boxHeight(b);
    const rows = (b.rows ?? [])
      .map((r, i) => {
        const ry = p.y + HEADER_H + i * ROW_H;
        // The label has to give way to whatever sits beside it. A fixed truncation ran the
        // printString straight under the slot name — "LineItem(SO-1197:" and "product"
        // printed on top of each other. Budget: ~20 characters of row, less the slot text
        // and the room the × takes.
        const slotText = r.via ? truncate(r.via, 8) : '';
        const labelRoom = Math.max(6, 20 - slotText.length - 2);
        return `<g class="grow" role="button" tabindex="0" data-focus-oop="${escapeHtml(r.oop)}">
        <title>Ask what points at this object, keeping everything already drawn: ${escapeHtml(r.label)}</title>
        <rect x="${p.x + 8}" y="${ry}" width="${BOX_W - 16}" height="${ROW_H - 3}" rx="2"/>
        <text x="${p.x + 16}" y="${ry + 14}">${escapeHtml(truncate(r.label, labelRoom))}</text>
        ${slotText ? `<text class="slot" x="${p.x + BOX_W - 28}" y="${ry + 14}" text-anchor="end">${escapeHtml(slotText)}</text>` : ''}
        <g class="drop" role="button" tabindex="0" data-remove-oop="${escapeHtml(r.oop)}">
          <title>Take this object off the graph: ${escapeHtml(r.label)}</title>
          <rect x="${p.x + BOX_W - 24}" y="${ry + 2}" width="13" height="13" rx="2"/>
          <text x="${p.x + BOX_W - 20}" y="${ry + 12}">\u00d7</text>
        </g>
      </g>`;
      })
      .join('\n      ');
    // Only meaningful once some members ARE drawn; with an empty group the header's own
    // "N objects" already says it, and the line collided with it.
    const more =
      b.rows?.length && b.remaining !== undefined && b.remaining > 0
        ? `<text class="sub" x="${p.x + 16}" y="${p.y + h - 4}">+${b.remaining} not shown</text>`
        : '';
    const meta = isMetaclassName(b.title) ? ' meta' : '';
    return `<g class="gnode${meta}${b.rows?.length ? ' open' : ''}">
      <rect class="stack2" x="${p.x + 7}" y="${p.y + 7}" width="${BOX_W}" height="${h}"/>
      <rect class="stack1" x="${p.x + 4}" y="${p.y + 4}" width="${BOX_W}" height="${h}"/>
      <rect class="front" x="${p.x}" y="${p.y}" width="${BOX_W}" height="${h}"/>
      <g class="ghead" role="button" tabindex="0" data-expand="${escapeHtml(b.classOop ?? '')}"
         data-class-name="${escapeHtml(b.title)}" data-expand-of="${escapeHtml(b.oop ?? '')}">
        <title>List the objects of class ${escapeHtml(b.title)} that point here — ${escapeHtml(b.sub)}</title>
        <rect class="hit" x="${p.x}" y="${p.y}" width="${BOX_W}" height="${HEADER_H}"/>
        <text x="${p.x + 8}" y="${p.y + 15}">${escapeHtml(truncate(b.title, 21))}</text>
        <text class="sub" x="${p.x + 8}" y="${p.y + 28}">${escapeHtml(truncate(b.sub, 24))}</text>
      </g>
      ${rows}
      ${more}
    </g>`;
  };

  const drawn = boxes
    .map((b) => {
      const p = pos.get(b.id)!;
      return b.kind === 'group' ? groupBox(b, p) : objectBox(b, p);
    })
    .join('\n    ');

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
     aria-label="Object graph centred on ${escapeHtml(view.targetLabel)}">
    <defs>
      <marker id="ref-arrow" viewBox="0 0 10 8" refX="9" refY="4"
              markerWidth="9" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
        <path d="M 0 0 L 10 4 L 0 8 z" class="arrowhead"/>
      </marker>
    </defs>
    ${edges}
    ${crossEdges}
    ${drawn}
  </svg>`;
}

/** Render the whole panel. */
export function renderObjectGraphHtml(view: ObjectGraphView): string {
  const total = view.groups.reduce((sum, g) => sum + g.count, 0);
  const classCount = view.groups.length;

  // An object nothing points at is a real, informative answer — not an error and not an
  // empty screen. Most often it is reachable only from a session temp or a stack frame,
  // neither of which is a repository reference. The breadcrumb still lets you back out.
  // Kept to ONE line and rendered in the same slot as the summary, so the picture does not
  // shift when the centre turns out to have no referrers. A taller notice above the graph
  // pushed every box down and read as though the drawing had changed when it had not.
  const summaryLine =
    classCount === 0
      ? `<p class="summary empty">Nothing in the repository points at this object — it is
         reachable only from a session temporary or a stack frame.</p>`
      : `<p class="summary"><strong>${total.toLocaleString()}</strong> object(s) from
         <strong>${classCount}</strong> class(es) point at this · scanned in
         ${view.scanMillis} ms</p>`;

  // Say what the picture leaves out. A diagram that quietly draws the top 20 of 284 reads
  // as the whole story.
  const truncated =
    classCount > MAX_NODES
      ? `<p class="note">Drawing the ${MAX_NODES} largest of ${classCount} referrer classes.
         All ${classCount} are listed below.</p>`
      : '';

  // The canvas takes over the diagram once it holds more than the centre object. Below
  // that there is nothing to accumulate, so the referrer-class fan stays — it answers the
  // question the panel was opened with.
  const accumulating = view.canvas.nodes.length > 1;
  const canvasBar = accumulating
    ? `<p class="canvasbar"><strong>${view.canvas.nodes.length}</strong> objects on the graph,
       <strong>${view.canvas.edges.length}</strong> reference(s) between them.
       <button class="act" data-clear-canvas="1"
       title="Removes every box from the picture except the one in focus. The graph is not
              saved anywhere, so this cannot be undone.">Remove all but the focused object</button></p>`
    : '';

  const hint =
    classCount === 0
      ? ''
      : `<p class="hint">Arrows run the way the reference goes: a box points at the box on
         its left. A <strong>stacked dashed</strong> box summarises the objects of one class
         that point there, and the number on its edge is how many such objects there are — click it
         to list them below. Clicking one there asks what points at it right here, in this
         graph; <em>+ graph</em> puts it on the picture instead, and <em>↗ tab</em> is the
         only thing that opens a second tab. A group holding
         a single object is drawn as that object straight away, and objects you promote from
         a group sit <em>inside</em> it — that containment is what says they are its
         referrers, so no line has to run back past the box. A
         <strong>solid</strong> box is a single object, its edge labelled with the slot the
         reference sits in; click one to ask what points at <em>it</em>, keeping everything
         already drawn. A <strong>dotted</strong> edge is a further reference between two
         objects already on the picture — every reference among them is drawn, not only the
         ones you followed.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${view.nonce}';">
  <title>Object Graph</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 12px 16px;
    }
    h2 { font-size: 1.1em; margin: 0 0 2px; font-weight: 600; }
    .trail { margin: 0 0 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
    .trail .sep { color: var(--vscode-descriptionForeground); margin: 0 2px; }
    .crumb {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.95em;
      padding: 1px 3px;
      cursor: pointer;
    }
    .crumb:hover { text-decoration: underline; }
    .crumb.here { color: var(--vscode-foreground); cursor: default; font-weight: 600; }
    .target-print {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
      padding: 4px 6px;
      border-radius: 3px;
      display: block;
      margin: 0 0 10px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .summary, .note, .empty, .hint { margin: 6px 0 10px; }
    .note, .empty, .hint { color: var(--vscode-descriptionForeground); }
    .canvasbar { margin: 0 0 12px; color: var(--vscode-descriptionForeground); }
    .cnode[data-focus-oop] { cursor: pointer; }
    .cnode[data-focus-oop]:hover rect { stroke: var(--vscode-focusBorder, #4f9cf9); }
    .cnode:focus-visible rect { stroke: var(--vscode-focusBorder, #4f9cf9); }
    .edge.back { stroke-dasharray: 4 3; opacity: 0.7; }
    /* A reference between two drawn objects that the layout does not already express.
       Dotted and dimmer so the structure still reads first, but present, because a
       reference left undrawn makes the picture wrong. */
    .edge.cross { stroke-dasharray: 2 3; opacity: 0.7; }
    .count.cross { font-style: italic; opacity: 0.85; }
    .cnode rect {
      fill: var(--vscode-editor-background);
      stroke: var(--vscode-foreground);
      stroke-opacity: 0.55;
      stroke-width: 1.2;
    }
    .cnode.centre rect { stroke: var(--vscode-charts-blue, #4f9cf9); stroke-width: 1.6; }
    .cnode text {
      font-size: 11.5px;
      fill: var(--vscode-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .cnode .sub { font-size: 9.5px; fill: var(--vscode-descriptionForeground); }
    .cnode .drop { cursor: pointer; }
    .cnode .drop rect { fill: transparent; stroke: transparent; }
    .cnode .drop text { font-size: 12px; fill: var(--vscode-descriptionForeground); }
    .cnode .drop:hover rect { fill: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.3)); }
    .cnode .drop:hover text { fill: var(--vscode-foreground); }
    /* Members drawn INSIDE a group box. Containment is what says "these are the referrers
       of that class", so a row needs to read as part of its box, not as a box of its own. */
    .grow { cursor: pointer; }
    .grow rect {
      fill: var(--vscode-editor-background);
      stroke: var(--vscode-panel-border, rgba(127,127,127,0.35));
      stroke-dasharray: none;
    }
    .grow:hover rect { stroke: var(--vscode-focusBorder, #4f9cf9); }
    .grow text {
      font-size: 10.5px;
      fill: var(--vscode-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .grow .slot { font-size: 9px; fill: var(--vscode-descriptionForeground); }
    .grow .drop rect { fill: transparent; stroke: transparent; }
    .grow .drop text { font-size: 11px; fill: var(--vscode-descriptionForeground); }
    .grow .drop:hover rect { fill: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.3)); }
    .grow .drop:hover text { fill: var(--vscode-foreground); }
    /* The header is the only part of a group box that expands it; a transparent hit rect
       gives it a target without painting over the stacked panels behind. */
    .ghead { cursor: pointer; }
    .ghead rect.hit { fill: transparent; stroke: transparent; }
    .ghead:hover text { fill: var(--vscode-textLink-foreground); }
    .act.on { opacity: 0.65; }
    /* The graph keeps its natural size and the WRAPPER scrolls. Letting the svg scale to
       max-width:100% shrank every label as the graph widened — five layers rendered the
       text at about 8px, which is what made it unreadable. */
    .graphwrap { overflow-x: auto; overflow-y: hidden; margin: 4px 0 16px; }
    .graphwrap svg { display: block; overflow: visible; }
    .edge { fill: none; stroke: var(--vscode-charts-blue, #4f9cf9); opacity: 0.55; }
    /* A marker is not a descendant of the path that uses it, so it inherits nothing from
       the edge — the fill has to be stated here or the head renders black. */
    .arrowhead { fill: var(--vscode-charts-blue, #4f9cf9); opacity: 0.75; }
    .count {
      font-size: 10px;
      fill: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    /* A group box is a STACK of squared-off, dashed panels: many objects, summarised.
       An object box is one solid rounded panel. The two must not be mistakable, since one
       is a real object you can act on and the other is a summary you can only open. */
    .gnode rect {
      fill: var(--vscode-editorWidget-background, rgba(127,127,127,0.10));
      stroke: var(--vscode-panel-border, rgba(127,127,127,0.5));
      stroke-dasharray: 5 3;
    }
    .gnode rect.stack1 { opacity: 0.55; }
    .gnode rect.stack2 { opacity: 0.3; }
    .gnode.open rect.front { stroke: var(--vscode-focusBorder, #4f9cf9); }
    .gnode text {
      font-size: 11.5px;
      fill: var(--vscode-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    table { border-collapse: collapse; width: 100%; max-width: 860px; }
    th, td {
      text-align: left;
      padding: 2px 8px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
    }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .acts { text-align: right; white-space: nowrap; }
    /* Everything clickable says so, and its tooltip says which destination it leads to. */
    .disclose, .dive {
      background: none;
      border: none;
      color: inherit;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: inherit;
      text-align: left;
      padding: 2px 0;
      cursor: pointer;
      width: 100%;
    }
    .disclose:hover, .dive:hover { color: var(--vscode-textLink-foreground); }
    .chev { display: inline-block; width: 1em; color: var(--vscode-descriptionForeground); }
    .act {
      background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.2));
      color: var(--vscode-button-secondaryForeground, inherit);
      border: none;
      border-radius: 2px;
      font-size: 0.85em;
      padding: 1px 6px;
      margin-left: 4px;
      cursor: pointer;
    }
    .act:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,0.35)); }
    tr.row:hover td { background: var(--vscode-list-hoverBackground, rgba(127,127,127,0.15)); }
    tr.row.open td { background: var(--vscode-list-inactiveSelectionBackground, rgba(127,127,127,0.18)); }
    tr.row.meta .cls { font-style: italic; }
    g.gnode.meta text { font-style: italic; }
    tr.objrow td { padding-left: 26px; }
    tr.objrow .obj { font-family: var(--vscode-editor-font-family, monospace); }
    tr.objrow.more td { color: var(--vscode-descriptionForeground); font-style: italic; }
    g.gnode { cursor: pointer; }
    g.gnode:hover rect.front { stroke: var(--vscode-focusBorder, #4f9cf9); }
    .gnode .sub { font-size: 9.5px; fill: var(--vscode-descriptionForeground); }
    .disclose:focus-visible, .dive:focus-visible, .act:focus-visible, .crumb:focus-visible,
    g.gnode:focus-visible rect.front, g.cnode:focus-visible rect {
      outline: 1px solid var(--vscode-focusBorder, #4f9cf9);
    }
  </style>
</head>
<body>
  ${renderBreadcrumb(view.trail)}
  <h2>What points at this ${escapeHtml(view.targetClass)}</h2>
  <code class="target-print">${escapeHtml(view.targetLabel)}</code>
  ${summaryLine}
  ${hint}
  ${truncated}
  ${classCount === 0 && view.canvas.nodes.length < 2 ? '' : `<div class="graphwrap">${renderGraph(view)}</div>`}
  ${canvasBar}
  ${renderTable(view)}
  <script nonce="${view.nonce}">${view.script}</script>
</body>
</html>`;
}
