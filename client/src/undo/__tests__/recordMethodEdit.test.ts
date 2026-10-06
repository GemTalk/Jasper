import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));
vi.mock('../queries/methodSlotQueries', () => ({ captureMethodSlots: vi.fn() }));

import { defaultQueryExecutorUsing } from '../../browserQueries';
import { captureMethodSlots } from '../queries/methodSlotQueries';
import {
  ABSENT,
  beginMethodDeletion,
  beginMethodEdit,
  present,
  readMethodSlotState,
} from '../recordMethodEdit';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import { MethodSlot } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * The recorder (#434).
 *
 * Its central promise is negative and easy to break by accident: recording must NEVER be the
 * reason an edit fails. Every way the capture can go wrong has to answer "this edit is not
 * undoable" rather than throw — so most of what is pinned here is failure paths.
 *
 * The other rule worth a test is the one that keeps the stack honest: an edit that changed
 * nothing records nothing, because an entry offering to undo a no-op would take a slot and
 * name an edit that did not happen.
 */

const session = { id: 1 } as ActiveSession;

const slot = (selector: string, environmentId = 0): MethodSlot => ({
  className: 'Account',
  isMeta: false,
  selector,
  environmentId,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  vi.mocked(defaultQueryExecutorUsing).mockReturnValue(async () => '');
});

describe('beginMethodEdit', () => {
  it('captures the slots and hands the state back to the caller', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([present('balance ^1', 'accessing')]);

    const recording = await beginMethodEdit(session, [slot('balance')]);

    expect(recording?.before).toEqual([present('balance ^1', 'accessing')]);
  });

  it('records the edit and answers the entry, so the caller can offer Undo', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([present('balance ^1', 'accessing')]);
    const recording = await beginMethodEdit(session, [slot('balance')]);

    const entry = recording?.commit('Save Account>>#balance', [present('balance ^2', 'accessing')]);

    expect(entry).toMatchObject({ kind: 'methodEdit', label: 'Save Account>>#balance' });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('records nothing when the edit left every slot exactly as it found it', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([present('balance ^1', 'accessing')]);
    const recording = await beginMethodEdit(session, [slot('balance')]);

    const entry = recording?.commit('Save Account>>#balance', [present('balance ^1', 'accessing')]);

    expect(entry).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('counts a category-only change as a change', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([present('balance ^1', 'accessing')]);
    const recording = await beginMethodEdit(session, [slot('balance')]);

    expect(recording?.commit('Save', [present('balance ^1', 'private')])).toBeDefined();
  });

  it('refuses a slot in a non-default method environment', async () => {
    // `removeSelector:` takes no environment id, so a method created there could not be taken
    // away again. A reversal that is wrong in one direction is worse than none.
    expect(await beginMethodEdit(session, [slot('balance', 2)])).toBeUndefined();
    expect(captureMethodSlots).not.toHaveBeenCalled();
  });

  it('refuses an empty slot list', async () => {
    expect(await beginMethodEdit(session, [])).toBeUndefined();
    expect(captureMethodSlots).not.toHaveBeenCalled();
  });

  it('answers undefined rather than throwing when the capture fails', async () => {
    vi.mocked(captureMethodSlots).mockImplementation(async () => {
      throw new Error('session busy');
    });

    await expect(beginMethodEdit(session, [slot('balance')])).resolves.not.toThrow();
    expect(await beginMethodEdit(session, [slot('balance')])).toBeUndefined();
  });

  it('answers undefined rather than throwing when the executor cannot be built', async () => {
    // The lookup is inside the guard too — a session that has gone must not take the edit
    // down with it.
    vi.mocked(defaultQueryExecutorUsing).mockImplementation(() => {
      throw new Error('no session');
    });

    expect(await beginMethodEdit(session, [slot('balance')])).toBeUndefined();
  });

  it('refuses a capture that did not answer one state per slot', async () => {
    // Every rule downstream is written against the pairing being exact.
    vi.mocked(captureMethodSlots).mockResolvedValue([present('a', 'c')]);

    expect(await beginMethodEdit(session, [slot('a'), slot('b')])).toBeUndefined();
  });

  it('refuses a capture that answered nothing at all', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue(undefined as never);

    expect(await beginMethodEdit(session, [slot('balance')])).toBeUndefined();
  });
});

describe('beginMethodDeletion', () => {
  it('records the deletion against the method that was there', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([present('gone ^1', 'private')]);
    const recording = await beginMethodDeletion(session, slot('gone'));

    const entry = recording?.commit();

    expect(entry).toMatchObject({ label: 'Delete Account>>#gone' });
    expect(entry?.kind === 'methodEdit' && entry.after).toEqual([ABSENT]);
  });

  it('records nothing when there was no method to delete', async () => {
    // The removal is a no-op, so there is nothing to put back.
    vi.mocked(captureMethodSlots).mockResolvedValue([ABSENT]);

    expect(await beginMethodDeletion(session, slot('gone'))).toBeUndefined();
  });

  it('answers undefined when the capture failed, so the delete still runs', async () => {
    vi.mocked(captureMethodSlots).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(await beginMethodDeletion(session, slot('gone'))).toBeUndefined();
  });

  it('names the metaclass side when that is what went', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([present('make ^1', 'c')]);
    const recording = await beginMethodDeletion(session, { ...slot('make'), isMeta: true });

    expect(recording?.commit()).toMatchObject({ label: 'Delete Account class>>#make' });
  });
});

describe('readMethodSlotState', () => {
  const slot: MethodSlot = {
    dict: 'UserGlobals',
    className: 'Account',
    isMeta: false,
    selector: 'balance',
    environmentId: 0,
  };

  it('reads back what an edit left, for a caller that cannot say', async () => {
    // Add Accessors SKIPS any selector the class already implements, so only the stone knows
    // which of the pair are new.
    const states = [present('balance\n\t^1', 'accessing')];
    vi.mocked(captureMethodSlots).mockResolvedValue(states);

    expect(await readMethodSlotState(session, [slot])).toBe(states);
  });

  it('answers undefined rather than a guess when the read fails', async () => {
    vi.mocked(captureMethodSlots).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(await readMethodSlotState(session, [slot])).toBeUndefined();
  });

  it('answers undefined when the read does not pair up with the slots', async () => {
    // Every reversal rule is written against the pairing being exact.
    vi.mocked(captureMethodSlots).mockResolvedValue([]);

    expect(await readMethodSlotState(session, [slot])).toBeUndefined();
  });
});
