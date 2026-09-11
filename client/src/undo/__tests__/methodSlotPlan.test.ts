import { describe, it, expect } from 'vitest';
import { describeOps, driftedSlots, planReversal } from '../methodSlotPlan';
import { MethodSlot, MethodSlotState } from '../undoTypes';

/**
 * The reversal rules (#434).
 *
 * These are the whole of what "undo a method edit" means, so they are pinned as data:
 * what the slot held before, what it holds now, and what putting it back therefore has
 * to do. The plan is computed against the LIVE state rather than against what the edit
 * was expected to leave — that is what stops an undo from redoing work the stone has
 * already had done to it by other means.
 */

const slot = (selector: string): MethodSlot => ({
  className: 'Account',
  isMeta: false,
  selector,
  environmentId: 0,
});

const has = (source: string, category = 'accessing'): MethodSlotState => ({
  exists: true,
  source,
  category,
});
const gone: MethodSlotState = { exists: false, source: null, category: null };

describe('planReversal', () => {
  it('recompiles a method that was edited, back to its earlier source', () => {
    const ops = planReversal([slot('balance')], [has('balance ^1')], [has('balance ^2')]);
    expect(ops).toEqual([
      {
        kind: 'recompile',
        slot: slot('balance'),
        source: 'balance ^1',
        category: 'accessing',
      },
    ]);
  });

  it('restores a method that was deleted', () => {
    const ops = planReversal([slot('balance')], [has('balance ^1')], [gone]);
    expect(ops.map((o) => o.kind)).toEqual(['restore']);
    expect(ops[0].source).toBe('balance ^1');
  });

  it('removes a method that was created', () => {
    const ops = planReversal([slot('balance')], [gone], [has('balance ^1')]);
    expect(ops.map((o) => o.kind)).toEqual(['remove']);
  });

  it('treats a category-only change as worth reversing', () => {
    // Re-categorising is an edit like any other, and the source comparison alone would
    // miss it.
    const ops = planReversal(
      [slot('balance')],
      [has('balance ^1', 'accessing')],
      [has('balance ^1', 'private')],
    );
    expect(ops.map((o) => o.kind)).toEqual(['recompile']);
    expect(ops[0].category).toBe('accessing');
  });

  it('does nothing for a slot that is already back the way it was', () => {
    expect(planReversal([slot('balance')], [has('balance ^1')], [has('balance ^1')])).toEqual([]);
    expect(planReversal([slot('balance')], [gone], [gone])).toEqual([]);
  });

  it('restores before it removes, so a renamed method is never missing entirely', () => {
    // Editing an existing method's message pattern leaves the original and compiles a new
    // one. Undoing that both takes the new one away and leaves the old — and doing the
    // restoring first means the class always implements one of the two.
    const ops = planReversal(
      [slot('total'), slot('sum')],
      [has('total ^1'), gone],
      [gone, has('sum ^1')],
    );
    expect(ops.map((o) => o.kind)).toEqual(['restore', 'remove']);
  });
});

describe('driftedSlots', () => {
  it('reports a slot someone has changed since the edit', () => {
    const drifted = driftedSlots([slot('balance')], [has('balance ^2')], [has('balance ^3')]);
    expect(drifted).toEqual([slot('balance')]);
  });

  it('reports a slot that has since been deleted', () => {
    expect(driftedSlots([slot('balance')], [has('balance ^2')], [gone])).toHaveLength(1);
  });

  it('stays quiet when the slot is exactly as the edit left it', () => {
    expect(driftedSlots([slot('balance')], [has('balance ^2')], [has('balance ^2')])).toEqual([]);
  });

  it('skips a slot the capture came up short on, and still judges the rest', () => {
    // A short state array means the stone told us less than we asked for. That slot cannot
    // be judged and is passed over — it is not evidence of drift — while the slots that WERE
    // reported are still compared.
    expect(driftedSlots([slot('a'), slot('b')], [has('a ^1')], [has('a ^2')])).toEqual([slot('a')]);
    expect(driftedSlots([slot('a'), slot('b')], [has('a ^1')], [has('a ^1')])).toEqual([]);
    expect(driftedSlots([slot('a')], [], [])).toEqual([]);
  });

  it('stays quiet about a slot the edit left empty and which is still empty', () => {
    expect(driftedSlots([slot('balance')], [gone], [gone])).toEqual([]);
  });
});

describe('describeOps', () => {
  it('names the single method when there is only one', () => {
    expect(
      describeOps([{ kind: 'restore', slot: slot('balance'), source: 'x', category: 'c' }]),
    ).toBe('restored Account>>#balance');
  });

  it('counts by kind when there are several', () => {
    const ops = [
      { kind: 'restore' as const, slot: slot('a'), source: 'x', category: 'c' },
      { kind: 'remove' as const, slot: slot('b'), source: null, category: null },
    ];
    expect(describeOps(ops)).toBe('1 restored, 1 removed');
  });

  it('names a single removal and a single revert distinctly', () => {
    // Three verbs, because the three are not the same thing to a reader: one method came
    // back, one went away, one has different source than it did a moment ago.
    expect(
      describeOps([{ kind: 'remove', slot: slot('balance'), source: null, category: null }]),
    ).toBe('removed Account>>#balance');
    expect(
      describeOps([{ kind: 'recompile', slot: slot('balance'), source: 'x', category: 'c' }]),
    ).toBe('reverted Account>>#balance');
  });

  it('counts all three kinds at once', () => {
    const ops = [
      { kind: 'restore' as const, slot: slot('a'), source: 'x', category: 'c' },
      { kind: 'recompile' as const, slot: slot('b'), source: 'y', category: 'c' },
      { kind: 'remove' as const, slot: slot('c'), source: null, category: null },
    ];
    expect(describeOps(ops)).toBe('1 restored, 1 reverted, 1 removed');
  });

  it('says so plainly when the plan turned out empty', () => {
    // Reached when the method is already back the way it was; the notice still has to read
    // as a sentence.
    expect(describeOps([])).toBe('nothing to change');
  });
});
