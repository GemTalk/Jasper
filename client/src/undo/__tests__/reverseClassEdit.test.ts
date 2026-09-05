import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: () => () => '' }));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../queries/classSlotQueries', () => ({
  captureClassSlots: vi.fn(),
  applyClassSlotOps: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  refreshExplorer: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
  revealMethod: vi.fn(),
}));

import * as vscode from 'vscode';
import { applyClassSlotOps, captureClassSlots } from '../queries/classSlotQueries';
import { refreshSearch } from '../afterUndo';
import { reverseClassEdit } from '../reverseClassEdit';
import { ClassEditUndoEntry, ClassSlotState } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Reverting a class edit (#434).
 *
 * The behaviour that makes this different from a method undo, and the reason it is called a
 * REVERT: binding the earlier version again leaves anything written on the newer version
 * behind. That is a real cost, it is not recoverable by pressing the button again, and the
 * user is told what it is — by name — before it happens.
 */

const session = { id: 1 } as ActiveSession;

const bound = (oop: string, selectors: string[] = []): ClassSlotState => ({
  bound: true,
  oop,
  selectors,
});
const unbound: ClassSlotState = { bound: false, oop: null, selectors: [] };

function entry(before: ClassSlotState[], after: ClassSlotState[]): ClassEditUndoEntry {
  return {
    id: 1,
    kind: 'classEdit',
    sessionId: session.id,
    label: 'Redefine class Account',
    slots: [{ dict: 'UserGlobals', className: 'Account' }],
    before,
    after,
    stashKeys: ['k1'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyClassSlotOps).mockImplementation((_e, ops) =>
    ops.map((op) => ({ op, error: null })),
  );
});

describe('reverseClassEdit', () => {
  it('binds the earlier version back and says the history is kept', () => {
    // GemStone has no savepoints -- a revert adds a version rather than removing one, and
    // the notice must not read as a rollback.
    vi.mocked(captureClassSlots).mockReturnValue([bound('2')]);

    return reverseClassEdit(session, entry([bound('1')], [bound('2')])).then((spent) => {
      expect(spent).toBe(true);
      expect(vi.mocked(applyClassSlotOps).mock.calls[0][1]).toEqual([
        expect.objectContaining({ kind: 'rebind', stashKey: 'k1' }),
      ]);
      const notice = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0];
      expect(notice).toContain('keeps its history');
      expect(notice).toContain('NOT committed');
    });
  });

  it('keeps the entry when the reversal could not even run', async () => {
    // Distinct from a reversal the stone REFUSED (which is reported per class and uses the
    // entry up): a throw here means nothing was attempted, so the entry must stay on offer.
    vi.mocked(captureClassSlots).mockReturnValue([bound('2')]);
    vi.mocked(applyClassSlotOps).mockImplementation(() => {
      throw new Error('session busy');
    });

    const spent = await reverseClassEdit(session, entry([bound('1')], [bound('2')]));

    expect(spent).toBe(false);
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toContain('session busy');
    expect(refreshSearch).not.toHaveBeenCalled();
  });

  it('resyncs GemStone Search, which caches the class list', async () => {
    // Unbinding a class the user just created leaves the search panel offering it as a hit;
    // opening that hit lands on "Class not found". Search has to be told, same as the
    // Explorer.
    vi.mocked(captureClassSlots).mockReturnValue([bound('2')]);

    await reverseClassEdit(session, entry([unbound], [bound('2')]));

    expect(refreshSearch).toHaveBeenCalledWith(session.id);
  });

  it('leaves GemStone Search alone when the user backs out', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('2', ['writtenLater'])]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    await reverseClassEdit(session, entry([bound('1')], [bound('2')]));

    expect(refreshSearch).not.toHaveBeenCalled();
  });

  it('names what would be left behind, and backs out if refused', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('2', ['writtenLater'])]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    const spent = await reverseClassEdit(session, entry([bound('1')], [bound('2')]));

    expect(spent).toBe(false);
    expect(applyClassSlotOps).not.toHaveBeenCalled();
    const [message, options] = vi.mocked(vscode.window.showWarningMessage).mock.calls[0];
    expect(message).toContain('1 method');
    expect((options as { modal: boolean; detail: string }).modal).toBe(true);
    // By name, not just a count -- the user cannot judge the cost from a number.
    expect((options as { detail: string }).detail).toContain('Account>>#writtenLater');
  });

  it('names every class when a whole subtree drifted, not just a count', () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('9'), bound('9')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const subtree: ClassEditUndoEntry = {
      ...entry([bound('1'), bound('1')], [bound('2'), bound('2')]),
      slots: [
        { dict: 'UserGlobals', className: 'Account' },
        { dict: 'UserGlobals', className: 'Savings' },
      ],
      stashKeys: ['k1', 'k2'],
    };

    return reverseClassEdit(session, subtree).then(() => {
      const message = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0];
      expect(message).toContain('2 classes (Account, Savings)');
    });
  });

  it('caps the list of methods it would leave behind, and says how many it cut', async () => {
    // The detail is a modal body, not a log: twenty selectors is a wall the user cannot read,
    // and a bare count is not enough to judge the cost. Ten plus a remainder is the compromise.
    const many = Array.from({ length: 12 }, (_, i) => `writtenLater${i}`);
    vi.mocked(captureClassSlots).mockReturnValue([bound('2', many)]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    await reverseClassEdit(session, entry([bound('1')], [bound('2')]));

    const [message, options] = vi.mocked(vscode.window.showWarningMessage).mock.calls[0];
    expect(message).toContain('12 methods');
    const { detail } = options as { detail: string };
    expect(detail).toContain('Account>>#writtenLater0');
    expect(detail).toContain('…and 2 more');
    expect(detail).not.toContain('writtenLater11');
  });

  it('goes ahead when the cost is accepted', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('2', ['writtenLater'])]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Revert Anyway' as never);

    expect(await reverseClassEdit(session, entry([bound('1')], [bound('2')]))).toBe(true);
    expect(applyClassSlotOps).toHaveBeenCalled();
  });

  it('does not ask when nothing would be left behind', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('2')]);

    await reverseClassEdit(session, entry([bound('1')], [bound('2')]));

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('asks separately when the class has been rebound since', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('9')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    const spent = await reverseClassEdit(session, entry([bound('1')], [bound('2')]));

    expect(spent).toBe(false);
    expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]).toContain('changed again');
  });

  it('puts a removed class back without asking anything', async () => {
    // Nothing newer exists to leave behind: this one really is an exact restore.
    vi.mocked(captureClassSlots).mockReturnValue([unbound]);

    const spent = await reverseClassEdit(session, entry([bound('1', ['plain'])], [unbound]));

    expect(spent).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vi.mocked(applyClassSlotOps).mock.calls[0][1][0].kind).toBe('rebind');
  });

  it('takes away a class that was created', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('2')]);

    await reverseClassEdit(session, entry([unbound], [bound('2')]));

    expect(vi.mocked(applyClassSlotOps).mock.calls[0][1][0].kind).toBe('unbind');
  });

  it('says so quietly when it is already as it was, and uses the entry up', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([bound('1')]);

    const spent = await reverseClassEdit(session, entry([bound('1')], [bound('2')]));

    expect(spent).toBe(true);
    expect(applyClassSlotOps).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalled();
  });

  it('reports a version the session no longer holds', async () => {
    vi.mocked(captureClassSlots).mockReturnValue([unbound]);
    vi.mocked(applyClassSlotOps).mockImplementation((_e, ops) =>
      ops.map((op) => ({ op, error: 'this session no longer holds the earlier version' })),
    );

    const spent = await reverseClassEdit(session, entry([bound('1')], [unbound]));

    expect(spent).toBe(true);
    expect(vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0]).toContain('no longer holds');
  });

  it('keeps the entry when the current state could not be read', async () => {
    vi.mocked(captureClassSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseClassEdit(session, entry([bound('1')], [bound('2')]))).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
