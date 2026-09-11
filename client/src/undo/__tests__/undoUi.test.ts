import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  refreshUndoUi,
  undoStateChangedCommand,
  undoVerb,
  REVERT_AVAILABLE_CONTEXT_KEY,
  UNDO_AVAILABLE_CONTEXT_KEY,
} from '../undoUi';
import { pushUndoEntry, resetUndoStacks } from '../undoStack';
import type { NewUndoEntry } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * What says whether there is anything to undo (#434).
 *
 * The BUTTON is the Actions & Navigation pane's, and what it draws is pinned in
 * `explorerNavigationView.test.ts` — it took over from a status-bar item on the review of
 * #507, which wanted one button where there had been five affordances. This module kept the
 * two halves that are not the button: the VERB, and the pair of context keys the palette
 * entries and the keybinding gate on.
 *
 * The verb matters because a class edit is reversed by binding an earlier version, which is a
 * revert and not a rollback — every message that action produces says so, and an affordance
 * that promised an Undo and handed over a Revert would be worse than one that names what it
 * will do. Every other kind is an exact undo, and these pin which is which.
 */

const session = { id: 1 } as ActiveSession;

const setContextCalls = () =>
  vi.mocked(vscode.commands.executeCommand).mock.calls.filter((c) => c[0] === 'setContext');

const contextValue = (key: string): unknown =>
  setContextCalls()
    .filter((c) => c[1] === key)
    .at(-1)?.[2];

const classEdit: NewUndoEntry = {
  kind: 'classEdit',
  sessionId: session.id,
  label: 'Redefine class Account',
  slots: [],
  before: [],
  after: [],
  stashKeys: [],
};

const methodEdit: NewUndoEntry = {
  kind: 'methodEdit',
  sessionId: session.id,
  label: 'Save Account>>#balance',
  slots: [],
  before: [],
  after: [],
};

const classComment: NewUndoEntry = {
  kind: 'classComment',
  sessionId: session.id,
  label: 'Save comment for Account',
  slot: { dict: 7, className: 'Account' },
  before: 'was',
  after: 'is',
};

const classVarEdit: NewUndoEntry = {
  kind: 'classVarEdit',
  sessionId: session.id,
  label: 'Add class variable Registry to Account',
  slot: { dict: 7, className: 'Account', varName: 'Registry' },
  before: { defined: false },
  after: { defined: true },
  accessorSlots: [],
  accessorBefore: [],
  accessorAfter: [],
};

const methodCategoryEdit: NewUndoEntry = {
  kind: 'methodCategoryEdit',
  sessionId: session.id,
  label: "Rename category 'accessing' to 'reading' in Account",
  slot: { dict: 7, className: 'Account', isMeta: false },
  before: 'accessing',
  after: 'reading',
};

const classCategoryEdit: NewUndoEntry = {
  kind: 'classCategoryEdit',
  sessionId: session.id,
  label: 'Rename class category Old to New',
  dict: 3,
  changes: [{ className: 'A', before: 'Old', after: 'New' }],
};

const dictionaryEdit: NewUndoEntry = {
  kind: 'dictionaryEdit',
  sessionId: session.id,
  label: 'Remove dictionary Reports',
  before: { present: true, name: 'Reports', index: 2 },
  after: { present: false, name: 'Reports', index: 2 },
  stashKey: 'k1',
};

const refactoring: NewUndoEntry = {
  kind: 'refactoring',
  sessionId: session.id,
  label: 'Rename #total to #sum',
  sequence: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
});

describe('the verb an entry is reversed under', () => {
  it('calls a class edit a REVERT', () => {
    // Binding an earlier class version is not a rollback: the class keeps its history and
    // anything written on the newer version is left behind on it.
    expect(undoVerb(pushUndoEntry(classEdit))).toBe('Revert');
  });

  it.each<[string, NewUndoEntry]>([
    ['a method edit', methodEdit],
    // Neither of these re-versions the class, so nothing is left behind on an older version
    // and there is nothing a "revert" would be warning about.
    ['a class comment', classComment],
    ['an added class variable', classVarEdit],
    // Nothing here is versioned either — a category is a label, not a version.
    ['a method-category rename', methodCategoryEdit],
    ['a class-category change', classCategoryEdit],
    ['a symbol-list change', dictionaryEdit],
    ['a refactoring', refactoring],
  ])('calls %s an UNDO', (_what, entry) => {
    expect(undoVerb(pushUndoEntry(entry))).toBe('Undo');
  });
});

describe('the context keys the palette and the keybinding gate on', () => {
  it('offers UNDO for a method edit, and not REVERT', () => {
    pushUndoEntry(methodEdit);

    refreshUndoUi(session);

    expect(contextValue(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(true);
    expect(contextValue(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });

  it('offers REVERT for a class edit, so nothing promises an undo', () => {
    pushUndoEntry(classEdit);

    refreshUndoUi(session);

    expect(contextValue(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(true);
    expect(contextValue(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });

  it('offers neither when there is nothing to reverse', () => {
    refreshUndoUi(session);

    expect(contextValue(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(false);
    expect(contextValue(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });

  it('offers neither when no session is selected', () => {
    // The stack is per session, so there is nothing GemStone-ish to offer without one.
    pushUndoEntry(methodEdit);

    refreshUndoUi(undefined);

    expect(contextValue(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(false);
    expect(contextValue(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });

  it('reads the most recent change, not the first one recorded', () => {
    pushUndoEntry(methodEdit);
    pushUndoEntry(classEdit);

    refreshUndoUi(session);

    expect(contextValue(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(true);
  });

  it('offers neither for a session that recorded nothing, even when another one did', () => {
    pushUndoEntry(methodEdit);

    refreshUndoUi({ id: 2 } as ActiveSession);

    expect(contextValue(UNDO_AVAILABLE_CONTEXT_KEY)).toBe(false);
    expect(contextValue(REVERT_AVAILABLE_CONTEXT_KEY)).toBe(false);
  });
});

describe('redrawing the pane that holds the button', () => {
  it('asks the Explorer to redraw, since the tooltip names the change', () => {
    pushUndoEntry(methodEdit);

    refreshUndoUi(session);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(undoStateChangedCommand);
  });

  it('survives the Explorer not being registered', () => {
    // Best-effort by design: the pane may not be resolved yet, or at all, and a refresh of
    // the context keys must not fail because of it.
    const executeCommand = vi.mocked(vscode.commands.executeCommand);
    const original = executeCommand.getMockImplementation();
    executeCommand.mockImplementation(((command: string) =>
      command === undoStateChangedCommand
        ? Promise.reject(new Error(`command '${command}' not found`))
        : Promise.resolve(undefined)) as never);

    try {
      expect(() => refreshUndoUi(session)).not.toThrow();
    } finally {
      // The tests shuffle, and clearAllMocks leaves implementations in place, so this has to
      // be put back or whichever test runs next inherits a rejecting executeCommand.
      executeCommand.mockImplementation(original as never);
    }
  });

  it('survives a command registry that answers with no promise at all', () => {
    // The API returns a Thenable, but this call is fire-and-forget from a synchronous
    // function: reaching for .then on whatever comes back is how it broke under test, and
    // would break the same way against any host that answered undefined.
    vi.mocked(vscode.commands.executeCommand).mockReturnValue(undefined as never);

    expect(() => refreshUndoUi(session)).not.toThrow();
  });
});
