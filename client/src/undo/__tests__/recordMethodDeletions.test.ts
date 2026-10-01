import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));
vi.mock('../queries/methodSlotQueries', () => ({ captureMethodSlots: vi.fn() }));

import { defaultQueryExecutorUsing } from '../../browserQueries';
import { captureMethodSlots } from '../queries/methodSlotQueries';
import {
  ABSENT,
  beginMethodDeletions,
  beginMethodEdit,
  MethodEditRecording,
  present,
} from '../recordMethodEdit';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import { MethodEditUndoEntry, MethodSlot, MethodSlotState, UndoEntry } from '../undoTypes';

/**
 * Recording a run of removals as one undo entry.
 *
 * A removal run can leave some of the slots it captured standing — GemStone refuses one, or the
 * method was already gone — so the entry must describe only what really went. That is the one
 * thing this shape needs over an ordinary edit, and it is the whole reason a second
 * entry-building path grew beside `commit`: two copies of the same rules, each able to drift
 * from the other.
 *
 * So these pin the rules themselves, against BOTH ways in, and assert the two agree. A rule
 * that holds through `commit` and not through the deletions path (or the other way about) is
 * exactly the failure the duplication makes possible.
 */

const session = { id: 1 } as unknown as import('../../sessionManager').ActiveSession;

const slot = (selector: string, isMeta = false): MethodSlot => ({
  className: 'Account',
  isMeta,
  selector,
  environmentId: 0,
});

const recorded = (): MethodEditUndoEntry => peekUndoEntry(session.id) as MethodEditUndoEntry;

/**
 * `commit`, given the subset of slots the run actually acted on.
 *
 * The cast is the point of the item and goes away with it: `commit` does not take the subset
 * yet, so the call compiles against the signature it is about to have and fails against the
 * behaviour it has now. Once the parameter exists, lint's unnecessary-assertion rule says so.
 */
const commitOnly = (
  recording: MethodEditRecording | undefined,
  label: string,
  after: MethodSlotState[],
  only: MethodSlot[],
): UndoEntry | undefined =>
  (
    recording?.commit as unknown as (
      l: string,
      a: MethodSlotState[],
      o: MethodSlot[],
    ) => UndoEntry | undefined
  )?.call(recording, label, after, only);

/** The selector/side pairs an entry will put back, in order. */
const slotsOf = (entry: MethodEditUndoEntry): string[] =>
  entry.slots.map((s) => `${s.isMeta ? 'class ' : ''}${s.selector}`);

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  vi.mocked(defaultQueryExecutorUsing).mockReturnValue(() => '');
});

describe('recording only some of the captured slots', () => {
  it('records the slots that were named and leaves the rest out', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('deposit: n ^n', 'accessing'),
    ]);
    const slots = [slot('balance'), slot('deposit:')];
    const recording = beginMethodEdit(session, slots);

    commitOnly(recording, 'Delete Account>>#balance', [ABSENT], [slots[0]]);

    expect(slotsOf(recorded())).toEqual(['balance']);
  });

  it('keeps each recorded slot paired with the state captured for it', () => {
    // The before-states have to be filtered alongside the slots, not re-indexed: a plan built
    // from a mispaired entry restores one method's source into another's selector.
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('deposit: n ^n', 'private'),
    ]);
    const slots = [slot('balance'), slot('deposit:')];
    const recording = beginMethodEdit(session, slots);

    commitOnly(recording, 'Delete Account>>#deposit:', [ABSENT], [slots[1]]);

    expect(recorded().before).toEqual([present('deposit: n ^n', 'private')]);
  });

  it('tells two slots apart by which object was named, not by the selector they share', () => {
    // A class can implement the same selector on both sides, and those are two different
    // methods. Matching the subset on the selector alone records the one that is still there.
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('balance ^self new', 'instance creation'),
    ]);
    const slots = [slot('balance'), slot('balance', true)];
    const recording = beginMethodEdit(session, slots);

    commitOnly(recording, 'Delete Account class>>#balance', [ABSENT], [slots[1]]);

    expect(slotsOf(recorded())).toEqual(['class balance']);
  });

  it('records nothing when none of the captured slots were named', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('balance ^1', 'accessing')]);
    const recording = beginMethodEdit(session, [slot('balance')]);

    const entry = commitOnly(recording, 'Delete Account>>#balance', [ABSENT], []);

    expect(entry).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('leaves out a named slot that held nothing to begin with', () => {
    // Nothing was removed there, so there is nothing to put back; an entry offering to restore
    // it would compile a method that never existed.
    vi.mocked(captureMethodSlots).mockReturnValue([present('balance ^1', 'accessing'), ABSENT]);
    const slots = [slot('balance'), slot('deposit:')];
    const recording = beginMethodEdit(session, slots);

    commitOnly(recording, 'Delete 2 methods from Account', [ABSENT, ABSENT], slots);

    expect(slotsOf(recorded())).toEqual(['balance']);
  });

  it('records every captured slot when no subset is named', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('deposit: n ^n', 'accessing'),
    ]);
    const recording = beginMethodEdit(session, [slot('balance'), slot('deposit:')]);

    recording?.commit('Save 2 methods', [
      present('balance ^2', 'accessing'),
      present('deposit: n ^n + 1', 'accessing'),
    ]);

    expect(slotsOf(recorded())).toEqual(['balance', 'deposit:']);
  });
});

