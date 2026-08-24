import { describe, it, expect } from 'vitest';
import {
  describeClassOps,
  discardedByReversal,
  driftedClassSlots,
  planClassReversal,
} from '../classSlotPlan';
import { ClassSlot, ClassSlotState } from '../undoTypes';

/**
 * The class revert rules (#434).
 *
 * The rule that carries everything: sameness is the OOP of the BOUND VERSION, not the name
 * and not the shape. GemStone re-versions a class on every shape change, so the class before
 * an edit and the class after it are different objects, and reverting means binding the
 * earlier one again.
 */

const slot: ClassSlot = { dict: 'UserGlobals', className: 'Account' };
const other: ClassSlot = { dict: 'UserGlobals', className: 'Ledger' };

const bound = (oop: string, selectors: string[] = []): ClassSlotState => ({
  bound: true,
  oop,
  selectors,
});
const unbound: ClassSlotState = { bound: false, oop: null, selectors: [] };

describe('planClassReversal', () => {
  it('rebinds the earlier version after a redefinition', () => {
    const ops = planClassReversal([slot], [bound('1')], [bound('2')], ['k1']);
    expect(ops).toEqual([{ kind: 'rebind', slot, stashKey: 'k1', discarded: [] }]);
  });

  it('rebinds the class after it was removed', () => {
    const ops = planClassReversal([slot], [bound('1')], [unbound], ['k1']);
    expect(ops.map((o) => o.kind)).toEqual(['rebind']);
    expect(ops[0].stashKey).toBe('k1');
  });

  it('unbinds a class that was created', () => {
    const ops = planClassReversal([slot], [unbound], [bound('2')], [null]);
    expect(ops).toEqual([{ kind: 'unbind', slot, stashKey: null, discarded: [] }]);
  });

  it('does nothing when the same version is bound again', () => {
    // Someone already put it back, or the edit never landed.
    expect(planClassReversal([slot], [bound('1')], [bound('1')], ['k1'])).toEqual([]);
  });

  it('does nothing when the name was unbound and still is', () => {
    expect(planClassReversal([slot], [unbound], [unbound], [null])).toEqual([]);
  });

  it('names the methods a rebind would leave behind', () => {
    // Only what the NEWER version has and the older one does not — the rest come back with
    // the restored version.
    const ops = planClassReversal(
      [slot],
      [bound('1', ['plain', 'class>>make'])],
      [bound('2', ['plain', 'writtenLater'])],
      ['k1'],
    );
    expect(ops[0].discarded).toEqual(['writtenLater']);
  });

  it('leaves nothing behind when the class was removed rather than redefined', () => {
    // There is no newer version holding anything.
    const ops = planClassReversal([slot], [bound('1', ['plain'])], [unbound], ['k1']);
    expect(ops[0].discarded).toEqual([]);
  });

  it('plans a whole removed subtree in one go', () => {
    const ops = planClassReversal(
      [slot, other],
      [bound('1'), bound('2')],
      [unbound, unbound],
      ['k1', 'k2'],
    );
    expect(ops.map((o) => o.slot.className)).toEqual(['Account', 'Ledger']);
  });
});

describe('driftedClassSlots', () => {
  it('reports a class rebound since the edit', () => {
    expect(driftedClassSlots([slot], [bound('2')], [bound('3')])).toEqual([slot]);
  });

  it('reports a class removed since the edit', () => {
    expect(driftedClassSlots([slot], [bound('2')], [unbound])).toHaveLength(1);
  });

  it('stays quiet when the version is exactly what the edit left', () => {
    expect(driftedClassSlots([slot], [bound('2')], [bound('2')])).toEqual([]);
  });
});

describe('discardedByReversal', () => {
  it('labels each left-behind method with its class, without repeats', () => {
    const ops = planClassReversal(
      [slot, other],
      [bound('1', []), bound('2', [])],
      [bound('3', ['a']), bound('4', ['a'])],
      ['k1', 'k2'],
    );
    expect(discardedByReversal(ops)).toEqual(['Account>>#a', 'Ledger>>#a']);
  });
});

describe('describeClassOps', () => {
  it('says what happened to a single class', () => {
    const [op] = planClassReversal([slot], [unbound], [bound('2')], [null]);
    expect(describeClassOps([op])).toBe('removed Account');
  });

  it('counts by kind for a subtree', () => {
    const ops = planClassReversal(
      [slot, other],
      [bound('1'), unbound],
      [unbound, bound('9')],
      ['k1', null],
    );
    expect(describeClassOps(ops)).toBe('1 restored, 1 removed');
  });
});
