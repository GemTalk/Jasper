import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what renameClassCategory touches.
vi.mock('../browserQueries', () => ({
  renameClassCategory: vi.fn(),
  getClassesWithCategory: vi.fn().mockReturnValue([]),
}));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undo/undoStack';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

// A ClassCategoryItem-shaped node: the handler reads segment + fullPath.
const NODE = { segment: 'Announcements', fullPath: 'Announcements' } as never;
// A nested node: segment is the last dash-segment, fullPath the whole path.
const NESTED_NODE = { segment: 'Core', fullPath: 'Announcements-Core' } as never;
// A node whose name carries a wide (non-ASCII) character. Fine in a .ts literal;
// only GemStone's 3.6.x compiler chokes on it as a doit source literal.
const WIDE_NODE = { segment: '類', fullPath: 'Demo-類' } as never;

type WithEntries = { classCategoryEntries: { className: string; category: string }[] };

function makeController(
  session: ActiveSession | undefined,
  entries: { className: string; category: string }[] = [],
) {
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictIndex = 3;
  (ctl as unknown as WithEntries).classCategoryEntries = entries;
  const refresh = vi.spyOn(ctl.categoryProvider, 'refresh').mockImplementation(() => {});
  vi.spyOn(ctl.classProvider, 'refresh').mockImplementation(() => {});
  vi.spyOn(ctl.methodProvider, 'refresh').mockImplementation(() => {});
  return { ctl, refresh };
}

