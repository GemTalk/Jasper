import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', async (orig) => ({
  ...(await orig()),
  canClassBeWritten: vi.fn(() => true),
  getClassDescendantNames: vi.fn(() => []),
  getAllClassNames: vi.fn(() => []),
  getClassesWithCategory: vi.fn(() => []),
  deleteClass: vi.fn(() => 'Deleted class: X'),
}));

import { window } from '../__mocks__/vscode';
import { ExplorerController } from '../gemstoneExplorer';
import {
  canClassBeWritten,
  getClassDescendantNames,
  getAllClassNames,
  deleteClass,
} from '../browserQueries';
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
const deleteClassMock = deleteClass as ReturnType<typeof vi.fn>;
const descendantsMock = getClassDescendantNames as ReturnType<typeof vi.fn>;
const allClassesMock = getAllClassNames as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  (canClassBeWritten as ReturnType<typeof vi.fn>).mockReturnValue(true);
  deleteClassMock.mockReturnValue('Deleted class: X');
  descendantsMock.mockReturnValue([]);
  allClassesMock.mockReturnValue([]);
});

describe('ExplorerController.removeClass', () => {
  it('deletes a leaf class (no subclasses) dict-scoped after confirmation', async () => {
    const ctl = makeController();
    warn.mockResolvedValueOnce('Remove');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledTimes(1);
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Doomed');
    // The removed class is dropped from selection.
    expect(ctl.state.className).toBeUndefined();
  });

  it('does not delete anything when the confirmation is dismissed', async () => {
    const ctl = makeController();
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
    expect(ctl.state.className).toBe('Doomed');
  });

  it('removes the whole subtree (all-or-none) when the class has subclasses', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([
      { className: 'Sub1', parentName: 'Doomed' },
      { className: 'Sub2', parentName: 'Sub1' },
    ]);
    // Sub2 lives in a different dictionary — each descendant deletes dict-scoped.
    allClassesMock.mockReturnValue([
      { className: 'Sub1', dictName: 'UserGlobals', dictIndex: 1 },
      { className: 'Sub2', dictName: 'OtherDict', dictIndex: 3 },
      { className: 'Doomed', dictName: 'UserGlobals', dictIndex: 1 },
    ]);
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledTimes(3);
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Sub1');
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 3, 'Sub2');
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Doomed');
  });

  it('cancels the subtree removal when the all-or-none confirmation is dismissed', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([{ className: 'Sub1', parentName: 'Doomed' }]);
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
  });

  it('refuses to remove a class that cannot be written in this repository', async () => {
    const ctl = makeController();
    (canClassBeWritten as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await ctl.removeClass();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot be modified'));
    expect(deleteClassMock).not.toHaveBeenCalled();
  });
});
