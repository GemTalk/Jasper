import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what the drop path touches.
vi.mock('../browserQueries', () => ({
  recategorizeMethod: vi.fn(() => 'ok'),
  getClassEnvironments: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Dropping methods on a method category.
 *
 * The case with teeth is a target category that exists only in the CLIENT overlay — the
 * Explorer's "+ new category" leaves the stone untouched until something is filed there, so
 * the drop is what makes it real. The controller does not special-case that: the query
 * creates the category when it is missing, so the drop looks the same either way. What the
 * controller must get right is which methods it moves, and that a refused move is reported
 * rather than swallowed.
 */

const payload = (selector: string, category: string, isMeta = false) => ({
  selector,
  isMeta,
  category,
  className: 'UndoDemoAccount2',
  dictName: 'UserGlobals',
  dictIndex: 3,
});

// `null` means "no selected session" — passing `undefined` would trigger the default.
function makeController(session: ActiveSession | null = { id: 1 } as ActiveSession) {
  const sessionManager = {
    getSelectedSession: () => session ?? undefined,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const reload = vi
    .spyOn(ctl as unknown as { reloadIfCurrent: () => void }, 'reloadIfCurrent')
    .mockImplementation(() => {});
  return { ctl, reload };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.recategorizeMethod).mockReturnValue('ok');
});

describe('ExplorerController.dragMoveToCategory', () => {
  it('moves the method into a category that exists only in the client overlay', async () => {
    // `accessing` here is a "+"-button category with no server existence — the exact shape
    // that used to answer classErrMethCatNotFound.
    const { ctl, reload } = makeController();

    await ctl.dragMoveToCategory([payload('udBalanceValue', 'accessing-renamed')], 'accessing');

    expect(queries.recategorizeMethod).toHaveBeenCalledWith(
      expect.anything(),
      'UndoDemoAccount2',
      false,
      'udBalanceValue',
      'accessing',
      3,
    );
    expect(reload).toHaveBeenCalledWith('UndoDemoAccount2', 3);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Moved #udBalanceValue to 'accessing'"),
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('moves several at once and says how many', async () => {
    const { ctl } = makeController();

    await ctl.dragMoveToCategory(
      [payload('one', 'computing'), payload('two', 'printing')],
      'accessing',
    );

    expect(queries.recategorizeMethod).toHaveBeenCalledTimes(2);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Moved 2 methods to 'accessing'"),
    );
  });

  it('skips a method already in the target category', async () => {
    const { ctl, reload } = makeController();

    await ctl.dragMoveToCategory([payload('one', 'accessing')], 'accessing');

    expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the class side on the class side', async () => {
    const { ctl } = makeController();

    await ctl.dragMoveToCategory([payload('make', 'instance creation', true)], 'building');

    expect(queries.recategorizeMethod).toHaveBeenCalledWith(
      expect.anything(),
      'UndoDemoAccount2',
      true,
      'make',
      'building',
      3,
    );
  });

  it('reports a move the stone refused, and does not claim success', async () => {
    const { ctl, reload } = makeController();
    vi.mocked(queries.recategorizeMethod).mockImplementation(() => {
      throw new Error('classErrMethCatNotFound');
    });

    await ctl.dragMoveToCategory([payload('one', 'computing')], 'accessing');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('classErrMethCatNotFound'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing without a selected session', async () => {
    const { ctl } = makeController(null);

    await ctl.dragMoveToCategory([payload('one', 'computing')], 'accessing');

    expect(queries.recategorizeMethod).not.toHaveBeenCalled();
  });
});
