import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what renameDictionary touches.
vi.mock('../browserQueries', () => ({ renameDictionary: vi.fn() }));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

// A DictItem-shaped node: renameDictionary reads only dictName + dictIndex.
const NODE = { dictName: 'MyDict', dictIndex: 3 } as never;

function makeController(session: ActiveSession | undefined) {
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  // selectDict / refreshRetainingSelection fan out into many queries against a live
  // session, and the tab sweep touches the tab API; stub them so the success path can
  // be asserted without that machinery.
  const selectDict = vi.spyOn(ctl, 'selectDict').mockImplementation(() => {});
  const refreshRetaining = vi.spyOn(ctl, 'refreshRetainingSelection').mockResolvedValue(undefined);
  const closeStaleTabs = vi
    .spyOn(
      ctl as unknown as { closeStaleTabsForRenamedDictionary: () => Promise<void> },
      'closeStaleTabsForRenamedDictionary',
    )
    .mockResolvedValue(undefined);
  const refresh = vi.spyOn(ctl.dictProvider, 'refresh').mockImplementation(() => {});
  return { ctl, selectDict, refreshRetaining, closeStaleTabs, refresh };
}

describe('ExplorerController.renameDictionary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when there is no selected session', async () => {
    const { ctl, selectDict } = makeController(undefined);
    await ctl.renameDictionary(NODE);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(queries.renameDictionary).not.toHaveBeenCalled();
    expect(selectDict).not.toHaveBeenCalled();
  });

  it('does nothing when the name prompt is cancelled', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await ctl.renameDictionary(NODE);
    expect(queries.renameDictionary).not.toHaveBeenCalled();
  });

  it('does nothing when the name is unchanged', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('MyDict');
    await ctl.renameDictionary(NODE);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(queries.renameDictionary).not.toHaveBeenCalled();
  });

  it('does not rename when the user declines the confirm', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('NewDict');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    await ctl.renameDictionary(NODE);
    expect(queries.renameDictionary).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not refresh when the query throws', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('NewDict');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Rename' as never);
    vi.mocked(queries.renameDictionary).mockImplementation(() => {
      throw new Error('boom');
    });
    await ctl.renameDictionary(NODE);
    expect(queries.renameDictionary).toHaveBeenCalledWith(expect.anything(), 3, 'NewDict');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces a server-side refusal (non-ok result) and does not refresh', async () => {
    const { ctl, refresh, selectDict } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Globals');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Rename' as never);
    vi.mocked(queries.renameDictionary).mockReturnValue(
      'Cannot rename a system dictionary (Globals, Published, or UserGlobals)',
    );
    await ctl.renameDictionary(NODE);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('system dictionary'),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(selectDict).not.toHaveBeenCalled();
  });

  it('renames by index, sweeps stale tabs, refreshes and reports on success', async () => {
    const { ctl, refresh, selectDict, closeStaleTabs } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('NewDict');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Rename' as never);
    vi.mocked(queries.renameDictionary).mockReturnValue('ok');
    await ctl.renameDictionary(NODE);
    expect(queries.renameDictionary).toHaveBeenCalledWith(expect.anything(), 3, 'NewDict');
    // Stale editor tabs for the old name are swept (MED-1).
    expect(closeStaleTabs).toHaveBeenCalledWith(expect.anything(), 'MyDict');
    expect(refresh).toHaveBeenCalledTimes(1);
    // No longer resets the selection via selectDict (LOW-5).
    expect(selectDict).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('NewDict'),
      expect.any(Number),
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('retains the class/method selection when renaming the currently-selected dictionary (LOW-5)', async () => {
    const { ctl, selectDict, refreshRetaining } = makeController({} as ActiveSession);
    // The node being renamed IS the dictionary the user is browsing.
    ctl.state.dictIndex = 3;
    ctl.state.dictName = 'MyDict';
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('NewDict');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Rename' as never);
    vi.mocked(queries.renameDictionary).mockReturnValue('ok');

    await ctl.renameDictionary(NODE);

    // Keeps the place via refreshRetainingSelection, not selectDict, and the state
    // now carries the new name (same index).
    expect(refreshRetaining).toHaveBeenCalledTimes(1);
    expect(selectDict).not.toHaveBeenCalled();
    expect(ctl.state.dictName).toBe('NewDict');
    expect(ctl.state.dictIndex).toBe(3);
  });
});
