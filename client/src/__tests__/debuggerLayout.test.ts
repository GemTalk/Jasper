import { describe, it, expect } from 'vitest';
import {
  EditorGroupLayout,
  EditorGroupNode,
  HORIZONTAL,
  VERTICAL,
  columnPaneSizes,
  fitSourceRatio,
  flattenLayoutLeaves,
  planDebuggerGrid,
  setSourceRatioInLayout,
  sourceRatioFromLayout,
} from '../debuggerLayout';

/** Sum of a branch's direct children — the whole point is that these stay put. */
const weightOf = (nodes: EditorGroupNode[]): number => nodes.reduce((s, g) => s + (g.size ?? 0), 0);

describe('flattenLayoutLeaves / sourceRatioFromLayout', () => {
  // A real `vscode.getEditorLayout` result Eric captured: code | (debugger / source).
  // Leaf order = ViewColumn order, so code=1, debugger=2, source=3.
  const sample = (): EditorGroupLayout => ({
    orientation: HORIZONTAL,
    groups: [{ size: 636 }, { size: 877, groups: [{ size: 749 }, { size: 99 }] }],
  });

  it('flattens leaves in ViewColumn order (depth-first, left-to-right)', () => {
    expect(flattenLayoutLeaves(sample()).map((l) => l.node.size)).toEqual([636, 749, 99]);
  });

  it('reads the source group ratio from its containing column', () => {
    // Source is ViewColumn 3 → 99 of the 877-wide column's 848 (749+99).
    expect(sourceRatioFromLayout(sample(), 3)).toBeCloseTo(99 / 848, 5);
  });

  it('returns undefined when the column is missing or unmeasurable', () => {
    expect(sourceRatioFromLayout(sample(), 9)).toBeUndefined(); // column past the end
    expect(sourceRatioFromLayout(undefined, 3)).toBeUndefined(); // no layout
    expect(sourceRatioFromLayout(sample(), undefined)).toBeUndefined(); // no column
  });
});

describe('planDebuggerGrid', () => {
  // The grid as VS Code reports it with the panel already open: the user's
  // editor column, then the debugger's, which is column 2.
  const afterPanelOpened = (): EditorGroupLayout => ({
    orientation: HORIZONTAL,
    groups: [{ size: 1200 }, { size: 400 }],
  });

  it("splits the panel's own column into panel-over-source", () => {
    const plan = planDebuggerGrid(afterPanelOpened(), 2)!;
    expect(plan.panelColumn).toBe(2);
    expect(plan.sourceColumn).toBe(3); // the source is always the next leaf along
    // The pair carries NO sizes: the column's height isn't knowable until the
    // split exists, so it opens evenly and the panel's measurement sizes it.
    expect(plan.layout.groups[1].groups).toEqual([{}, {}]);
  });

  it('widens the debugger column in whole pixels, keeping the total exact', () => {
    // VS Code decides for itself whether a `size` is pixels or a fraction, and
    // reads a stray fraction as a pixel count — which collapses that group to its
    // 70px minimum. Pixel counts summing to the reported width can't be misread.
    const plan = planDebuggerGrid(afterPanelOpened(), 2)!;
    const sizes = plan.layout.groups.map((g) => g.size!);
    for (const size of sizes) expect(Number.isInteger(size)).toBe(true);
    expect(weightOf(plan.layout.groups)).toBe(1600); // exactly the width it was handed
    expect(sizes[1]).toBe(960); // the debugger's 60%
  });

  it('splits a panel nested deep in the grid, leaving everything else alone', () => {
    // The real shape after a session or two: VS Code nests new groups inside
    // existing branches rather than appending at the top level, and earlier
    // debuggers leave empty groups behind. The panel is column 4 here, two
    // levels down — a plan that only handles a flat row of columns gives up,
    // and then the source pane opens BESIDE the debugger instead of under it.
    const plan = planDebuggerGrid(
      {
        orientation: HORIZONTAL,
        groups: [
          { size: 632 },
          {
            size: 631,
            groups: [{ size: 310 }, { size: 392, groups: [{ size: 315 }, { size: 316 }] }],
          },
        ],
      },
      4,
    )!;
    expect(plan.sourceColumn).toBe(5);
    const inner = plan.layout.groups[1].groups![1].groups!;
    // Our leaf became the pair; its neighbour kept its place and the pair took
    // the debugger's share of their combined width.
    expect(inner[1].groups).toEqual([{}, {}]);
    expect(inner[1].size).toBe(Math.round(631 * 0.6));
    expect(inner[0].size).toBe(631 - Math.round(631 * 0.6));
    // Untouched: the other column and the row above.
    expect(plan.layout.groups[0].size).toBe(632);
    expect(plan.layout.groups[1].groups![0].size).toBe(310);
  });

  it('puts the source in the next row down when the panel sits on a stack of rows', () => {
    // A branch there would run ACROSS the rows — side-by-side, which is the very
    // arrangement this is meant to prevent. A new row after ours is already below.
    const plan = planDebuggerGrid(
      {
        orientation: VERTICAL,
        groups: [{ size: 400 }, { size: 300 }], // panel is the second row
      },
      2,
    )!;
    expect(plan.sourceColumn).toBe(3);
    expect(plan.layout.groups).toHaveLength(3);
    expect(plan.layout.groups.map((g) => g.size)).toEqual([400, 150, 150]);
    expect(plan.layout.groups[1].groups).toBeUndefined(); // still a plain group
  });

  it('takes the whole window when nothing else is open', () => {
    const plan = planDebuggerGrid({ orientation: HORIZONTAL, groups: [{ size: 1600 }] }, 1)!;
    expect(plan.layout.groups).toHaveLength(1);
    expect(plan.layout.groups[0].size).toBe(1600); // no siblings to rebalance against
    expect(plan.layout.groups[0].groups).toEqual([{}, {}]);
    expect(plan.sourceColumn).toBe(2);
  });

  it('leaves an unmeasured grid unbalanced rather than inventing sizes', () => {
    const plan = planDebuggerGrid({ orientation: HORIZONTAL, groups: [{}, {}] }, 2)!;
    expect(plan.layout.groups[1].groups).toEqual([{}, {}]);
    expect(plan.layout.groups[0].size).toBeUndefined();
  });

  it("leaves the caller's layout untouched (planning is pure)", () => {
    const current = afterPanelOpened();
    const before = JSON.stringify(current);
    planDebuggerGrid(current, 2);
    expect(JSON.stringify(current)).toBe(before);
  });

  it("declines when it can't find the panel's column", () => {
    expect(planDebuggerGrid(afterPanelOpened(), 9)).toBeUndefined(); // past the end
    expect(planDebuggerGrid(afterPanelOpened(), undefined)).toBeUndefined();
    expect(planDebuggerGrid(undefined, 2)).toBeUndefined();
    expect(planDebuggerGrid({ orientation: HORIZONTAL, groups: [] }, 1)).toBeUndefined();
  });
});

