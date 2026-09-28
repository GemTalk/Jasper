import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  deleteMethod: vi.fn(() => 'Deleted'),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
  sendersOf: vi.fn(() => []),
  hierarchyImplementorsOf: vi.fn(() => []),
}));
vi.mock('../../undo/queries/methodSlotQueries', () => ({
  captureMethodSlots: vi.fn(),
  applyMethodSlotOps: vi.fn(),
}));
vi.mock('../../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import { ExplorerController, MethodItem } from '../../gemstoneExplorer';
import * as queries from '../../browserQueries';
import { window, __resetConfig } from '../../__mocks__/vscode';
import { captureMethodSlots } from '../../undo/queries/methodSlotQueries';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { MethodSearchResult } from '../../queries/methodSearch';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../../undo/undoStack';
import type { MethodSlot } from '../../undo/undoTypes';

/**
 * Removing several Methods-pane rows at once, under the same safe-delete rule as one
 * row: when nothing sends any of them they go without a question and one notice says
 * so; when anything still sends one, ONE confirmation names every method and every
 * surviving sender across all of them, answered once. The single-row rules are in
 * explorerRemoveMethod.test.ts.
 */

type SelectorInfo = {
  selector: string;
  category: string;
  overrideBits: number;
  sessionBit: number;
};

const SESSION = { id: 1 } as ActiveSession;

function makeController(session: ActiveSession | undefined = SESSION): ExplorerController {
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Array';
  return ctl;
}

function row(selector: string, isMeta = false): MethodItem {
  const info: SelectorInfo = { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 };
  return new MethodItem(isMeta, info, info.category);
}

const sender = (over: Partial<MethodSearchResult> = {}): MethodSearchResult => ({
  dictName: 'UserGlobals',
  className: 'Caller',
  isMeta: false,
  selector: 'usesIt',
  category: 'accessing',
  environmentId: 0,
  ...over,
});

/** The removal API under test: the whole selection in one call. */
const removeMethods = (ctl: ExplorerController, rows: MethodItem[]) =>
  (ctl as unknown as { removeMethods: (n: MethodItem[]) => Promise<void> }).removeMethods(rows);

const deleteMethod = queries.deleteMethod as ReturnType<typeof vi.fn>;
const canClassBeWritten = queries.canClassBeWritten as ReturnType<typeof vi.fn>;
const sendersOf = queries.sendersOf as ReturnType<typeof vi.fn>;
const hierarchyImplementorsOf = queries.hierarchyImplementorsOf as ReturnType<typeof vi.fn>;
const getClassEnvironments = queries.getClassEnvironments as ReturnType<typeof vi.fn>;
const showWarningMessage = window.showWarningMessage as ReturnType<typeof vi.fn>;
const showInformationMessage = window.showInformationMessage as ReturnType<typeof vi.fn>;
const showErrorMessage = window.showErrorMessage as ReturnType<typeof vi.fn>;

/** Every selector has a sender somewhere, so the removal has to ask. */
const everythingIsSent = () => sendersOf.mockReturnValue([sender()]);

/** The capture answers a real method for every slot it is asked about. */
const everySlotHoldsAMethod = () =>
  vi
    .mocked(captureMethodSlots)
    .mockImplementation((_exec: unknown, slots: MethodSlot[]) =>
      slots.map((sl) => ({ exists: true, source: `${sl.selector}\n\t^1`, category: 'accessing' })),
    );

/** Answer the confirmation with its Remove button, whatever it is labelled. */
const confirm = () =>
  showWarningMessage.mockImplementation((_m: string, _o: unknown, ...buttons: string[]) =>
    Promise.resolve(buttons.find((b) => /^Remove/.test(b))),
  );

/** Everything the one confirmation said: its message and its detail. */
const dialogText = (call = 0) => {
  const [message, opts] = showWarningMessage.mock.calls[call] as [string, { detail?: string }];
  return `${message}\n${opts?.detail ?? ''}`;
};

/** Selectors deleteMethod was asked to remove, in order. */
const deleted = () => deleteMethod.mock.calls.map((c) => c[3] as string);

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  resetUndoStacks();
  window.tabGroups.all = [];
  canClassBeWritten.mockReturnValue(true);
  deleteMethod.mockReturnValue('Deleted');
  sendersOf.mockReturnValue([]);
  hierarchyImplementorsOf.mockReturnValue([]);
  getClassEnvironments.mockReturnValue([]);
  showWarningMessage.mockResolvedValue(undefined);
  vi.mocked(captureMethodSlots).mockReset();
});

