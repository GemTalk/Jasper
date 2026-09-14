import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ getStoredClassComment: vi.fn() }));

import { getStoredClassComment } from '../../browserQueries';
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
    vi.mocked(getStoredClassComment).mockReturnValue('the old comment');

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
    vi.mocked(getStoredClassComment).mockReturnValue('');

    beginClassCommentEdit(session, slot);

    expect(getStoredClassComment).toHaveBeenCalledWith(session, 'Account', 7);
  });

  it('records nothing when the save did not change the text', () => {
    vi.mocked(getStoredClassComment).mockReturnValue('unchanged');

    expect(beginClassCommentEdit(session, slot)?.commit('unchanged')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing — and does not throw — when the comment cannot be read', () => {
    vi.mocked(getStoredClassComment).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(beginClassCommentEdit(session, slot)).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing when the read answers something that is not text', () => {
    // An entry whose `before` defaulted to the empty string would offer to WIPE the user's
    // earlier comment rather than restore it.
    vi.mocked(getStoredClassComment).mockReturnValue(undefined as unknown as string);

    expect(beginClassCommentEdit(session, slot)).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  /**
   * The "before" is what the class STORES, which is empty for a class with no
   * comment. `Class>>comment` would answer GemStone's synthesised "No
   * class-specific documentation for …" placeholder here, and recording that
   * would make undoing the first comment on a class write the boilerplate in as
   * a real one.
   */
  /**
   * The entry has to describe what the stone HOLDS, not what the buffer said. An
   * empty or whitespace-only save removes the key, so recording the buffer's
   * stray newline as `after` left the reversal comparing `'\n'` against the `''`
   * it reads back — drift nobody caused, and a modal on an undo of the user's own
   * save. insert-final-newline makes this the ordinary way to clear a comment,
   * not an edge case.
   */
  it('records an emptied comment as what was stored, not what was typed', () => {
    vi.mocked(getStoredClassComment).mockReturnValue('the old comment');

    const entry = beginClassCommentEdit(session, slot)?.commit('\n');

    expect(entry).toMatchObject({ before: 'the old comment', after: '' });
  });

  it('records nothing when whitespace is saved onto a class that had no comment', () => {
    vi.mocked(getStoredClassComment).mockReturnValue('');

    const entry = beginClassCommentEdit(session, slot)?.commit('  \t');

    // The save stored nothing and the class had nothing: no change to offer back.
    expect(entry).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records the first comment on a class that had none as an empty before', () => {
    vi.mocked(getStoredClassComment).mockReturnValue('');

    const entry = beginClassCommentEdit(session, slot)?.commit('a first comment');

    // Undoing this takes the comment away again: setClassComment removes the key
    // for an empty comment, so the class ends up as it was found.
    expect(entry).toMatchObject({ before: '', after: 'a first comment' });
  });
});
