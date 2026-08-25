/**
 * Editor-grid math for the debugger's companion column.
 *
 * The debugger wants a predictable shape: its own column at the end of the grid,
 * the webview panel on top and the companion source editor directly below it,
 * the same sizes every time. VS Code offers two ways to get there — relative
 * step commands (`newGroupBelow`, `increase/decreaseView{Width,Height}`), which
 * act on whatever group happens to be focused and clamp against window size, or
 * `vscode.setEditorLayout`, which takes the whole grid as a tree and applies it
 * atomically. The step commands made the layout depend on focus timing and
 * window size; everything here exists so the grid can be *declared* instead.
 *
 * These functions are deliberately pure — grid in, grid out — so every shape
 * (narrow window, vertical root, a grid already full of Jasper panels) can be
 * unit-tested without an editor. `debuggerPanel.ts` owns the two commands that
 * read and write the real grid.
 */

/**
 * `orientation` values accepted by `vscode.setEditorLayout`: HORIZONTAL lays the
 * root's groups out as side-by-side columns, VERTICAL stacks them as rows. A
 * nested branch alternates from its parent, so a branch of a HORIZONTAL root
 * splits top/bottom on its own — which is how the panel-over-source pair is
 * expressed below.
 */
export const HORIZONTAL = 0;
export const VERTICAL = 1;

/**
 * VS Code editor-group layout, as returned by the `vscode.getEditorLayout`
 * command and accepted by `vscode.setEditorLayout`. A tree of groups; a leaf has
 * a `size`, a branch has nested `groups`.
 *
 * Sizes come back from `getEditorLayout` in pixels but are applied as relative
 * weights *within their own parent*, so a branch written in fractions can sit
 * beside one still carrying pixels — only the ratios inside each branch matter.
 * `planDebuggerGrid` normalizes the root's children to fractions summing to 1
 * so the debugger's share is exact, and leaves nested children untouched.
 */
export interface EditorGroupNode {
  size?: number;
  groups?: EditorGroupNode[];
}
export interface EditorGroupLayout {
  orientation?: number;
  groups: EditorGroupNode[];
}

/** Source-group fraction of the debugger column when nothing's been saved (~1/3). */
export const DEFAULT_SOURCE_RATIO = 0.33;
/** The debugger column's share of the window's width (its panes want the room). */
export const DEFAULT_COLUMN_SHARE = 0.6;

/**
 * Bands that keep a remembered value from reopening the debugger unusable. The
 * source pane's cap is the tighter one: a drag that leaves the panel a sliver is
 * the user's business while they're in it, but the NEXT halt has to open with
 * the Call Stack and Variables readable, which is the whole point of the panel.
 */
const MIN_SOURCE_RATIO = 0.15;
const MAX_SOURCE_RATIO = 0.75;
const MIN_COLUMN_SHARE = 0.25;
const MAX_COLUMN_SHARE = 0.8;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Flatten a layout's leaf groups in depth-first, left-to-right order — the same
 * order VS Code assigns ViewColumns (1-based), so leaf N maps to ViewColumn N+1.
 * Each entry carries its parent branch so callers can find a leaf's siblings.
 */
export function flattenLayoutLeaves(
  layout: EditorGroupLayout,
): { node: EditorGroupNode; parent: EditorGroupNode }[] {
  const acc: { node: EditorGroupNode; parent: EditorGroupNode }[] = [];
  const root: EditorGroupNode = { groups: layout.groups };
  const walk = (node: EditorGroupNode, parent: EditorGroupNode): void => {
    if (node.groups && node.groups.length) {
      for (const child of node.groups) walk(child, node);
    } else {
      acc.push({ node, parent });
    }
  };
  for (const g of layout.groups) walk(g, root);
  return acc;
}

/**
 * The debugger's two panes, given the source's column: the source group and the
 * one directly above it.
 *
 * "Directly above" is the sibling immediately before it, which is what the pair
 * is in BOTH shapes the carve produces — the two children of a branch when the
 * panel sat on a row of columns, and two adjacent rows when it sat on a stack of
 * them. Measuring against the containing branch instead only works for the first
 * shape: on a stack of rows the branch holds every other row too, so the source's
 * "share" would be of the whole window and every correction computed from it
 * would be wrong.
 */
function locatePair(
  layout: EditorGroupLayout | undefined,
  sourceColumn: number | undefined,
): { panel: EditorGroupNode; source: EditorGroupNode } | undefined {
  if (!layout || !sourceColumn || sourceColumn < 2) return undefined;
  const leaf = flattenLayoutLeaves(layout)[sourceColumn - 1];
  if (!leaf?.parent.groups) return undefined;
  const index = leaf.parent.groups.indexOf(leaf.node);
  if (index < 1) return undefined; // nothing above it in this branch
  const panel = leaf.parent.groups[index - 1];
  if (panel.groups && panel.groups.length) return undefined; // not a plain pane
  return { panel, source: leaf.node };
}

