import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: () => () => '' }));
vi.mock('../queries/classVarQueries', () => ({
  captureClassVar: vi.fn(),
  applyClassVarOp: vi.fn(),
  methodsReferencingClassVar: vi.fn(),
}));
vi.mock('../queries/methodSlotQueries', () => ({
  captureMethodSlots: vi.fn(),
  applyMethodSlotOps: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  closeEditorsForRemovedMethods: vi.fn(),
  refreshExplorer: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
}));

import * as vscode from 'vscode';
import {
  applyClassVarOp,
  captureClassVar,
  methodsReferencingClassVar,
} from '../queries/classVarQueries';
import { applyMethodSlotOps, captureMethodSlots } from '../queries/methodSlotQueries';
import { reverseClassVarEdit } from '../reverseClassVarEdit';
import { ClassVarEditUndoEntry, MethodSlot, MethodSlotState } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Undoing an added class variable (#434).
 *
 * The behaviour that matters here is ORDER: the accessors go before the declaration, so the
 * class never holds a method reading a class variable it no longer declares. The second is
 * that an accessor which already existed when the variable was added is left alone — the
 * ordinary method-slot planner sees its state unchanged and asks for nothing. The third is
 * the cost this has to NAME: any other method that came to reference the variable is not
 * removed by the undo, and GemStone severs its reference rather than breaking it loudly, so
 * the user has to be told before it happens.
 */

const session = { id: 1 } as ActiveSession;

const accessor = (selector: string): MethodSlot => ({
  dict: 7,
  className: 'Account',
  isMeta: true,
  selector,
  environmentId: 0,
});
const accessors = [accessor('registry'), accessor('registry:')];

const present = (source: string): MethodSlotState => ({
  exists: true,
  source,
  category: 'accessing',
});
const absent: MethodSlotState = { exists: false, source: null, category: null };
const compiled = [present('registry\n\t^Registry'), present('registry: v\n\tRegistry := v')];

function entry(overrides: Partial<ClassVarEditUndoEntry> = {}): ClassVarEditUndoEntry {
  return {
    id: 1,
    kind: 'classVarEdit',
    sessionId: session.id,
    label: 'Add class variable Registry to Account',
    slot: { dict: 7, className: 'Account', varName: 'Registry' },
    before: { defined: false },
    after: { defined: true },
    accessorSlots: accessors,
    accessorBefore: [absent, absent],
    accessorAfter: compiled,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyClassVarOp).mockResolvedValue(null);
  vi.mocked(applyMethodSlotOps).mockImplementation(async (_e, ops) =>
    ops.map((op) => ({ op, error: null })),
  );
  vi.mocked(captureClassVar).mockResolvedValue({ defined: true });
  vi.mocked(captureMethodSlots).mockResolvedValue(compiled);
  // Nothing references it beyond the accessors, unless a test says otherwise.
  vi.mocked(methodsReferencingClassVar).mockResolvedValue(accessors);
});

