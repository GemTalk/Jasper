import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: () => () => '' }));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../queries/methodSlotQueries', () => ({
  captureMethodSlots: vi.fn(),
  applyMethodSlotOps: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  refreshExplorer: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
  revealMethod: vi.fn(),
}));

import * as vscode from 'vscode';
import { applyMethodSlotOps, captureMethodSlots } from '../queries/methodSlotQueries';
import { refreshSearch, revealMethod } from '../afterUndo';
import { reverseMethodEdit } from '../reverseMethodEdit';
import { MethodEditUndoEntry, MethodSlotState } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Undoing a method edit (#434).
 *
 * A method edit reverses IMMEDIATELY, with no preview: the user just made it, and it is
 * one method. What is pinned here is the one exception to that — DRIFT. If the method has
 * changed since the edit was recorded, putting the old source back throws that change
 * away, and the user is asked first. Drift is a warning, never a refusal, which is the
 * same policy the refactoring undo follows.
 */

const session = { id: 1 } as ActiveSession;

const has = (source: string): MethodSlotState => ({ exists: true, source, category: 'accessing' });
const gone: MethodSlotState = { exists: false, source: null, category: null };

function entry(before: MethodSlotState[], after: MethodSlotState[]): MethodEditUndoEntry {
  return {
    id: 1,
    kind: 'methodEdit',
    sessionId: session.id,
    label: 'Save Account>>#balance',
    slots: [{ className: 'Account', isMeta: false, selector: 'balance', environmentId: 0 }],
    before,
    after,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyMethodSlotOps).mockImplementation((_e, ops) =>
    ops.map((op) => ({ op, error: null })),
  );
});

describe('reverseMethodEdit', () => {
  it('puts the earlier source back and says it did not commit', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([has('balance ^2')]);

    const spent = await reverseMethodEdit(session, entry([has('balance ^1')], [has('balance ^2')]));

    expect(spent).toBe(true);
    const ops = vi.mocked(applyMethodSlotOps).mock.calls[0][1];
    expect(ops).toEqual([expect.objectContaining({ kind: 'recompile', source: 'balance ^1' })]);
    expect(vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0]).toContain(
      'NOT committed',
    );
  });

  it('asks before discarding a change made since, and backs out if refused', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([has('balance ^99')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    const spent = await reverseMethodEdit(session, entry([has('balance ^1')], [has('balance ^2')]));

    expect(spent).toBe(false);
    expect(applyMethodSlotOps).not.toHaveBeenCalled();
    // Modal, because it is destructive and easy to miss in a toast.
    expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][1]).toEqual({ modal: true });
  });

  it('names every drifted method when there is more than one', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([has('a ^9'), has('b ^9')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const multi: MethodEditUndoEntry = {
      ...entry([has('a ^1'), has('b ^1')], [has('a ^2'), has('b ^2')]),
      slots: [
        { className: 'Account', isMeta: false, selector: 'a', environmentId: 0 },
        { className: 'Account', isMeta: false, selector: 'b', environmentId: 0 },
      ],
    };

    await reverseMethodEdit(session, multi);

    expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]).toContain(
      '2 methods (Account>>#a, Account>>#b)',
    );
  });

  it('goes ahead when the drift is accepted — drift is a warning, not a refusal', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([has('balance ^99')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

    const spent = await reverseMethodEdit(session, entry([has('balance ^1')], [has('balance ^2')]));

    expect(spent).toBe(true);
    expect(applyMethodSlotOps).toHaveBeenCalled();
  });

  it('says so quietly when the method is already as it was, and uses the entry up', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([has('balance ^1')]);

    const spent = await reverseMethodEdit(session, entry([has('balance ^1')], [has('balance ^1')]));

    expect(spent).toBe(true);
    expect(applyMethodSlotOps).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalled();
  });

  it('lands the Explorer on a method it brought back', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([gone]);

    await reverseMethodEdit(session, entry([has('balance ^1')], [gone]));

    expect(revealMethod).toHaveBeenCalledWith('Account', 'balance', false);
  });

  it('does not go looking for a method it just removed', async () => {
    vi.mocked(captureMethodSlots).mockReturnValue([has('balance ^1')]);

    await reverseMethodEdit(session, entry([gone], [has('balance ^1')]));

    expect(revealMethod).not.toHaveBeenCalled();
  });

  it('keeps the entry when the reversal could not even run', async () => {
    // A throw means nothing was attempted, unlike a reversal the stone refused per slot —
    // which is reported and still uses the entry up, because the recorded "before" no
    // longer describes anything.
    vi.mocked(captureMethodSlots).mockReturnValue([gone]);
    vi.mocked(applyMethodSlotOps).mockImplementation(() => {
      throw new Error('session busy');
    });

    const spent = await reverseMethodEdit(session, entry([has('balance ^1')], [gone]));

    expect(spent).toBe(false);
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toContain('session busy');
    expect(refreshSearch).not.toHaveBeenCalled();
  });

  it('resyncs GemStone Search, which caches what it searches', async () => {
    // A method the undo took away, or put back, changes what a source or selector search
    // should find. Search caches; it has to be told.
    vi.mocked(captureMethodSlots).mockReturnValue([gone]);

    await reverseMethodEdit(session, entry([has('balance ^1')], [gone]));

    expect(refreshSearch).toHaveBeenCalledWith(session.id);
  });

  it('reports a failed reversal, and still uses the entry up', async () => {
    // The recorded "before" no longer describes anything the stone holds, so offering the
    // entry again would reverse from a state it does not know.
    vi.mocked(captureMethodSlots).mockReturnValue([has('balance ^2')]);
    vi.mocked(applyMethodSlotOps).mockImplementation((_e, ops) =>
      ops.map((op) => ({ op, error: 'not writable' })),
    );

    const spent = await reverseMethodEdit(session, entry([has('balance ^1')], [has('balance ^2')]));

    expect(spent).toBe(true);
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toContain('not writable');
  });

  it('keeps the entry when the current state could not even be read', async () => {
    vi.mocked(captureMethodSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    const spent = await reverseMethodEdit(session, entry([has('balance ^1')], [has('balance ^2')]));

    expect(spent).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
