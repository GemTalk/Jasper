import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what removeDictionary touches.
vi.mock('../../browserQueries', () => ({
  removeDictionary: vi.fn(),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's symbol-list read — mocked so the flow records without a stone (#434).
vi.mock('../../undo/queries/dictionaryQueries', () => ({ captureDictionary: vi.fn() }));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { captureDictionary } from '../../undo/queries/dictionaryQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../../undo/undoStack';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

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
    resetUndoStacks();
    vi.mocked(captureDictionary).mockReturnValue({
      present: true,
      name: 'UserGlobals',
      index: 3,
    });
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
    // A notice rather than a status-bar message, because this one carries Undo (#434).
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('UserGlobals'),
      'Undo',
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('records the dictionary and its POSITION, so undo puts it back where it was', async () => {
    // A symbol list is ordered and name resolution walks it in order: putting the
    // dictionary back on the end would silently change what a bare name resolves to.
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);
    vi.mocked(queries.removeDictionary).mockReturnValue('Removed dictionary: UserGlobals');

    await ctl.removeDictionary(NODE);

    const entry = peekUndoEntry(1);
    expect(entry).toMatchObject({
      kind: 'dictionaryEdit',
      label: 'Remove dictionary UserGlobals',
      before: { present: true, name: 'UserGlobals', index: 3 },
      after: { present: false },
    });
    // The dictionary itself is pinned in SessionTemps -- unlisting does not destroy it, but
    // nothing else references it once it is off the list.
    expect(entry?.kind === 'dictionaryEdit' && entry.stashKey).not.toBeNull();
    expect(vi.mocked(captureDictionary).mock.calls[0][2]).toBe(
      entry?.kind === 'dictionaryEdit' ? entry.stashKey : undefined,
    );
  });

  it('records nothing when the removal itself failed', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);
    vi.mocked(queries.removeDictionary).mockImplementation(() => {
      throw new Error('boom');
    });

    await ctl.removeDictionary(NODE);

    expect(undoStackDepth(1)).toBe(0);
  });
});
