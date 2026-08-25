import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyClassSlotOps,
  captureClassSlots,
  newStashKey,
  parseClassApply,
  parseClassCapture,
  resetStashKeys,
} from '../queries/classSlotQueries';
import { ClassSlot, ClassSlotOp } from '../undoTypes';

/**
 * The class doits (#434).
 *
 * As with the method ones, the property that matters most is that they name no class the
 * refactoring engine installs. Beyond that, what is pinned here is the STASH: capturing
 * before an edit holds the bound version in SessionTemps, and capturing the live state at
 * revert time deliberately does not — pinning the version the edit just produced would keep
 * a class alive that nothing else needs.
 */

const slot: ClassSlot = { dict: 'UserGlobals', className: 'Account' };

beforeEach(() => resetStashKeys());

describe('the class doits', () => {
  it('never mention the refactoring engine, so they run on any stone', () => {
    const seen: string[] = [];
    const execute = (code: string) => {
      seen.push(code);
      return '0\n';
    };
    captureClassSlots(execute, [slot], ['k1']);
    applyClassSlotOps(execute, [{ kind: 'rebind', slot, stashKey: 'k1', discarded: [] }]);
    applyClassSlotOps(execute, [{ kind: 'unbind', slot, stashKey: null, discarded: [] }]);

    for (const code of seen) {
      expect(code).not.toMatch(/GsRefactoring|GsClassHistory|GsRename|GsInstVar/);
    }
  });

  it('stashes the bound version when a key is given', () => {
    let code = '';
    captureClassSlots(
      (c) => {
        code = c;
        return '0\n';
      },
      [slot],
      ['JasperUndoStash_7'],
    );
    expect(code).toContain("SessionTemps current at: #'JasperUndoStash_7' put: cls");
  });

  it('stashes nothing when reading the live state', () => {
    // The revert-time read must not pin the version the edit produced.
    let code = '';
    captureClassSlots(
      (c) => {
        code = c;
        return '0\n';
      },
      [slot],
    );
    expect(code).not.toContain('SessionTemps');
  });

  it('asks for nothing when there is nothing to ask about', () => {
    const execute = vi.fn();
    expect(captureClassSlots(execute, [])).toEqual([]);
    expect(applyClassSlotOps(execute, [])).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('hands out a fresh stash key each time', () => {
    expect(newStashKey()).not.toBe(newStashKey());
  });
});

describe('parseClassCapture', () => {
  it('reads a bound class: its version and both sides of its method list', () => {
    expect(parseClassCapture('1\t405435905\tplain class>>make \n', 1)).toEqual([
      { bound: true, oop: '405435905', selectors: ['plain', 'class>>make'] },
    ]);
  });

  it('reads an unbound name', () => {
    expect(parseClassCapture('0\n', 1)).toEqual([{ bound: false, oop: null, selectors: [] }]);
  });

  it('reads a class with no methods at all', () => {
    // Exactly what a shape-changing redefinition leaves behind, so it is the common case.
    expect(parseClassCapture('1\t99\t\n', 1)[0]).toEqual({
      bound: true,
      oop: '99',
      selectors: [],
    });
  });

  it('keeps the OOP as text rather than a number', () => {
    // A GemStone OOP can exceed what a JS number holds exactly, and it is only compared.
    expect(parseClassCapture('1\t9007199254740993\t\n', 1)[0].oop).toBe('9007199254740993');
  });

  it('reads a truncated result as unbound rather than throwing', () => {
    expect(parseClassCapture('', 2).every((s) => !s.bound)).toBe(true);
  });

  it('reads a line with no fields as bound with no version rather than undefined', () => {
    // Only reachable from a stone that answered something malformed. An empty OOP compares
    // unequal to every real one, so a reversal planned from it is a no-op rather than a
    // rebind of the wrong version.
    expect(parseClassCapture('1', 1)).toEqual([{ bound: true, oop: '', selectors: [] }]);
  });
});

describe('parseClassApply', () => {
  const ops: ClassSlotOp[] = [
    { kind: 'rebind', slot, stashKey: 'k1', discarded: [] },
    { kind: 'unbind', slot, stashKey: null, discarded: [] },
  ];

  it('pairs each outcome with its operation', () => {
    const results = parseClassApply('O\nE\tno such dictionary\n', ops);
    expect(results[0].error).toBeNull();
    expect(results[1].error).toBe('no such dictionary');
  });

  it('reports a missing line rather than counting it as success', () => {
    expect(parseClassApply('O\n', ops)[1].error).toBe('no result reported');
  });
});
