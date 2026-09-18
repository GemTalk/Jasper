import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// Stub browserQueries (→ native GCI). The class-variable add + accessor paths use
// these four; each returns a benign default so the controller flow runs.
vi.mock('../../browserQueries', () => ({
  addClassVariable: vi.fn(() => 'ok'),
  getVisibleClassVarNames: vi.fn(() => []),
  addAccessors: vi.fn(() => ({ created: 2, skipped: 0, noClass: false })),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's two captures — mocked so the flow records without a stone (#434).
vi.mock('../../undo/queries/classVarQueries', () => ({ captureClassVar: vi.fn() }));
vi.mock('../../undo/queries/methodSlotQueries', () => ({ captureMethodSlots: vi.fn() }));

import * as vscode from 'vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import * as queries from '../../browserQueries';
import { captureClassVar } from '../../undo/queries/classVarQueries';
import { captureMethodSlots } from '../../undo/queries/methodSlotQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../../undo/undoStack';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Drives ExplorerController's Add Class Variable and Add Accessors handlers: the
 * add sends addClassVariable and refuses an already-visible name; the accessors
 * question is asked up front (escaping it cancels the whole add); opting in
 * generates accessors on the correct side (class side for a class variable,
 * instance side for an instance variable). It also records ONE undo entry covering
 * the variable AND its accessors, because the user did one thing (#434). Queries are
 * mocked; no live stone.
 */

function makeController(session: ActiveSession | undefined) {
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.className = 'Foo';
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  const refresh = vi
    .spyOn(
      ctl as unknown as { refreshAfterClassReshape: () => Promise<void> },
      'refreshAfterClassReshape',
    )
    .mockResolvedValue();
  const reveal = vi.fn().mockResolvedValue(undefined);
  ctl.setViews({
    dict: {},
    category: {},
    klass: { reveal },
    hierarchy: {},
    method: {},
  } as never);
  return { ctl, refresh, reveal };
}

let captureCalls = 0;

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks clears call history but NOT implementations, so re-establish the
  // benign defaults each test (a per-test mockReturnValue would otherwise leak into
  // the next test under the suite's randomized order).
  vi.mocked(queries.addClassVariable).mockReturnValue('ok');
  vi.mocked(queries.getVisibleClassVarNames).mockReturnValue([]);
  vi.mocked(queries.addAccessors).mockReturnValue({ created: 2, skipped: 0, noClass: false });
  vi.mocked(queries.getClassEnvironments).mockReturnValue([]);
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue('No accessors' as never);
  resetUndoStacks();
  // mockReset, not clearAllMocks: clearing a mock leaves its `...Once` queue in place, so a
  // per-test `mockReturnValueOnce` would pile up and be answered in a later test instead.
  vi.mocked(captureClassVar).mockReset();
  vi.mocked(captureMethodSlots).mockReset();
  // Not declared before the add, declared after it — what the recorder reads either side.
  vi.mocked(captureClassVar)
    .mockReturnValueOnce({ defined: false })
    .mockReturnValue({ defined: true });
  // Absent on the way in, present on the way out — what the stone reads either side of an
  // add that actually compiled the accessors.
  captureCalls = 0;
  vi.mocked(captureMethodSlots).mockImplementation((_e, slots) => {
    captureCalls += 1;
    return slots.map((slot) =>
      captureCalls === 1
        ? { exists: false, source: null, category: null }
        : { exists: true, source: `${slot.selector}\n\t^1`, category: 'accessing' },
    );
  });
});

describe('ExplorerController add class variable', () => {
  it('adds the class variable with the trimmed name and current dict, then refreshes', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('  Registry  ');

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addClassVariable).toHaveBeenCalledWith(expect.anything(), 'Foo', 'Registry', 1);
    expect(refresh).toHaveBeenCalledWith('Foo');
  });

  it('refuses a name already visible on the class instead of a silent no-op', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(queries.getVisibleClassVarNames).mockReturnValue(['Registry']);

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addClassVariable).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('already a class variable'),
    );
  });

  it('cancels the whole add when the accessors prompt is escaped — nothing is added', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined); // escaped

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addClassVariable).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('generates class-side accessors after adding when the user opts in', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Add accessors' as never);

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addAccessors).toHaveBeenCalledWith(
      expect.anything(),
      'Foo',
      true, // class side
      expect.arrayContaining([expect.objectContaining({ selector: 'registry' })]),
      1,
    );
  });

  it('records ONE undo entry covering the variable and the accessors it generated', async () => {
    // The user did one thing, so one Undo takes all of it back. Removing the variable while
    // its accessors remained would leave two methods reading a binding the class no longer
    // declares.
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Add accessors' as never);

    await ctl.addClassVarOnClass('Foo');

    // ONE, not two: the accessors ride on the class-variable entry rather than pushing their
    // own, so the user does not have to press Undo twice for one action.
    expect(undoStackDepth(1)).toBe(1);
    const entry = peekUndoEntry(1);
    expect(entry).toMatchObject({
      kind: 'classVarEdit',
      label: 'Add class variable Registry to Account'.replace('Account', 'Foo'),
      slot: { className: 'Foo', varName: 'Registry', dict: 1 },
    });
    expect(entry?.kind === 'classVarEdit' && entry.accessorSlots.map((s) => s.selector)).toEqual([
      'registry',
      'registry:',
    ]);
    // Class-variable accessors live on the class side, so that is where undo removes them.
    expect(entry?.kind === 'classVarEdit' && entry.accessorSlots.every((s) => s.isMeta)).toBe(true);
  });

  it('records no accessor slots when the user declined them', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');

    await ctl.addClassVarOnClass('Foo');

    const entry = peekUndoEntry(1);
    expect(entry?.kind === 'classVarEdit' && entry.accessorSlots).toEqual([]);
  });

  it('records nothing when the class could not be resolved', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(queries.addClassVariable).mockReturnValue('no-class');

    await ctl.addClassVarOnClass('Foo');

    expect(undoStackDepth(1)).toBe(0);
  });

  it('reports failure and does not refresh, reveal, or add accessors when the class cannot be resolved', async () => {
    // addClassVariable answers the non-throwing sentinel 'no-class' — the flow must
    // treat that as a failure, not proceed as if the variable had been added.
    const { ctl, refresh, reveal } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Add accessors' as never);
    vi.mocked(queries.addClassVariable).mockReturnValue('no-class');

    await ctl.addClassVarOnClass('Foo');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't resolve Foo"),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(queries.addAccessors).not.toHaveBeenCalled();
  });
});

