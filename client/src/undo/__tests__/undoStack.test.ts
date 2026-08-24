import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearUndoStack,
  dropUndoEntry,
  MAX_UNDO_DEPTH,
  onUndoStackChanged,
  peekUndoEntry,
  popUndoEntry,
  pushUndoEntry,
  resetUndoStacks,
  undoStackDepth,
} from '../undoStack';
import type { NewUndoEntry } from '../undoTypes';

/**
 * The stack itself (#434).
 *
 * The two rules worth pinning are the ones a reader would not guess: a stack is PER
 * SESSION (an entry describes work in one session's transaction and means nothing in
 * another's), and a refactoring entry DISPLACES the previous one, because the stone keeps
 * exactly one refactoring undo and a second applied refactoring overwrites the first
 * server-side.
 */

const methodEdit = (sessionId: number, label: string): NewUndoEntry => ({
  kind: 'methodEdit',
  sessionId,
  label,
  slots: [],
  before: [],
  after: [],
});

const refactoring = (sessionId: number, label: string, sequence: number): NewUndoEntry => ({
  kind: 'refactoring',
  sessionId,
  label,
  sequence,
});

beforeEach(() => resetUndoStacks());

describe('the undo stack', () => {
  it('hands back the most recent entry first', () => {
    pushUndoEntry(methodEdit(1, 'first'));
    pushUndoEntry(methodEdit(1, 'second'));
    expect(peekUndoEntry(1)?.label).toBe('second');
    expect(popUndoEntry(1)?.label).toBe('second');
    expect(peekUndoEntry(1)?.label).toBe('first');
  });

  it('keeps sessions apart', () => {
    pushUndoEntry(methodEdit(1, 'session one'));
    expect(peekUndoEntry(2)).toBeUndefined();
    expect(undoStackDepth(1)).toBe(1);
    expect(undoStackDepth(2)).toBe(0);
  });

  it('drops the older refactoring entry when a second refactoring is applied', () => {
    // The stone holds ONE refactoring undo. Keeping the first on the stack would offer an
    // undo the stone can no longer perform.
    pushUndoEntry(refactoring(1, 'Rename #a to #b', 1));
    pushUndoEntry(methodEdit(1, 'Save Account>>#x'));
    pushUndoEntry(refactoring(1, 'Extract #answer', 2));

    const labels: string[] = [];
    for (let e = popUndoEntry(1); e; e = popUndoEntry(1)) labels.push(e.label);
    expect(labels).toEqual(['Extract #answer', 'Save Account>>#x']);
  });

  it('does not displace method edits, which hold their own state', () => {
    pushUndoEntry(methodEdit(1, 'one'));
    pushUndoEntry(methodEdit(1, 'two'));
    expect(undoStackDepth(1)).toBe(2);
  });

  it('forgets the oldest entry once it is full', () => {
    for (let i = 0; i < MAX_UNDO_DEPTH + 3; i += 1) pushUndoEntry(methodEdit(1, `edit ${i}`));
    expect(undoStackDepth(1)).toBe(MAX_UNDO_DEPTH);
    const remaining: string[] = [];
    for (let e = popUndoEntry(1); e; e = popUndoEntry(1)) remaining.push(e.label);
    expect(remaining[remaining.length - 1]).toBe('edit 3');
  });

  it('can forget one entry from the middle, for a record the stone no longer holds', () => {
    const stale = pushUndoEntry(refactoring(1, 'stale', 1));
    pushUndoEntry(methodEdit(1, 'later'));
    dropUndoEntry(1, stale.id);
    expect(undoStackDepth(1)).toBe(1);
    expect(peekUndoEntry(1)?.label).toBe('later');
  });

  it('clears a whole session at once', () => {
    pushUndoEntry(methodEdit(1, 'a'));
    pushUndoEntry(methodEdit(2, 'b'));
    clearUndoStack(1);
    expect(peekUndoEntry(1)).toBeUndefined();
    expect(peekUndoEntry(2)?.label).toBe('b');
  });

  it('tells listeners about every change, so the UI never has to be updated by hand', () => {
    const listener = vi.fn();
    onUndoStackChanged(listener);
    const entry = pushUndoEntry(methodEdit(1, 'a'));
    expect(listener).toHaveBeenCalledTimes(1);
    popUndoEntry(1);
    expect(listener).toHaveBeenCalledTimes(2);
    const second = pushUndoEntry(methodEdit(1, 'b'));
    dropUndoEntry(1, second.id);
    expect(listener).toHaveBeenCalledTimes(4);
    pushUndoEntry(methodEdit(1, 'c'));
    clearUndoStack(1);
    expect(listener).toHaveBeenCalledTimes(6);
    // Clearing an already-empty stack changed nothing, so it says nothing.
    clearUndoStack(1);
    expect(listener).toHaveBeenCalledTimes(6);
    expect(entry.id).not.toBe(second.id);
  });

  it('survives a listener that throws — an edit must not fail because its UI did', () => {
    onUndoStackChanged(() => {
      throw new Error('boom');
    });
    expect(() => pushUndoEntry(methodEdit(1, 'a'))).not.toThrow();
  });
});
