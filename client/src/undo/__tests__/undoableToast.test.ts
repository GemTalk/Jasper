import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { notifyUndoable } from '../undoableToast';
import { UNDO_COMMAND } from '../undoUi';
import { UndoEntry } from '../undoTypes';

/**
 * The notice that follows an undoable action (#434).
 *
 * This is the affordance with no discovery cost — it is where the user is already looking.
 * What is pinned here is that the button appears only when something was actually recorded
 * (a dead Undo button is worse than none), and that the notice never makes the edit that
 * triggered it wait on the user's answer.
 */

const entry: UndoEntry = {
  id: 1,
  kind: 'methodEdit',
  sessionId: 1,
  label: 'Save Account>>#balance',
  slots: [],
  before: [],
  after: [],
};

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
});

describe('notifyUndoable', () => {
  it('offers Undo when the action recorded one', async () => {
    notifyUndoable('Compiled method Account>>#balance', entry);
    await settle();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Compiled method Account>>#balance',
      'Undo',
    );
  });

  it('runs the undo command when the button is pressed', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Undo' as never);
    notifyUndoable('Compiled method Account>>#balance', entry);
    await settle();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(UNDO_COMMAND);
  });

  it('shows a plain notice when nothing was recorded', async () => {
    notifyUndoable('Compiled method Account>>#balance', undefined);
    await settle();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Compiled method Account>>#balance',
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('does nothing when the toast is dismissed', async () => {
    notifyUndoable('Compiled method Account>>#balance', entry);
    await settle();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(UNDO_COMMAND);
  });

  it('returns while the toast is still unanswered', async () => {
    // The save must finish even if the toast sits there unanswered.
    vi.mocked(vscode.window.showInformationMessage).mockReturnValue(new Promise(() => {}) as never);
    expect(notifyUndoable('Compiled method Account>>#balance', entry)).toBeUndefined();
    await settle();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });
});
