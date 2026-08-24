import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));
vi.mock('../queries/methodSlotQueries', () => ({ captureMethodSlots: vi.fn() }));

import { defaultQueryExecutorUsing } from '../../browserQueries';
import { captureMethodSlots } from '../queries/methodSlotQueries';
import { ABSENT, beginMethodDeletion, beginMethodEdit, present } from '../recordMethodEdit';
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
  vi.mocked(defaultQueryExecutorUsing).mockReturnValue(() => '');
});

describe('beginMethodEdit', () => {
  it('captures the slots and hands the state back to the caller', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('balance ^1', 'accessing')]);

    const recording = beginMethodEdit(session, [slot('balance')]);

    expect(recording?.before).toEqual([present('balance ^1', 'accessing')]);
  });

  it('records the edit and answers the entry, so the caller can offer Undo', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('balance ^1', 'accessing')]);
    const recording = beginMethodEdit(session, [slot('balance')]);

    const entry = recording?.commit('Save Account>>#balance', [present('balance ^2', 'accessing')]);

    expect(entry).toMatchObject({ kind: 'methodEdit', label: 'Save Account>>#balance' });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('records nothing when the edit left every slot exactly as it found it', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('balance ^1', 'accessing')]);
    const recording = beginMethodEdit(session, [slot('balance')]);

    const entry = recording?.commit('Save Account>>#balance', [present('balance ^1', 'accessing')]);

    expect(entry).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('counts a category-only change as a change', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('balance ^1', 'accessing')]);
    const recording = beginMethodEdit(session, [slot('balance')]);

    expect(recording?.commit('Save', [present('balance ^1', 'private')])).toBeDefined();
  });

  it('refuses a slot in a non-default method environment', () => {
    // `removeSelector:` takes no environment id, so a method created there could not be taken
    // away again. A reversal that is wrong in one direction is worse than none.
    expect(beginMethodEdit(session, [slot('balance', 2)])).toBeUndefined();
    expect(captureMethodSlots).not.toHaveBeenCalled();
  });

  it('refuses an empty slot list', () => {
    expect(beginMethodEdit(session, [])).toBeUndefined();
    expect(captureMethodSlots).not.toHaveBeenCalled();
  });

  it('answers undefined rather than throwing when the capture fails', () => {
    vi.mocked(captureMethodSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(() => beginMethodEdit(session, [slot('balance')])).not.toThrow();
    expect(beginMethodEdit(session, [slot('balance')])).toBeUndefined();
  });

  it('answers undefined rather than throwing when the executor cannot be built', () => {
    // The lookup is inside the guard too — a session that has gone must not take the edit
    // down with it.
    vi.mocked(defaultQueryExecutorUsing).mockImplementation(() => {
      throw new Error('no session');
    });

    expect(beginMethodEdit(session, [slot('balance')])).toBeUndefined();
  });

  it('refuses a capture that did not answer one state per slot', () => {
    // Every rule downstream is written against the pairing being exact.
    vi.mocked(captureMethodSlots).mockReturnValue([present('a', 'c')]);

    expect(beginMethodEdit(session, [slot('a'), slot('b')])).toBeUndefined();
  });

  it('refuses a capture that answered nothing at all', () => {
    vi.mocked(captureMethodSlots).mockReturnValue(undefined as never);

    expect(beginMethodEdit(session, [slot('balance')])).toBeUndefined();
  });
});

describe('beginMethodDeletion', () => {
  it('records the deletion against the method that was there', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('gone ^1', 'private')]);
    const recording = beginMethodDeletion(session, slot('gone'));

    const entry = recording?.commit();

    expect(entry).toMatchObject({ label: 'Delete Account>>#gone' });
    expect(entry?.kind === 'methodEdit' && entry.after).toEqual([ABSENT]);
  });

  it('records nothing when there was no method to delete', () => {
    // The removal is a no-op, so there is nothing to put back.
    vi.mocked(captureMethodSlots).mockReturnValue([ABSENT]);

    expect(beginMethodDeletion(session, slot('gone'))).toBeUndefined();
  });

  it('answers undefined when the capture failed, so the delete still runs', () => {
    vi.mocked(captureMethodSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(beginMethodDeletion(session, slot('gone'))).toBeUndefined();
  });

  it('names the metaclass side when that is what went', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('make ^1', 'c')]);
    const recording = beginMethodDeletion(session, { ...slot('make'), isMeta: true });

    expect(recording?.commit()).toMatchObject({ label: 'Delete Account class>>#make' });
  });
});
