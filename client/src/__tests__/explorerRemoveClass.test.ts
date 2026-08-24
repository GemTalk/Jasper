import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', async (orig) => ({
  ...(await orig()),
  canClassBeWritten: vi.fn(() => true),
  getClassDescendantNames: vi.fn(() => []),
  getClassesWithCategory: vi.fn(() => []),
  deleteClass: vi.fn(() => 'Deleted class: X'),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The revert recorder's one round trip, stubbed so the snapshot is data this test controls
// rather than a live doit (#434).
vi.mock('../undo/queries/classSlotQueries', () => ({
  captureClassSlots: vi.fn(),
  applyClassSlotOps: vi.fn(),
  newStashKey: vi.fn(() => 'k1'),
}));

import { window } from '../__mocks__/vscode';
import { ExplorerController } from '../gemstoneExplorer';
import { canClassBeWritten, getClassDescendantNames, deleteClass } from '../browserQueries';
import { captureClassSlots } from '../undo/queries/classSlotQueries';
import { peekUndoEntry, resetUndoStacks } from '../undo/undoStack';
import type { SessionManager, ActiveSession } from '../sessionManager';

function makeController(onClassRemoved?: (sessionId: number, className: string) => void) {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager, undefined, onClassRemoved);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Doomed';
  return ctl;
}

const warn = window.showWarningMessage as ReturnType<typeof vi.fn>;
const error = window.showErrorMessage as ReturnType<typeof vi.fn>;
const deleteClassMock = deleteClass as ReturnType<typeof vi.fn>;
const descendantsMock = getClassDescendantNames as ReturnType<typeof vi.fn>;
const writableMock = canClassBeWritten as ReturnType<typeof vi.fn>;

// A descendant now carries the dictionary that binds it (resolved by object identity
// in the query layer), so removeClass never has to guess by name.
const descendant = (className: string, dictIndex: number, dictName = 'UserGlobals') => ({
  className,
  parentName: 'Doomed',
  dictIndex,
  dictName,
});

beforeEach(() => {
  vi.clearAllMocks();
  writableMock.mockReturnValue(true);
  deleteClassMock.mockReturnValue('Deleted class: X');
  descendantsMock.mockReturnValue([]);
});

describe('ExplorerController.removeClass', () => {
  it('deletes a leaf class (no subclasses) dict-scoped after confirmation', async () => {
    const ctl = makeController();
    warn.mockResolvedValueOnce('Remove');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledTimes(1);
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Doomed');
    expect(ctl.state.className).toBeUndefined();
  });

  it('does not delete anything when the confirmation is dismissed', async () => {
    const ctl = makeController();
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
    expect(ctl.state.className).toBe('Doomed');
  });

  it('removes the whole subtree, deleting each member in its OWN dictionary', async () => {
    const ctl = makeController();
    // Sub2 lives in a different dictionary (index 3) than the root (index 1).
    descendantsMock.mockReturnValue([descendant('Sub1', 1), descendant('Sub2', 3, 'OtherDict')]);
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledTimes(3);
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Sub1');
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 3, 'Sub2');
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Doomed');
  });

  it('deletes a subclass in its own dictionary even when its name is shadowed elsewhere', async () => {
    const ctl = makeController();
    // The real subclass "Shadowed" lives in dict index 3; a different, unrelated class
    // of the same name lives in dict index 1. The query resolved by object identity,
    // so the descendant carries dictIndex 3 — deleteClass must target 3, not 1.
    descendantsMock.mockReturnValue([descendant('Shadowed', 3, 'OtherDict')]);
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 3, 'Shadowed');
    // Never the shadow in dict 1.
    expect(deleteClassMock).not.toHaveBeenCalledWith(expect.anything(), 1, 'Shadowed');
  });

  it('aborts (all-or-none) without deleting when a descendant cannot be located', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1), descendant('Lost', 0, '')]);

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('all-or-none'));
    // No confirmation was even offered — we can't deliver the removal.
    expect(warn).not.toHaveBeenCalled();
  });

  it('aborts (all-or-none) without deleting when a descendant is not writable', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1), descendant('Locked', 2, 'Kernel')]);
    // Root writable; the "Locked" descendant is not.
    writableMock.mockImplementation((_s: unknown, name: string) => name !== 'Locked');

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Locked'));
  });

  it('cancels the subtree removal when the all-or-none confirmation is dismissed', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1)]);
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
  });

  it('refuses to remove a root class that cannot be written in this repository', async () => {
    const ctl = makeController();
    writableMock.mockReturnValue(false);

    await ctl.removeClass();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot be modified'));
    expect(deleteClassMock).not.toHaveBeenCalled();
  });
});

