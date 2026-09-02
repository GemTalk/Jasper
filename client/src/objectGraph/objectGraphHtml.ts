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

/** Edge thickness by reference count. Logarithmic because counts span four orders of
 *  magnitude in practice (1 to 13,688 on a real model) and a linear scale renders
 *  everything below the largest as a hairline. */
function strokeWidth(count: number, max: number): number {
  if (max <= 1) return 1.4;
  const t = Math.log(count) / Math.log(max);
  return 1 + t * 4.5;
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
        <button class="dive" data-dive="${escapeHtml(o.oop)}"
                title="Open what points at this object in a new tab">${escapeHtml(o.printString)}</button>
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

/** One box in the layered graph: either an object, or the class-group standing for
 *  "N instances of this class point at the object to my left". */
interface LayoutNode {
  id: string;
  kind: 'object' | 'group';
  /** Primary line: an object's printString, or a group's class name. */
  title: string;
  /** Second line: an object's class, or a group's reference count. */
  sub: string;
  layer: number;
  /** The box this one points AT — immediately to its left. */
  toward?: string;
  /** Edge label: the slot for an object, the reference count for a group. */
  via?: string;
  oop?: string;
  classOop?: string;
  isCentre?: boolean;
  isOpen?: boolean;
}

/** Layer pitch and box size. Tight enough that a five-layer walk fits a normal editor
 *  width without scrolling — the gap between layers only has to hold an edge label. */
const LAYER_W = 208;
const NODE_W = 176;
const NODE_H = 38;
const NODE_GAP = 12;

/** Lay the whole picture out as ONE graph, layered outward from the centre.
 *
 *  Layer 0 is the object being asked about. Layer 1 holds a class-group per referrer class
 *  — the "40 GraphDemoLineItems point here" summary. An object promoted onto the graph
 *  from one of those groups lands in layer 2, beyond the group it came from, and asking
 *  about THAT object grows layers 3 and 4 the same way. So an object is always two layers
 *  beyond its parent, with the group that classifies it in between.
 *
 *  There is deliberately no second diagram. Objects and class-groups are two kinds of box
 *  in one picture, rather than two pictures with two different node vocabularies — which
 *  is what made the split version unreadable, since the same object showed as
 *  `GraphDemoProduct` in one and `Product(Widget)` in the other. */
function layoutNodes(view: ObjectGraphView): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const objectLayer = new Map<string, number>();
  const byOop = new Map(view.canvas.nodes.map((n) => [n.oop, n]));

  const layerOf = (oop: string, seen: Set<string>): number => {
    const known = objectLayer.get(oop);
    if (known !== undefined) return known;
    const node = byOop.get(oop);
    if (!node?.parentOop || seen.has(oop)) return 0;
    seen.add(oop);
    const depth = layerOf(node.parentOop, seen) + 2;
    objectLayer.set(oop, depth);
    return depth;
  };
  for (const n of view.canvas.nodes) layerOf(n.oop, new Set());

  for (const n of view.canvas.nodes) {
    const parent = n.parentOop;
    nodes.push({
      id: `o:${n.oop}`,
      kind: 'object',
      title: n.label,
      sub: n.className,
      layer: objectLayer.get(n.oop) ?? 0,
      oop: n.oop,
      isCentre: n.oop === view.targetOop,
      // Straight to the object it actually references. Routing this through the class box
      // put the slot label on the segment between the object and that box, which reads as
      // "this array's slot [1] points at the class Array" — it does not; slot 1 holds the
      // referent. The class box summarises a group; it is not a waypoint on a reference.
      // It also meant the edge vanished entirely once the group box was removed.
      toward: parent ? `o:${parent}` : undefined,
      via: view.canvas.edges.find((e) => e.fromOop === n.oop && e.toOop === parent)?.via,
    });
  }

  for (const [oop, groups] of Object.entries(view.groupsByOop)) {
    const parentLayer = objectLayer.get(oop) ?? 0;
    for (const g of groups) {
      const promoted = view.canvas.nodes.filter(
        (n) => n.parentOop === oop && n.viaClass === g.referrerClass,
      ).length;
      // How many objects a group actually holds is only known once it has been listed —
      // `count` counts REFERENCES, and one object can hold several. So the box only claims
      // to be exhausted when the listing says so, and otherwise reports what is shown.
      // A single-object group is drawn as that object instead — the box would add an
      // indirection with nothing behind it. Only skipped once the object is actually on
      // the graph, so a group whose promotion was bounded away still shows.
      if (
        g.count === 1 &&
        view.canvas.nodes.some((n) => n.parentOop === oop && n.viaClass === g.referrerClass)
      ) {
        continue;
      }
      const listed =
        view.expanded?.ownerOop === oop && view.expanded.classOop === g.referrerClassOop
          ? view.expanded.total
          : undefined;
      if (listed !== undefined && promoted >= listed) {
        // Every object behind this group is already drawn, each with its own edge to the
        // referent. Keeping the box would imply there is still something behind it.
        continue;
      }
      const shown = promoted > 0 ? ` \u00b7 ${promoted} on the graph` : '';
      nodes.push({
        id: `g:${oop}:${g.referrerClass}`,
        kind: 'group',
        title: g.referrerClass,
        sub: `${g.count} object${g.count === 1 ? '' : 's'}${shown}`,
        layer: parentLayer + 1,
        toward: `o:${oop}`,
        via: String(g.count),
        classOop: g.referrerClassOop,
        oop,
        isOpen: listed !== undefined,
      });
    }
  }
  return nodes;
}

