import { describe, it, expect } from 'vitest';
import { planUndo } from '../undoPlan';
import type { UndoEntry } from '../undoTypes';

/**
 * What an undo says it will do, before it does it (#396 review).
 *
 * Every kind now shows the same panel, so every kind has to be able to describe itself. The plan
 * is pure -- derived from the recorded entry, which is what the reversal works from too -- so
 * these are the only tests needed to know the panel will be truthful.
 */
const base = { id: 1, sessionId: 1 };
const present = (source: string, category = 'accessing') => ({ exists: true, source, category });
const absent = { exists: false, source: null, category: null };

describe('planUndo', () => {
  it('describes a saved method as a restore, naming its category', () => {
    const plan = planUndo({
      ...base,
      kind: 'methodEdit',
      label: 'Save Account>>#balance',
      slots: [
        { dict: 7, className: 'Account', isMeta: false, selector: 'balance', environmentId: 0 },
      ],
      before: [present('balance\n\t^1')],
      after: [present('balance\n\t^2')],
    })!;

    expect(plan.verb).toBe('Undo');
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].action).toBe('restore');
    expect(plan.rows[0].target).toBe('Account >> #balance');
    expect(plan.rows[0].detail).toContain('accessing');
  });

  it('describes a newly created method as a removal', () => {
    const plan = planUndo({
      ...base,
      kind: 'methodEdit',
      label: 'Create Account>>#total',
      slots: [{ dict: 7, className: 'Account', isMeta: true, selector: 'total', environmentId: 0 }],
      before: [absent],
      after: [present('total\n\t^0')],
    })!;

    expect(plan.rows[0].action).toBe('remove');
    // the meta side is named as such, or the row is ambiguous
    expect(plan.rows[0].target).toBe('Account class >> #total');
  });

  it('calls a class edit a Revert and says what it leaves behind', () => {
    const plan = planUndo({
      ...base,
      kind: 'classEdit',
      label: 'Redefine class Account',
      slots: [{ dict: 'UserGlobals', className: 'Account' }],
      before: [{ bound: true, oop: '1', selectors: [] }],
      after: [{ bound: true, oop: '2', selectors: [] }],
      stashKeys: ['k1'],
    })!;

    expect(plan.verb).toBe('Revert');
    expect(plan.rows[0].action).toBe('rebind earlier version');
    expect(plan.note).toContain('left behind');
  });

  it('lists a class variable undo accessors-first, then the declaration', () => {
    // The order the reversal itself uses: the class must never hold a method reading a class
    // variable it no longer declares.
    const accessor = (selector: string) => ({
      dict: 7,
      className: 'Shadowed',
      isMeta: true,
      selector,
      environmentId: 0,
    });
    const plan = planUndo({
      ...base,
      kind: 'classVarEdit',
      label: 'Add class variable Registry to Shadowed (DictionaryB)',
      slot: { dict: 7, className: 'Shadowed', varName: 'Registry' },
      before: { defined: false },
      after: { defined: true },
      accessorSlots: [accessor('registry'), accessor('registry:')],
      accessorBefore: [absent, absent],
      accessorAfter: [present('registry\n\t^Registry'), present('registry: v\n\tRegistry := v')],
    })!;

    expect(plan.rows.map((r) => r.target)).toEqual([
      'Shadowed class >> #registry',
      'Shadowed class >> #registry:',
      'Shadowed  Registry',
    ]);
    expect(
      plan.rows.every((r) => r.action === 'remove' || r.action === 'remove class variable'),
    ).toBe(true);
    // the label the recorder gave it -- dictionary and all -- is what the panel titles itself with
    expect(plan.label).toContain('(DictionaryB)');
  });

  it('describes a comment undo as putting the earlier text back', () => {
    const plan = planUndo({
      ...base,
      kind: 'classComment',
      label: 'Comment Account',
      slot: { dict: 7, className: 'Account' },
      before: 'old text',
      after: 'new text',
    })!;

    expect(plan.rows[0].action).toBe('restore comment');
    expect(plan.rows[0].detail).toContain('earlier text');
  });

  it('describes a method-category rename as a rename back, and a creation as a removal', () => {
    const renamed = planUndo({
      ...base,
      kind: 'methodCategoryEdit',
      label: 'Rename category',
      slot: { dict: 7, className: 'Account', isMeta: false },
      before: 'accessing',
      after: 'reading',
    })!;
    expect(renamed.rows[0].action).toBe('rename category back to accessing');

    const created = planUndo({
      ...base,
      kind: 'methodCategoryEdit',
      label: 'Add category',
      slot: { dict: 7, className: 'Account', isMeta: true },
      before: null,
      after: 'reading',
    })!;
    expect(created.rows[0].action).toBe('remove category');
    expect(created.rows[0].target).toContain('Account class');
  });

  it('gives one row per class whose category is put back', () => {
    const plan = planUndo({
      ...base,
      kind: 'classCategoryEdit',
      label: 'Rename class category',
      dict: 7,
      changes: [
        { className: 'A', before: 'Old', after: 'New' },
        { className: 'B', before: null, after: 'New' },
      ],
    } as UndoEntry)!;

    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0].action).toBe('set category back to Old');
    expect(plan.rows[1].action).toBe('clear category');
  });

  it('warns that unlisting a dictionary puts what it holds out of reach', () => {
    const plan = planUndo({
      ...base,
      kind: 'dictionaryEdit',
      label: 'Add dictionary DictionaryB',
      before: { present: false, name: 'DictionaryB', index: 0 },
      after: { present: true, name: 'DictionaryB', index: 7 },
      stashKey: null,
    })!;

    expect(plan.rows[0].action).toBe('remove from the symbol list');
    expect(plan.note).toContain('out of reach');
  });

  it('puts a removed dictionary back at the position it held', () => {
    const plan = planUndo({
      ...base,
      kind: 'dictionaryEdit',
      label: 'Remove dictionary DictionaryB',
      before: { present: true, name: 'DictionaryB', index: 4 },
      after: { present: false, name: 'DictionaryB', index: 0 },
      stashKey: 'k1',
    })!;

    expect(plan.rows[0].detail).toContain('position 4');
  });

  it('has no plan for a refactoring, which previews itself from the stone', () => {
    expect(
      planUndo({ ...base, kind: 'refactoring', label: 'Rename class', sequence: 3 }),
    ).toBeUndefined();
  });

  // A slot records its dictionary as a SymbolList INDEX as often as a name, and an index means
  // nothing to a reader -- least of all when the whole point is telling two same-named classes
  // apart. The plan stays pure, so the caller passes the lookup in (#396).
  describe('naming the dictionary on each row', () => {
    const lookup = (d: number | string | undefined): string | undefined =>
      d === 7 ? 'DictionaryA' : typeof d === 'string' ? d : undefined;

    it('qualifies a method row with its class’s dictionary', () => {
      const plan = planUndo(
        {
          ...base,
          kind: 'methodEdit',
          label: 'Save Shadowed>>#bbc',
          slots: [
            { dict: 7, className: 'Shadowed', isMeta: false, selector: 'bbc', environmentId: 0 },
          ],
          before: [present('bbc\n\t^1')],
          after: [present('bbc\n\t^2')],
        },
        lookup,
      )!;

      expect(plan.rows[0].target).toBe('Shadowed (DictionaryA) >> #bbc');
    });

    it('qualifies the class-variable rows and the declaration', () => {
      const plan = planUndo(
        {
          ...base,
          kind: 'classVarEdit',
          label: 'Add class variable Registry to Shadowed',
          slot: { dict: 7, className: 'Shadowed', varName: 'Registry' },
          before: { defined: false },
          after: { defined: true },
          accessorSlots: [
            {
              dict: 7,
              className: 'Shadowed',
              isMeta: true,
              selector: 'registry',
              environmentId: 0,
            },
          ],
          accessorBefore: [absent],
          accessorAfter: [present('registry\n\t^Registry')],
        },
        lookup,
      )!;

      expect(plan.rows[0].target).toBe('Shadowed (DictionaryA) class >> #registry');
      expect(plan.rows[1].target).toBe('Shadowed (DictionaryA)  Registry');
    });

    it('leaves a row unqualified when the dictionary cannot be resolved', () => {
      // Less specific beats wrong -- the same rule the labels follow.
      const plan = planUndo(
        {
          ...base,
          kind: 'classComment',
          label: 'Comment Shadowed',
          slot: { dict: 99, className: 'Shadowed' },
          before: 'a',
          after: 'b',
        },
        lookup,
      )!;

      expect(plan.rows[0].target).toBe('Shadowed');
    });
  });
});
