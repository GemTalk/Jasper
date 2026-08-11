import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller module pulls in browserQueries (→ native GCI). Only the calls this
// flow makes before the (mocked) preview panel need to answer.
vi.mock('../browserQueries', () => ({
  getMethodSource: vi.fn(() => ''),
  startRenameMethodPreview: vi.fn(() => Promise.resolve('{"token":"t1","total":3}')),
  clearRenameMethodPreview: vi.fn(),
}));
vi.mock('../refactoring/renameMethodEditor', () => ({ showRenameMethodEditor: vi.fn() }));
vi.mock('../refactoring/renameMethodPanel', () => ({ showRenameMethodPanel: vi.fn() }));
// Hoisted so the (hoisted) vi.mock factory below can close over it without a TDZ error.
const { gciChannel } = vi.hoisted(() => ({
  gciChannel: { show: vi.fn(), appendLine: vi.fn() },
}));
vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => gciChannel),
  _resetGciLogForTests: vi.fn(),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import { showRenameMethodEditor } from '../refactoring/renameMethodEditor';
import { showRenameMethodPanel } from '../refactoring/renameMethodPanel';
import { logInfo } from '../gciLog';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Pins the WIRING between a rename apply that reports un-recompilable methods and the
 * persistent "GemStone GCI" output channel: the toast can name only the first failure
 * and then vanishes, so the full set must reach the durable log. `formatRenameFailureLog`
 * is unit-tested on its own (renameFailureLog.test.ts); this drives the rename-method
 * call site end to end so the wiring — and the action label that says WHICH rename the
 * block belongs to — cannot be dropped unnoticed.
 */
function makeController(): ExplorerController {
  const session = { rbSupportAvailable: true } as unknown as ActiveSession;
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  // Post-apply refreshes want a live tree/stone; neither is under test here.
  vi.spyOn(ctl, 'reloadCurrentClassMethods').mockImplementation(() => {});
  vi.spyOn(
    ctl as unknown as {
      refreshRenamedSelectorEditors: (o: string, n: string) => Promise<void>;
    },
    'refreshRenamedSelectorEditors',
  ).mockResolvedValue();
  return ctl;
}

/** The user renames `area` → `size` (no argument reorder), in class scope. */
function editReturns(): void {
  vi.mocked(showRenameMethodEditor).mockResolvedValue({
    parts: ['size'],
    originalIndices: [],
    scope: { kind: 'class' },
  });
}

function applyReturns(failed: { id: string; label: string; error: string }[]): void {
  vi.mocked(showRenameMethodPanel).mockResolvedValue({
    applied: 2,
    failed,
    error: undefined,
  });
}

const renameMethod = (ctl: ExplorerController): Promise<boolean> =>
  ctl.renameMethodNamed('Account', 'area', false, 1, 'UserGlobals');

beforeEach(() => {
  vi.clearAllMocks();
  editReturns();
  // The failure toast carries a button, so it awaits the user's choice; default to
  // dismissing it. Tests that exercise the button override this.
  vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
});

describe('a rename that leaves methods un-recompiled logs them all', () => {
  it('writes every failure to the GCI channel, not just the one the toast names', async () => {
    applyReturns([
      { id: 'a', label: 'Account>>balance', error: 'undeclared variable' },
      { id: 'b', label: 'Account>>deposit:', error: 'parse error' },
      { id: 'c', label: 'Account class>>new', error: 'undeclared variable' },
    ]);

    const applied = await renameMethod(makeController());

    expect(applied).toBe(true);
    expect(vi.mocked(logInfo)).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(logInfo).mock.calls[0][0]);
    expect(logged).toContain('Account>>balance: undeclared variable');
    expect(logged).toContain('Account>>deposit:: parse error');
    expect(logged).toContain('Account class>>new: undeclared variable');
    // The toast names only the first and offers a button for the rest.
    const [toast, ...actions] = vi.mocked(vscode.window.showErrorMessage).mock.calls[0];
    expect(String(toast)).toContain('Account>>balance');
    expect(String(toast)).toContain('(+2 more)');
    expect(actions).toEqual(['Show Details']);
  });

  it('reveals the channel when the user presses the toast button', async () => {
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(
      'Show Details' as unknown as undefined,
    );
    applyReturns([{ id: 'a', label: 'Account>>balance', error: 'undeclared variable' }]);

    await renameMethod(makeController());
    // The toast's `.then` settles on a microtask, after renameMethodNamed returns.
    await Promise.resolve();

    expect(gciChannel.show).toHaveBeenCalledWith(true);
  });

  it('leaves the channel alone when the user dismisses the toast', async () => {
    applyReturns([{ id: 'a', label: 'Account>>balance', error: 'undeclared variable' }]);

    await renameMethod(makeController());
    await Promise.resolve();

    expect(gciChannel.show).not.toHaveBeenCalled();
  });

  it('labels the block with the rename it belongs to, so a shared channel stays readable', async () => {
    applyReturns([{ id: 'a', label: 'Account>>balance', error: 'undeclared variable' }]);

    await renameMethod(makeController());

    expect(String(vi.mocked(logInfo).mock.calls[0][0])).toContain("Rename method 'area' → 'size'");
  });

  it('logs nothing when every method recompiled', async () => {
    applyReturns([]);

    const applied = await renameMethod(makeController());

    expect(applied).toBe(true);
    expect(vi.mocked(logInfo)).not.toHaveBeenCalled();
  });
});
