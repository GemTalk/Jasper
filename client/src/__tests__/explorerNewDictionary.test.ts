import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what newDictionary touches.
vi.mock('../browserQueries', () => ({
  addDictionary: vi.fn(),
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Globals', 'Reports']),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's symbol-list read — mocked so the flow records without a stone (#434).
vi.mock('../undo/queries/dictionaryQueries', () => ({ captureDictionary: vi.fn() }));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { captureDictionary } from '../undo/queries/dictionaryQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undo/undoStack';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Creating a dictionary from the Explorer's "+" (#434).
 *
 * Recorded AFTER the fact, unlike almost everything else here: there is nothing to capture
 * before a dictionary exists, and the position it landed at is only knowable afterwards.
 * That position is what the entry carries, because a symbol list is ordered.
 */

// `null` means "no selected session" — passing `undefined` would trigger the default.
function makeController(session: ActiveSession | null = { id: 1 } as ActiveSession) {
  const sessionManager = {
    getSelectedSession: () => session ?? undefined,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  vi.spyOn(ctl, 'selectDict').mockImplementation(() => {});
  return ctl;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 3 });
  vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Globals', 'Reports']);
});

describe('ExplorerController.newDictionary', () => {
  it('records the create with the position the dictionary landed at', async () => {
    const ctl = makeController();
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('  Reports  ');

    await ctl.newDictionary();

    expect(queries.addDictionary).toHaveBeenCalledWith(expect.anything(), 'Reports');
    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'dictionaryEdit',
      label: 'Create dictionary Reports',
      // An absent `before` is what makes the reversal a removal rather than a restore.
      before: { present: false, name: 'Reports' },
      after: { present: true, name: 'Reports', index: 3 },
      // No stash: nothing is being held for a later reversal.
      stashKey: null,
    });
  });

  it('offers Undo on the notice, which is the affordance that gets used', async () => {
    const ctl = makeController();
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Reports');

    await ctl.newDictionary();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Added dictionary Reports'),
      'Undo',
    );
  });

  it('records nothing when the prompt is cancelled or empty', async () => {
    const ctl = makeController();
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await ctl.newDictionary();
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('   ');
    await ctl.newDictionary();

    expect(queries.addDictionary).not.toHaveBeenCalled();
    expect(undoStackDepth(1)).toBe(0);
  });

  it('records nothing when the dictionary did not appear on the symbol list', async () => {
    const ctl = makeController();
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Reports');
    vi.mocked(captureDictionary).mockReturnValue({ present: false, name: 'Reports', index: 0 });

    await ctl.newDictionary();

    expect(undoStackDepth(1)).toBe(0);
  });

  it('does nothing without a selected session', async () => {
    const ctl = makeController(null);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Reports');

    await ctl.newDictionary();

    expect(queries.addDictionary).not.toHaveBeenCalled();
  });
});
