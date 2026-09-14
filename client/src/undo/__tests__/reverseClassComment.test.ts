import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({
  getClassComment: vi.fn(),
  setClassComment: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  refreshExplorer: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
}));

import * as vscode from 'vscode';
import { getClassComment, setClassComment } from '../../browserQueries';
import { reloadGemstoneEditors } from '../afterUndo';
import { reverseClassComment } from '../reverseClassComment';
import { ClassCommentUndoEntry } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Undoing a comment save (#434).
 *
 * An UNDO rather than a revert, and exact: `comment:` does not re-version the class, so
 * there is no discard modal and nothing is left behind. The one thing worth asking about is
 * DRIFT — and, as everywhere else here, it is a warning rather than a refusal.
 */

const session = { id: 1 } as ActiveSession;

function entry(before = 'the old comment', after = 'the new comment'): ClassCommentUndoEntry {
  return {
    id: 1,
    kind: 'classComment',
    sessionId: session.id,
    label: 'Save comment for Account',
    slot: { dict: 7, className: 'Account' },
    before,
    after,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setClassComment).mockReturnValue('Comment set: Account');
});

describe('reverseClassComment', () => {
  it('writes the earlier comment back and reports it', async () => {
    vi.mocked(getClassComment).mockReturnValue('the new comment');

    expect(await reverseClassComment(session, entry())).toBe(true);

    expect(setClassComment).toHaveBeenCalledWith(session, 'Account', 'the old comment', 7);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Undid Save comment for Account'),
    );
  });

  it('reloads open editors, so the comment tab stops showing what the undo discarded', async () => {
    vi.mocked(getClassComment).mockReturnValue('the new comment');

    await reverseClassComment(session, entry());

    expect(reloadGemstoneEditors).toHaveBeenCalled();
  });

  it('does nothing when the comment is already back the way it was', async () => {
    vi.mocked(getClassComment).mockReturnValue('the old comment');

    expect(await reverseClassComment(session, entry())).toBe(true);
    expect(setClassComment).not.toHaveBeenCalled();
  });

  it('warns before discarding a comment edited since, and undoes anyway when told to', async () => {
    vi.mocked(getClassComment).mockReturnValue('someone else edited this');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

    expect(await reverseClassComment(session, entry())).toBe(true);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('has changed since'),
      { modal: true },
      'Undo Anyway',
    );
    expect(setClassComment).toHaveBeenCalledWith(session, 'Account', 'the old comment', 7);
  });

  it('keeps the entry on offer when the drift warning is declined', async () => {
    vi.mocked(getClassComment).mockReturnValue('someone else edited this');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    expect(await reverseClassComment(session, entry())).toBe(false);
    expect(setClassComment).not.toHaveBeenCalled();
  });

  it('reports a write the stone refused rather than claiming the undo landed', async () => {
    // setClassComment answers a status string instead of throwing when the class is gone.
    vi.mocked(getClassComment).mockReturnValue('the new comment');
    vi.mocked(setClassComment).mockReturnValue('Class not found: Account');

    expect(await reverseClassComment(session, entry())).toBe(false);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Class not found: Account'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('keeps the entry on offer when the write itself raises', async () => {
    vi.mocked(getClassComment).mockReturnValue('the new comment');
    vi.mocked(setClassComment).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseClassComment(session, entry())).toBe(false);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('session busy'),
    );
  });

  it('keeps the entry on offer when the current comment cannot be read', async () => {
    vi.mocked(getClassComment).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseClassComment(session, entry())).toBe(false);
    expect(setClassComment).not.toHaveBeenCalled();
  });
});