describe('removing several methods nothing sends', () => {
  it('removes them all without asking', async () => {
    await removeMethods(makeController(), [row('at:'), row('size'), row('new', true)]);

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', false, 'at:', 1);
    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', false, 'size', 1);
    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', true, 'new', 1);
  });

  it('says so in ONE notice that counts and names every method', async () => {
    await removeMethods(makeController(), [row('at:'), row('size'), row('new', true)]);

    expect(showInformationMessage).toHaveBeenCalledTimes(1);
    const notice = String(showInformationMessage.mock.calls[0][0]);
    expect(notice).toContain('3 methods');
    expect(notice).toContain('#at:');
    expect(notice).toContain('#size');
    expect(notice).toContain('#new');
    expect(notice).toContain('Array class');
  });

  it('does not count a send from another method in the same removal as a survivor', async () => {
    // #size sends #at:, but #size is going too, so nothing is left calling #at:.
    sendersOf.mockImplementation((_s: unknown, selector: string) =>
      selector === 'at:' ? [sender({ className: 'Array', selector: 'size' })] : [],
    );

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleted()).toEqual(['at:', 'size']);
  });

  it("carries an override's note: senders resolve to the inherited method", async () => {
    hierarchyImplementorsOf.mockImplementation(
      (_s: unknown, _d: number, _c: string, selector: string) =>
        selector === 'printOn:' ? [sender({ className: 'Object', selector: 'printOn:' })] : [],
    );

    await removeMethods(makeController(), [row('printOn:'), row('size')]);

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(String(showInformationMessage.mock.calls[0][0])).toContain('Object >> #printOn:');
  });

  it('carries the note that another environment still implements a selector', async () => {
    const ctl = makeController();
    getClassEnvironments.mockReturnValue([
      { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:', 'size'] },
      { isMeta: false, envId: 1, category: 'accessing', selectors: ['at:'] },
    ]);
    ctl.reloadCurrentClassMethods();

    await removeMethods(ctl, [row('at:'), row('size')]);

    expect(String(showInformationMessage.mock.calls[0][0])).toContain('environment 1');
  });
});

