import { describe, it, expect, vi } from 'vitest';
vi.mock('../../refactoring/queries/getDefinedClassVarNames', () => ({
  getDefinedClassVarNames: vi.fn(),
}));
vi.mock('../../refactoring/queries/addClassVariable', () => ({ addClassVariable: vi.fn() }));
vi.mock('../../refactoring/queries/deleteClassVariable', () => ({ deleteClassVariable: vi.fn() }));
vi.mock('../../refactoring/queries/methodsAccessingClassVar', () => ({
  methodsAccessingClassVar: vi.fn(() => []),
}));

import { getDefinedClassVarNames } from '../../refactoring/queries/getDefinedClassVarNames';
import { addClassVariable } from '../../refactoring/queries/addClassVariable';
import { deleteClassVariable } from '../../refactoring/queries/deleteClassVariable';
import { applyClassVarOp, captureClassVar } from '../queries/classVarQueries';

/**
 * How the undo layer reads and writes a class-variable declaration (#434).
 *
 * The rules with teeth are the SENTINELS. These queries report trouble by returning a string
 * rather than raising, so a reversal that reads them wrongly reports success over a stone
 * that did nothing — and 'not-declared' on a removal is the state the reversal was aiming at,
 * not a failure.
 */

const exec = vi.fn();
const slot = { dict: 7, className: 'Account', varName: 'Registry' };

describe('captureClassVar', () => {
  it('reads a DECLARED name as defined', async () => {
    vi.mocked(getDefinedClassVarNames).mockResolvedValue(['Registry', 'Other']);

    expect(await captureClassVar(exec, slot)).toEqual({ defined: true });
  });

  it('reads a name the class only inherits as not defined here', async () => {
    // The reversal touches the class that DECLARES the variable; removing an inherited name
    // would take it away from every other subclass too.
    vi.mocked(getDefinedClassVarNames).mockResolvedValue(['Other']);

    expect(await captureClassVar(exec, slot)).toEqual({ defined: false });
  });
});

describe('applyClassVarOp', () => {
  it('declares through addClassVariable and undeclares through deleteClassVariable', async () => {
    vi.mocked(addClassVariable).mockResolvedValue('ok');
    vi.mocked(deleteClassVariable).mockResolvedValue('ok');

    expect(await applyClassVarOp(exec, slot, 'declare')).toBeNull();
    expect(addClassVariable).toHaveBeenCalledWith(exec, 'Account', 'Registry', 7);

    expect(await applyClassVarOp(exec, slot, 'undeclare')).toBeNull();
    expect(deleteClassVariable).toHaveBeenCalledWith(exec, 'Account', 'Registry', 7);
  });

  it("treats 'not-declared' on a removal as done, not as a failure", async () => {
    // That IS the state the reversal was aiming at.
    vi.mocked(deleteClassVariable).mockResolvedValue('not-declared');

    expect(await applyClassVarOp(exec, slot, 'undeclare')).toBeNull();
  });

  it("does NOT treat 'not-declared' as done when declaring", async () => {
    vi.mocked(addClassVariable).mockResolvedValue('not-declared');

    expect(await applyClassVarOp(exec, slot, 'declare')).toBe('not-declared');
  });

  it('turns no-class into a sentence naming the class', async () => {
    vi.mocked(deleteClassVariable).mockResolvedValue('no-class');

    expect(await applyClassVarOp(exec, slot, 'undeclare')).toBe('Account could not be resolved');
  });

  it('reports an unexpected answer verbatim rather than reading it as success', async () => {
    vi.mocked(deleteClassVariable).mockResolvedValue('something else entirely');

    expect(await applyClassVarOp(exec, slot, 'undeclare')).toBe('something else entirely');
  });

  it('answers the reason instead of throwing past the caller', async () => {
    vi.mocked(deleteClassVariable).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(await applyClassVarOp(exec, slot, 'undeclare')).toBe('session busy');
  });
});
