import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../undo/recordMethodEdit', () => ({ readMethodSlotState: vi.fn() }));
vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
}));

import * as vscode from 'vscode';
import { resyncEditorsAfterAbort } from '../afterAbort';
import { openMethodSlots } from '../undo/afterUndo';
import { readMethodSlotState } from '../undo/recordMethodEdit';
import type { ActiveSession } from '../sessionManager';
import type { MethodSlotState } from '../undo/undoTypes';

/**
 * An abort discards everything uncommitted, and until now left every open editor
 * pointing at what it threw away — a tab still editable over a method the stone
 * no longer has, whose next save would compile the method straight back into the
 * transaction the abort abandoned.
 *
 * The abort cannot say what it discarded, so the open tabs are probed against the
 * stone. What is asserted here is that split: survivors are re-read, the gone are
 * closed, and a probe that fails closes nothing.
 */
const SESSION = { id: 1 } as ActiveSession;
const BALANCE = 'gemstone://1/Globals/Account/instance/accessing/balance';
const TOTAL = 'gemstone://1/Globals/Account/instance/accessing/total';

function methodTab(uri: string, isDirty = false) {
  return { input: new vscode.TabInputText(vscode.Uri.parse(uri)), isDirty };
}

function openTabs(...tabs: { input: unknown; isDirty?: boolean }[]) {
  Object.defineProperty(vscode.window.tabGroups, 'all', {
    value: [{ viewColumn: 1, tabs }],
    writable: true,
  });
}

const present = (): MethodSlotState => ({ exists: true, source: 'balance\n  ^ 1', category: 'a' });
const absent = (): MethodSlotState => ({ exists: false, source: null, category: null });

beforeEach(() => {
  vi.clearAllMocks();
  openTabs();
  Object.defineProperty(vscode.workspace, 'textDocuments', { value: [], writable: true });
  Object.defineProperty(vscode.window, 'visibleTextEditors', { value: [], writable: true });
  Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, writable: true });
  vi.mocked(vscode.window.tabGroups.close).mockResolvedValue(true);
  vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
});

describe('openMethodSlots', () => {
  it('reports the methods open for the session', () => {
    openTabs(methodTab(BALANCE));

    expect(openMethodSlots(1)).toEqual([
      {
        dict: 'Globals',
        className: 'Account',
        isMeta: false,
        selector: 'balance',
        environmentId: 0,
      },
    ]);
  });

  it("leaves another session's tabs out", () => {
    openTabs(methodTab('gemstone://2/Globals/Account/instance/accessing/balance'));

    expect(openMethodSlots(1)).toEqual([]);
  });

  // What the user has typed is not ours to discard, so a dirty tab is neither
  // probed nor closed.
  it('leaves dirty tabs out', () => {
    openTabs(methodTab(BALANCE, true));

    expect(openMethodSlots(1)).toEqual([]);
  });

  it('ignores tabs that are not method editors', () => {
    openTabs(methodTab('gemstone://1/Globals/Account/definition'), methodTab('file:///a.st'));

    expect(openMethodSlots(1)).toEqual([]);
  });
});

describe('resyncEditorsAfterAbort', () => {
  it('closes the tab over a method the abort discarded', async () => {
    const gone = methodTab(BALANCE);
    openTabs(gone);
    vi.mocked(readMethodSlotState).mockReturnValue([absent()]);

    await resyncEditorsAfterAbort(SESSION);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(gone);
  });

  it('keeps the tab over a method that survived', async () => {
    openTabs(methodTab(BALANCE));
    vi.mocked(readMethodSlotState).mockReturnValue([present()]);

    await resyncEditorsAfterAbort(SESSION);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('closes only the methods that went', async () => {
    const gone = methodTab(BALANCE);
    const kept = methodTab(TOTAL);
    openTabs(gone, kept);
    vi.mocked(readMethodSlotState).mockReturnValue([absent(), present()]);

    await resyncEditorsAfterAbort(SESSION);

    expect(vscode.window.tabGroups.close).toHaveBeenCalledTimes(1);
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(gone);
  });

  /**
   * An abort rewinds a surviving method over GCI without going through the file
   * system provider, so VS Code has no reason to believe the source it is showing
   * is stale. The notification is the same one a save sends.
   */
  it('re-reads the editors that are still valid', async () => {
    openTabs(methodTab(BALANCE));
    Object.defineProperty(vscode.workspace, 'textDocuments', {
      value: [{ uri: { scheme: 'gemstone', toString: () => BALANCE }, isDirty: false }],
      writable: true,
    });
    vi.mocked(readMethodSlotState).mockReturnValue([present()]);

    await resyncEditorsAfterAbort(SESSION);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.fs.notifyChanged',
      expect.arrayContaining([expect.objectContaining({ scheme: 'gemstone' })]),
    );
  });

  // A stale tab beats a tab closed over a method that is really still there.
  it('closes nothing when the stone could not be asked', async () => {
    openTabs(methodTab(BALANCE));
    vi.mocked(readMethodSlotState).mockReturnValue(undefined);

    await resyncEditorsAfterAbort(SESSION);

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled();
  });

  it('asks the stone nothing when no method editor is open', async () => {
    await resyncEditorsAfterAbort(SESSION);

    expect(readMethodSlotState).not.toHaveBeenCalled();
  });

  it('still re-reads the editors when nothing was closed', async () => {
    openTabs(methodTab(BALANCE));
    vi.mocked(readMethodSlotState).mockReturnValue(undefined);
    Object.defineProperty(vscode.workspace, 'textDocuments', {
      value: [{ uri: { scheme: 'gemstone', toString: () => BALANCE }, isDirty: false }],
      writable: true,
    });

    await resyncEditorsAfterAbort(SESSION);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.fs.notifyChanged',
      expect.anything(),
    );
  });
});
