import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../refactoringUndoAvailability', () => ({
  checkRefactoringUndoAvailable: vi.fn(),
}));

import * as vscode from 'vscode';
import { checkRefactoringUndoAvailable } from '../refactoringUndoAvailability';
import { notifyRefactoringApplied } from '../refactoringAppliedToast';
import { UNDO_COMMAND } from '../../undo/undoUi';
import { peekUndoEntry, resetUndoStacks } from '../../undo/undoStack';
import type { ActiveSession } from '../../sessionManager';

/**
 * The shared post-apply notice (#434). This is where an applied refactoring joins Jasper's
 * undo stack, and the first of the four ways to reach an undo, so what is pinned here is
 * that the entry and the Undo button appear exactly when the stone actually recorded
 * something to undo — and that a stone which recorded nothing keeps the quiet notice the
 * refactorings had before, rather than growing a dead button.
 */

const session = { id: 7 } as ActiveSession;
const status = (available: boolean) => ({
  available,
  label: 'Rename #total to #sum',
  engine: 'GsRenameMethodRefactoring',
  mechanism: 'changeSet' as const,
  reverseKind: null,
  sequence: 1,
  total: 2,
});

// The notice is deliberately fire-and-forget (a toast resolves only when the user
// dismisses it, and the refactoring must not stay "running" until then), so tests
// let the microtask queue drain before asserting.
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('notifyRefactoringApplied', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUndoStacks();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  });

  it('offers Undo on the toast when the stone recorded one', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));

    notifyRefactoringApplied(session, 'Renamed it.');
    await settle();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Renamed it.', 'Undo');
  });

  it('runs the undo command when the button is pressed', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Undo' as never);

    notifyRefactoringApplied(session, 'Renamed it.');
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(UNDO_COMMAND);
  });

  it('does nothing when the toast is dismissed', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    notifyRefactoringApplied(session, 'Renamed it.');
    await settle();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(UNDO_COMMAND);
  });

  it('falls back to the quiet status-bar notice when nothing was recorded', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));

    notifyRefactoringApplied(session, 'Extracted #answer.');
    await settle();

    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith('Extracted #answer.', 4000);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('falls back to a plain toast for the refactorings that ask for one', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));

    notifyRefactoringApplied(session, 'Moved 2 methods.', 'toast');
    await settle();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Moved 2 methods.');
    expect(vscode.window.setStatusBarMessage).not.toHaveBeenCalled();
  });

  it('puts the refactoring on the undo stack, carrying the stone sequence', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));

    notifyRefactoringApplied(session, 'Renamed it.');
    await settle();

    const entry = peekUndoEntry(session.id);
    expect(entry).toMatchObject({
      kind: 'refactoring',
      label: 'Rename #total to #sum',
      // The pointer back to the stone's record, so a stale entry can be recognised later.
      sequence: 1,
    });
  });

  it('records nothing when the stone recorded nothing', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));

    notifyRefactoringApplied(session, 'Extracted #answer.');
    await settle();

    expect(peekUndoEntry(session.id)).toBeUndefined();
  });

  it('returns while the toast is still unanswered', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));
    // A toast nobody answers: showInformationMessage never settles.
    vi.mocked(vscode.window.showInformationMessage).mockReturnValue(new Promise(() => {}) as never);

    // Returning void rather than a promise is the whole point: the refactoring command
    // must finish even if the toast sits there.
    expect(notifyRefactoringApplied(session, 'Renamed it.')).toBeUndefined();
    await settle();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(UNDO_COMMAND);
  });
});
