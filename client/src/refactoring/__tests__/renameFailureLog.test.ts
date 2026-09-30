import { describe, it, expect } from 'vitest';
import {
  formatRenameFailureLog,
  renameFailureNotification,
  UNDO_RENAME,
} from '../renameFailureLog';

const fail = (label: string, error: string) => ({ id: label, label, error });

describe('formatRenameFailureLog', () => {
  it('returns undefined when nothing failed', () => {
    expect(formatRenameFailureLog('Rename', [])).toBeUndefined();
  });

  it('lists every failed method, not just the first', () => {
    const line = formatRenameFailureLog('Rename', [
      fail('Account>>balance', 'undeclared variable'),
      fail('Account>>deposit:', 'parse error'),
      fail('Account class>>new', 'undeclared variable'),
    ]);

    expect(line).toContain('3 method(s) did not recompile');
    expect(line).toContain('Account>>balance: undeclared variable');
    expect(line).toContain('Account>>deposit:: parse error');
    expect(line).toContain('Account class>>new: undeclared variable');
    // One line per failure (plus the header line).
    expect(line!.split('\n')).toHaveLength(4);
  });

  it('carries the action label and the not-committed caveat', () => {
    const line = formatRenameFailureLog("Rename 'count' → 'tally'", [fail('Foo>>bar', 'boom')])!;

    expect(line).toContain("Rename 'count' → 'tally'");
    expect(line).toContain('compiled but NOT committed');
  });
});

describe('renameFailureNotification', () => {
  const result = (applied = 2) => ({
    applied,
    failed: [fail('Account>>balance', 'undeclared variable')],
  });

  /**
   * The invariant, checked from both sides, for both answers: the sentence naming a recourse
   * and the button offering it come from one flag and cannot disagree. They used to be built
   * apart, so every toast promised an Undo while three of the five rename paths armed none —
   * and a user who went looking for it reversed whatever they had done before the rename.
   */
  for (const undoable of [true, false]) {
    it(`says Undo exactly when it offers Undo (undoable: ${undoable})`, () => {
      const { message, actions } = renameFailureNotification('Rename', result(), undoable);

      expect(message.includes('Undo reverses this rename')).toBe(actions.includes(UNDO_RENAME));
    });
  }

  it('names the recourse and offers the button when a reversal was recorded', () => {
    const { message, actions } = renameFailureNotification('Rename', result(), true);

    expect(message).toContain('Compiled but NOT committed — Undo reverses this rename.');
    expect(actions).toEqual([UNDO_RENAME, 'Show Details']);
  });

  it('stops at the caveat, and offers no Undo, when nothing was recorded', () => {
    const { message, actions } = renameFailureNotification('Rename', result(), false);

    expect(message).toContain('Compiled but NOT committed.');
    expect(message).not.toContain('Undo');
    expect(actions).toEqual(['Show Details']);
  });

  it('names the first failure and counts the rest', () => {
    const { message } = renameFailureNotification(
      "Rename 'count' → 'tally'",
      {
        applied: 1,
        failed: [fail('Foo>>bar', 'boom'), fail('Foo>>baz', 'bang'), fail('Foo>>qux', 'crunch')],
      },
      true,
    );

    expect(message).toContain("Rename 'count' → 'tally'");
    expect(message).toContain('applied 1 change(s), but 3 method(s)');
    expect(message).toContain('Foo>>bar: boom (+2 more)');
  });
});
