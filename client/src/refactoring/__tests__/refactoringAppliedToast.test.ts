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
import { peekUndoEntry, resetUndoStacks } from '../../undo/undoStack';
import type { ActiveSession } from '../../sessionManager';
import {
  _resetAutoCommitStateForTests,
  registerSessionAutoCommit,
  setAutoCommitStatus,
} from '../../autoCommit/autoCommitState';
import { setAutoCommitFailureHandler } from '../../autoCommit/autoCommitRunner';

/**
 * The shared post-apply notice (#434). This is where an applied refactoring joins Jasper's
 * undo stack, and the first of the four ways to reach an undo, so what is pinned here is
 * that the entry and the Undo button appear exactly when the stone actually recorded
 * something to undo — and that a stone which recorded nothing keeps the quiet notice the
 * refactorings had before, rather than growing a dead button.
 */

const OK = { success: true, err: { number: 0, message: '' } };

// A session that can be asked to commit, so the auto-commit tests below can see whether the
// notice actually did. The other tests here never arm it, so `GciTsCommit` goes uncalled.
let commit = vi.fn(() => OK);
const makeSession = (id = 7): ActiveSession =>
  ({ id, gci: { GciTsCommit: commit }, handle: {} }) as unknown as ActiveSession;
const session = makeSession();
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

// File-level, so both describes below start from the same clean slate — in particular a
// fresh `commit` spy, which the auto-commit block counts calls on.
beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  _resetAutoCommitStateForTests();
  setAutoCommitFailureHandler(undefined);
  commit = vi.fn(() => OK);
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
});

describe('notifyRefactoringApplied', () => {
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

/**
 * This is also where an applied refactoring meets auto-commit (issue #254), and the reason
 * it is HERE rather than at the engine's apply is the thing worth pinning: a refactoring can
 * stop at its first failure and strand a partly-reshaped class, and the panels recover from
 * that by ABORTING the transaction. A commit inside the apply would leave that button
 * rewinding to a repository that already held the wreckage. By the time this runs the apply
 * has landed and the panel has closed, so the abort window is shut.
 */
describe('notifyRefactoringApplied and auto-commit', () => {
  beforeEach(() => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));
  });

  it('commits the refactoring on an armed session', () => {
    registerSessionAutoCommit(7, true);

    notifyRefactoringApplied(makeSession(), 'Renamed it.');

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits before it puts the toast up, not after the user answers it', () => {
    // The work is safe the moment the apply lands. Deferring the commit into the toast's
    // async tail would leave it riding on a notice the user may never look at — and the
    // toast resolves only when they dismiss it.
    registerSessionAutoCommit(7, true);

    notifyRefactoringApplied(makeSession(), 'Renamed it.');

    const toast = vi.mocked(vscode.window.showInformationMessage);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(toast.mock.invocationCallOrder[0]);
  });

  it('commits nothing on a session that never armed it', () => {
    notifyRefactoringApplied(makeSession(), 'Renamed it.');
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing once a previous commit has failed', () => {
    registerSessionAutoCommit(7, true);
    setAutoCommitStatus(7, 'failed');

    notifyRefactoringApplied(makeSession(), 'Renamed it.');

    expect(commit).not.toHaveBeenCalled();
  });

  it('does not fall over when there is no session to commit', () => {
    // The signature allows it, and a stone-less call must still put up its notice.
    expect(() => notifyRefactoringApplied(undefined, 'Renamed it.')).not.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });
});