describe('fitSourceRatio', () => {
  // The panel measures itself and reports what it needs; these are pixels.
  const NEEDS = 300;

  it('leaves a ratio alone when the column is tall enough for it', () => {
    // 1000px tall, source wants a third → the panel keeps ~670px, plenty.
    expect(fitSourceRatio(1000, 0.33, NEEDS)).toBeCloseTo(0.33, 5);
  });

  it('nudges the source pane down when the panel would be too short to read', () => {
    // 500px tall: at 0.75 the panel gets 125px — not even the error message.
    // The panel is given exactly what it asked for and the source takes the rest.
    const fitted = fitSourceRatio(500, 0.75, NEEDS);
    expect(fitted).toBeCloseTo(1 - NEEDS / 500, 5);
    expect(500 * (1 - fitted)).toBeCloseTo(NEEDS, 5);
  });

  it('keeps the source pane visible on a column too short for both', () => {
    // 320px can't give the panel 300 AND keep a source pane; the source holds
    // its floor rather than vanishing.
    expect(fitSourceRatio(320, 0.5, NEEDS)).toBeCloseTo(0.15, 5);
  });

  it('never grows the source pane beyond what was asked for', () => {
    expect(fitSourceRatio(4000, 0.2, NEEDS)).toBeCloseTo(0.2, 5); // a tall column stays at 0.2
  });

  it('passes the ratio through when the height is unknown', () => {
    expect(fitSourceRatio(0, 0.4, NEEDS)).toBeCloseTo(0.4, 5);
  });
});

describe('setSourceRatioInLayout / columnPaneSizes', () => {
  // The grid as read back after a carve, in pixels: user column | (panel / source).
  const carved = (): EditorGroupLayout => ({
    orientation: HORIZONTAL,
    groups: [{ size: 505 }, { size: 758, groups: [{ size: 470 }, { size: 232 }] }],
  });

  it('measures the debugger column and each of its halves', () => {
    expect(columnPaneSizes(carved(), 3)).toEqual({ total: 702, panel: 470, source: 232 });
    expect(columnPaneSizes(carved(), 9)).toBeUndefined(); // column past the end
    expect(columnPaneSizes(undefined, 3)).toBeUndefined();
    // Not a two-way split — not a column we created.
    expect(
      columnPaneSizes({ orientation: HORIZONTAL, groups: [{ size: 500 }] }, 1),
    ).toBeUndefined();
  });

  it('re-sizes the pair in whole pixels that still add up to the column', () => {
    const layout = carved();
    expect(setSourceRatioInLayout(layout, 3, 0.25)).toBe(true);
    const pair = layout.groups[1].groups!;
    expect(pair[1].size).toBe(176); // source: round(702 * 0.25)
    expect(pair[0].size).toBe(526); // panel keeps the rest — 176 + 526 = 702 exactly
    expect(layout.groups[0].size).toBe(505); // the user's column untouched
  });

  it('measures and resizes the pair when the column is a stack of rows', () => {
    // The carve puts the source in the next row down when the panel sits on a
    // stack of rows, so the pair is two ADJACENT rows, not the only two children
    // of a branch. Measuring against the whole branch here would make the source
    // a share of the entire window — and every correction computed from it wrong.
    const rows = (): EditorGroupLayout => ({
      orientation: VERTICAL,
      groups: [{ size: 200 }, { size: 300 }, { size: 100 }, { size: 400 }],
    });
    // Source is row 3; the panel is row 2 above it — 400 between them.
    expect(columnPaneSizes(rows(), 3)).toEqual({ total: 400, panel: 300, source: 100 });
    expect(sourceRatioFromLayout(rows(), 3)).toBeCloseTo(0.25, 5);

    const layout = rows();
    expect(setSourceRatioInLayout(layout, 3, 0.5)).toBe(true);
    expect(layout.groups.map((g) => g.size)).toEqual([200, 200, 200, 400]); // others untouched
  });

  it('declines when there is nothing above the source to pair it with', () => {
    // First leaf in its branch, or first in the grid — not a shape we made.
    const layout: EditorGroupLayout = {
      orientation: HORIZONTAL,
      groups: [{ size: 636 }, { size: 877, groups: [{ size: 300 }, { size: 200 }] }],
    };
    expect(setSourceRatioInLayout(layout, 1, 0.33)).toBe(false); // column 1
    expect(columnPaneSizes(layout, 2)).toBeUndefined(); // first child of its branch
    expect(layout.groups[1].groups!.map((g) => g.size)).toEqual([300, 200]); // untouched
  });
});
