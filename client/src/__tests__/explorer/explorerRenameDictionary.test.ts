import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what renameDictionary touches.
vi.mock('../../browserQueries', () => ({
  renameDictionary: vi.fn(),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's symbol-list read — mocked so the flow records without a stone (#434).
vi.mock('../../undo/queries/dictionaryQueries', () => ({ captureDictionary: vi.fn() }));
// Keep the real filesystem-provider exports, but make the two the tab sweep uses
// (listOpenGemstoneTabs + parseUri) overridable so the sweep can be driven with
// synthetic tabs. They default to the real implementations, so other tests are
// unaffected; the sweep test overrides them.
vi.mock('../../gemstoneFileSystemProvider', async (importActual) => {
  const actual = await importActual<typeof import('../../gemstoneFileSystemProvider')>();
  return {
    ...actual,
    listOpenGemstoneTabs: vi.fn(actual.listOpenGemstoneTabs),
    parseUri: vi.fn(actual.parseUri),
  };
});

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { captureDictionary } from '../../undo/queries/dictionaryQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../../undo/undoStack';
import { listOpenGemstoneTabs, parseUri } from '../../gemstoneFileSystemProvider';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

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
    resetUndoStacks();
    vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'MyDict', index: 3 });
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
    // A notice rather than a status-bar message, because this one carries Undo (#434).
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('NewDict'),
      'Undo',
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('records the rename, so undo renames it back', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('NewDict');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Rename' as never);
    vi.mocked(queries.renameDictionary).mockReturnValue('ok');

    await ctl.renameDictionary(NODE);

    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'dictionaryEdit',
      label: 'Rename dictionary MyDict to NewDict',
      before: { present: true, name: 'MyDict' },
      after: { present: true, name: 'NewDict' },
      // No stash: the dictionary never left the symbol list, so the reversal finds it by
      // its new name.
      stashKey: null,
    });
  });

  it('records nothing when the stone refused the rename', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Globals');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Rename' as never);
    vi.mocked(queries.renameDictionary).mockReturnValue(
      'Cannot rename a system dictionary (Globals, Published, or UserGlobals)',
    );

    await ctl.renameDictionary(NODE);

    expect(undoStackDepth(1)).toBe(0);
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

// The success-path tests above spy `closeStaleTabsForRenamedDictionary` out entirely,
// so the MED-1 sweep itself (session/dirty/parse filtering) had no coverage — the one
// place a rename can silently close someone's open editor. Drive it directly here.
describe('ExplorerController.closeStaleTabsForRenamedDictionary (sweep)', () => {
  const SESSION = { id: 7 } as unknown as ActiveSession;

  // A synthetic gemstone tab: the sweep reads only tab.isDirty and, via parseUri,
  // the uri's { sessionId, dictName }. `parsed: 'throw'` makes parseUri raise.
  function tab(isDirty: boolean, parsed: { sessionId: number; dictName: string } | 'throw') {
    return { tab: { isDirty }, uri: { parsed } };
  }

  function sweepController() {
    const sessionManager = { getSelectedSession: () => undefined } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager);
    return ctl as unknown as {
      closeStaleTabsForRenamedDictionary: (s: ActiveSession, oldName: string) => Promise<void>;
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseUri).mockImplementation((u: unknown) => {
      const p = (u as { parsed: { sessionId: number; dictName: string } | 'throw' }).parsed;
      if (p === 'throw') throw new Error('unparseable uri');
      return p as never;
    });
  });

  it('closes clean matching tabs, leaves dirty ones open, and skips other sessions / unparseable uris', async () => {
    const cleanMatch = tab(false, { sessionId: 7, dictName: 'MyDict' });
    const dirtyMatch = tab(true, { sessionId: 7, dictName: 'MyDict' });
    const otherSession = tab(false, { sessionId: 99, dictName: 'MyDict' });
    const otherDict = tab(false, { sessionId: 7, dictName: 'Other' });
    const unparseable = tab(false, 'throw');
    vi.mocked(listOpenGemstoneTabs).mockReturnValue([
      cleanMatch,
      dirtyMatch,
      otherSession,
      otherDict,
      unparseable,
    ] as never);

    await sweepController().closeStaleTabsForRenamedDictionary(SESSION, 'MyDict');

    // Only the clean, same-session, same-name tab is closed.
    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(cleanMatch.tab);
    // The dirty match is left open but warned about (singular).
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('MyDict'),
    );
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('1 unsaved editor'),
    );
  });

  it('closes all clean matches and warns in the plural when several dirty tabs remain', async () => {
    vi.mocked(listOpenGemstoneTabs).mockReturnValue([
      tab(false, { sessionId: 7, dictName: 'MyDict' }),
      tab(false, { sessionId: 7, dictName: 'MyDict' }),
      tab(true, { sessionId: 7, dictName: 'MyDict' }),
      tab(true, { sessionId: 7, dictName: 'MyDict' }),
    ] as never);

    await sweepController().closeStaleTabsForRenamedDictionary(SESSION, 'MyDict');

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(2);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 unsaved editors'),
    );
  });

  it('closes nothing and does not warn when no tab references the old name', async () => {
    vi.mocked(listOpenGemstoneTabs).mockReturnValue([
      tab(false, { sessionId: 7, dictName: 'Other' }),
      tab(false, { sessionId: 99, dictName: 'MyDict' }),
    ] as never);

    await sweepController().closeStaleTabsForRenamedDictionary(SESSION, 'MyDict');

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
