import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what renameClassCategory touches.
vi.mock('../browserQueries', () => ({
  renameClassCategory: vi.fn(),
  getClassesWithCategory: vi.fn().mockReturnValue([]),
}));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
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

  it('does nothing when the prompt is cancelled or unchanged', async () => {
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Foo', category: 'Announcements' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);
    await ctl.renameClassCategory(NODE);
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce('Announcements');
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
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('Events'),
      expect.any(Number),
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
    expect(queries.getClassesWithCategory).not.toHaveBeenCalled();
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

  it('renames a still-empty overlay-only category without a server round-trip', async () => {
    // No server classes under the category, so the server query must not run.
    const { ctl } = makeController({} as ActiveSession, [
      { className: 'Baz', category: 'Unrelated' },
    ]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Events');

    await ctl.renameClassCategory(NODE);

    expect(queries.renameClassCategory).not.toHaveBeenCalled();
    // Still redraws (overlay carry) and refetches for consistency.
    expect(queries.getClassesWithCategory).toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('Events'),
      expect.any(Number),
    );
  });
});
