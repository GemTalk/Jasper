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
import { planUndo } from '../undoPlan';
import { ClassVarEditUndoEntry, MethodSlot, MethodSlotState } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * The plan the user approves and the reversal that follows it have to be the same thing.
 *
 * The reversal drops a slot whose state already matches what was recorded for "before": there
 * is nothing to put back, so it does nothing to it. The plan builds a row per recorded slot and
 * so counts that one in — the panel offers "Undo 3" and three rows, one of which says a method
 * "is put back" when the reversal will walk past it untouched.
 *
 * The case is ordinary rather than exotic: adding a class variable with accessors SKIPS an
 * accessor the class already implements, so the add never touched it and the undo has nothing
 * to undo there.
 *
 * The notice afterwards has the matching problem from the other end: it reports every accessor
 * operation as a restore, whatever the operation was, so undoing an add says the accessors were
 * "put back" at the moment it removed them.
 */

const session = { id: 1 } as ActiveSession;

const accessor = (selector: string): MethodSlot => ({
  dict: 7,
  className: 'Account',
  isMeta: true,
  selector,
  environmentId: 0,
});

const present = (source: string): MethodSlotState => ({
  exists: true,
  source,
  category: 'accessing',
});
const absent: MethodSlotState = { exists: false, source: null, category: null };

const alreadyThere = present('registry\n\t^Registry');
const compiledSetter = present('registry: v\n\tRegistry := v');

/**
 * The repro's recording: `registry` was already implemented, so the add skipped it and left it
 * exactly as it found it; `registry:` is new.
 */
function entryWithOneSkippedAccessor(
  overrides: Partial<ClassVarEditUndoEntry> = {},
): ClassVarEditUndoEntry {
  return {
    id: 1,
    kind: 'classVarEdit',
    sessionId: session.id,
    label: 'Add class variable Registry to Account',
    slot: { dict: 7, className: 'Account', varName: 'Registry' },
    before: { defined: false },
    after: { defined: true },
    accessorSlots: [accessor('registry'), accessor('registry:')],
    accessorBefore: [alreadyThere, absent],
    accessorAfter: [alreadyThere, compiledSetter],
    ...overrides,
  };
}

const rowTargets = (entry: ClassVarEditUndoEntry): string[] =>
  planUndo(entry)!.rows.map((r) => `${r.action} ${r.target}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyClassVarOp).mockReturnValue(null);
  vi.mocked(applyMethodSlotOps).mockImplementation((_e, ops) =>
    ops.map((op) => ({ op, error: null })),
  );
  vi.mocked(methodsReferencingClassVar).mockReturnValue([]);
});

describe('the plan for an undo that will skip a slot', () => {
  it('leaves out the accessor the change never touched', () => {
    const targets = rowTargets(entryWithOneSkippedAccessor());

    expect(targets).not.toContain('restore Account class >> #registry');
  });

  it('lists the accessor the change did compile', () => {
    const targets = rowTargets(entryWithOneSkippedAccessor());

    expect(targets).toContain('remove Account class >> #registry:');
  });

  it('counts only the rows the reversal will act on, which is what the button says', () => {
    const plan = planUndo(entryWithOneSkippedAccessor())!;

    expect(plan.rows).toHaveLength(2);
  });

  it('still lists the declaration when every accessor was skipped', () => {
    // The whole point of the undo is the variable; a plan with no rows at all would read as
    // "nothing to undo" for a change that really did declare one.
    const plan = planUndo(
      entryWithOneSkippedAccessor({
        accessorSlots: [accessor('registry')],
        accessorBefore: [alreadyThere],
        accessorAfter: [alreadyThere],
      }),
    )!;

    expect(plan.rows.map((r) => r.action)).toEqual(['remove class variable']);
  });

  it('leaves out a method slot the edit left exactly as it found it', () => {
    // Same rule, same reason, on the other kind of entry: a multi-method edit can record a
    // slot it turned out not to change, and the reversal will pass over that one too.
    const plan = planUndo({
      id: 2,
      kind: 'methodEdit',
      sessionId: session.id,
      label: 'Save 2 methods in Account',
      slots: [
        { dict: 7, className: 'Account', isMeta: false, selector: 'balance', environmentId: 0 },
        { dict: 7, className: 'Account', isMeta: false, selector: 'deposit:', environmentId: 0 },
      ],
      before: [present('balance\n\t^1'), present('deposit: n\n\t^n')],
      after: [present('balance\n\t^2'), present('deposit: n\n\t^n')],
    })!;

    expect(plan.rows.map((r) => r.target)).toEqual(['Account >> #balance']);
  });

  it('keeps every row when the change touched every slot it recorded', () => {
    const plan = planUndo(
      entryWithOneSkippedAccessor({
        accessorBefore: [absent, absent],
        accessorAfter: [alreadyThere, compiledSetter],
      }),
    )!;

    expect(plan.rows).toHaveLength(3);
  });
});

describe('what the notice says after undoing an added class variable', () => {
  /** The clause of the post-undo notice that talks about the accessors. */
  async function accessorClause(entry: ClassVarEditUndoEntry): Promise<string> {
    await reverseClassVarEdit(session, entry);
    const message = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0];
    return (
      message
        .split(/[—,.]/)
        .map((part) => part.trim())
        .find((part) => /accessor/.test(part)) ?? message
    );
  }

  it('does not claim the accessors were put back when it removed them', async () => {
    vi.mocked(captureClassVar).mockReturnValue({ defined: true });
    vi.mocked(captureMethodSlots).mockReturnValue([alreadyThere, compiledSetter]);

    const clause = await accessorClause(entryWithOneSkippedAccessor());

    expect(clause).not.toMatch(/put back/);
  });

  it('says the accessors were removed when that is what it did', async () => {
    vi.mocked(captureClassVar).mockReturnValue({ defined: true });
    vi.mocked(captureMethodSlots).mockReturnValue([alreadyThere, compiledSetter]);

    const clause = await accessorClause(entryWithOneSkippedAccessor());

    expect(clause).toMatch(/remov/);
  });

  it('counts only the accessors it acted on, not every one recorded', async () => {
    // `registry` was skipped by the add and is skipped by the undo, so one accessor went.
    vi.mocked(captureClassVar).mockReturnValue({ defined: true });
    vi.mocked(captureMethodSlots).mockReturnValue([alreadyThere, compiledSetter]);

    const clause = await accessorClause(entryWithOneSkippedAccessor());

    expect(clause).toMatch(/\b1\b/);
  });

  it('still says the accessors were put back when undoing a removal', async () => {
    // The other direction keeps its wording: here the reversal really does compile them again.
    vi.mocked(captureClassVar).mockReturnValue({ defined: false });
    vi.mocked(captureMethodSlots).mockReturnValue([absent, absent]);

    const clause = await accessorClause(
      entryWithOneSkippedAccessor({
        label: 'Remove class variable Registry from Account',
        before: { defined: true },
        after: { defined: false },
        accessorBefore: [alreadyThere, compiledSetter],
        accessorAfter: [absent, absent],
      }),
    );

    expect(clause).toMatch(/put back/);
  });
});
