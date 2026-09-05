import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../reverseMethodEdit', () => ({ reverseMethodEdit: vi.fn() }));
vi.mock('../reverseClassEdit', () => ({ reverseClassEdit: vi.fn() }));
vi.mock('../reverseClassComment', () => ({ reverseClassComment: vi.fn() }));
vi.mock('../reverseClassVarEdit', () => ({ reverseClassVarEdit: vi.fn() }));
vi.mock('../reverseMethodCategoryEdit', () => ({ reverseMethodCategoryEdit: vi.fn() }));
vi.mock('../reverseDictionaryEdit', () => ({ reverseDictionaryEdit: vi.fn() }));
vi.mock('../reverseClassCategoryEdit', () => ({ reverseClassCategoryEdit: vi.fn() }));
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
import { reverseClassComment } from '../reverseClassComment';
import { reverseClassVarEdit } from '../reverseClassVarEdit';
import { reverseMethodCategoryEdit } from '../reverseMethodCategoryEdit';
import { reverseDictionaryEdit } from '../reverseDictionaryEdit';
import { reverseClassCategoryEdit } from '../reverseClassCategoryEdit';
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

const classComment = (label: string): NewUndoEntry => ({
  kind: 'classComment',
  sessionId: session.id,
  label,
  slot: { dict: 7, className: 'Account' },
  before: 'was',
  after: 'is',
});

const classVarEdit = (label: string): NewUndoEntry => ({
  kind: 'classVarEdit',
  sessionId: session.id,
  label,
  slot: { dict: 7, className: 'Account', varName: 'Registry' },
  before: { defined: false },
  after: { defined: true },
  accessorSlots: [],
  accessorBefore: [],
  accessorAfter: [],
});

const methodCategoryEdit = (label: string): NewUndoEntry => ({
  kind: 'methodCategoryEdit',
  sessionId: session.id,
  label,
  slot: { dict: 7, className: 'Account', isMeta: false },
  before: 'accessing',
  after: 'reading',
});

const classCategoryEdit = (label: string): NewUndoEntry => ({
  kind: 'classCategoryEdit',
  sessionId: session.id,
  label,
  dict: 3,
  changes: [{ className: 'A', before: 'Old', after: 'New' }],
});

const dictionaryEdit = (label: string): NewUndoEntry => ({
  kind: 'dictionaryEdit',
  sessionId: session.id,
  label,
  before: { present: true, name: 'Reports', index: 2 },
  after: { present: false, name: 'Reports', index: 2 },
  stashKey: 'k1',
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

  it('hands a class comment to the comment reverser, and calls it an undo', async () => {
    pushUndoEntry(classComment('Save comment for Account'));
    vi.mocked(reverseClassComment).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(reverseClassComment).toHaveBeenCalled();
    expect(reverseClassEdit).not.toHaveBeenCalled();
    expect(undoLastRefactoringCommand).not.toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('hands an added class variable to its own reverser', async () => {
    pushUndoEntry(classVarEdit('Add class variable Registry to Account'));
    vi.mocked(reverseClassVarEdit).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(reverseClassVarEdit).toHaveBeenCalled();
    expect(reverseClassEdit).not.toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('leaves a class comment and a class variable on the stack when they are declined', async () => {
    pushUndoEntry(classComment('Save comment for Account'));
    vi.mocked(reverseClassComment).mockResolvedValue(false);
    await undoLastCommand(sessions);
    expect(undoStackDepth(session.id)).toBe(1);

    pushUndoEntry(classVarEdit('Add class variable Registry to Account'));
    vi.mocked(reverseClassVarEdit).mockResolvedValue(false);
    await undoLastCommand(sessions);
    expect(undoStackDepth(session.id)).toBe(2);
  });

  it('leaves a method edit on the stack when the user backs out of it', async () => {
    pushUndoEntry(methodEdit('Save Account>>#balance'));
    vi.mocked(reverseMethodEdit).mockResolvedValue(false);

    await undoLastCommand(sessions);

    expect(undoStackDepth(session.id)).toBe(1);
  });

  it('hands a method-category rename to its own reverser', async () => {
    pushUndoEntry(methodCategoryEdit("Rename category 'accessing' to 'reading' in Account"));
    vi.mocked(reverseMethodCategoryEdit).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(reverseMethodCategoryEdit).toHaveBeenCalled();
    expect(undoLastRefactoringCommand).not.toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('hands a symbol-list change to its own reverser', async () => {
    pushUndoEntry(dictionaryEdit('Remove dictionary Reports'));
    vi.mocked(reverseDictionaryEdit).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(reverseDictionaryEdit).toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('leaves a category rename and a symbol-list change on the stack when they refuse', async () => {
    pushUndoEntry(methodCategoryEdit('Rename category'));
    vi.mocked(reverseMethodCategoryEdit).mockResolvedValue(false);
    await undoLastCommand(sessions);
    expect(undoStackDepth(session.id)).toBe(1);

    pushUndoEntry(dictionaryEdit('Remove dictionary Reports'));
    vi.mocked(reverseDictionaryEdit).mockResolvedValue(false);
    await undoLastCommand(sessions);
    expect(undoStackDepth(session.id)).toBe(2);
  });

  it('hands a class-category change to its own reverser', async () => {
    pushUndoEntry(classCategoryEdit('Rename class category Old to New'));
    vi.mocked(reverseClassCategoryEdit).mockResolvedValue(true);

    await undoLastCommand(sessions);

    expect(reverseClassCategoryEdit).toHaveBeenCalled();
    expect(undoLastRefactoringCommand).not.toHaveBeenCalled();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('leaves a class-category change on the stack when it refuses', async () => {
    pushUndoEntry(classCategoryEdit('Rename class category Old to New'));
    vi.mocked(reverseClassCategoryEdit).mockResolvedValue(false);

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
