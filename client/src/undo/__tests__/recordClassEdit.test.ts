import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));
vi.mock('../queries/classSlotQueries', () => ({
  captureClassSlots: vi.fn(),
  newStashKey: vi.fn(),
}));

import { defaultQueryExecutorUsing } from '../../browserQueries';
import { captureClassSlots, newStashKey } from '../queries/classSlotQueries';
import { beginClassDeletion, beginClassEdit } from '../recordClassEdit';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import { ClassSlot, ClassSlotState } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * The class recorder (#434).
 *
 * Same negative promise as the method recorder — recording must never break the edit — plus
 * one rule specific to classes: a stash key is only kept for a slot that HAD a version bound.
 * A class being created has no earlier version, and a key that resolves to nil at revert time
 * would be a lie the reversal could not detect.
 */

const session = { id: 1 } as ActiveSession;
const slot = (className = 'Account'): ClassSlot => ({ dict: 'UserGlobals', className });

const bound = (oop: string): ClassSlotState => ({ bound: true, oop, selectors: [] });
const unbound: ClassSlotState = { bound: false, oop: null, selectors: [] };

let keySerial = 0;

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  keySerial = 0;
  vi.mocked(defaultQueryExecutorUsing).mockReturnValue(() => '');
  vi.mocked(newStashKey).mockImplementation(() => {
    keySerial += 1;
    return `k${keySerial}`;
  });
});

describe('beginClassEdit', () => {
  it('stashes the bound version and records the new one on commit', () => {
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([bound('1')])
      .mockReturnValueOnce([bound('2')]);

    const entry = beginClassEdit(session, [slot()])?.commit('Redefine class Account');

    expect(entry).toMatchObject({
      kind: 'classEdit',
      label: 'Redefine class Account',
      stashKeys: ['k1'],
    });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('asks for the stash on the way in and not on the way out', () => {
    // The read-back must not pin the version the edit just produced.
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([bound('1')])
      .mockReturnValueOnce([bound('2')]);

    beginClassEdit(session, [slot()])?.commit('Redefine class Account');

    expect(vi.mocked(captureClassSlots).mock.calls[0][2]).toEqual(['k1']);
    expect(vi.mocked(captureClassSlots).mock.calls[1][2]).toBeUndefined();
  });

  it('keeps no stash key for a name that had nothing bound', () => {
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([unbound])
      .mockReturnValueOnce([bound('2')]);

    const entry = beginClassEdit(session, [slot()])?.commit('Add class Account');

    expect(entry?.kind === 'classEdit' && entry.stashKeys).toEqual([null]);
  });

  it('records nothing when the same version is still bound', () => {
    // An identical redefinition answers the SAME class object, so no version was created.
    vi.mocked(captureClassSlots).mockReturnValue([bound('1')]);

    expect(beginClassEdit(session, [slot()])?.commit('Redefine class Account')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing when the name was unbound before and still is', () => {
    vi.mocked(captureClassSlots).mockReturnValue([unbound]);

    expect(beginClassEdit(session, [slot()])?.commit('Add class Account')).toBeUndefined();
  });

  it('refuses an empty slot list', () => {
    expect(beginClassEdit(session, [])).toBeUndefined();
    expect(captureClassSlots).not.toHaveBeenCalled();
  });

  it('answers undefined rather than throwing when the capture fails', () => {
    vi.mocked(captureClassSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(() => beginClassEdit(session, [slot()])).not.toThrow();
    expect(beginClassEdit(session, [slot()])).toBeUndefined();
  });

  it('answers undefined rather than throwing when the executor cannot be built', () => {
    vi.mocked(defaultQueryExecutorUsing).mockImplementation(() => {
      throw new Error('no session');
    });

    expect(beginClassEdit(session, [slot()])).toBeUndefined();
  });

  it('refuses a capture that did not answer one state per slot', () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('1')]);

    expect(beginClassEdit(session, [slot('A'), slot('B')])).toBeUndefined();
  });

  it('records nothing when the result could not be read back', () => {
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([bound('1')])
      .mockImplementationOnce(() => {
        throw new Error('session busy');
      });

    expect(beginClassEdit(session, [slot()])?.commit('Redefine class Account')).toBeUndefined();
  });
});

describe('beginClassDeletion', () => {
  it('names a single removed class', () => {
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([bound('1')])
      .mockReturnValueOnce([unbound]);

    expect(beginClassDeletion(session, [slot()])?.commit()).toMatchObject({
      label: 'Remove class Account',
    });
  });

  it('records a removed subtree as ONE entry, named for its root', () => {
    // Putting half a subtree back is not a reversal of what the user asked for.
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([bound('1'), bound('2')])
      .mockReturnValueOnce([unbound, unbound]);

    const entry = beginClassDeletion(session, [slot('Account'), slot('Savings')])?.commit();

    expect(entry).toMatchObject({
      label: 'Remove 2 classes (Account and its subclasses)',
    });
    expect(entry?.kind === 'classEdit' && entry.slots).toHaveLength(2);
  });

  it('records nothing when none of the names were bound', () => {
    vi.mocked(captureClassSlots).mockReturnValue([unbound]);

    expect(beginClassDeletion(session, [slot()])).toBeUndefined();
  });

  it('answers undefined when the capture failed, so the delete still runs', () => {
    vi.mocked(captureClassSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(beginClassDeletion(session, [slot()])).toBeUndefined();
  });
});