/**
 * The source pane's fraction of the debugger's column, or undefined when the
 * pair can't be located / measured. `sourceColumn` is 1-based (a ViewColumn).
 * This is the read side of the remembered panel↔source divider position.
 */
export function sourceRatioFromLayout(
  layout: EditorGroupLayout | undefined,
  sourceColumn: number | undefined,
): number | undefined {
  const sizes = columnPaneSizes(layout, sourceColumn);
  return sizes ? sizes.source / sizes.total : undefined;
}

/** Deep copy of a group subtree, so planning never mutates the caller's layout. */
function cloneNode(node: EditorGroupNode): EditorGroupNode {
  const copy: EditorGroupNode = {};
  if (node.size != null) copy.size = node.size;
  if (node.groups) copy.groups = node.groups.map(cloneNode);
  return copy;
}

/** The other axis. Nesting alternates: a branch's children run across its parent's grain. */
const flip = (orientation: number): number => (orientation === HORIZONTAL ? VERTICAL : HORIZONTAL);

/**
 * Find the group at `column` (1-based, depth-first — see `flattenLayoutLeaves`),
 * along with the branch holding it and the axis that branch lays its children
 * out on. That axis is what decides how to make room for the source pane below.
 */
function locateLeaf(
  layout: EditorGroupLayout,
  column: number,
): { node: EditorGroupNode; parent: EditorGroupNode; axis: number } | undefined {
  const root: EditorGroupNode = { groups: layout.groups };
  let seen = 0;
  let found: { node: EditorGroupNode; parent: EditorGroupNode; axis: number } | undefined;
  const walk = (node: EditorGroupNode, parent: EditorGroupNode, axis: number): void => {
    if (found) return;
    if (node.groups && node.groups.length) {
      for (const child of node.groups) walk(child, node, flip(axis));
      return;
    }
    seen += 1;
    if (seen === column) found = { node, parent, axis };
  };
  const rootAxis = layout.orientation ?? HORIZONTAL;
  for (const g of layout.groups) walk(g, root, rootAxis);
  return found;
}

/**
 * Rewrite `siblings` in whole pixels so the one at `index` takes `share` of their
 * combined size and the rest keep their proportions. No-op (false) unless every
 * sibling is measured — sizes that don't add up are licence for VS Code to
 * redistribute them itself.
 */
function rebalance(siblings: EditorGroupNode[], index: number, share: number): boolean {
  if (siblings.length < 2) return false;
  const sizes = siblings.map((g) => g.size ?? 0);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!(total > 0) || sizes.some((v) => v <= 0)) return false;
  const ours = Math.round(total * share);
  const others = total - ours;
  const otherTotal = total - sizes[index];
  let left = others;
  siblings.forEach((g, i) => {
    if (i === index) return;
    const isLast =
      i === siblings.length - 1 || (index === siblings.length - 1 && i === siblings.length - 2);
    g.size = isLast ? left : Math.round((sizes[i] / otherTotal) * others);
    left -= g.size;
  });
  siblings[index].size = ours;
  return true;
}

export interface DebuggerGridPlan {
  /** The whole grid, ready to hand to `vscode.setEditorLayout`. */
  layout: EditorGroupLayout;
  /** 1-based ViewColumn the debugger webview is in (the pair's top half). */
  panelColumn: number;
  /** 1-based ViewColumn the companion source editor opens into (the bottom half). */
  sourceColumn: number;
}

/**
 * Plan the grid that puts a source pane directly below the debugger panel, and
 * say which ViewColumns the two halves are.
 *
 * `current` is the grid as VS Code reports it with the panel already open in it;
 * `panelColumn` is the column the panel says it is in. The panel's own group is
 * split in place and NOTHING else is touched — no rebuilt root, no re-weighted
 * neighbours. That matters because the grid is rarely the tidy row of columns
 * you'd sketch: a couple of debugger sessions leave empty groups behind, VS Code
 * nests new groups inside existing branches rather than appending at the top
 * level, and a plan that assumes otherwise quietly declines to do anything —
 * which is how the source pane ends up beside the debugger instead of under it.
 *
 * Which edit makes "below" depends on the axis the panel's group sits on:
 *  - on a row of columns, the group becomes a branch — a branch runs across its
 *    parent's grain, so its two children stack, panel over source;
 *  - on a stack of rows, the group keeps its place and the source becomes a new
 *    row immediately after it, which is already "below".
 * Either way the source is the very next leaf, so its ViewColumn is the panel's
 * plus one.
 *
 * Sizes stay in the whole pixels VS Code just reported. It decides for itself
 * whether a `size` is pixels or a fraction, and a fraction it reads as pixels
 * collapses that group to the 70px minimum — the panel becoming a sliver the
 * moment it opened. The new pair gets no sizes at all: the column's HEIGHT isn't
 * knowable until the split exists, so it opens evenly split and the panel's own
 * measurement sets it (see fitSourceRatio and the webview's `fit` message).
 *
 * Returns undefined when the panel's column can't be found — the caller then
 * leaves the grid alone rather than reshaping something it doesn't understand.
 */