describe('removing several methods something still sends — the one confirmation', () => {
  beforeEach(everythingIsSent);

  it('asks exactly once for five rows that all have senders', async () => {
    await removeMethods(
      makeController(),
      ['a', 'b', 'c', 'd', 'e'].map((s) => row(s)),
    );

    expect(showWarningMessage).toHaveBeenCalledTimes(1);
  });

  it('asks once, and names all of them, when only ONE of them has a sender', async () => {
    sendersOf.mockImplementation((_s: unknown, selector: string) =>
      selector === 'size' ? [sender()] : [],
    );

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    expect(dialogText()).toContain('#at:');
    expect(dialogText()).toContain('#size');
  });

  it('is modal', async () => {
    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(showWarningMessage.mock.calls[0][1]).toEqual(expect.objectContaining({ modal: true }));
  });

  it('counts and names every method it is about to remove, class side included', async () => {
    await removeMethods(makeController(), [row('at:'), row('size'), row('new', true)]);

    const text = dialogText();
    expect(text).toContain('3 methods');
    expect(text).toContain('#at:');
    expect(text).toContain('#size');
    expect(text).toContain('#new');
    expect(text).toContain('Array class');
  });

  it('lists the surviving senders of every method in one list', async () => {
    sendersOf.mockImplementation((_s: unknown, selector: string) =>
      selector === 'at:'
        ? [sender({ className: 'Caller', selector: 'usesAt' })]
        : [sender({ className: 'Other', selector: 'usesSize' })],
    );

    await removeMethods(makeController(), [row('at:'), row('size')]);

    const text = dialogText();
    expect(text).toContain('Caller >> #usesAt');
    expect(text).toContain('Other >> #usesSize');
  });

  it('does not list a send from another method in the same removal', async () => {
    sendersOf.mockImplementation((_s: unknown, selector: string) =>
      selector === 'at:' ? [sender({ className: 'Array', selector: 'size' }), sender()] : [],
    );

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(dialogText()).not.toContain('Array >> #size');
  });

  it('still counts a same-named sender on the side that is NOT being removed', async () => {
    // Removing instance-side #size takes nothing from the class side.
    sendersOf.mockImplementation((_s: unknown, selector: string) =>
      selector === 'at:' ? [sender({ className: 'Array', isMeta: true, selector: 'size' })] : [],
    );

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(dialogText()).toContain('Array class >> #size');
  });

  it("keeps an override's note beside the senders of the others", async () => {
    hierarchyImplementorsOf.mockImplementation(
      (_s: unknown, _d: number, _c: string, selector: string) =>
        selector === 'printOn:' ? [sender({ className: 'Object', selector: 'printOn:' })] : [],
    );

    await removeMethods(makeController(), [row('printOn:'), row('size')]);

    expect(dialogText()).toContain('Object >> #printOn:');
  });

  it('keeps the note that another environment still implements a selector', async () => {
    const ctl = makeController();
    getClassEnvironments.mockReturnValue([
      { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:', 'size'] },
      { isMeta: false, envId: 1, category: 'accessing', selectors: ['at:'] },
    ]);
    ctl.reloadCurrentClassMethods();

    await removeMethods(ctl, [row('at:'), row('size')]);

    expect(dialogText()).toContain('also implements #at: in environment 1');
  });

  it('asks, rather than removing unasked, when one of the sender scans failed', async () => {
    sendersOf.mockImplementation((_s: unknown, selector: string) => {
      if (selector === 'size') throw new Error('a SecurityError occurred');
      return [];
    });

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    expect(dialogText()).toContain('#size');
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('removes nothing when the confirmation is dismissed', async () => {
    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('removes every selected method, on its own side, when confirmed', async () => {
    confirm();

    await removeMethods(makeController(), [row('at:'), row('new', true)]);

    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', false, 'at:', 1);
    expect(deleteMethod).toHaveBeenCalledWith(SESSION, 'Array', true, 'new', 1);
    expect(deleteMethod).toHaveBeenCalledTimes(2);
  });

  it('does not stack an announcement on the removal the user just confirmed', async () => {
    confirm();

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(showInformationMessage).not.toHaveBeenCalled();
  });
});

describe('removing several methods — the pane', () => {
  it('refreshes once, not once per method', async () => {
    const ctl = makeController();
    const reload = vi.spyOn(ctl, 'reloadCurrentClassMethods');

    await removeMethods(ctl, [row('a'), row('b'), row('c')]);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('removing several methods — one of them fails', () => {
  it('stops at the failure and names what failed, what was removed and what was not', async () => {
    deleteMethod.mockImplementation((_s: unknown, _c: string, _m: boolean, selector: string) => {
      if (selector === 'b') throw new Error('removeSelector: refused');
      return 'Deleted';
    });

    await removeMethods(makeController(), [row('a'), row('b'), row('c')]);

    expect(deleted()).toEqual(['a', 'b']);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    const error = String(showErrorMessage.mock.calls[0][0]);
    expect(error).toContain('#b');
    expect(error).toContain('removeSelector: refused');
    expect(error).toContain('#a');
    expect(error).toContain('#c');
  });

  it('treats a non-"Deleted" status as a failure too', async () => {
    deleteMethod.mockImplementation((_s: unknown, _c: string, _m: boolean, selector: string) =>
      selector === 'a' ? 'Not found' : 'Deleted',
    );

    await removeMethods(makeController(), [row('a'), row('b')]);

    expect(deleted()).toEqual(['a']);
    expect(String(showErrorMessage.mock.calls[0][0])).toContain('Not found');
  });

  it('still redraws the pane, which has lost the methods removed before the failure', async () => {
    deleteMethod.mockImplementation((_s: unknown, _c: string, _m: boolean, selector: string) => {
      if (selector === 'b') throw new Error('refused');
      return 'Deleted';
    });
    const ctl = makeController();
    const reload = vi.spyOn(ctl, 'reloadCurrentClassMethods');

    await removeMethods(ctl, [row('a'), row('b')]);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('removing several methods — undo', () => {
  type Entry = {
    label: string;
    slots: MethodSlot[];
    before: { exists: boolean }[];
    after: { exists: boolean }[];
  };
  const entry = () => peekUndoEntry(1) as unknown as Entry | undefined;
  const slotSelectors = () => (entry()?.slots ?? []).map((sl) => sl.selector);

  it('records ONE entry that restores every method removed', async () => {
    everySlotHoldsAMethod();

    await removeMethods(makeController(), [row('at:'), row('size'), row('new', true)]);

    expect(undoStackDepth(1)).toBe(1);
    expect(peekUndoEntry(1)).toMatchObject({ kind: 'methodEdit' });
    expect(slotSelectors()).toEqual(['at:', 'size', 'new']);
    expect(entry()!.slots.map((sl) => sl.isMeta)).toEqual([false, false, true]);
    expect(entry()!.before.every((st) => st.exists)).toBe(true);
    expect(entry()!.after.every((st) => !st.exists)).toBe(true);
  });

  it('labels the entry with the count and the class', async () => {
    everySlotHoldsAMethod();

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(entry()!.label).toContain('2 methods');
    expect(entry()!.label).toContain('Array');
  });

  it('captures every method before removing any of them', async () => {
    const order: string[] = [];
    vi.mocked(captureMethodSlots).mockImplementation((_e: unknown, slots: MethodSlot[]) => {
      order.push('capture');
      return slots.map(() => ({ exists: true, source: 'x', category: 'accessing' }));
    });
    deleteMethod.mockImplementation(() => {
      order.push('delete');
      return 'Deleted';
    });

    await removeMethods(makeController(), [row('a'), row('b')]);

    expect(order).toContain('capture');
    expect(order.indexOf('delete')).toBeGreaterThan(order.lastIndexOf('capture'));
  });

  it('puts Undo on the one silent-removal notice', async () => {
    everySlotHoldsAMethod();

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(showInformationMessage).toHaveBeenCalledTimes(1);
    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 methods'),
      'Undo',
    );
  });

  it('records the entry quietly after a confirmed removal', async () => {
    everythingIsSent();
    confirm();
    everySlotHoldsAMethod();

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(slotSelectors()).toEqual(['at:', 'size']);
  });

  it('covers only the methods actually removed when one fails part-way', async () => {
    // Offering to restore #b or #c would restore methods that never went away.
    everySlotHoldsAMethod();
    deleteMethod.mockImplementation((_s: unknown, _c: string, _m: boolean, selector: string) => {
      if (selector === 'b') throw new Error('refused');
      return 'Deleted';
    });

    await removeMethods(makeController(), [row('a'), row('b'), row('c')]);

    expect(undoStackDepth(1)).toBe(1);
    expect(slotSelectors()).toEqual(['a']);
  });

  it('records nothing when the first removal fails', async () => {
    everySlotHoldsAMethod();
    deleteMethod.mockReturnValue('Not found');

    await removeMethods(makeController(), [row('a'), row('b')]);

    expect(peekUndoEntry(1)).toBeUndefined();
  });

  it('records nothing, and captures nothing, when the confirmation is dismissed', async () => {
    everythingIsSent();
    everySlotHoldsAMethod();

    await removeMethods(makeController(), [row('a'), row('b')]);

    expect(captureMethodSlots).not.toHaveBeenCalled();
    expect(peekUndoEntry(1)).toBeUndefined();
  });

  it('still removes them all when the capture fails, just without an undo', async () => {
    vi.mocked(captureMethodSlots).mockImplementation(() => {
      throw new Error('session busy');
    });

    await removeMethods(makeController(), [row('a'), row('b')]);

    expect(deleted()).toEqual(['a', 'b']);
    expect(peekUndoEntry(1)).toBeUndefined();
  });
});

describe('removing several methods — guards', () => {
  it('does nothing for an empty selection', async () => {
    await removeMethods(makeController(), []);

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });

  it('keeps the single-row wording for a selection of one', async () => {
    await removeMethods(makeController(), [row('at:')]);

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleted()).toEqual(['at:']);
    expect(showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Removed method #at: from Array'),
    );
  });

  it('removes a row selected twice only once', async () => {
    await removeMethods(makeController(), [row('at:'), row('at:'), row('size')]);

    expect(deleted()).toEqual(['at:', 'size']);
  });

  it('asks nothing and removes nothing on a class that cannot be written', async () => {
    canClassBeWritten.mockReturnValue(false);

    await removeMethods(makeController(), [row('at:'), row('size')]);

    expect(deleteMethod).not.toHaveBeenCalled();
    expect(showWarningMessage).toHaveBeenCalledTimes(1);
    expect(dialogText()).toContain('cannot be modified');
  });

  it('does nothing without a selected session', async () => {
    await removeMethods(makeController(undefined), [row('at:'), row('size')]);

    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(deleteMethod).not.toHaveBeenCalled();
  });
});