/** Render the single layered graph. */
function renderGraph(view: ObjectGraphView): string {
  const nodes = layoutNodes(view);
  if (nodes.length === 0) return '';

  const maxLayer = Math.max(...nodes.map((n) => n.layer));
  const perLayer = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const list = perLayer.get(n.layer) ?? [];
    list.push(n);
    perLayer.set(n.layer, list);
  }

  const rows = Math.max(...[...perLayer.values()].map((l) => l.length));
  const height = TOP * 2 + rows * (NODE_H + NODE_GAP);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, list] of perLayer) {
    // Each layer is centred vertically against the tallest one, so a lone node sits level
    // with the middle of the fan pointing at it rather than at the top of the picture.
    const span = list.length * (NODE_H + NODE_GAP) - NODE_GAP;
    const top = (height - span) / 2;
    list.forEach((n, i) => {
      pos.set(n.id, { x: 16 + layer * LAYER_W, y: top + i * (NODE_H + NODE_GAP) });
    });
  }
  const width = 32 + (maxLayer + 1) * LAYER_W;

  const counts = nodes.filter((n) => n.kind === 'group').map((n) => Number(n.via) || 1);
  const maxCount = counts.length ? Math.max(...counts) : 1;

  const edges = nodes
    .map((n) => {
      if (!n.toward) return '';
      const a = pos.get(n.id);
      const b = pos.get(n.toward);
      if (!a || !b) return '';
      const sx = a.x;
      const sy = a.y + NODE_H / 2;
      const tx = b.x + NODE_W + ARROW_GAP;
      const ty = b.y + NODE_H / 2;
      const midX = (sx + tx) / 2;
      const w = n.kind === 'group' ? strokeWidth(Number(n.via) || 1, maxCount) : 1.4;
      // A back-edge: this box sits left of what it points at, unavoidable once the graph
      // has a cycle — an order holds its line items and each line item holds its order.
      // Dashed, so an arrow against the flow reads as closing a cycle, not as a bug.
      const back = a.x <= b.x ? ' back' : '';
      return (
        `<path class="edge${back}" marker-end="url(#ref-arrow)" stroke-width="${w.toFixed(2)}" ` +
        `d="M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}"/>` +
        (n.via
          ? `<text class="count" x="${midX}" y="${(sy + ty) / 2 - 4}" text-anchor="middle">` +
            `${escapeHtml(n.via)}</text>`
          : '')
      );
    })
    .join('\n    ');

  const boxes = nodes
    .map((n) => {
      const p = pos.get(n.id)!;
      if (n.kind === 'group') {
        const meta = isMetaclassName(n.title) ? ' meta' : '';
        // Drawn as a STACK — two offset rectangles behind the front one — because this box
        // stands for many objects rather than one. That, plus the dashed outline, is what
        // tells the two kinds of box apart at a glance; the word "class" would be wrong,
        // since the box is not the class object but the referrers that happen to be of it
        // (and a metaclass group would then read "Foo class class").
        return `<g class="gnode${meta}${n.isOpen ? ' open' : ''}" role="button" tabindex="0"
              data-expand="${escapeHtml(n.classOop ?? '')}" data-class-name="${escapeHtml(n.title)}"
              data-expand-of="${escapeHtml(n.oop ?? '')}">
      <title>${n.isOpen ? 'Hide' : 'List'} the objects behind this group — ${escapeHtml(n.sub)} of class ${escapeHtml(n.title)}</title>
      <rect class="stack2" x="${p.x + 7}" y="${p.y + 7}" width="${NODE_W}" height="${NODE_H}"/>
      <rect class="stack1" x="${p.x + 4}" y="${p.y + 4}" width="${NODE_W}" height="${NODE_H}"/>
      <rect class="front" x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}"/>
      <text x="${p.x + 8}" y="${p.y + 16}">${escapeHtml(truncate(n.title, 20))}</text>
      <text class="sub" x="${p.x + 8}" y="${p.y + 29}">${escapeHtml(truncate(n.sub, 24))}</text>
    </g>`;
      }
      const drop = n.isCentre
        ? ''
        : `<g class="drop" role="button" tabindex="0" data-remove-oop="${escapeHtml(n.oop ?? '')}">
        <title>Take this object off the graph: ${escapeHtml(n.title)}</title>
        <rect x="${p.x + NODE_W - 17}" y="${p.y + 3}" width="14" height="14" rx="3"/>
        <text x="${p.x + NODE_W - 13}" y="${p.y + 14}">\u00d7</text>
      </g>`;
      return `<g class="cnode${n.isCentre ? ' centre' : ''}" role="button" tabindex="0"
              ${n.isCentre ? '' : `data-focus-oop="${escapeHtml(n.oop ?? '')}"`}>
      <title>${
        n.isCentre
          ? 'The object this graph is centred on'
          : `Ask what points at this object, keeping everything already drawn: ${escapeHtml(n.title)}`
      }</title>
      <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="4"/>
      <text x="${p.x + 8}" y="${p.y + 16}">${escapeHtml(truncate(n.title, 21))}</text>
      <text class="sub" x="${p.x + 8}" y="${p.y + 29}">${escapeHtml(truncate(n.sub, 21))}</text>
      ${drop}
    </g>`;
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
    ${boxes}
  </svg>`;
}

/** Render the whole panel. */
export function renderObjectGraphHtml(view: ObjectGraphView): string {
  const total = view.groups.reduce((sum, g) => sum + g.count, 0);
  const classCount = view.groups.length;

  // An object nothing points at is a real, informative answer — not an error and not an
  // empty screen. Most often it is reachable only from a session temp or a stack frame,
  // neither of which is a repository reference. The breadcrumb still lets you back out.
  const empty =
    classCount === 0
      ? `<p class="empty">Nothing in the repository holds a reference to this object.
       It is reachable only from something outside the object graph — a session temporary
       or a stack frame.</p>`
      : '';

  // Say what the picture leaves out. A diagram that quietly draws the top 20 of 284 reads
  // as the whole story.
  const truncated =
    classCount > MAX_NODES
      ? `<p class="note">Drawing the ${MAX_NODES} largest of ${classCount} referrer classes.
         All ${classCount} are listed below.</p>`
      : '';

  const summary =
    classCount === 0
      ? ''
      : `<p class="summary"><strong>${total.toLocaleString()}</strong> object(s) from
         <strong>${classCount}</strong> class(es) point at this · scanned in
         ${view.scanMillis} ms</p>`;

  // The canvas takes over the diagram once it holds more than the centre object. Below
  // that there is nothing to accumulate, so the referrer-class fan stays — it answers the
  // question the panel was opened with.
  const accumulating = view.canvas.nodes.length > 1;
  const canvasBar = accumulating
    ? `<p class="canvasbar"><strong>${view.canvas.nodes.length}</strong> objects on the graph,
       <strong>${view.canvas.edges.length}</strong> reference(s) between them.
       <button class="act" data-clear-canvas="1"
       title="Drop every object except the one the graph is centred on">Reset to one object</button></p>`
    : '';

  const hint =
    classCount === 0
      ? ''
      : `<p class="hint">Arrows run the way the reference goes: a box points at the box on
         its left. A <strong>stacked dashed</strong> box summarises the objects of one class
         that point there, and its edge number is how many such objects there are — click it
         to list them below, then <em>+ graph</em> to put one on the picture. A group holding
         a single object is drawn as that object straight away. A
         <strong>solid</strong> box is a single object, its edge labelled with the slot the
         reference sits in; click one to ask what points at <em>it</em>, keeping everything
         already drawn.</p>`;

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
  ${summary}
  ${empty}
  ${hint}
  ${truncated}
  ${classCount === 0 && view.canvas.nodes.length < 2 ? '' : `<div class="graphwrap">${renderGraph(view)}</div>`}
  ${canvasBar}
  ${renderTable(view)}
  <script nonce="${view.nonce}">${view.script}</script>
</body>
</html>`;
}
