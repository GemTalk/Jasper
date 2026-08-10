import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', async (orig) => ({
  ...(await orig()),
  canClassBeWritten: vi.fn(() => true),
  getClassDescendantNames: vi.fn(() => []),
  getClassesWithCategory: vi.fn(() => []),
  deleteClass: vi.fn(() => 'Deleted class: X'),
}));

import { window } from '../__mocks__/vscode';
import { ExplorerController } from '../gemstoneExplorer';
import { canClassBeWritten, getClassDescendantNames, deleteClass } from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
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
