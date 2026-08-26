import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));

import { beginMethodCategoryAdd, beginMethodCategoryRename } from '../recordMethodCategoryEdit';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import type { ActiveSession } from '../../sessionManager';

/**
 * The method-category recorder (#434).
 *
 * The plainest one here: two names, both known to the caller, so there is nothing to capture
 * and no round trip to make. What it still has to get right is the label — the status bar is
 * the only affordance that can name the change, so the entry has to carry both names — and
 * refusing to record a rename that changed nothing.
 */

const session = { id: 1 } as ActiveSession;
const slot = { dict: 7, className: 'Account', isMeta: false };

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
});

describe('beginMethodCategoryRename', () => {
  it('records both names, and says which class side it was', () => {
    const entry = beginMethodCategoryRename(session, slot, 'accessing').commit('reading');

    expect(entry).toMatchObject({
      kind: 'methodCategoryEdit',
      label: "Rename category 'accessing' to 'reading' in Account",
      before: 'accessing',
      after: 'reading',
      slot,
    });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('names the class side in the label, so the two sides are told apart', () => {
    const entry = beginMethodCategoryRename(
      session,
      { ...slot, isMeta: true },
      'instance creation',
    ).commit('creating');

    expect(entry?.label).toBe("Rename category 'instance creation' to 'creating' in Account class");
  });

  it('records nothing when the name did not change', () => {
    expect(
      beginMethodCategoryRename(session, slot, 'accessing').commit('accessing'),
    ).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });
});

describe('beginMethodCategoryAdd', () => {
  it('records a create as a null `before`, which is what makes the reversal a removal', () => {
    const entry = beginMethodCategoryAdd(session, slot).commit('tests');

    expect(entry).toMatchObject({
      kind: 'methodCategoryEdit',
      label: "Create category 'tests' in Account",
      before: null,
      after: 'tests',
    });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('names the class side in the label, like the rename does', () => {
    const entry = beginMethodCategoryAdd(session, { ...slot, isMeta: true }).commit('creating');

    expect(entry?.label).toBe("Create category 'creating' in Account class");
  });

  it('records nothing for an empty name', () => {
    expect(beginMethodCategoryAdd(session, slot).commit('')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });
});
