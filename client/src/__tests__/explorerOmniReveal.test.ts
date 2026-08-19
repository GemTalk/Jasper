/**
 * GemStone Search → Explorer reveal robustness.
 *
 * revealDictionaryByName no longer swallows a failed TreeView.reveal with a bare
 * `catch { /* ignore *\/ }`; it logs to the durable GCI channel (mirroring the
 * category-reveal path) so a future failure is diagnosable instead of invisible.
 *
 * revealCategoryByPath checks the category actually exists in the dictionary's loaded
 * forest BEFORE selectClassCategory mutates the category/classes panes. A missing category
 * must leave the category/classes panes untouched (and warn) rather than scroll them to a node
 * that isn't there — which looked like the jump "landed nowhere" (the reported bug). The home
 * dictionary is selected before the check and deliberately stays selected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller imports browserQueries (→ native GCI). Only the two calls these reveal
// paths make need answering; every other query in selectDict is try/caught to an empty map.
vi.mock('../browserQueries', () => ({
  getClassesWithCategory: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['UserGlobals']),
}));
vi.mock('../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import { getClassesWithCategory, getDictionaryNames } from '../browserQueries';
import { logWarning } from '../gciLog';
import type { SessionManager, ActiveSession } from '../sessionManager';

const classesInDict = getClassesWithCategory as ReturnType<typeof vi.fn>;
const dictNames = getDictionaryNames as ReturnType<typeof vi.fn>;

const SESSION = { id: 1 } as ActiveSession;

function makeController(): ExplorerController {
  const sessionManager = {
    getSelectedSession: () => SESSION,
    resolveSession: () => Promise.resolve(SESSION),
  } as unknown as SessionManager;
  return new ExplorerController(sessionManager);
}

// A TreeView-shaped stub; `reveal` defaults to resolving, overridable per view.
function fakeView(reveal: () => Promise<void> = async () => {}) {
  return { reveal: vi.fn(reveal), selection: [] as unknown[], description: '', visible: true };
}

/** Attach a full set of fake views, returning the dict/category ones the tests inspect. */
function withViews(ctl: ExplorerController, dictReveal: () => Promise<void> = async () => {}) {
  const dict = fakeView(dictReveal);
  const category = fakeView();
  ctl.setViews({
    dict,
    category,
    klass: fakeView(),
    hierarchy: fakeView(),
    method: fakeView(),
  } as never);
  return { dict, category };
}

beforeEach(() => {
  vi.clearAllMocks();
  classesInDict.mockReturnValue([]);
  dictNames.mockReturnValue(['UserGlobals']);
});

describe('revealDictionaryByName logs a failed reveal instead of swallowing it', () => {
  it('logs to the GCI channel when TreeView.reveal rejects', async () => {
    const ctl = makeController();
    withViews(ctl, () => Promise.reject(new Error('pane gone')));

    await ctl.revealDictionaryByName('UserGlobals');

    expect(vi.mocked(logWarning)).toHaveBeenCalledTimes(1);
    const logged = String(vi.mocked(logWarning).mock.calls[0][0]);
    expect(logged).toContain('UserGlobals');
    expect(logged).toContain('pane gone');
  });

  it('reveals the dictionary and logs nothing when the reveal succeeds', async () => {
    const ctl = makeController();
    const { dict } = withViews(ctl); // reveal resolves

    await ctl.revealDictionaryByName('UserGlobals');

    // Assert the reveal was actually attempted — otherwise "logs nothing" would pass vacuously
    // even if a bug skipped the reveal entirely.
    expect(dict.reveal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logWarning)).not.toHaveBeenCalled();
  });

  it('warns, does not reveal, and does not log when the dictionary name is unknown', async () => {
    const ctl = makeController();
    const { dict } = withViews(ctl);

    await ctl.revealDictionaryByName('NoSuchDict');

    expect(dict.reveal).not.toHaveBeenCalled(); // bails before touching the tree
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0])).toContain(
      'NoSuchDict',
    );
    expect(vi.mocked(logWarning)).not.toHaveBeenCalled();
  });
});

describe('revealCategoryByPath checks existence before mutating the panes', () => {
  it('does NOT mutate the panes when the category is missing, and warns', async () => {
    const ctl = makeController();
    const { category } = withViews(ctl);
    classesInDict.mockReturnValue([{ className: 'Foo', category: 'Kernel' }]);
    const selectCat = vi.spyOn(ctl, 'selectClassCategory');

    await ctl.revealCategoryByPath('UserGlobals', 'Ghost-Category');

    // The whole point: a missing category leaves the category/classes panes untouched. On the OLD code
    // selectClassCategory ran BEFORE the existence check, so this assertion fails there — it pins
    // the reorder, not merely "a check exists".
    expect(selectCat).not.toHaveBeenCalled();
    expect(category.reveal).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0])).toContain(
      'Ghost-Category',
    );
  });

  it('calls selectClassCategory and reveals when the category exists', async () => {
    const ctl = makeController();
    const { category } = withViews(ctl);
    classesInDict.mockReturnValue([{ className: 'Foo', category: 'Kernel' }]);
    const selectCat = vi.spyOn(ctl, 'selectClassCategory').mockImplementation(() => {});

    await ctl.revealCategoryByPath('UserGlobals', 'Kernel');

    expect(selectCat).toHaveBeenCalledTimes(1);
    expect(category.reveal).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('matches a parent category path against its child segments', async () => {
    const ctl = makeController();
    withViews(ctl);
    // A class filed under 'Kernel-Collections' means the parent 'Kernel' node exists.
    classesInDict.mockReturnValue([{ className: 'Foo', category: 'Kernel-Collections' }]);
    const selectCat = vi.spyOn(ctl, 'selectClassCategory').mockImplementation(() => {});

    await ctl.revealCategoryByPath('UserGlobals', 'Kernel');

    expect(selectCat).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });
});
