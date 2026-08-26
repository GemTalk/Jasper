import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({
  getClassesWithCategory: vi.fn(),
  recategorizeClass: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  refreshExplorer: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
}));

import * as vscode from 'vscode';
import { getClassesWithCategory, recategorizeClass } from '../../browserQueries';
import { reverseClassCategoryEdit } from '../reverseClassCategoryEdit';
import { ClassCategoryUndoEntry } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Undoing a class-category change (#434).
 *
 * Each class goes back under the label IT carried, one `category:` per class. That is what
 * makes a merged rename reversible: renaming the category back would drag along the classes
 * that were already there.
 */

const session = { id: 1 } as ActiveSession;
const entries = (m: Record<string, string>) =>
  Object.entries(m).map(([className, category]) => ({ className, category, hasComment: false }));

function entry(
  changes = [{ className: 'A', before: 'Old', after: 'New' }],
): ClassCategoryUndoEntry {
  return {
    id: 1,
    kind: 'classCategoryEdit',
    sessionId: session.id,
    label: 'Rename class category Old to New',
    dict: 3,
    changes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recategorizeClass).mockReturnValue('Recategorized: A');
});

describe('reverseClassCategoryEdit', () => {
  it('files each class back under its own former label', async () => {
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ A: 'New', B: 'New' }));

    expect(
      await reverseClassCategoryEdit(
        session,
        entry([
          { className: 'A', before: 'Old', after: 'New' },
          { className: 'B', before: 'Older', after: 'New' },
        ]),
      ),
    ).toBe(true);

    expect(recategorizeClass).toHaveBeenCalledWith(session, 'A', 'Old', 3);
    expect(recategorizeClass).toHaveBeenCalledWith(session, 'B', 'Older', 3);
  });

  it('leaves alone a class that was already in the target category', async () => {
    // The merge case: B was in New before the rename, so it is not in the entry at all.
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ A: 'New', B: 'New' }));

    await reverseClassCategoryEdit(session, entry());

    expect(recategorizeClass).toHaveBeenCalledTimes(1);
    expect(recategorizeClass).toHaveBeenCalledWith(session, 'A', 'Old', 3);
  });

  it('does nothing when the classes are already filed as they were', async () => {
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ A: 'Old' }));

    expect(await reverseClassCategoryEdit(session, entry())).toBe(true);
    expect(recategorizeClass).not.toHaveBeenCalled();
  });

  it('skips a class that has gone away since', async () => {
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ B: 'Elsewhere' }));

    expect(await reverseClassCategoryEdit(session, entry())).toBe(true);
    expect(recategorizeClass).not.toHaveBeenCalled();
  });

  it('warns before discarding a refiling done since, and undoes anyway when told to', async () => {
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ A: 'SomewhereElse' }));
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

    expect(await reverseClassCategoryEdit(session, entry())).toBe(true);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('has been refiled since'),
      expect.objectContaining({ modal: true, detail: expect.stringContaining('A') }),
      'Undo Anyway',
    );
    expect(recategorizeClass).toHaveBeenCalled();
  });

  it('keeps the entry on offer when the drift warning is declined', async () => {
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ A: 'SomewhereElse' }));
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    expect(await reverseClassCategoryEdit(session, entry())).toBe(false);
    expect(recategorizeClass).not.toHaveBeenCalled();
  });

  it('reports a refiling the stone answered with a status string rather than raising', async () => {
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ A: 'New' }));
    vi.mocked(recategorizeClass).mockReturnValue('Class not found: A');

    expect(await reverseClassCategoryEdit(session, entry())).toBe(true);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Class not found: A'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reports a partial refiling without claiming the whole thing worked', async () => {
    vi.mocked(getClassesWithCategory).mockReturnValue(entries({ A: 'New', B: 'New' }));
    vi.mocked(recategorizeClass)
      .mockReturnValueOnce('Recategorized: A')
      .mockReturnValueOnce('Class not found: B');

    await reverseClassCategoryEdit(
      session,
      entry([
        { className: 'A', before: 'Old', after: 'New' },
        { className: 'B', before: 'Old', after: 'New' },
      ]),
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('was partial'),
    );
  });

  it('keeps the entry on offer when the dictionary cannot be read', async () => {
    vi.mocked(getClassesWithCategory).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseClassCategoryEdit(session, entry())).toBe(false);
    expect(recategorizeClass).not.toHaveBeenCalled();
  });
});