describe('recording a run of removals', () => {
  it('records only the methods that really went', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('deposit: n ^n', 'accessing'),
    ]);
    const slots = [slot('balance'), slot('deposit:')];
    const recording = beginMethodDeletions(session, slots, 'Account');

    recording?.commit([slots[0]]);

    expect(slotsOf(recorded())).toEqual(['balance']);
  });

  it('tells two slots apart by which object was removed, not by the selector they share', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('balance ^self new', 'instance creation'),
    ]);
    const slots = [slot('balance'), slot('balance', true)];
    const recording = beginMethodDeletions(session, slots, 'Account');

    recording?.commit([slots[1]]);

    expect(slotsOf(recorded())).toEqual(['class balance']);
  });

  it('records nothing when every removal in the run failed', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([present('balance ^1', 'accessing')]);
    const recording = beginMethodDeletions(session, [slot('balance')], 'Account');

    const entry = recording?.commit([]);

    expect(entry).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('names the one method when a run removed exactly one', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('deposit: n ^n', 'accessing'),
    ]);
    const slots = [slot('balance'), slot('deposit:')];
    const recording = beginMethodDeletions(session, slots, 'Account');

    recording?.commit([slots[0]]);

    expect(recorded().label).toBe('Delete Account>>#balance');
  });

  it('counts the methods when a run removed several', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('deposit: n ^n', 'accessing'),
    ]);
    const slots = [slot('balance'), slot('deposit:')];
    const recording = beginMethodDeletions(session, slots, 'Account');

    recording?.commit(slots);

    expect(recorded().label).toBe('Delete 2 methods from Account');
  });

  it('counts only what went, so a run where one removal failed is not named for both', () => {
    vi.mocked(captureMethodSlots).mockReturnValue([
      present('balance ^1', 'accessing'),
      present('deposit: n ^n', 'accessing'),
    ]);
    const slots = [slot('balance'), slot('deposit:')];
    const recording = beginMethodDeletions(session, slots, 'Account');

    recording?.commit([slots[1]]);

    expect(recorded().label).toBe('Delete Account>>#deposit:');
  });
});

describe('the two ways of recording a subset', () => {
  it('build the same entry from the same removals', () => {
    // The deletions path exists for the subset, not for a different idea of what an entry is.
    // Anything the two disagree about is a rule that was fixed in one copy and not the other.
    const states = [present('balance ^1', 'accessing'), present('deposit: n ^n', 'private')];
    const slots = [slot('balance'), slot('deposit:')];

    vi.mocked(captureMethodSlots).mockReturnValue(states);
    beginMethodDeletions(session, slots, 'Account')?.commit([slots[1]]);
    const viaDeletions = recorded();

    resetUndoStacks();
    vi.mocked(captureMethodSlots).mockReturnValue(states);
    commitOnly(beginMethodEdit(session, slots), 'Delete Account>>#deposit:', [ABSENT], [slots[1]]);
    const viaCommit = recorded();

    expect(viaCommit.slots).toEqual(viaDeletions.slots);
    expect(viaCommit.before).toEqual(viaDeletions.before);
    expect(viaCommit.after).toEqual(viaDeletions.after);
    expect(viaCommit.label).toEqual(viaDeletions.label);
  });
});