describe('reverseClassVarEdit', () => {
  it('removes the accessors and then the declaration', async () => {
    const order: string[] = [];
    vi.mocked(applyMethodSlotOps).mockImplementation(async (_e, ops) => {
      order.push('accessors');
      return ops.map((op) => ({ op, error: null }));
    });
    vi.mocked(applyClassVarOp).mockImplementation(async () => {
      order.push('variable');
      return null;
    });

    expect(await reverseClassVarEdit(session, entry())).toBe(true);

    // Accessors first: a method reading a class variable the class no longer declares is a
    // state the undo must never pass through.
    expect(order).toEqual(['accessors', 'variable']);
    expect(applyClassVarOp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ varName: 'Registry' }),
      'undeclare',
    );
    expect(vi.mocked(applyMethodSlotOps).mock.calls[0][1].map((op) => op.kind)).toEqual([
      'remove',
      'remove',
    ]);
  });

  it('declares the variable first when the reversal is putting one BACK', async () => {
    const order: string[] = [];
    vi.mocked(captureClassVar).mockResolvedValue({ defined: false });
    vi.mocked(captureMethodSlots).mockResolvedValue([absent, absent]);
    vi.mocked(applyMethodSlotOps).mockImplementation(async (_e, ops) => {
      order.push('accessors');
      return ops.map((op) => ({ op, error: null }));
    });
    vi.mocked(applyClassVarOp).mockImplementation(async () => {
      order.push('variable');
      return null;
    });

    await reverseClassVarEdit(
      session,
      entry({
        before: { defined: true },
        after: { defined: false },
        accessorBefore: compiled,
        accessorAfter: [absent, absent],
      }),
    );

    expect(order).toEqual(['variable', 'accessors']);
  });

  it('leaves an accessor that already existed alone — and warns that it is stranded', async () => {
    // It was not created by the add, so the undo does not remove it; it references the
    // variable, so it is exactly what the warning is for.
    const handWritten = present('registry\n\t^self hand written');
    vi.mocked(captureMethodSlots).mockResolvedValue([handWritten, compiled[1]]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

    await reverseClassVarEdit(
      session,
      entry({ accessorBefore: [handWritten, absent], accessorAfter: [handWritten, compiled[1]] }),
    );

    const ops = vi.mocked(applyMethodSlotOps).mock.calls[0][1];
    expect(ops).toHaveLength(1);
    expect(ops[0].slot.selector).toBe('registry:');
    const detail = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][1] as {
      detail: string;
    };
    expect(detail.detail).toContain('Account class>>#registry');
  });

  it('touches no methods when no accessors were generated', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([]);
    vi.mocked(methodsReferencingClassVar).mockResolvedValue([]);

    await reverseClassVarEdit(
      session,
      entry({ accessorSlots: [], accessorBefore: [], accessorAfter: [] }),
    );

    expect(applyMethodSlotOps).not.toHaveBeenCalled();
    expect(applyClassVarOp).toHaveBeenCalled();
  });

  it('does nothing when the variable and its accessors are already gone', async () => {
    vi.mocked(captureClassVar).mockResolvedValue({ defined: false });
    vi.mocked(captureMethodSlots).mockResolvedValue([absent, absent]);

    expect(await reverseClassVarEdit(session, entry())).toBe(true);
    expect(applyClassVarOp).not.toHaveBeenCalled();
    expect(applyMethodSlotOps).not.toHaveBeenCalled();
  });

  it('warns before discarding an accessor edited since, and undoes anyway when told to', async () => {
    vi.mocked(captureMethodSlots).mockResolvedValue([
      present('registry\n\t^self edited'),
      compiled[1],
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

    expect(await reverseClassVarEdit(session, entry())).toBe(true);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('changed since'),
      { modal: true },
      'Undo Anyway',
    );
    expect(applyClassVarOp).toHaveBeenCalled();
  });

  it('keeps the entry on offer when the drift warning is declined', async () => {
    vi.mocked(captureClassVar).mockResolvedValue({ defined: false });
    vi.mocked(captureMethodSlots).mockResolvedValue([
      present('registry\n\t^self edited'),
      compiled[1],
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    expect(await reverseClassVarEdit(session, entry())).toBe(false);
    expect(applyClassVarOp).not.toHaveBeenCalled();
  });

  it('reports a failed removal and spends the entry anyway', async () => {
    vi.mocked(applyClassVarOp).mockResolvedValue('Account could not be resolved');

    expect(await reverseClassVarEdit(session, entry())).toBe(true);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Account could not be resolved'),
    );
  });

  it('names the methods left referencing the variable, and undoes anyway when told to', async () => {
    // Undoing does not remove them, and GemStone severs the reference rather than breaking it
    // loudly — a method silently reading nil is exactly what the user must be warned about.
    const strayed = accessor('report');
    vi.mocked(methodsReferencingClassVar).mockResolvedValue([...accessors, strayed]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

    expect(await reverseClassVarEdit(session, entry())).toBe(true);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('leaves 1 method referencing it'),
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining('Account class>>#report'),
      }),
      'Undo Anyway',
    );
    expect(applyClassVarOp).toHaveBeenCalled();
  });

  it('does not count the accessors it is removing itself', async () => {
    // They are going with the variable, so they are not left behind by it.
    vi.mocked(methodsReferencingClassVar).mockResolvedValue(accessors);

    expect(await reverseClassVarEdit(session, entry())).toBe(true);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('counts a subclass method and an instance-side one, not just the class side', async () => {
    vi.mocked(methodsReferencingClassVar).mockResolvedValue([
      ...accessors,
      { dict: 7, className: 'Savings', isMeta: false, selector: 'peek', environmentId: 0 },
      { dict: 7, className: 'Account', isMeta: false, selector: 'audit', environmentId: 0 },
    ]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

    await reverseClassVarEdit(session, entry());

    const detail = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][1] as {
      detail: string;
    };
    expect(detail.detail).toContain('Savings>>#peek');
    expect(detail.detail).toContain('Account>>#audit');
  });

  it('leaves everything alone when the stranded-reference warning is declined', async () => {
    vi.mocked(methodsReferencingClassVar).mockResolvedValue([accessor('report')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    expect(await reverseClassVarEdit(session, entry())).toBe(false);

    expect(applyClassVarOp).not.toHaveBeenCalled();
    expect(applyMethodSlotOps).not.toHaveBeenCalled();
  });

  it('does not scan when the reversal is putting a variable BACK', async () => {
    // Declaring a name cannot strand anything.
    vi.mocked(captureClassVar).mockResolvedValue({ defined: false });
    vi.mocked(captureMethodSlots).mockResolvedValue([absent, absent]);

    await reverseClassVarEdit(
      session,
      entry({
        before: { defined: true },
        after: { defined: false },
        accessorBefore: compiled,
        accessorAfter: [absent, absent],
      }),
    );

    expect(methodsReferencingClassVar).not.toHaveBeenCalled();
  });

  it('undoes without the warning when the scan itself fails', async () => {
    // A missed warning is the state the user was in before this check existed; a blocked undo
    // would be worse.
    vi.mocked(methodsReferencingClassVar).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(await reverseClassVarEdit(session, entry())).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(applyClassVarOp).toHaveBeenCalled();
  });

  it('keeps the entry on offer when the current state cannot be read', async () => {
    vi.mocked(captureClassVar).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(await reverseClassVarEdit(session, entry())).toBe(false);
    expect(applyClassVarOp).not.toHaveBeenCalled();
  });

  // findClass resolves a bare class name against the whole symbol list and lands on the FIRST
  // match, so undoing on a shadowed class name selected another dictionary's class of that name
  // and left the Explorer looking at the wrong thing (#396). The slot always carries a
  // dictionary -- that is why a class slot requires one -- so the reveal uses it.
  it('reveals the class in its own dictionary, not the first of that name', async () => {
    await reverseClassVarEdit(
      session,
      entry({ slot: { dict: 'DictionaryB', className: 'Shadowed', varName: 'Registry' } }),
    );

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.findClass',
      'Shadowed',
      undefined,
      'DictionaryB',
    );
  });
});
