/**
 * Where the Explorer lands after a class is reshaped, when two dictionaries share a NAME.
 *
 * The symbol list can hold two dictionaries called `Shared`, each binding its own `Shadowed`. The
 * rename resolves its class by SymbolList index, so it knows which `Shadowed` it renamed; the
 * landing has to know it too. Resolving the index to a name and the name back to an index finds
 * the first `Shared`, and the Explorer then shows the other dictionary's class of that name (#396).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../refactoring/renameClassEditor', () => ({ showRenameClassEditor: vi.fn() }));
vi.mock('../../refactoring/renameClassPanel', () => ({ showRenameClassPanel: vi.fn() }));
vi.mock('../../refactoring/refactoringAppliedToast', () => ({
  notifyRefactoringApplied: vi.fn(),
  armRefactoringUndo: vi.fn(),
}));
vi.mock('../../browserQueries', () => ({
  isKernelClass: vi.fn(() => false),
  classDefiningDictionaryName: vi.fn(() => 'Shared'),
  dictionariesContainingClass: vi.fn(() => []),
  startRenameClassPreview: vi.fn(() => Promise.resolve('{"token":"t1","total":1}')),
  pageRenameClassPreview: vi.fn(),
  clearRenameClassPreview: vi.fn(),
  applyRenameClass: vi.fn(),
  recordReverseRename: vi.fn(() => 'ok'),
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => []),
  getDefinedInstVarCounts: vi.fn(() => new Map()),
  getDefinedClassVarCounts: vi.fn(() => new Map()),
  getClassHierarchy: vi.fn(() => []),
  getClassDescendantNames: vi.fn(() => []),
  getMethodInstVarAccess: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import { showRenameClassEditor } from '../../refactoring/renameClassEditor';
import { showRenameClassPanel } from '../../refactoring/renameClassPanel';
import * as queries from '../../browserQueries';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

// Two dictionaries called `Shared`, at positions 1 and 3, and UserGlobals between them.
const SYMBOL_LIST = ['Shared', 'UserGlobals', 'Shared'];
const RENAMED_IN = 3;

function makeController(selected: { dictName: string; dictIndex: number }): ExplorerController {
  const session = { id: 1, rbSupportAvailable: true } as unknown as ActiveSession;
  const ctl = new ExplorerController({
    getSelectedSession: () => session,
  } as unknown as SessionManager);
  const view = () => ({
    reveal: vi.fn(async () => {}),
    selection: [],
    description: '',
    visible: true,
  });
  ctl.setViews({
    dict: view(),
    category: view(),
    klass: view(),
    hierarchy: view(),
    method: view(),
  } as never);
  ctl.state.dictName = selected.dictName;
  ctl.state.dictIndex = selected.dictIndex;
  return ctl;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.getDictionaryNames).mockReturnValue(SYMBOL_LIST);
  // Both `Shared` dictionaries bind a `Shadowed` once the rename has landed: the renamed class in
  // the third, and an unrelated class of that name in the first.
  vi.mocked(queries.getClassesWithCategory).mockImplementation(((_s: unknown, idx: number) =>
    idx === 1 || idx === RENAMED_IN
      ? [{ className: 'Shadowed', category: 'fixture' }]
      : []) as never);
  vi.mocked(queries.applyRenameClass).mockReturnValue(
    JSON.stringify({ applied: 1, failed: [], migratedFailures: 0, committed: false }) as never,
  );
  vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
  vi.mocked(showRenameClassEditor).mockResolvedValue({
    newName: 'Shadowed',
    scope: { kind: 'wholeSystem' },
    options: {
      copyMethods: true,
      recompileSubclasses: true,
      migrateInstances: false,
      removeOldFromHistory: false,
    },
  } as never);
  vi.mocked(showRenameClassPanel).mockImplementation(((...args: unknown[]) => {
    const handlers = args[4] as { apply: (ids: string[]) => Promise<unknown> };
    return handlers.apply([]);
  }) as never);
});

describe('a reshaped class is revealed in the dictionary it lives in, not a namesake', () => {
  it('lands on the renamed class when an earlier dictionary shares its dictionary name', async () => {
    const ctl = makeController({ dictName: 'UserGlobals', dictIndex: 2 });

    await ctl.renameClassNamed('ShadowedAAAAA', RENAMED_IN);

    expect(ctl.state.dictIndex).toBe(RENAMED_IN);
    expect(ctl.state.className).toBe('Shadowed');
  });

  it('lands on the renamed class when the selected dictionary merely shares its name', async () => {
    // Selected: the FIRST `Shared`. Renamed: the class in the third. Same name, different
    // dictionary -- so "the target is the selection" cannot be decided by comparing names.
    const ctl = makeController({ dictName: 'Shared', dictIndex: 1 });

    await ctl.renameClassNamed('ShadowedAAAAA', RENAMED_IN);

    expect(ctl.state.dictIndex).toBe(RENAMED_IN);
    expect(ctl.state.className).toBe('Shadowed');
  });
});