// A removal is uncommitted, so nothing else announces it: without this hook a deleted class stayed
// listed — and clickable — in an open Omni Search until the next commit/abort. Fired per class rather
// than per command, because Remove Class takes the whole subtree. See PR #443 review (#428 Round 1).
describe('ExplorerController.removeClass — telling cached corpora what went', () => {
  it('reports a removed leaf class with its session', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);
    warn.mockResolvedValueOnce('Remove');

    await ctl.removeClass();

    expect(onClassRemoved).toHaveBeenCalledTimes(1);
    expect(onClassRemoved).toHaveBeenCalledWith(1, 'Doomed');
  });

  it('reports every member of a removed subtree, not just the root', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);
    descendantsMock.mockReturnValue([descendant('Kid', 1), descendant('GrandKid', 1)]);
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(onClassRemoved.mock.calls.map((c) => c[1])).toEqual(['Doomed', 'Kid', 'GrandKid']);
  });

  it('stays silent about a class the delete did not actually remove', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);
    descendantsMock.mockReturnValue([descendant('Kid', 1)]);
    warn.mockResolvedValueOnce('Remove All');
    // Root deletes; the subclass reports a failure — dropping it from the corpus would hide a class
    // that is still in the image.
    deleteClassMock
      .mockReturnValueOnce('Deleted class: Doomed')
      .mockReturnValueOnce('Error: could not delete Kid');

    await ctl.removeClass();

    expect(onClassRemoved).toHaveBeenCalledTimes(1);
    expect(onClassRemoved).toHaveBeenCalledWith(1, 'Doomed');
  });

  it('reports nothing when the confirmation is dismissed', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(onClassRemoved).not.toHaveBeenCalled();
  });
});

describe('removeClass records a revert (#434)', () => {
  /**
   * `deleteClass` only unbinds the name — the class version itself survives — so the very
   * same version can be bound again. That is only true while something still holds it, which
   * is why the capture has to happen BEFORE the removal, and why it stashes.
   */
  const bound = (oop: string) => ({ bound: true, oop, selectors: [] });
  const unbound = { bound: false, oop: null, selectors: [] };

  beforeEach(() => {
    resetUndoStacks();
    vi.mocked(captureClassSlots).mockReset();
  });

  it('captures and stashes before the class is removed', async () => {
    const order: string[] = [];
    vi.mocked(captureClassSlots).mockImplementation((_e, _slots, keys) => {
      order.push(keys ? 'capture-with-stash' : 'capture-plain');
      return keys ? [bound('1')] : [unbound];
    });
    deleteClassMock.mockImplementation(() => {
      order.push('delete');
      return 'Deleted class: Doomed';
    });
    warn.mockResolvedValue('Remove');

    await makeController().removeClass();

    expect(order[0]).toBe('capture-with-stash');
    expect(order[1]).toBe('delete');
  });

  it('records one entry naming the class, with its stash key', async () => {
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([bound('1')])
      .mockReturnValueOnce([unbound]);
    warn.mockResolvedValue('Remove');

    await makeController().removeClass();

    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'classEdit',
      label: 'Remove class Doomed',
      stashKeys: ['k1'],
    });
  });

  it('records the whole subtree as ONE entry', async () => {
    descendantsMock.mockReturnValue([descendant('Child', 1)]);
    vi.mocked(captureClassSlots)
      .mockReturnValueOnce([bound('1'), bound('2')])
      .mockReturnValueOnce([unbound, unbound]);
    warn.mockResolvedValue('Remove All');

    await makeController().removeClass();

    const entry = peekUndoEntry(1);
    expect(entry?.kind === 'classEdit' && entry.slots).toHaveLength(2);
    expect(entry?.label).toContain('2 classes');
  });

  it('records nothing when the removal was refused at the prompt', async () => {
    warn.mockResolvedValue(undefined);

    await makeController().removeClass();

    expect(captureClassSlots).not.toHaveBeenCalled();
    expect(peekUndoEntry(1)).toBeUndefined();
  });

  it('removes the class normally when the capture fails', async () => {
    // Recording must never be the reason a removal fails.
    vi.mocked(captureClassSlots).mockImplementation(() => {
      throw new Error('session busy');
    });
    warn.mockResolvedValue('Remove');

    await expect(makeController().removeClass()).resolves.toBeUndefined();
    expect(deleteClassMock).toHaveBeenCalled();
    expect(peekUndoEntry(1)).toBeUndefined();
  });
});
