import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../refactoringUndoAvailability', () => ({
  checkRefactoringUndoAvailable: vi.fn(),
  warnUndoUnsupported: vi.fn(),
}));

import * as vscode from 'vscode';
import { checkRefactoringUndoAvailable, warnUndoUnsupported } from '../refactoringUndoAvailability';
import { notifyRefactoringApplied } from '../refactoringAppliedToast';
import { UNDO_COMMAND } from '../../undo/undoUi';
import { REFACTORING_APPLIED_COMMAND } from '../refactoringAppliedEvent';
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
const status = (available: boolean, supported = true) => ({
  available,
  supported,
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

/**
 * Telling the rest of the UI that a refactoring landed.
 *
 * An open method-history panel refreshes itself after a Save and must do the same after a
 * refactoring: the method changed either way, and needing to close and reopen the panel to see the
 * new version makes the history look unreliable. This notice is the one place every refactoring
 * ends, so it is the one place that can say so — whether or not an undo was recorded, since the two
 * are unrelated.
 */
describe('notifyRefactoringApplied — announcing the change to the UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUndoStacks();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  });

  it('announces the apply when an undo WAS recorded', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));

    notifyRefactoringApplied(session, 'Renamed.');
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(REFACTORING_APPLIED_COMMAND, 7);
  });

  it('announces it just the same when NO undo was recorded', async () => {
    // A stone whose engine records no undo still recompiled methods, so the panel is still stale.
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));

    notifyRefactoringApplied(session, 'Renamed.');
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(REFACTORING_APPLIED_COMMAND, 7);
  });

  it('carries the session id, so only that session’s panels re-fetch', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));

    notifyRefactoringApplied({ id: 42 } as ActiveSession, 'Renamed.');
    await settle();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(REFACTORING_APPLIED_COMMAND, 42);
  });

  it('says nothing when there is no session to name', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));

    notifyRefactoringApplied(undefined, 'Renamed.');
    await settle();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      REFACTORING_APPLIED_COMMAND,
      expect.anything(),
    );
  });

  it('does not fail the refactoring when nothing is listening', async () => {
    // No Explorer registered — the command is unknown and rejects. A redraw must never take the
    // refactoring down with it.
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('command not found'));

    expect(() => notifyRefactoringApplied(session, 'Renamed.')).not.toThrow();
    await settle();

    expect(vscode.window.setStatusBarMessage).toHaveBeenCalled();
  });
});

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

  it("says so when the stone's engine cannot record an undo at all", async () => {
    // An engine installed before the undo work applies every refactoring and records none, so
    // the quiet notice is identical to the one a recorded-nothing refactoring gets — and the
    // user is left with a feature that silently never works (review of #507).
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false, false));

    notifyRefactoringApplied(session, 'Renamed it.', 'toast');
    await settle();

    expect(warnUndoUnsupported).toHaveBeenCalledWith(session);
  });

  it('stays quiet when the engine has undo and this refactoring recorded none', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));

    notifyRefactoringApplied(session, 'Extracted #answer.');
    await settle();

    expect(warnUndoUnsupported).not.toHaveBeenCalled();
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
