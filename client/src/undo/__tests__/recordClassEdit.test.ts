import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));
vi.mock('../queries/classSlotQueries', () => ({
  captureClassSlots: vi.fn(),
  forgetStashKeys: vi.fn(),
  newStashKey: vi.fn(),
  releaseStashKeys: vi.fn(),
}));

import { defaultQueryExecutorUsing } from '../../browserQueries';
import {
  captureClassSlots,
  forgetStashKeys,
  newStashKey,
  releaseStashKeys,
} from '../queries/classSlotQueries';
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
  vi.mocked(defaultQueryExecutorUsing).mockReturnValue(async () => '');
  vi.mocked(newStashKey).mockImplementation(() => {
    keySerial += 1;
    return `k${keySerial}`;
  });
});

describe('beginClassEdit', () => {
  it('stashes the bound version and records the new one on commit', async () => {
    vi.mocked(captureClassSlots)
      .mockResolvedValueOnce([bound('1')])
      .mockResolvedValueOnce([bound('2')]);

    const entry = await (await beginClassEdit(session, [slot()]))?.commit('Redefine class Account');

    expect(entry).toMatchObject({
      kind: 'classEdit',
      label: 'Redefine class Account',
      stashKeys: ['k1'],
    });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('asks for the stash on the way in and not on the way out', async () => {
    // The read-back must not pin the version the edit just produced.
    vi.mocked(captureClassSlots)
      .mockResolvedValueOnce([bound('1')])
      .mockResolvedValueOnce([bound('2')]);

    await (await beginClassEdit(session, [slot()]))?.commit('Redefine class Account');

    expect(vi.mocked(captureClassSlots).mock.calls[0][2]).toEqual(['k1']);
    expect(vi.mocked(captureClassSlots).mock.calls[1][2]).toBeUndefined();
  });

  it('keeps no stash key for a name that had nothing bound', async () => {
    vi.mocked(captureClassSlots)
      .mockResolvedValueOnce([unbound])
      .mockResolvedValueOnce([bound('2')]);

    const entry = await (await beginClassEdit(session, [slot()]))?.commit('Add class Account');

    expect(entry?.kind === 'classEdit' && entry.stashKeys).toEqual([null]);
  });

  it('records nothing when the same version is still bound', async () => {
    // An identical redefinition answers the SAME class object, so no version was created.
    vi.mocked(captureClassSlots).mockResolvedValue([bound('1')]);

    expect(
      await (await beginClassEdit(session, [slot()]))?.commit('Redefine class Account'),
    ).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing when the name was unbound before and still is', async () => {
    vi.mocked(captureClassSlots).mockResolvedValue([unbound]);

    expect(
      await (await beginClassEdit(session, [slot()]))?.commit('Add class Account'),
    ).toBeUndefined();
  });

  it('refuses an empty slot list', async () => {
    expect(await beginClassEdit(session, [])).toBeUndefined();
    expect(captureClassSlots).not.toHaveBeenCalled();
  });

  it('answers undefined rather than throwing when the capture fails', async () => {
    vi.mocked(captureClassSlots).mockImplementation(async () => {
      throw new Error('session busy');
    });

    await expect(beginClassEdit(session, [slot()])).resolves.not.toThrow();
    expect(await beginClassEdit(session, [slot()])).toBeUndefined();
  });

  it('answers undefined rather than throwing when the executor cannot be built', async () => {
    vi.mocked(defaultQueryExecutorUsing).mockImplementation(() => {
      throw new Error('no session');
    });

    expect(await beginClassEdit(session, [slot()])).toBeUndefined();
  });

  it('refuses a capture that did not answer one state per slot', async () => {
    vi.mocked(captureClassSlots).mockResolvedValue([bound('1')]);

    expect(await beginClassEdit(session, [slot('A'), slot('B')])).toBeUndefined();
  });

  it('records nothing when the result could not be read back', async () => {
    vi.mocked(captureClassSlots)
      .mockResolvedValueOnce([bound('1')])
      .mockImplementationOnce(() => {
        throw new Error('session busy');
      });

    expect(
      await (await beginClassEdit(session, [slot()]))?.commit('Redefine class Account'),
    ).toBeUndefined();
  });

  it('lets go of what it pinned when it decides not to record', async () => {
    // The capture has already held a version in the stone. Nothing on the stack will ever
    // name that key once the recording is declined, so the decline has to free it itself.
    vi.mocked(captureClassSlots).mockResolvedValue([bound('1')]);

    await (await beginClassEdit(session, [slot()]))?.commit('Redefine class Account');

    expect(vi.mocked(releaseStashKeys).mock.calls[0][1]).toEqual(['k1']);
    expect(forgetStashKeys).toHaveBeenCalledWith(session.id, ['k1']);
  });

  it('frees nothing for a name that had no version bound to pin', async () => {
    vi.mocked(captureClassSlots).mockResolvedValue([unbound]);

    await (await beginClassEdit(session, [slot()]))?.commit('Add class Account');

    expect(releaseStashKeys).not.toHaveBeenCalled();
    expect(forgetStashKeys).toHaveBeenCalledWith(session.id, ['k1']);
  });

  it('still declines when the release itself fails', async () => {
    vi.mocked(captureClassSlots).mockResolvedValue([bound('1')]);
    vi.mocked(releaseStashKeys).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(
      await (await beginClassEdit(session, [slot()]))?.commit('Redefine class Account'),
    ).toBeUndefined();
  });
});

describe('beginClassDeletion', () => {
  it('names a single removed class', async () => {
    vi.mocked(captureClassSlots)
      .mockResolvedValueOnce([bound('1')])
      .mockResolvedValueOnce([unbound]);

    expect(await (await beginClassDeletion(session, [slot()]))?.commit()).toMatchObject({
      label: 'Remove class Account',
    });
  });

  it('records a removed subtree as ONE entry, named for its root', async () => {
    // Putting half a subtree back is not a reversal of what the user asked for.
    vi.mocked(captureClassSlots)
      .mockResolvedValueOnce([bound('1'), bound('2')])
      .mockResolvedValueOnce([unbound, unbound]);

    const entry = await (
      await beginClassDeletion(session, [slot('Account'), slot('Savings')])
    )?.commit();

    expect(entry).toMatchObject({
      label: 'Remove 2 classes (Account and its subclasses)',
    });
    expect(entry?.kind === 'classEdit' && entry.slots).toHaveLength(2);
  });

  it('records nothing when none of the names were bound', async () => {
    vi.mocked(captureClassSlots).mockResolvedValue([unbound]);

    expect(await beginClassDeletion(session, [slot()])).toBeUndefined();
  });

  it('answers undefined when the capture failed, so the delete still runs', async () => {
    vi.mocked(captureClassSlots).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(await beginClassDeletion(session, [slot()])).toBeUndefined();
  });
});
