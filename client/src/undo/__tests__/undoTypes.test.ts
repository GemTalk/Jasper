import { describe, it, expect } from 'vitest';
import { classSlotLabel, slotLabel } from '../undoTypes';

/**
 * How a slot reads in a message (#434).
 *
 * Small, but they are the only naming an undo notice does: a drift modal that says
 * "Account>>#balance changed since…" is the difference between a warning the user can act on
 * and one they cannot. The side marker in particular has to be right — `Account class>>#new`
 * and `Account>>#new` are different methods, and reversing the wrong one is not a reversal.
 */
describe('slotLabel', () => {
  const slot = (over: Partial<Parameters<typeof slotLabel>[0]> = {}) => ({
    className: 'Account',
    isMeta: false,
    selector: 'balance',
    environmentId: 0,
    ...over,
  });

  it('names an instance method as Class>>#selector', () => {
    expect(slotLabel(slot())).toBe('Account>>#balance');
  });

  it('marks the class side, which is a different method entirely', () => {
    expect(slotLabel(slot({ isMeta: true, selector: 'new' }))).toBe('Account class>>#new');
  });

  it('leaves a keyword selector intact, colons and all', () => {
    expect(slotLabel(slot({ selector: 'at:put:' }))).toBe('Account>>#at:put:');
  });

  it('leaves a binary selector intact', () => {
    expect(slotLabel(slot({ selector: '+' }))).toBe('Account>>#+');
  });

  it('says nothing about the dictionary, which is how it was found and not what it is called', () => {
    expect(slotLabel(slot({ dict: 3 }))).toBe('Account>>#balance');
  });
});

describe('classSlotLabel', () => {
  it('is just the class name', () => {
    // Deliberately not "UserGlobals.Account": the dictionary is how the class is found, not
    // what the user calls it, and a revert notice that named one would read as a new concept.
    expect(classSlotLabel({ dict: 'UserGlobals', className: 'Account' })).toBe('Account');
  });

  it('names the same class the same way however the dictionary was given', () => {
    expect(classSlotLabel({ dict: 2, className: 'Account' })).toBe(
      classSlotLabel({ dict: 'UserGlobals', className: 'Account' }),
    );
  });
});
