import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({
  moveClass: vi.fn(() => 'Moved class: Account'),
  recategorizeClass: vi.fn(() => 'Recategorized: Account'),
  getDictionaryNames: vi.fn(() => ['UserGlobals', 'Reports', 'Globals']),
  getClassesWithCategory: vi.fn(() => []),
  canClassBeWritten: vi.fn(() => true),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
vi.mock('../undo/queries/classSlotQueries', () => ({
  captureClassSlots: vi.fn(),
  newStashKey: vi.fn(() => 'k1'),
}));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { captureClassSlots } from '../undo/queries/classSlotQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undo/undoStack';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Moving a class from the Explorer — to another dictionary, or to another class category.
 *
 * Both are offered on the Classes pane and the Hierarchy pane, and both are recorded (#434).
 * The two are deliberately different shapes: a DICTIONARY move rebinds the class object, so it
 * is a class edit over two names; a CATEGORY move changes a label on the class, so it is
 * recorded per class.
 */

const entry = (className: string, category: string) => ({ className, category, hasComment: false });
const bound = (oop: string) => ({ bound: true, oop, selectors: [] });
const unbound = { bound: false, oop: null, selectors: [] };

// `null` means "no selected session" — passing `undefined` would trigger the default.
function makeController(session: ActiveSession | null = { id: 1 } as ActiveSession) {
  const sessionManager = {
    getSelectedSession: () => session ?? undefined,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.className = 'Account';
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  vi.spyOn(ctl.categoryProvider, 'refresh').mockImplementation(() => {});
  vi.spyOn(ctl.classProvider, 'refresh').mockImplementation(() => {});
  vi.spyOn(
    ctl as unknown as { refreshRetainingSelection: () => Promise<void> },
    'refreshRetainingSelection',
  ).mockResolvedValue();
  return ctl;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  vi.mocked(queries.moveClass).mockReturnValue('Moved class: Account');
  vi.mocked(queries.recategorizeClass).mockReturnValue('Recategorized: Account');
  vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
  vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals', 'Reports', 'Globals']);
  vi.mocked(captureClassSlots).mockReset();
});

describe('ExplorerController.moveClassToDictionary', () => {
  it('offers every dictionary EXCEPT the one the class is already in', async () => {
    const ctl = makeController();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await ctl.moveClassToDictionary();

    const offered = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as {
      label: string;
    }[];
    expect(offered.map((c) => c.label)).toEqual(['Reports', 'Globals']);
  });

  it('moves the class and records both names, so undo can put it back', async () => {
    const ctl = makeController();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
      label: 'Reports',
      index: 2,
    } as never);
    let capture = 0;
    vi.mocked(captureClassSlots).mockImplementation((_e, slots) => {
      capture += 1;
      return slots.map((s) =>
        capture === 1
          ? s.dict === 1
            ? bound('100')
            : unbound
          : s.dict === 1
            ? unbound
            : bound('100'),
      );
    });

    await ctl.moveClassToDictionary();

    expect(queries.moveClass).toHaveBeenCalledWith(expect.anything(), 1, 2, 'Account');
    const recorded = peekUndoEntry(1);
    expect(recorded).toMatchObject({
      kind: 'classEdit',
      label: 'Move class Account to Reports',
    });
    // The name it left, then the name it arrived under.
    expect(recorded?.kind === 'classEdit' && recorded.slots.map((s) => s.dict)).toEqual([1, 2]);
  });

  it('refuses a class the repository will not let you write', async () => {
    const ctl = makeController();
    vi.mocked(queries.canClassBeWritten).mockReturnValue(false);

    await ctl.moveClassToDictionary();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(queries.moveClass).not.toHaveBeenCalled();
  });

  it('records nothing when the stone answered with a status string', async () => {
    const ctl = makeController();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
      label: 'Reports',
      index: 2,
    } as never);
    vi.mocked(queries.moveClass).mockReturnValue('Class not found in source dictionary: Account');

    await ctl.moveClassToDictionary();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Class not found'),
    );
    expect(undoStackDepth(1)).toBe(0);
  });

  it('says so when there is nowhere else to move it', async () => {
    const ctl = makeController();
    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals']);

    await ctl.moveClassToDictionary();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no other dictionary'),
    );
  });

  it('does nothing without a selected session', async () => {
    const ctl = makeController(null);

    await ctl.moveClassToDictionary();

    expect(queries.moveClass).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.moveClassToCategory', () => {
  it('files the class under the chosen category and records it per class', async () => {
    const ctl = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
      entry('Other', 'Printing'),
    ];
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Printing' as never);
    vi.mocked(queries.getClassesWithCategory)
      .mockReturnValueOnce([entry('Account', 'Banking')])
      .mockReturnValue([entry('Account', 'Printing')]);

    await ctl.moveClassToCategory();

    expect(queries.recategorizeClass).toHaveBeenCalledWith(
      expect.anything(),
      'Account',
      'Printing',
      1,
    );
    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'classCategoryEdit',
      label: 'Move class Account to category Printing',
      changes: [{ className: 'Account', before: 'Banking', after: 'Printing' }],
    });
  });

  it('offers a still-empty category from the + button — filing a class is what makes it real', async () => {
    const ctl = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
    ];
    (ctl as unknown as { newClassCategories: Set<string> }).newClassCategories = new Set(['Fresh']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await ctl.moveClassToCategory();

    expect(vi.mocked(vscode.window.showQuickPick).mock.calls[0][0]).toEqual(['Banking', 'Fresh']);
  });

  it('records nothing when the stone answered with a status string', async () => {
    const ctl = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
    ];
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Printing' as never);
    vi.mocked(queries.recategorizeClass).mockReturnValue('Class not found: Account');

    await ctl.moveClassToCategory();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Class not found'),
    );
    expect(undoStackDepth(1)).toBe(0);
  });

  it('says so when the dictionary has no categories yet', async () => {
    const ctl = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [];

    await ctl.moveClassToCategory();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no class categories'),
    );
  });
});
