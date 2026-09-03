/**
 * The walk through the live object graph: which object is centred, which class row is
 * expanded, and how you got here.
 *
 * State lives here rather than in the webview because the panel is re-rendered whole on
 * every action — there is exactly one copy of "where the walk is", and the view is a
 * projection of it. It also lives here rather than in codeExecutor, which owns *executing
 * code* and should not also own a navigator.
 *
 * Every hop is a fresh repository scan (measured 17–25 ms on 3.6.2, 38–73 ms on 3.7.5 per
 * hop), so walking is interactive without any caching. Nothing is cached deliberately: a
 * reference graph is live, and showing a remembered picture of it would be showing
 * something that may no longer be true.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { ReferrerGroup } from '../queries/objectGraph';
import { logInfo } from '../gciLog';
import {
  CanvasGraph,
  CanvasNode,
  ExpandedClass,
  WalkStep,
  classNameFromMetaclass,
  isMetaclassName,
} from './objectGraphHtml';

/** What the walk needs from the rest of the extension. Injected so this module stays
 *  free of the inspector, the Explorer and the commit machinery. */
export interface ObjectGraphWalkDeps {
  /** Open an inspector on `oop`. */
  inspect: (oop: bigint, label: string) => void;
  /** Navigate the GemStone Explorer to a class by name. */
  revealClass: (className: string) => Promise<void>;
  /** Run a scan that needs a clean session, resolving the dirty-session question by
   *  asking the user. Answers undefined when the user declines. */
  withCleanSession: <T extends { kind: string }>(
    run: () => Promise<T>,
  ) => Promise<Exclude<T, { kind: 'needsCommit' }> | undefined>;
  /** Pin an OOP in the session's export set for as long as the panel can act on it. */
  pin: (oop: bigint) => void;
  /** Release a previously pinned OOP. */
  unpin: (oop: bigint) => void;
  /** Run `work` behind a progress indicator. The nb runner only raises its own
   *  notification past a couple of seconds, and a scan is nearer 150 ms, so without this
   *  a hop gave no sign that anything was happening. */
  withProgress: <T>(title: string, work: () => Promise<T>) => Promise<T>;
  /** Hand a finished view to this walk's own panel. */
  render: (view: ObjectGraphWalkView, handlers: ObjectGraphActions) => void;
  /** Start a SEPARATE walk in its own tab, seeded with `trail` so the new tab's breadcrumb
   *  still shows the path that led there. Stepping into a referrer goes through this rather
   *  than re-centring, so the graph you stepped from survives. */
  openWalk: (oop: bigint, trail: WalkStep[]) => Promise<void>;
  /** How much of an object's printString to show. */
  describe: (oop: bigint) => { className: string; printString: string };
}

/** The rendering inputs the walk produces — everything the panel draws except the nonce
 *  and the view script, which are the panel's own business. */
export interface ObjectGraphWalkView {
  trail: WalkStep[];
  targetLabel: string;
  targetClass: string;
  targetOop: string;
  groups: ReferrerGroup[];
  groupsByOop: Record<string, ReferrerGroup[]>;
  scanMillis: number;
  expanded?: ExpandedClass;
  canvas: CanvasGraph;
  positions: Record<string, { x: number; y: number }>;
  removedCount: number;
}

/** The intents the view can send, in the host's vocabulary. */
export interface ObjectGraphActions {
  expand: (ownerOop: string, classOop: string, className: string) => Promise<void>;
  dive: (oop: string) => Promise<void>;
  goTo: (index: number) => Promise<void>;
  inspectObject: (oop: string) => Promise<void>;
  inspectCollection: (classOop: string, className: string) => Promise<void>;
  revealClass: (className: string) => Promise<void>;
  revealClassByOop: (oop: string) => Promise<void>;
  addToCanvas: (oop: string) => Promise<void>;
  /** Re-centre on an object already on the canvas, keeping the canvas. */
  focusNode: (oop: string) => Promise<void>;
  removeFromCanvas: (oop: string) => Promise<void>;
  clearCanvas: () => Promise<void>;
  /** Pin a box at a hand-chosen position, or clear every such override. */
  moveBox: (boxId: string, x: number, y: number) => Promise<void>;
  resetLayout: () => Promise<void>;
  /** Take a whole class box off the graph, with anything shown under it. */
  removeGroup: (ownerOop: string, className: string) => Promise<void>;
  /** Put every removed box back. */
  restoreRemoved: () => Promise<void>;
}

