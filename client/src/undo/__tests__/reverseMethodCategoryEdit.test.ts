import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({
  getMethodCategories: vi.fn(),
  renameCategory: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  refreshExplorer: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
}));

import * as vscode from 'vscode';
import { getMethodCategories, renameCategory } from '../../browserQueries';
import { reverseMethodCategoryEdit } from '../reverseMethodCategoryEdit';
import { MethodCategoryUndoEntry } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Undoing a method-category rename (#434).
 *
 * Reversed by renaming it back rather than recompiling the methods it holds. The rule with
 * teeth is the COLLISION: GemStone refuses to rename one category onto another, so if the old
 * name has been taken again the undo refuses too — and names what is in the way, rather than
 * letting the stone's error 2032 reach the user unexplained.
 */

const session = { id: 1 } as ActiveSession;

function entry(): MethodCategoryUndoEntry {
  return {
    id: 1,
    kind: 'methodCategoryEdit',
    sessionId: session.id,
    label: "Rename category 'accessing' to 'reading' in Account",
    slot: { dict: 7, className: 'Account', isMeta: false },
    before: 'accessing',
    after: 'reading',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renameCategory).mockReturnValue('ok');
});

describe('reverseMethodCategoryEdit', () => {
  it('renames the category back, through the dictionary and side it was renamed on', async () => {
    vi.mocked(getMethodCategories).mockReturnValue(['reading', 'printing']);

    expect(await reverseMethodCategoryEdit(session, entry())).toBe(true);

    expect(renameCategory).toHaveBeenCalledWith(
      session,
      'Account',
      false,
      'reading',
      'accessing',
      7,
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("called 'accessing' again"),
    );
  });

  it('does nothing when the category is already back the way it was', async () => {
    vi.mocked(getMethodCategories).mockReturnValue(['accessing', 'printing']);

    expect(await reverseMethodCategoryEdit(session, entry())).toBe(true);
    expect(renameCategory).not.toHaveBeenCalled();
  });

  it('refuses, and names the collision, when the old name has been taken again', async () => {
    // Renaming onto an existing category is exactly what GemStone refuses; saying so here
    // beats letting error 2032 reach the user unexplained.
    vi.mocked(getMethodCategories).mockReturnValue(['reading', 'accessing']);

    expect(await reverseMethodCategoryEdit(session, entry())).toBe(false);

    expect(renameCategory).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("a category called 'accessing' again"),
    );
  });

  it('refuses when the renamed category is gone entirely', async () => {
    vi.mocked(getMethodCategories).mockReturnValue(['printing']);

    expect(await reverseMethodCategoryEdit(session, entry())).toBe(false);
    expect(renameCategory).not.toHaveBeenCalled();
  });

  it('keeps the entry on offer when the categories cannot be read', async () => {
    vi.mocked(getMethodCategories).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseMethodCategoryEdit(session, entry())).toBe(false);
    expect(renameCategory).not.toHaveBeenCalled();
  });

  it('reports a rename the stone refused', async () => {
    vi.mocked(getMethodCategories).mockReturnValue(['reading']);
    vi.mocked(renameCategory).mockImplementation(() => {
      throw new Error('classErrMethCatExists');
    });

    expect(await reverseMethodCategoryEdit(session, entry())).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('classErrMethCatExists'),
    );
  });
});
