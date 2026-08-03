import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what removeDictionary touches.
vi.mock('../browserQueries', () => ({ removeDictionary: vi.fn() }));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

// A DictItem-shaped node: removeDictionary reads only dictName + dictIndex.
const NODE = { dictName: 'UserGlobals', dictIndex: 3 } as never;

function makeController(session: ActiveSession | undefined) {
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  // reset() rebuilds the tree from a live session; stub it so we can assert it ran
  // without exercising the whole refresh/auto-select path.
  const reset = vi.spyOn(ctl, 'reset').mockImplementation(() => {});
  return { ctl, reset };
}

describe('ExplorerController.removeDictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when there is no selected session', async () => {
    const { ctl, reset } = makeController(undefined);

    await ctl.removeDictionary(NODE);

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(queries.removeDictionary).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('does not remove the dictionary when the user declines the confirm', async () => {
    const { ctl, reset } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    await ctl.removeDictionary(NODE);

    expect(queries.removeDictionary).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not reset when the query throws', async () => {
    const { ctl, reset } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);
    vi.mocked(queries.removeDictionary).mockImplementation(() => {
      throw new Error('boom');
    });

    await ctl.removeDictionary(NODE);

    expect(queries.removeDictionary).toHaveBeenCalledWith(expect.anything(), 3);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(reset).not.toHaveBeenCalled();
  });

  it('removes by index, then resets and reports on success', async () => {
    const { ctl, reset } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);
    vi.mocked(queries.removeDictionary).mockReturnValue('Removed dictionary: UserGlobals');

    await ctl.removeDictionary(NODE);

    expect(queries.removeDictionary).toHaveBeenCalledWith(expect.anything(), 3);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('UserGlobals'),
      expect.any(Number),
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});