/** One visited object, with everything needed to re-render it without another describe. */
interface Visited {
  oop: bigint;
  label: string;
  className: string;
  printString: string;
}

/** How many single-object groups are drawn as objects automatically. A guard, not a
 *  preference: `Object` answers over three thousand referrer groups on a real stone and
 *  most of them hold one object, so promoting every one would bury the picture. */
const SOLE_AUTO_LIMIT = 8;

export class ObjectGraphWalk {
  /** Visited objects, oldest first. The last is the centre. */
  private trail: Visited[] = [];
  /** The class row currently expanded, if any. Cleared on every hop, because it belongs
   *  to the object that was centred when it was opened. */
  private expanded: ExpandedClass | undefined;
  /** Objects gathered on the canvas, in the order they were added. The centred object is
   *  always the first entry. */
  private canvasNodes: CanvasNode[] = [];
  /** References running between the canvas nodes. Recomputed wholesale whenever the node
   *  set changes — see slotEdgesAmong for why that is cheaper than it sounds, and why it
   *  is the only way the picture can be trusted to show every edge. */
  private canvasEdges: CanvasGraph['edges'] = [];
  /** Referrer classes per object that has been asked about, so the single layered graph
   *  can draw a grouping layer for each of them and an expand/collapse can re-render
   *  without paying for the scan again. */
  private groupsByOop = new Map<string, ReferrerGroup[]>();
  private scanMillis = 0;
  /** Boxes the user has dragged. Kept here, not in the webview, because the panel is
   *  re-rendered whole on every action and a drag has to outlive that. Survives hops and
   *  expansions; only Reset layout clears it. */
  private positions = new Map<string, { x: number; y: number }>();
  /** Objects the user has taken off the graph.
   *
   *  Remembered because a single-object group is promoted automatically on every scan, so
   *  removing one and then re-centring — which removing the centre does by design — put it
   *  straight back, with only whatever hung beneath it actually gone. A removal is an
   *  explicit "not this box", and it outranks the convenience of drawing a group of one as
   *  its object. Putting it back by hand clears the mark. */
  private dismissed = new Set<string>();
  /** Class boxes the user has taken off, keyed `ownerOop|className`. Groups come from a
   *  scan rather than from anything the user added, so this is the only way to say "not
   *  that class" — and without it a class box was the one thing on the picture with no way
   *  off it. */
  private dismissedGroups = new Set<string>();

  constructor(
    private readonly session: ActiveSession,
    private readonly deps: ObjectGraphWalkDeps,
  ) {}

  /** Begin a walk at `oop`.
   *
   *  `inherited` seeds the breadcrumb with the path from the tab this walk was opened
   *  from, so a new tab still shows where you came from — those entries are history, and
   *  jumping back to one re-centres THIS tab rather than opening yet another. */
  async start(oop: bigint, inherited: WalkStep[] = []): Promise<void> {
    this.trail = [];
    this.dismissed.clear();
    this.dismissedGroups.clear();
    for (const step of inherited) {
      const stepOop = BigInt(step.oop);
      this.deps.pin(stepOop);
      this.trail.push({
        oop: stepOop,
        label: step.label,
        className: step.label,
        printString: step.label,
      });
    }
    await this.centreOn(oop);
  }

  /** Release every pinned object. Called when the walk restarts or the panel closes, so a
   *  long exploration does not leave a hundred objects pinned in the session. */
  releaseAll(): void {
    for (const step of this.trail) this.deps.unpin(step.oop);
    this.trail = [];
    this.expanded = undefined;
    this.groupsByOop.clear();
  }

