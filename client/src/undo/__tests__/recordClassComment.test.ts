import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ getClassComment: vi.fn() }));

import { getClassComment } from '../../browserQueries';
import { beginClassCommentEdit } from '../recordClassComment';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import type { ActiveSession } from '../../sessionManager';

/**
 * The comment recorder (#434).
 *
 * Same negative promise as every other recorder — recording must never break the save it
 * wraps — plus the rule that matters for text: a comment that could not be READ records
 * nothing, because an entry whose "before" defaulted to the empty string would offer to
 * wipe the user's earlier comment rather than restore it.
 */

const session = { id: 1 } as ActiveSession;
const slot = { dict: 7, className: 'Account' };

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
});

describe('beginClassCommentEdit', () => {
  it('records the earlier text and the text the save wrote', () => {
    vi.mocked(getClassComment).mockReturnValue('the old comment');

    const entry = beginClassCommentEdit(session, slot)?.commit('the new comment');

    expect(entry).toMatchObject({
      kind: 'classComment',
      label: 'Save comment for Account',
      before: 'the old comment',
      after: 'the new comment',
    });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('reads the comment through the dictionary the save targets', () => {
    vi.mocked(getClassComment).mockReturnValue('');

    beginClassCommentEdit(session, slot);

    expect(getClassComment).toHaveBeenCalledWith(session, 'Account', 7);
  });

  it('records nothing when the save did not change the text', () => {
    vi.mocked(getClassComment).mockReturnValue('unchanged');

    expect(beginClassCommentEdit(session, slot)?.commit('unchanged')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing — and does not throw — when the comment cannot be read', () => {
    vi.mocked(getClassComment).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(beginClassCommentEdit(session, slot)).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records the first comment on a class that had none', () => {
    vi.mocked(getClassComment).mockReturnValue('');

    const entry = beginClassCommentEdit(session, slot)?.commit('a first comment');

    // Undoing this empties the comment again — GemStone stores the empty string rather
    // than dropping it, so "no comment" and "empty comment" are the same state.
    expect(entry).toMatchObject({ before: '', after: 'a first comment' });
  });
});
