import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  createUndoStatusBarItem,
  setUndoStatusBarItem,
  refreshUndoUi,
  REVERT_AVAILABLE_CONTEXT_KEY,
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

  it('calls a class comment and a class variable an UNDO, not a revert', () => {
    // Neither re-versions the class, so nothing is left behind on an older version and there
    // is nothing a "revert" would be warning about.
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    pushUndoEntry({
      kind: 'classComment',
      sessionId: session.id,
      label: 'Save comment for Account',
      slot: { dict: 7, className: 'Account' },
      before: 'was',
      after: 'is',
    });

    refreshUndoUi(session);
    expect(item.tooltip).toBe('GemStone — Undo: Save comment for Account (Ctrl+K U)');

    pushUndoEntry({
      kind: 'classVarEdit',
      sessionId: session.id,
      label: 'Add class variable Registry to Account',
      slot: { dict: 7, className: 'Account', varName: 'Registry' },
      before: { defined: false },
      after: { defined: true },
      accessorSlots: [],
      accessorBefore: [],
      accessorAfter: [],
    });

    refreshUndoUi(session);
    expect(item.text).toContain('Undo');
    expect(item.tooltip).toBe('GemStone — Undo: Add class variable Registry to Account (Ctrl+K U)');
  });

  it('calls a category rename and a symbol-list change an UNDO too', () => {
    // Nothing here is versioned, so nothing is left behind and there is no revert to warn of.
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    pushUndoEntry({
      kind: 'methodCategoryEdit',
      sessionId: session.id,
      label: "Rename category 'accessing' to 'reading' in Account",
      slot: { dict: 7, className: 'Account', isMeta: false },
      before: 'accessing',
      after: 'reading',
    });

    refreshUndoUi(session);
    expect(item.text).toContain('Undo');
    expect(item.tooltip).toContain("Undo: Rename category 'accessing' to 'reading' in Account");

    pushUndoEntry({
      kind: 'dictionaryEdit',
      sessionId: session.id,
      label: 'Remove dictionary Reports',
      before: { present: true, name: 'Reports', index: 2 },
      after: { present: false, name: 'Reports', index: 2 },
      stashKey: 'k1',
    });

    refreshUndoUi(session);
    expect(item.tooltip).toBe('GemStone — Undo: Remove dictionary Reports (Ctrl+K U)');
  });

  it('calls a class-category change an UNDO — a category is a label, not a version', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    pushUndoEntry({
      kind: 'classCategoryEdit',
      sessionId: session.id,
      label: 'Rename class category Old to New',
      dict: 3,
      changes: [{ className: 'A', before: 'Old', after: 'New' }],
    });

    refreshUndoUi(session);

    expect(item.text).toContain('Undo');
    expect(item.tooltip).toBe('GemStone — Undo: Rename class category Old to New (Ctrl+K U)');
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

  /** What `setContext` was last told about a key. */
  const contextKey = (key: string): unknown => {
    const calls = vi
      .mocked(vscode.commands.executeCommand)
      .mock.calls.filter((c) => c[0] === 'setContext' && c[1] === key);
    return calls.length > 0 ? calls[calls.length - 1][2] : undefined;
  };

  const pushClassEdit = (): void => {
    pushUndoEntry({
      kind: 'classEdit',
      sessionId: session.id,
      label: 'Redefine class Account',
      slots: [{ dict: 'UserGlobals', className: 'Account' }],
      before: [{ bound: true, oop: '1', selectors: [] }],
      after: [{ bound: true, oop: '2', selectors: [] }],
      stashKeys: ['k1'],
    });
  };

  it('offers the UNDO icon for a method edit, and not the revert one', () => {
    // A contributed menu title is a fixed string, so the title-bar icons and the palette
    // cannot name the change. The verb is the part they CAN follow: one command per verb,
    // gated on these two booleans, so exactly one icon is ever showing.
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    recordSomething('x');

    refreshUndoUi(session);

    expect(contextKey(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(true);
    expect(contextKey(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });

  it('offers the REVERT icon for a class edit, so no affordance promises an undo', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);
    pushClassEdit();

    refreshUndoUi(session);

    expect(contextKey(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(true);
    expect(contextKey(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });

  it('offers neither when there is nothing to reverse', () => {
    const item = fakeItem();
    setUndoStatusBarItem(item as never);

    refreshUndoUi(session);

    expect(contextKey(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(false);
    expect(contextKey(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });

  it('does not fall over when no status item has been created', () => {
    setUndoStatusBarItem(undefined);
    recordSomething('x');

    expect(() => refreshUndoUi(session)).not.toThrow();
  });
});
