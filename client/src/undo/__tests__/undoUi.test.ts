import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  createUndoStatusBarItem,
  setUndoStatusBarItem,
  refreshUndoUi,
  UNDO_AVAILABLE_CONTEXT_KEY,
  UNDO_COMMAND,
} from '../undoUi';
import { pushUndoEntry, resetUndoStacks } from '../undoStack';
import type { ActiveSession } from '../../sessionManager';

/**
 * The status-bar button (#434).
 *
 * The Explorer title-bar button is easy to miss unless you are already looking at the Explorer, so
 * the action also sits in the status bar. What these pin is what makes it findable and honest:
 * it shows and hides with the stack, it is coloured so it stands out from the neutral items
 * around it, and its tooltip says both GEMSTONE and WHICH change would be undone — the latter
 * being something a contributed menu title can never do, since those are static.
 */

const session = { id: 1 } as ActiveSession;

function fakeItem() {
  return {
    text: '',
    tooltip: '' as string | undefined,
    color: undefined as unknown,
    command: undefined as unknown,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

function recordSomething(label: string): void {
  pushUndoEntry({ kind: 'refactoring', sessionId: session.id, label, sequence: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
});

describe('the undo status-bar button', () => {
  it('is wired to the undo command and coloured to stand out', () => {
    const created = fakeItem();
    vi.mocked(vscode.window.createStatusBarItem).mockReturnValue(created as never);

    const item = createUndoStatusBarItem();

    expect(item.command).toBe(UNDO_COMMAND);
    // A real theme colour, so it renders correctly in light and dark rather than a hardcoded hex.
    expect(item.color).toBeInstanceOf(vscode.ThemeColor);
    expect((item.color as { id: string }).id).toBe('charts.purple');
  });

  it('appears when there is something to undo, naming GemStone and the change', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    recordSomething('Rename #total to #sum');

    refreshUndoUi(session);

    expect(item.show).toHaveBeenCalled();
    expect(item.tooltip).toContain('GemStone');
    // The specific change — the thing a static menu title cannot say.
    expect(item.tooltip).toContain('Rename #total to #sum');
    expect(item.text).toContain('Undo');
  });

  it('names the most recent change, not the first one recorded', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    pushUndoEntry({
      kind: 'methodEdit',
      sessionId: session.id,
      label: 'Save Account>>#balance',
      slots: [],
      before: [],
      after: [],
    });
    recordSomething('Rename #total to #sum');

    refreshUndoUi(session);

    expect(item.tooltip).toContain('Rename #total to #sum');
  });

  it('disappears once the stack is empty', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);

    refreshUndoUi(session);

    expect(item.hide).toHaveBeenCalled();
    expect(item.show).not.toHaveBeenCalled();
  });

  it('shows nothing for a session that recorded nothing, even when another one did', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    recordSomething('Rename #total to #sum');

    refreshUndoUi({ id: 2 } as ActiveSession);

    expect(item.hide).toHaveBeenCalled();
  });

  it('publishes the context key alongside, so the Explorer button tracks it', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    recordSomething('x');

    refreshUndoUi(session);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      UNDO_AVAILABLE_CONTEXT_KEY,
      true,
    );
  });

  it('does not fall over when no status item has been created', () => {
    setUndoStatusBarItem(undefined);
    recordSomething('x');

    expect(() => refreshUndoUi(session)).not.toThrow();
  });
});