  /** Scan `oop` and make it the centre, appending it to the trail. */
  private async centreOn(oop: bigint): Promise<void> {
    const described = this.deps.describe(oop);

    // Pinned before the scan and kept pinned while the walk can return to it: the scan
    // aborts the session, and an abort can scavenge an unreferenced object and reuse its
    // OOP number. Without the pin a breadcrumb could quietly point at a different object.
    this.deps.pin(oop);

    const result = await this.deps.withCleanSession(() =>
      this.deps.withProgress(`Scanning references to ${described.className}…`, () =>
        queries.referrersOfNb(this.session, oop),
      ),
    );
    if (!result) {
      // The user declined to commit or abort. Leave the walk exactly as it was — and drop
      // the pin we just took, since this object never joined the trail.
      if (!this.trail.some((s) => s.oop === oop)) this.deps.unpin(oop);
      return;
    }
    if (result.kind === 'unavailable') {
      if (!this.trail.some((s) => s.oop === oop)) this.deps.unpin(oop);
      void vscode.window.showErrorMessage(`Object graph unavailable: ${result.reason}`);
      return;
    }

    this.trail.push({
      oop,
      label: described.className,
      className: described.className,
      printString: described.printString,
    });
    this.expanded = undefined;
    this.groupsByOop.set(oop.toString(), result.groups);
    this.scanMillis = result.scanMillis;
    // The canvas SURVIVES a change of centre. Following "what points at this, and at
    // that, and at that" means the objects already gathered are the context for the
    // question being asked next — clearing them was throwing away the chain the user was
    // building. Only Clear canvas empties it.
    const key = oop.toString();
    if (!this.canvasNodes.some((n) => n.oop === key)) {
      this.canvasNodes = [
        ...this.canvasNodes,
        { oop: key, className: described.className, label: described.printString },
      ];
    }
    // An object already on the graph keeps its parent link when it becomes the centre —
    // re-centring re-aims the question, it does not re-root the picture.

    // A group holding exactly ONE object is just that object with a box round it, so draw
    // the object instead. The scan already resolved it (see ReferrerGroup.soleOop), so
    // this costs no extra round trip. Bounded, because an object can have hundreds of
    // single-referrer classes — the class Object has over three thousand groups — and
    // promoting them all would bury the picture it was meant to clarify.
    let promoted = 0;
    for (const group of result.groups) {
      if (promoted >= SOLE_AUTO_LIMIT) break;
      if (!group.soleOop) continue;
      if (this.dismissed.has(group.soleOop)) continue;
      if (this.canvasNodes.some((n) => n.oop === group.soleOop)) continue;
      this.deps.pin(BigInt(group.soleOop));
      this.canvasNodes = [
        ...this.canvasNodes,
        {
          oop: group.soleOop,
          className: group.referrerClass,
          label: group.solePrintString ?? group.referrerClass,
          parentOop: key,
          viaClass: group.referrerClass,
        },
      ];
      promoted += 1;
    }
    await this.recomputeCanvasEdges();
    logInfo(
      `Object graph: ${result.groups.length} referrer class(es) for oop ${oop} in ` +
        `${result.scanMillis}ms (walk depth ${this.trail.length})`,
    );
    this.render();
  }

  private current(): Visited | undefined {
    return this.trail[this.trail.length - 1];
  }

  private render(): void {
    const centre = this.current();
    if (!centre) return;
    this.deps.render(
      {
        trail: this.trail.map((s) => ({ oop: s.oop.toString(), label: s.label })),
        targetLabel: centre.printString,
        targetClass: centre.className,
        targetOop: centre.oop.toString(),
        groups: this.visibleGroups(centre.oop.toString()),
        groupsByOop: Object.fromEntries(
          [...this.groupsByOop.keys()].map((oop) => [oop, this.visibleGroups(oop)]),
        ),
        scanMillis: this.scanMillis,
        expanded: this.expanded,
        canvas: { nodes: this.canvasNodes, edges: this.canvasEdges },
        positions: Object.fromEntries(this.positions),
        removedCount: this.dismissed.size + this.dismissedGroups.size,
      },
      this.actions(),
    );
  }

  /** The referrer groups of `oop` that should still be drawn.
   *
   *  Two kinds are withheld. One the user removed outright. And one holding a single
   *  object that the user removed — the box stands for nothing else, so leaving it up
   *  reads as though the removal did not take, which is exactly how it looked. */
  private visibleGroups(oop: string): ReferrerGroup[] {
    return (this.groupsByOop.get(oop) ?? []).filter(
      (g) =>
        !this.dismissedGroups.has(`${oop}|${g.referrerClass}`) &&
        !(g.count === 1 && g.soleOop && this.dismissed.has(g.soleOop)),
    );
  }