export function planDebuggerGrid(
  current: EditorGroupLayout | undefined,
  panelColumn: number | undefined,
  opts: { columnShare?: number } = {},
): DebuggerGridPlan | undefined {
  if (!current?.groups?.length || !panelColumn) return undefined;
  const layout: EditorGroupLayout = {
    orientation: current.orientation ?? HORIZONTAL,
    groups: current.groups.map(cloneNode),
  };
  const found = locateLeaf(layout, panelColumn);
  if (!found?.parent.groups) return undefined;
  const { node, axis } = found;
  const siblings = found.parent.groups;
  const index = siblings.indexOf(node);
  if (index < 0) return undefined;

  if (axis === HORIZONTAL) {
    // The panel's group is a column. Turning it into a branch stacks its two
    // children — panel on top, source below.
    siblings[index] = {
      ...(node.size != null ? { size: node.size } : {}),
      groups: [{}, {}],
    };
    // Give the debugger its share of the width; its stack and variables sit
    // side by side and want more room than a default split leaves them.
    rebalance(
      siblings,
      index,
      clamp(opts.columnShare ?? DEFAULT_COLUMN_SHARE, MIN_COLUMN_SHARE, MAX_COLUMN_SHARE),
    );
  } else {
    // The panel's group is a row. The source becomes the next row down, sharing
    // the height this group had; evenly, until the panel measures itself.
    const size = node.size;
    if (size != null) {
      const top = Math.round(size / 2);
      node.size = top;
      siblings.splice(index + 1, 0, { size: size - top });
    } else {
      siblings.splice(index + 1, 0, {});
    }
  }

  return { layout, panelColumn, sourceColumn: panelColumn + 1 };
}

/**
 * Nudge the source pane down when the debugger column is too short to show the
 * panel's own content at the ratio being asked for.
 *
 * The remembered ratio is a *fraction*, so on a short window it can leave the
 * panel a sliver — you open the debugger and can't see why execution stopped,
 * which is the one thing it exists to tell you. Given the column's real height
 * and how much the panel actually needs (both in pixels — the panel measures
 * itself and reports it, see the webview's `fit` message), this returns the
 * largest source share that still leaves the panel that much, or the asked-for
 * ratio when it already fits. The floor still applies: on a column too short to
 * satisfy either side, the source pane keeps its minimum and the panel takes
 * what's left.
 */
export function fitSourceRatio(columnHeightPx: number, ratio: number, minPanelPx: number): number {
  const asked = clamp(ratio, MIN_SOURCE_RATIO, MAX_SOURCE_RATIO);
  if (!(columnHeightPx > 0)) return asked;
  const affordable = 1 - minPanelPx / columnHeightPx;
  return clamp(Math.min(asked, affordable), MIN_SOURCE_RATIO, MAX_SOURCE_RATIO);
}

/**
 * Give the source pane `ratio` of the debugger's column, and the rest to the
 * panel above it (see locatePair). Mutates `layout` in place; returns false,
 * leaving it untouched, when the pair can't be found — an unfamiliar grid is
 * left alone rather than reshaped. Sizes stay in whatever units they already
 * used, so this applies directly to a layout read back from `getEditorLayout`
 * in pixels.
 */
export function setSourceRatioInLayout(
  layout: EditorGroupLayout | undefined,
  sourceColumn: number | undefined,
  ratio: number,
): boolean {
  const pair = locatePair(layout, sourceColumn);
  if (!pair) return false;
  const total = (pair.panel.size ?? 0) + (pair.source.size ?? 0);
  if (total <= 0) return false;
  // Whole pixels summing exactly to what the two panes already had between them:
  // VS Code reads sizes that don't add up as licence to redistribute them
  // itself, and anything else in the column keeps what it had.
  const sourceSize = Math.round(total * clamp(ratio, MIN_SOURCE_RATIO, MAX_SOURCE_RATIO));
  pair.source.size = sourceSize;
  pair.panel.size = total - sourceSize;
  return true;
}

/**
 * The debugger column's measurements, in whatever units the layout carries
 * (pixels, when it came from `getEditorLayout`): the whole column and each half.
 * Undefined when `sourceColumn` isn't half of a clean pair.
 */
export function columnPaneSizes(
  layout: EditorGroupLayout | undefined,
  sourceColumn: number | undefined,
): { total: number; panel: number; source: number } | undefined {
  const pair = locatePair(layout, sourceColumn);
  if (!pair) return undefined;
  const source = pair.source.size ?? 0;
  const panel = pair.panel.size ?? 0;
  const total = source + panel;
  return total > 0 ? { total, panel, source } : undefined;
}