describe('ExplorerController add accessors (standalone row action)', () => {
  it('records its own undo entry, unlike the copy that follows Add Class Variable', async () => {
    // Standalone, it IS the whole action, so it gets its own entry.
    const { ctl } = makeController({ id: 1 } as ActiveSession);

    await ctl.generateAccessorsFor('Foo', 'count', 'ivar');

    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'methodEdit',
      label: 'Add accessors for count in Foo',
    });
    const entry = peekUndoEntry(1);
    expect(entry?.kind === 'methodEdit' && entry.slots.map((s) => s.selector)).toEqual([
      'count',
      'count:',
    ]);
    expect(entry?.kind === 'methodEdit' && entry.slots.every((s) => !s.isMeta)).toBe(true);
  });

  it('says class-side in the label for a class variable, and targets the class side', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);

    await ctl.generateAccessorsFor('Foo', 'Registry', 'classvar');

    const entry = peekUndoEntry(1);
    expect(entry?.label).toBe('Add class-side accessors for Registry in Foo');
    expect(entry?.kind === 'methodEdit' && entry.slots.every((s) => s.isMeta)).toBe(true);
  });

  it('records nothing when every accessor already existed', async () => {
    // Nothing was compiled, so there is nothing to take away.
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(queries.addAccessors).mockReturnValue({ created: 0, skipped: 2, noClass: false });

    await ctl.generateAccessorsFor('Foo', 'count', 'ivar');

    expect(undoStackDepth(1)).toBe(0);
  });

  it('records nothing when the class could not be resolved', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(queries.addAccessors).mockReturnValue({ created: 0, skipped: 0, noClass: true });

    await ctl.generateAccessorsFor('Foo', 'count', 'ivar');

    expect(undoStackDepth(1)).toBe(0);
  });

  it('adds instance-side accessors for an instance variable', async () => {
    const { ctl } = makeController({} as ActiveSession);

    await ctl.generateAccessorsFor('Foo', 'count', 'ivar');

    expect(queries.addAccessors).toHaveBeenCalledWith(
      expect.anything(),
      'Foo',
      false,
      [
        { selector: 'count', source: 'count\n\t^count' },
        { selector: 'count:', source: 'count: aValue\n\tcount := aValue' },
      ],
      1,
    );
  });

  it('adds class-side accessors with a lowercased selector for a class variable', async () => {
    const { ctl } = makeController({} as ActiveSession);

    await ctl.generateAccessorsFor('Foo', 'Registry', 'classvar');

    expect(queries.addAccessors).toHaveBeenCalledWith(
      expect.anything(),
      'Foo',
      true,
      [
        { selector: 'registry', source: 'registry\n\t^Registry' },
        { selector: 'registry:', source: 'registry: aValue\n\tRegistry := aValue' },
      ],
      1,
    );
  });
});
