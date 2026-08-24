import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../reverseMethodEdit', () => ({ reverseMethodEdit: vi.fn() }));
vi.mock('../reverseClassEdit', () => ({ reverseClassEdit: vi.fn() }));
vi.mock('../undoUi', () => ({ refreshUndoUi: vi.fn() }));
vi.mock('../../refactoring/refactoringUndoAvailability', () => ({
  checkRefactoringUndoAvailable: vi.fn(),
}));
vi.mock('../../refactoring/undoRefactoringCommand', () => ({
  undoLastRefactoringCommand: vi.fn(),
}));

import * as vscode from 'vscode';
import { reverseMethodEdit } from '../reverseMethodEdit';
import { reverseClassEdit } from '../reverseClassEdit';
import { checkRefactoringUndoAvailable } from '../../refactoring/refactoringUndoAvailability';
import { undoLastRefactoringCommand } from '../../refactoring/undoRefactoringCommand';
import { undoLastCommand } from '../undoLastCommand';
import { peekUndoEntry, pushUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import type { NewUndoEntry } from '../undoTypes';
import type { ActiveSession, SessionManager } from '../../sessionManager';

/**
 * The dispatcher (#434) — the single Undo every affordance runs.
 *
 * What is pinned here is the split that the whole design rests on: a METHOD EDIT reverses
 * on the spot, a REFACTORING opens the preview it already has, and the dispatcher is the
 * only place that knows the difference. Plus the two bookkeeping rules that keep the stack
 * honest — an entry is popped only when it was actually spent, and a refactoring entry the
 * stone no longer holds is dropped and skipped rather than previewed over nothing.
 */

const session = { id: 1 } as ActiveSession;
const sessions = { getSelectedSession: () => session } as unknown as SessionManager;

const status = (available: boolean, sequence = 1) => ({
  available,
  label: 'Rename #total to #sum',
  engine: 'GsRenameMethodRefactoring',
  mechanism: 'changeSet' as const,
  reverseKind: null,
  sequence,
  total: 2,
});

const classEdit = (label: string): NewUndoEntry => ({
  kind: 'classEdit',
  sessionId: session.id,
  label,
  slots: [],
  before: [],
  after: [],
  stashKeys: [],
});

const methodEdit = (label: string): NewUndoEntry => ({
  kind: 'methodEdit',
  sessionId: session.id,
  label,
  slots: [],
  before: [],
  after: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
});

describe('undoLastCommand', () => {
  it('refuses plainly when there is nothing to undo', async () => {
    await undoLastCommand(sessions);
    expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]).toContain(
      'nothing to undo',
    );
  });

  it('reverses a method edit on the spot — no preview panel', async () => {
    pushUndoEntry(methodEdit('Save Account>>#balance'));
    vi.mocked(reverseMethodEdit).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(reverseMethodEdit).toHaveBeenCalled();
    expect(undoLastRefactoringCommand).not.toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('hands a class edit to the class reverser, which also skips the preview', async () => {
    pushUndoEntry(classEdit('Redefine class Account'));
    vi.mocked(reverseClassEdit).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(reverseClassEdit).toHaveBeenCalled();
    expect(reverseMethodEdit).not.toHaveBeenCalled();
    expect(undoLastRefactoringCommand).not.toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('leaves a class edit on the stack when the user backs out of the cost', async () => {
    pushUndoEntry(classEdit('Redefine class Account'));
    vi.mocked(reverseClassEdit).mockResolvedValue(false);

    await undoLastCommand(sessions);

    expect(undoStackDepth(session.id)).toBe(1);
  });

  it('leaves a method edit on the stack when the user backs out of it', async () => {
    pushUndoEntry(methodEdit('Save Account>>#balance'));
    vi.mocked(reverseMethodEdit).mockResolvedValue(false);

    await undoLastCommand(sessions);

    expect(undoStackDepth(session.id)).toBe(1);
  });

  it('hands a refactoring to the engine reverser, which keeps its preview', async () => {
    pushUndoEntry({ kind: 'refactoring', sessionId: session.id, label: 'Rename', sequence: 1 });
    vi.mocked(checkRefactoringUndoAvailable)
      .mockReturnValueOnce(status(true))
      .mockReturnValueOnce(status(false));

    await undoLastCommand(sessions);

    expect(undoLastRefactoringCommand).toHaveBeenCalledWith(sessions);
    expect(reverseMethodEdit).not.toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('keeps the refactoring entry when the stone still holds its record', async () => {
    // A cancelled panel, or a partial undo: the stone's record survives, so the offer must.
    pushUndoEntry({ kind: 'refactoring', sessionId: session.id, label: 'Rename', sequence: 1 });
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));

    await undoLastCommand(sessions);

    expect(undoStackDepth(session.id)).toBe(1);
  });

  it('drops a refactoring entry the stone has forgotten and falls through to the next', async () => {
    // The stone's record is per session; a reconnect clears it while the client entry
    // remains. Answering "nothing to undo" over a stack that still has entries would be a lie.
    pushUndoEntry(methodEdit('Save Account>>#balance'));
    pushUndoEntry({ kind: 'refactoring', sessionId: session.id, label: 'Rename', sequence: 1 });
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));
    vi.mocked(reverseMethodEdit).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(undoLastRefactoringCommand).not.toHaveBeenCalled();
    expect(reverseMethodEdit).toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('drops a refactoring entry the stone has since replaced', async () => {
    // The sequence moves on when another refactoring is applied elsewhere in the session.
    pushUndoEntry({ kind: 'refactoring', sessionId: session.id, label: 'Rename', sequence: 1 });
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true, 9));

    await undoLastCommand(sessions);

    expect(undoLastRefactoringCommand).not.toHaveBeenCalled();
    expect(peekUndoEntry(session.id)).toBeUndefined();
  });

  it('asks for a session before anything else', async () => {
    const none = { getSelectedSession: () => undefined } as unknown as SessionManager;
    await undoLastCommand(none);
    expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]).toContain('session');
  });
});
