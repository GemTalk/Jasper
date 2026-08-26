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
  vi.spyOn(ctl.methodProvider, 'refresh').mockImplementation(() => {});
  const categoryReveal = vi.fn().mockResolvedValue(undefined);
  ctl.setViews({
    dict: { reveal: vi.fn().mockResolvedValue(undefined) },
    category: { reveal: categoryReveal },
    klass: { reveal: vi.fn().mockResolvedValue(undefined) },
    hierarchy: { reveal: vi.fn().mockResolvedValue(undefined) },
    method: { reveal: vi.fn().mockResolvedValue(undefined) },
  } as never);
  // revealClass is the pane cascade; stubbed so these tests assert WHAT the move reveals rather
  // than re-exercising the whole refresh path (covered by its own tests). The stub keeps the one
  // side effect the callers depend on: revealClass REFETCHES the dictionary's class categories,
  // and the category selection that follows a move reads them to decide whether the class is
  // still in view.
  const reveal = vi
    .spyOn(
      ctl as unknown as {
        revealClass: (d: string, i: number, c: string) => Promise<void>;
      },
      'revealClass',
    )
    .mockImplementation(async (_d: string, i: number) => {
      (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries =
        queries.getClassesWithCategory({} as ActiveSession, i);
    });
  return { ctl, reveal, categoryReveal };
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
    const { ctl } = makeController();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await ctl.moveClassToDictionary();

    const offered = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as {
      label: string;
    }[];
    expect(offered.map((c) => c.label)).toEqual(['Reports', 'Globals']);
  });

  it('moves the class and records both names, so undo can put it back', async () => {
    const { ctl } = makeController();
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

  it('follows the class to its new dictionary rather than leaving the panes behind', async () => {
    const { ctl, reveal } = makeController();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
      label: 'Reports',
      index: 2,
    } as never);

    await ctl.moveClassToDictionary();

    expect(reveal).toHaveBeenCalledWith('Reports', 2, 'Account');
  });

  it('drops the stale corpus entry for the dictionary the class left', async () => {
    // Anything caching classes by dictionary now has a row that will not open.
    const onClassRemoved = vi.fn();
    const sessionManager = {
      getSelectedSession: () => ({ id: 1 }) as ActiveSession,
    } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager, undefined, onClassRemoved);
    ctl.state.className = 'Account';
    ctl.state.dictName = 'UserGlobals';
    ctl.state.dictIndex = 1;
    vi.spyOn(
      ctl as unknown as { revealClass: () => Promise<void> },
      'revealClass',
    ).mockResolvedValue();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue({
      label: 'Reports',
      index: 2,
    } as never);

    await ctl.moveClassToDictionary();

    expect(onClassRemoved).toHaveBeenCalledWith(1, 'Account');
  });

  it('refuses a class the repository will not let you write', async () => {
    const { ctl } = makeController();
    vi.mocked(queries.canClassBeWritten).mockReturnValue(false);

    await ctl.moveClassToDictionary();

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(queries.moveClass).not.toHaveBeenCalled();
  });

  it('records nothing when the stone answered with a status string', async () => {
    const { ctl } = makeController();
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
    const { ctl } = makeController();
    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals']);

    await ctl.moveClassToDictionary();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no other dictionary'),
    );
  });

  it('does nothing without a selected session', async () => {
    const { ctl } = makeController(null);

    await ctl.moveClassToDictionary();

    expect(queries.moveClass).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.moveClassToCategory', () => {
  it('files the class under the chosen category and records it per class', async () => {
    const { ctl } = makeController();
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

  it('re-cascades the panes, so the new category shows and a stale filter is dropped', async () => {
    const { ctl, reveal } = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
    ];
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Printing' as never);

    await ctl.moveClassToCategory();

    expect(reveal).toHaveBeenCalledWith('UserGlobals', 1, 'Account');
  });

  it('SELECTS the category the user named, which revealClass alone does not', async () => {
    // revealClass deliberately leaves a class's own category unpinned; this is not an
    // incidental reveal, so the category the user chose is the one to highlight.
    const { ctl, categoryReveal } = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
    ];
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Printing' as never);
    vi.mocked(queries.getClassesWithCategory)
      .mockReturnValueOnce([entry('Account', 'Banking')])
      .mockReturnValue([entry('Account', 'Printing')]);

    await ctl.moveClassToCategory();

    expect(ctl.state.classCategory).toBe('Printing');
    expect(categoryReveal).toHaveBeenCalledWith(
      expect.objectContaining({ fullPath: 'Printing' }),
      expect.objectContaining({ select: true }),
    );
  });

  it('keeps the class selected, since it is inside the category being selected', async () => {
    const { ctl } = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
    ];
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Printing' as never);
    vi.mocked(queries.getClassesWithCategory)
      .mockReturnValueOnce([entry('Account', 'Banking')])
      .mockReturnValue([entry('Account', 'Printing')]);

    await ctl.moveClassToCategory();

    expect(ctl.state.className).toBe('Account');
  });

  it('selects the LAST segment of a dash-segmented category path', async () => {
    const { ctl, categoryReveal } = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
    ];
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Reports-Monthly' as never);
    vi.mocked(queries.getClassesWithCategory)
      .mockReturnValueOnce([entry('Account', 'Banking')])
      .mockReturnValue([entry('Account', 'Reports-Monthly')]);

    await ctl.moveClassToCategory();

    expect(categoryReveal).toHaveBeenCalledWith(
      expect.objectContaining({ segment: 'Monthly', fullPath: 'Reports-Monthly' }),
      expect.anything(),
    );
  });

  it('offers a still-empty category from the + button — filing a class is what makes it real', async () => {
    const { ctl } = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
      entry('Account', 'Banking'),
    ];
    (ctl as unknown as { newClassCategories: Set<string> }).newClassCategories = new Set(['Fresh']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await ctl.moveClassToCategory();

    expect(vi.mocked(vscode.window.showQuickPick).mock.calls[0][0]).toEqual(['Banking', 'Fresh']);
  });

  it('records nothing when the stone answered with a status string', async () => {
    const { ctl } = makeController();
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
    const { ctl } = makeController();
    (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [];

    await ctl.moveClassToCategory();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no class categories'),
    );
  });
});
