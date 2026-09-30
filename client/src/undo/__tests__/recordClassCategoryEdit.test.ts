import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ getClassesWithCategory: vi.fn() }));

import { getClassesWithCategory } from '../../browserQueries';
import { beginClassCategoryEdit } from '../recordClassCategoryEdit';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import type { ActiveSession } from '../../sessionManager';

/**
 * The class-category recorder (#434).
 *
 * Recorded per CLASS, by diffing the dictionary before and after — because a category rename
 * moves a dash-segmented subtree, MERGES into a category that already exists, and skips any
 * class it cannot write. Only the diff knows which classes actually moved.
 */

const session = { id: 1 } as ActiveSession;
const entries = (m: Record<string, string>) =>
  Object.entries(m).map(([className, category]) => ({ className, category, hasComment: false }));

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
});

describe('beginClassCategoryEdit', () => {
  it('records only the classes whose category actually changed', async () => {
    vi.mocked(getClassesWithCategory)
      .mockResolvedValueOnce(entries({ A: 'Old', B: 'Old', C: 'Untouched' }))
      .mockResolvedValueOnce(entries({ A: 'New', B: 'New', C: 'Untouched' }));

    const entry = await (
      await beginClassCategoryEdit(session, 3)
    )?.commit('Rename class category Old to New');

    expect(entry).toMatchObject({ kind: 'classCategoryEdit', dict: 3 });
    expect(entry?.kind === 'classCategoryEdit' && entry.changes).toEqual([
      { className: 'A', before: 'Old', after: 'New' },
      { className: 'B', before: 'Old', after: 'New' },
    ]);
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('records each class under its OWN former label, so a merge is reversible', async () => {
    // Renaming Old onto New merges into it. Putting back the NAME would drag the classes that
    // were already in New along with it; putting back each class's own label does not.
    vi.mocked(getClassesWithCategory)
      .mockResolvedValueOnce(entries({ A: 'Old', B: 'New' }))
      .mockResolvedValueOnce(entries({ A: 'New', B: 'New' }));

    const entry = await (
      await beginClassCategoryEdit(session, 3)
    )?.commit('Rename class category Old to New');

    expect(entry?.kind === 'classCategoryEdit' && entry.changes).toEqual([
      { className: 'A', before: 'Old', after: 'New' },
    ]);
  });

  it('records a whole dash-segmented subtree, each class with its own label', async () => {
    vi.mocked(getClassesWithCategory)
      .mockResolvedValueOnce(entries({ A: 'Old', B: 'Old-Sub', C: 'Old-Sub-Deep' }))
      .mockResolvedValueOnce(entries({ A: 'New', B: 'New-Sub', C: 'New-Sub-Deep' }));

    const entry = await (await beginClassCategoryEdit(session, 3))?.commit('Rename');

    expect(entry?.kind === 'classCategoryEdit' && entry.changes.map((c) => c.before)).toEqual([
      'Old',
      'Old-Sub',
      'Old-Sub-Deep',
    ]);
  });

  it('leaves out a class the rename SKIPPED, because it did not move', async () => {
    vi.mocked(getClassesWithCategory)
      .mockResolvedValueOnce(entries({ A: 'Old', Stubborn: 'Old' }))
      .mockResolvedValueOnce(entries({ A: 'New', Stubborn: 'Old' }));

    const entry = await (await beginClassCategoryEdit(session, 3))?.commit('Rename');

    expect(entry?.kind === 'classCategoryEdit' && entry.changes.map((c) => c.className)).toEqual([
      'A',
    ]);
  });

  it('ignores a class that APPEARED since — it has no earlier label to go back to', async () => {
    vi.mocked(getClassesWithCategory)
      .mockResolvedValueOnce(entries({ A: 'Old' }))
      .mockResolvedValueOnce(entries({ A: 'New', Fresh: 'Somewhere' }));

    const entry = await (await beginClassCategoryEdit(session, 3))?.commit('Rename');

    expect(entry?.kind === 'classCategoryEdit' && entry.changes.map((c) => c.className)).toEqual([
      'A',
    ]);
  });

  it('records nothing when no class changed category', async () => {
    vi.mocked(getClassesWithCategory).mockResolvedValue(entries({ A: 'Same' }));

    expect(await (await beginClassCategoryEdit(session, 3))?.commit('Rename')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing — and does not throw — when the dictionary cannot be read', async () => {
    vi.mocked(getClassesWithCategory).mockImplementation(async () => {
      throw new Error('session busy');
    });

    expect(await beginClassCategoryEdit(session, 3)).toBeUndefined();
  });

  it('records nothing when the result cannot be read back', async () => {
    vi.mocked(getClassesWithCategory)
      .mockResolvedValueOnce(entries({ A: 'Old' }))
      .mockImplementationOnce(() => {
        throw new Error('session busy');
      });

    expect(await (await beginClassCategoryEdit(session, 3))?.commit('Rename')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });
});