  private actions(): ObjectGraphActions {
    return {
      expand: (ownerOop, classOop, className) => this.expand(ownerOop, classOop, className),
      dive: (oop) => this.dive(oop),
      goTo: (index) => this.goTo(index),
      inspectObject: async (oop) => this.inspectObject(oop),
      inspectCollection: (classOop, className) => this.inspectCollection(classOop, className),
      revealClass: (className) => this.deps.revealClass(className),
      revealClassByOop: (oop) => this.revealClassByOop(oop),
      addToCanvas: (oop) => this.addToCanvas(oop),
      focusNode: (oop) => this.focusNode(oop),
      removeFromCanvas: (oop) => this.removeFromCanvas(oop),
      clearCanvas: () => this.clearCanvas(),
      moveBox: async (boxId, x, y) => {
        this.positions.set(boxId, { x, y });
        this.render();
      },
      removeGroup: (ownerOop, className) => this.removeGroup(ownerOop, className),
      restoreRemoved: () => this.restoreRemoved(),
      resetLayout: async () => {
        this.positions.clear();
        this.render();
      },
    };
  }

  /** Toggle the list of one class's individual referrers. */
  private async expand(ownerOop: string, classOop: string, className: string): Promise<void> {
    if (this.expanded?.ownerOop === ownerOop && this.expanded.classOop === classOop) {
      this.expanded = undefined;
      this.render();
      return;
    }

    // A group box belongs to the object it points at, which need not be the centre. Ask
    // about that object first, so the listing below always describes what the graph is
    // centred on — expanding against the centre regardless is what produced "no
    // GraphDemoLineItem instance points at this object any more" after the walk had moved
    // on. Re-centring keeps the graph, so nothing is lost.
    if (ownerOop !== this.current()?.oop.toString()) {
      await this.centreOn(BigInt(ownerOop));
      if (ownerOop !== this.current()?.oop.toString()) return; // declined or unavailable
    }
    const centre = this.current();
    if (!centre) return;

    const result = await this.deps.withCleanSession(() =>
      this.deps.withProgress(`Listing ${className} referrers…`, () =>
        queries.referrerObjectsOfNb(this.session, centre.oop, BigInt(classOop)),
      ),
    );
    if (!result) return;
    if (result.kind === 'unavailable') {
      void vscode.window.showErrorMessage(`Couldn't list referrers: ${result.reason}`);
      return;
    }
    if (result.total === 0) {
      void vscode.window.showInformationMessage(
        `No ${className} instance points at this object any more — the references went ` +
          'away since the scan.',
      );
      return;
    }
    this.expanded = {
      ownerOop,
      classOop,
      className,
      objects: result.objects,
      total: result.total,
    };
    this.render();
  }

  /** Step to a referrer.
   *
   *  Opens a NEW tab rather than re-centring this one: a walk that overwrote the graph you
   *  walked from would destroy the thing you were reading in order to show you the next
   *  thing. The new tab inherits this walk's trail, so it shows the whole path. */
  private async dive(oop: string): Promise<void> {
    const trail = this.trail.map((s) => ({ oop: s.oop.toString(), label: s.label }));
    await this.deps.openWalk(BigInt(oop), trail);
  }

