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
  renameOverlayCategory: vi.fn(),
}));

import * as vscode from 'vscode';
import { getMethodCategories, renameCategory } from '../../browserQueries';
import { renameOverlayCategory } from '../afterUndo';
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
  vi.mocked(renameOverlayCategory).mockResolvedValue('ok');
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

  it('does nothing on the stone when the category is already back the way it was', async () => {
    // 'reading' is gone and 'accessing' is there: nothing on the stone to rename. The overlay
    // is asked, finds nothing listed, and the entry is spent.
    vi.mocked(getMethodCategories).mockReturnValue(['accessing', 'printing']);
    vi.mocked(renameOverlayCategory).mockResolvedValue('not-listed');

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

  it('never renames on the stone when the target has no server existence', async () => {
    vi.mocked(getMethodCategories).mockReturnValue(['printing']);

    await reverseMethodCategoryEdit(session, entry());

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

  describe('a still-empty category, which lives only in the Explorer overlay', () => {
    // The stone does not have the renamed category, so this is a "+"-button one and the
    // overlay is the only place the rename happened.
    beforeEach(() => {
      vi.mocked(getMethodCategories).mockReturnValue(['printing']);
    });

    it('renames it back in the overlay, and says nothing reached the stone', async () => {
      expect(await reverseMethodCategoryEdit(session, entry())).toBe(true);

      expect(renameOverlayCategory).toHaveBeenCalledWith(
        { dict: 7, className: 'Account', isMeta: false },
        'reading',
        'accessing',
      );
      expect(renameCategory).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('nothing has reached the stone'),
      );
    });

    it('refuses and names the collision when the old name is taken again', async () => {
      vi.mocked(renameOverlayCategory).mockResolvedValue('collision');

      expect(await reverseMethodCategoryEdit(session, entry())).toBe(false);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("a category called 'accessing' again"),
      );
    });

    it('spends the entry, with a reason, when the category is no longer listed', async () => {
      // The overlay is discarded whenever the browsed class changes, so the entry now
      // describes something that is nowhere. Leaving it on offer over nothing is worse.
      vi.mocked(renameOverlayCategory).mockResolvedValue('not-listed');

      expect(await reverseMethodCategoryEdit(session, entry())).toBe(true);

      expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
        expect.stringContaining('no longer listed'),
        expect.any(Number),
      );
    });

    it('reverses on the STONE once a method has been filed into it', async () => {
      // A fresh category becomes real the moment something lands in it, and the reversal has
      // to follow — which is why the entry carries no overlay flag to go stale.
      vi.mocked(getMethodCategories).mockReturnValue(['reading', 'printing']);

      expect(await reverseMethodCategoryEdit(session, entry())).toBe(true);

      expect(renameCategory).toHaveBeenCalled();
      expect(renameOverlayCategory).not.toHaveBeenCalled();
    });
  });
});