describe('ExplorerController.renameClassCategory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.getClassesWithCategory).mockReturnValue([]);
  });

  it('does nothing without a session', async () => {
    const { ctl } = makeController(undefined);
    await ctl.renameClassCategory(NODE);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(queries.renameClassCategory).not.toHaveBeenCalled();
  });

  it('does nothing when the name prompt is cancelled', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await ctl.renameClassCategory(NODE);
    expect(queries.renameClassCategory).not.toHaveBeenCalled();
  });

  it('does nothing when the name is unchanged', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Announcements');
    await ctl.renameClassCategory(NODE);
    expect(queries.renameClassCategory).not.toHaveBeenCalled();
  });

  it('reassigns server classes in the subtree, refetches and reveals on success', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
      { className: 'Bar', category: 'Announcements-Core' },
      { className: 'Baz', category: 'Unrelated' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 2');

    await ctl.renameClassCategory(NODE);

    expect(queries.renameClassCategory).toHaveBeenCalledWith(
      expect.anything(),
      3,
      'Announcements',
      'Events',
    );
    // Refetch the dictionary's class/category data afterward.
    expect(queries.getClassesWithCategory).toHaveBeenCalledWith(expect.anything(), 3);
    expect(refresh).toHaveBeenCalled();
    // Success is reported on a notice now, not the status bar — that is what can carry Undo
    // (#434). No class moved in this fixture, so there is no entry and no button.
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Events'),
    );
  });

  it('surfaces a query throw and does not refetch', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockImplementation(() => {
      throw new Error('boom');
    });
    await ctl.renameClassCategory(NODE);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    // The one call is the undo recorder's snapshot, taken before the rename ran (#434); the
    // refetch afterwards is what must not have happened.
    expect(queries.getClassesWithCategory).toHaveBeenCalledTimes(1);
  });

  it('seeds the prompt with the single node segment, not the full path', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements-Core' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await ctl.renameClassCategory(NESTED_NODE);
    const opts = vi.mocked(vscode.window.showInputBox).mock.calls[0][0];
    expect(opts?.value).toBe('Core');
    expect(opts?.valueSelection).toEqual([0, 'Core'.length]);
  });

  it('renames only the node and rebuilds the full path from the unchanged parent', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements-Core' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Kernel');
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 1');

    await ctl.renameClassCategory(NESTED_NODE);

    // Parent 'Announcements' is preserved; only the 'Core' node becomes 'Kernel'.
    expect(queries.renameClassCategory).toHaveBeenCalledWith(
      expect.anything(),
      3,
      'Announcements-Core',
      'Announcements-Kernel',
    );
  });

  it('rejects a blank name or one containing a dash, accepts a plain node', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await ctl.renameClassCategory(NODE);
    const opts = vi.mocked(vscode.window.showInputBox).mock.calls[0][0];
    const validate = opts?.validateInput as (v: string) => string | undefined;
    expect(validate('   ')).toBe('Enter a category name.');
    expect(validate('Demo-Cat-Foo')).toBe("Enter a single category node (no '-').");
    expect(validate('Events')).toBeUndefined();
  });

  it('blocks renaming a non-ASCII category on a pre-3.7 stone with a clean message, no prompt', async () => {
    const { ctl } = makeController({ stoneVersion: '3.6.2' } as ActiveSession, [
      { className: 'Foo', category: 'Demo-類' },
    ]);
    await ctl.renameClassCategory(WIDE_NODE);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('3.6.2'));
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(queries.renameClassCategory).not.toHaveBeenCalled();
  });

  it('validateInput rejects a non-ASCII new name on a pre-3.7 stone but allows it on 3.7+', async () => {
    const grabValidate = () =>
      vi.mocked(vscode.window.showInputBox).mock.calls[0][0]?.validateInput as (
        v: string,
      ) => string | undefined;

    // Pre-3.7: a wide new name is rejected in the input box.
    const pre = makeController({ stoneVersion: '3.6.2' } as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await pre.ctl.renameClassCategory(NODE);
    expect(grabValidate()('日本')).toContain('3.6.2');

    vi.clearAllMocks();

    // 3.7+: the same wide name is accepted (UTF-8 source is supported).
    const post = makeController({ stoneVersion: '3.7.5' } as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await post.ctl.renameClassCategory(NODE);
    expect(grabValidate()('日本')).toBeUndefined();
  });

  it('always runs the query (never gates on the cached view) and reports success for an overlay-only category (MED-3)', async () => {
    // No server classes the client knows of under the category, but the query still
    // runs (the cache could be stale); the server answers renamed: 0 harmlessly.
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Baz', category: 'Unrelated' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 0');

    await ctl.renameClassCategory(NODE);

    expect(queries.renameClassCategory).toHaveBeenCalledWith(
      expect.anything(),
      3,
      'Announcements',
      'Events',
    );
    expect(queries.getClassesWithCategory).toHaveBeenCalled();
    // The client didn't expect classes here, so renamed: 0 is fine — success shown.
    // Success is reported on a notice now, not the status bar — that is what can carry Undo
    // (#434). No class moved in this fixture, so there is no entry and no button.
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Events'),
    );
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns instead of reporting success when the server moved 0 but the client expected classes (stale view, MED-2)', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 0');

    await ctl.renameClassCategory(NODE);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('out of date'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('warns about classes skipped because their category could not be read (LOW-2)', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 2 skipped: 1');

    await ctl.renameClassCategory(NODE);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('could not be read'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('treats an unrecognised payload as an error, not success (MED-2)', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockReturnValue('unexpected server reply');

    await ctl.renameClassCategory(NODE);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('unexpected server reply'),
    );
    // Bailed before refetch / success. The one call is the undo recorder's snapshot, taken
    // before the rename ran (#434); the refetch afterwards is what must not have happened.
    expect(queries.getClassesWithCategory).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('carries newClassCategories overlay entries and remaps state.classCategory across the rename, preserving suffixes', async () => {
    // Client-side bookkeeping the server never sees: empty (overlay) categories the
    // user added, and the currently-selected category. Both must follow the rename,
    // with the suffix below the renamed node preserved (suffix-slicing is easy to get
    // off by one). Seed some in the subtree and one outside it.
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    const overlay = (ctl as unknown as { newClassCategories: Set<string> }).newClassCategories;
    overlay.add('Announcements'); // the renamed node itself
    overlay.add('Announcements-Core-Empty'); // a descendant, suffix '-Core-Empty'
    overlay.add('Unrelated-Empty'); // outside the subtree — must be left alone
    ctl.state.classCategory = 'Announcements-Core'; // selection inside the renamed subtree

    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 1');

    await ctl.renameClassCategory(NODE);

    // Subtree overlay entries move onto the new prefix (suffix preserved); the
    // unrelated one is untouched.
    expect([...overlay].sort()).toEqual(['Events', 'Events-Core-Empty', 'Unrelated-Empty']);
    // The selected category is remapped onto the new path, suffix preserved.
    expect(ctl.state.classCategory).toBe('Events-Core');
  });

  it('leaves state.classCategory alone when the selection is outside the renamed subtree', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    ctl.state.classCategory = 'Announcementss-Core'; // shares a prefix but is NOT in the subtree

    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 1');

    await ctl.renameClassCategory(NODE);

    // `Announcementss-Core` starts with `Announcements` but not `Announcements-`, so it
    // is not a subtree member and must be left unchanged (guards the `startsWith` edge).
    expect(ctl.state.classCategory).toBe('Announcementss-Core');
  });
});

describe('ExplorerController.renameClassCategory — undo (#434)', () => {
  const entries = (m: Record<string, string>) =>
    Object.entries(m).map(([className, category]) => ({ className, category, hasComment: false }));

  beforeEach(() => {
    resetUndoStacks();
    // mockReset, not clearAllMocks: clearing leaves the `...Once` queue in place, so a
    // per-test queue would be answered in a later test instead.
    vi.mocked(queries.getClassesWithCategory).mockReset();
    vi.mocked(queries.renameClassCategory).mockReset();
    vi.mocked(queries.renameClassCategory).mockReturnValue('renamed: 2');
  });

  it('records each class under its OWN former label, so a merge is reversible', async () => {
    // Renaming onto an existing category MERGES into it. Putting the NAME back would drag the
    // classes that were already there along; putting each class's own label back does not.
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Existing');
    vi.mocked(queries.getClassesWithCategory)
      .mockReturnValueOnce(entries({ A: 'Announcements', B: 'Existing' }))
      .mockReturnValue(entries({ A: 'Existing', B: 'Existing' }));

    await ctl.renameClassCategory(NODE);

    expect(peekUndoEntry(1)).toMatchObject({
      kind: 'classCategoryEdit',
      label: 'Rename class category Announcements to Existing',
      changes: [{ className: 'A', before: 'Announcements', after: 'Existing' }],
    });
  });

  it('records the whole dash-segmented subtree, each with its own label', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Renamed');
    vi.mocked(queries.getClassesWithCategory)
      .mockReturnValueOnce(entries({ A: 'Announcements', B: 'Announcements-Core' }))
      .mockReturnValue(entries({ A: 'Renamed', B: 'Renamed-Core' }));

    await ctl.renameClassCategory(NODE);

    const entry = peekUndoEntry(1);
    expect(entry?.kind === 'classCategoryEdit' && entry.changes.map((c) => c.before)).toEqual([
      'Announcements',
      'Announcements-Core',
    ]);
  });

  it('records nothing when the server refused the rename', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Renamed');
    vi.mocked(queries.renameClassCategory).mockReturnValue('Dictionary not found');
    vi.mocked(queries.getClassesWithCategory).mockReturnValue(entries({ A: 'Announcements' }));

    await ctl.renameClassCategory(NODE);

    expect(undoStackDepth(1)).toBe(0);
  });

  it('records nothing when no class actually moved', async () => {
    const { ctl } = makeController({ id: 1 } as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Renamed');
    vi.mocked(queries.getClassesWithCategory).mockReturnValue(entries({ A: 'Announcements' }));

    await ctl.renameClassCategory(NODE);

    expect(undoStackDepth(1)).toBe(0);
  });
});