  /** Jump back to an earlier point in the walk. Everything after it is dropped — a
   *  breadcrumb is a path, not a history with branches, so walking on from here replaces
   *  what came after rather than keeping a forward stack the trail cannot show. */
  private async goTo(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= this.trail.length - 1) return;
    for (const dropped of this.trail.slice(index + 1)) this.deps.unpin(dropped.oop);
    const target = this.trail[index];
    this.trail = this.trail.slice(0, index);
    await this.centreOn(target.oop);
  }

  /** Ask what points at an object, keeping the graph.
   *
   *  If the object is not on the graph yet — the usual case when it is clicked in the
   *  listing below rather than on the picture — it is attached FIRST, so it arrives joined
   *  to the object it was found under. Centring alone would have added it with no parent,
   *  and a parentless object is drawn as a second root: it appeared beside the original
   *  object, in its own column, connected to nothing. */
  private async focusNode(oop: string): Promise<void> {
    // Attached WITHOUT rendering or recomputing edges: centreOn does both a moment later,
    // and doing them twice per click was half the cost of a hop for no visible benefit.
    if (!this.canvasNodes.some((n) => n.oop === oop)) this.attach(oop);
    // Asking about an object is a request for its references IN FULL, so anything
    // previously removed from around it comes back. Without this a removal silently
    // suppressed part of the answer to a later question, with nothing to say so — which
    // is not what "what points at this?" should ever return.
    this.undismissAround(oop);
    await this.centreOn(BigInt(oop));
  }

  /** Forget removals that would hide part of `oop`'s answer. */
  private undismissAround(oop: string): void {
    for (const key of [...this.dismissedGroups]) {
      if (key.startsWith(`${oop}|`)) this.dismissedGroups.delete(key);
    }
    for (const g of this.groupsByOop.get(oop) ?? []) {
      if (g.soleOop) this.dismissed.delete(g.soleOop);
    }
  }

  /** Put an object on the graph, recording where it was found, without redrawing. */
  private attach(oop: string): void {
    if (this.canvasNodes.some((n) => n.oop === oop)) return;
    this.dismissed.delete(oop);
    const described = this.deps.describe(BigInt(oop));
    const centre = this.current();
    this.deps.pin(BigInt(oop));
    this.canvasNodes = [
      ...this.canvasNodes,
      {
        oop,
        className: described.className,
        label: described.printString,
        parentOop: centre?.oop.toString(),
        viaClass: this.expanded?.className,
      },
    ];
  }

  /** Put an object on the canvas beside whatever is already there, then recompute every
   *  reference among the whole set. */
  private async addToCanvas(oop: string): Promise<void> {
    if (this.canvasNodes.some((n) => n.oop === oop)) return;
    this.attach(oop);
    await this.recomputeCanvasEdges();
    this.render();
  }

  private async removeFromCanvas(oop: string): Promise<void> {
    const node = this.canvasNodes.find((n) => n.oop === oop);
    if (!node) return;

    // Everything that arrived UNDER this object goes with it. Those boxes are on the graph
    // because of it — they were found among its referrers — so re-parenting them onto its
    // parent left the picture holding objects for a reason that no longer applied, and
    // pretending they referenced something they were never listed under.
    const doomed = new Set([oop]);
    for (let grew = true; grew;) {
      grew = false;
      for (const n of this.canvasNodes) {
        if (n.parentOop && doomed.has(n.parentOop) && !doomed.has(n.oop)) {
          doomed.add(n.oop);
          grew = true;
        }
      }
    }

    if (doomed.size >= this.canvasNodes.length) {
      void vscode.window.showInformationMessage(
        doomed.size === 1
          ? 'That is the only object on the graph — removing it would leave nothing to ' +
              'show. Run Show Object Graph on something else instead.'
          : `That would take the whole graph with it (${doomed.size} objects). Use ` +
              '"Remove all but the focused object" if that is what you want.',
      );
      return;
    }

    const centreWentToo = doomed.has(this.current()?.oop.toString() ?? '');
    this.canvasNodes = this.canvasNodes.filter((n) => !doomed.has(n.oop));
    for (const gone of doomed) {
      // Its referrer groups go too: a group box whose owner is gone points at nothing.
      this.groupsByOop.delete(gone);
      // And any hand placement, which described a box that no longer exists.
      this.positions.delete(`o:${gone}`);
      for (const key of [...this.positions.keys()]) {
        if (key.startsWith(`g:${gone}:`)) this.positions.delete(key);
      }
      this.deps.unpin(BigInt(gone));
      this.dismissed.add(gone);
    }
    this.trail = this.trail.filter((step) => !doomed.has(step.oop.toString()));
    if (this.expanded && doomed.has(this.expanded.ownerOop)) this.expanded = undefined;

    if (doomed.size > 1) {
      void vscode.window.showInformationMessage(
        `Removed ${doomed.size} objects: ${node.label} and the ${doomed.size - 1} found ` +
          'under it.',
      );
    }

    if (centreWentToo) {
      // Re-centre on what the removed object hung off, so the listing below always
      // describes something that is actually on the picture.
      const replacement = node.parentOop ?? this.canvasNodes[0]?.oop;
      if (replacement) {
        await this.centreOn(BigInt(replacement));
        return;
      }
    }
    await this.recomputeCanvasEdges();
    this.render();
  }

  /** Take a class box off the graph, along with any of its objects that are shown. */
  private async removeGroup(ownerOop: string, className: string): Promise<void> {
    this.dismissedGroups.add(`${ownerOop}|${className}`);
    const members = this.canvasNodes.filter(
      (n) => n.parentOop === ownerOop && n.viaClass === className,
    );
    // Its members go the same way a removed object's subtree does — they are on the graph
    // because of this group.
    for (const m of members) await this.removeFromCanvas(m.oop);
    if (members.length === 0) this.render();
  }

  /** Put every removed box back, and re-ask about the current object so single-object
   *  groups are promoted again. */
  private async restoreRemoved(): Promise<void> {
    this.dismissed.clear();
    this.dismissedGroups.clear();
    const centre = this.current();
    if (centre) await this.centreOn(centre.oop);
    else this.render();
  }

  private async clearCanvas(): Promise<void> {
    // Keeps whatever is CENTRED, not whatever was added first: the centre is what the
    // table below describes, and the canvas no longer implies the centre is node zero now
    // that focusing moves the centre around without disturbing the canvas.
    const centre = this.current();
    const keep = centre ? centre.oop.toString() : this.canvasNodes[0]?.oop;
    for (const node of this.canvasNodes) {
      if (node.oop !== keep) this.deps.unpin(BigInt(node.oop));
    }
    this.canvasNodes = this.canvasNodes.filter((n) => n.oop === keep);
    this.canvasEdges = [];
    // Hand placements refer to boxes that mostly no longer exist; keeping them would pin
    // survivors to positions chosen for a different picture.
    this.positions.clear();
    this.dismissed.clear();
    this.dismissedGroups.clear();
    this.render();
  }

  /** Re-derive every edge from the current node set.
   *
   *  Wholesale rather than incremental on purpose. Adding a node can create edges that
   *  have nothing to do with the click that added it — put a line item on a canvas that
   *  already holds a product and an order and all three edges appear at once — so the only
   *  way the picture can be trusted is to ask about the whole set each time. It reads
   *  slots rather than scanning the repository, so it costs milliseconds and needs no
   *  clean session. */
  private async recomputeCanvasEdges(): Promise<void> {
    if (this.canvasNodes.length < 2) {
      this.canvasEdges = [];
      return;
    }
    const result = await queries.slotEdgesAmongNb(
      this.session,
      this.canvasNodes.map((n) => n.oop),
    );
    if (result.kind !== 'ok') {
      this.canvasEdges = [];
      void vscode.window.showWarningMessage(`Couldn't work out the canvas edges: ${result.reason}`);
      return;
    }
    this.canvasEdges = result.edges;
  }

  private inspectObject(oop: string): void {
    const target = BigInt(oop);
    const { className } = this.deps.describe(target);
    this.deps.pin(target);
    this.deps.inspect(target, className);
  }

  /** Inspect every referrer of one class at once, as a collection.
   *
   *  Separate from {@link expand}, which lists a page of them for walking: this gathers
   *  the whole set — up to the query's cap — into a transient Array so the inspector can
   *  page through it. The collection is never committed, and building it does not dirty
   *  the session. */
  private async inspectCollection(classOop: string, className: string): Promise<void> {
    const centre = this.current();
    if (!centre) return;

    const result = await this.deps.withCleanSession(() =>
      this.deps.withProgress(`Collecting ${className} referrers…`, () =>
        queries.referrerCollectionOfNb(this.session, centre.oop, BigInt(classOop)),
      ),
    );
    if (!result) return;
    if (result.kind === 'unavailable') {
      void vscode.window.showErrorMessage(`Couldn't collect referrers: ${result.reason}`);
      return;
    }
    if (result.total === 0) {
      void vscode.window.showInformationMessage(
        `No ${className} instance points at this object any more.`,
      );
      return;
    }

    const collectionOop = BigInt(result.oop);
    this.deps.pin(collectionOop);
    const capped =
      result.returned < result.total ? ` (first ${result.returned} of ${result.total})` : '';
    this.deps.inspect(collectionOop, `${className} → ${centre.className}${capped}`);
    if (capped) {
      void vscode.window.showInformationMessage(
        `${result.total} ${className} instances point at this object; inspecting the ` +
          `first ${result.returned}.`,
      );
    }
    logInfo(
      `Object graph collection: ${result.returned} of ${result.total} ${className} ` +
        `referrer(s) in ${result.scanMillis}ms`,
    );
  }

  /** Open the Explorer on a referrer that is itself a class. The name comes from the
   *  object rather than from a row label, so it works for a class reached by walking as
   *  well as for a `Foo class` row. */
  private async revealClassByOop(oop: string): Promise<void> {
    const { printString, className } = this.deps.describe(BigInt(oop));
    // A class's printString is its name; a metaclass prints as 'Foo class'. Fall back to
    // the class name if the print is not usable as an identifier.
    const name = isMetaclassName(printString)
      ? classNameFromMetaclass(printString)
      : printString.trim();
    if (!name || /\s/.test(name)) {
      void vscode.window.showWarningMessage(
        `Can't tell which class this is (${className}). Inspect it instead.`,
      );
      return;
    }
    await this.deps.revealClass(name);
  }
}
