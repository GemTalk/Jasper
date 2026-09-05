/**
 * Working out what reverting a class edit has to do (issue #434).
 *
 * The same shape as `methodSlotPlan.ts`, and for the same reasons: pure functions over
 * captured state, planned against what is LIVE at undo time rather than against what the
 * edit was expected to leave, so a binding somebody has already put back needs no work.
 *
 * The difference is what "the same" means. A method slot compares source text; a class
 * binding compares the OOP of the bound version, because GemStone re-versions a class on
 * every shape change. Two class objects with the same name and the same instance variables
 * are still two different versions, and only one of them is the one that was there.
 */
import { ClassSlot, ClassSlotOp, ClassSlotState } from './undoTypes';

/**
 * The operations that put `before` back, given what is bound `now`.
 *
 * No ordering constraint, unlike the refactoring engine's wholesale class-history revert:
 * this binds class objects that already exist, so nothing is re-versioned and no subclass
 * has to follow its parent. A removed subtree can go back in any order.
 */
export function planClassReversal(
  slots: ClassSlot[],
  before: ClassSlotState[],
  now: ClassSlotState[],
  stashKeys: (string | null)[],
): ClassSlotOp[] {
  const ops: ClassSlotOp[] = [];

  slots.forEach((slot, i) => {
    const was = before[i];
    const is = now[i];
    if (!was || !is) return;

    if (!was.bound) {
      // Nothing was bound here: the edit created the class, so reversing removes it.
      if (is.bound) ops.push({ kind: 'unbind', slot, stashKey: null, discarded: [] });
      return;
    }
    // Something was bound. If the same version is bound now, the edit has already been
    // reversed (or never landed) and there is nothing to do.
    if (is.bound && is.oop === was.oop) return;
    ops.push({
      kind: 'rebind',
      slot,
      stashKey: stashKeys[i] ?? null,
      discarded: is.bound ? is.selectors.filter((sel) => !was.selectors.includes(sel)) : [],
    });
  });

  return ops;
}

/**
 * The class bindings someone has changed since the edit was recorded.
 *
 * As with a method edit, drift is a warning and never a refusal — but it matters more here,
 * because a rebind replaces a whole class version rather than one method's source.
 */
export function driftedClassSlots(
  slots: ClassSlot[],
  after: ClassSlotState[],
  now: ClassSlotState[],
): ClassSlot[] {
  return slots.filter((_slot, i) => {
    const expected = after[i];
    const actual = now[i];
    if (!expected || !actual) return false;
    if (expected.bound !== actual.bound) return true;
    return expected.bound && expected.oop !== actual.oop;
  });
}

/** Everything a set of rebinds would leave behind, de-duplicated and labelled by class. */
export function discardedByReversal(ops: ClassSlotOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    for (const selector of op.discarded) {
      const label = `${op.slot.className}>>#${selector}`;
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

/** A one-line summary of a completed reversal, for the post-undo notice. */
export function describeClassOps(ops: ClassSlotOp[]): string {
  if (ops.length === 0) return 'nothing to change';
  if (ops.length === 1) {
    const op = ops[0];
    return op.kind === 'unbind'
      ? `removed ${op.slot.className}`
      : `restored ${op.slot.className} to its earlier version`;
  }
  const rebound = ops.filter((o) => o.kind === 'rebind').length;
  const unbound = ops.filter((o) => o.kind === 'unbind').length;
  const parts: string[] = [];
  if (rebound) parts.push(`${rebound} restored`);
  if (unbound) parts.push(`${unbound} removed`);
  return parts.join(', ');
}
