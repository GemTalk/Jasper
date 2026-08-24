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
 * it STAYS PUT while a session is connected — dimmed rather than gone when there is nothing to
 * undo, because a control that is usually absent cannot be learned — it is coloured so it stands
 * out from the neutral items around it, and its tooltip says both GEMSTONE and WHICH change would
 * be undone, the latter being something a contributed menu title can never do, since those are
 * static.
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

  it('calls a class edit a REVERT, in the button and the tooltip', () => {
    // Every message that action goes on to produce says "Revert" — binding an earlier class
    // version is not a rollback. Promising an Undo and handing over a Revert would be worse
    // than one button that names what it will do.
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    pushUndoEntry({
      kind: 'classEdit',
      sessionId: session.id,
      label: 'Redefine class Account',
      slots: [],
      before: [],
      after: [],
      stashKeys: [],
    });

    refreshUndoUi(session);

    expect(item.text).toContain('Revert');
    expect(item.text).not.toContain('Undo');
    expect(item.tooltip).toBe('GemStone — Revert: Redefine class Account (Ctrl+K U)');
  });

  it('separates the verb from the label, so two verbs do not run together', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    pushUndoEntry({
      kind: 'methodEdit',
      sessionId: session.id,
      label: 'Delete Account>>#balance',
      slots: [],
      before: [],
      after: [],
    });

    refreshUndoUi(session);

    expect(item.tooltip).toBe('GemStone — Undo: Delete Account>>#balance (Ctrl+K U)');
  });

  it('names its keybinding, which is how the shortcut gets learned', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    recordSomething('Rename #total to #sum');

    refreshUndoUi(session);

    expect(item.tooltip).toContain('Ctrl+K U');
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

  it('stays put, dimmed, when there is nothing to undo', () => {
    // The whole point: a button that vanishes when it is not usable can be found once, by
    // accident, and then never again — there is nowhere to look when it is not there.
    const item = fakeItem();
    setUndoStatusBarItem(item as never);

    refreshUndoUi(session);

    expect(item.show).toHaveBeenCalled();
    expect(item.hide).not.toHaveBeenCalled();
    expect((item.color as { id: string }).id).toBe('disabledForeground');
    // Dimmed still says what it is for, so clicking it is not a mystery.
    expect(item.tooltip).toContain('nothing to undo');
  });

  it('dims for a session that recorded nothing, even when another one did', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    recordSomething('Rename #total to #sum');

    refreshUndoUi({ id: 2 } as ActiveSession);

    expect((item.color as { id: string }).id).toBe('disabledForeground');
  });

  it('goes away entirely when no session is selected', () => {
    // Undo is per session; with none there is nothing GemStone-ish to offer.
    const item = fakeItem();
    setUndoStatusBarItem(item as never);

    refreshUndoUi(undefined);

    expect(item.hide).toHaveBeenCalled();
    expect(item.show).not.toHaveBeenCalled();
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
