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
  classDefiningDictionaryName: vi.fn(() => 'DictionaryA'),
  dictionariesContainingClass: vi.fn(() => ['DictionaryA']),
  startRenameClassPreview: vi.fn(() => Promise.resolve('{"token":"t1","total":1}')),
  pageRenameClassPreview: vi.fn(),
  clearRenameClassPreview: vi.fn(),
  applyRenameClass: vi.fn(),
  recordReverseRename: vi.fn(() => 'ok'),
  getClassesWithCategory: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import { showRenameClassEditor } from '../../refactoring/renameClassEditor';
import { showRenameClassPanel } from '../../refactoring/renameClassPanel';
import * as queries from '../../browserQueries';
import {
  armRefactoringUndo,
  notifyRefactoringApplied,
} from '../../refactoring/refactoringAppliedToast';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * A rename that PARTIALLY applied must still be undoable (#396).
 *
 * The rename landed -- the class is bound under its new name -- and some method merely failed to
 * recompile onto the new version. That is exactly when a way back is worth most, and the flow was
 * reporting the failure and returning BEFORE it recorded the reversal. The only recourse left was
 * an abort, which discards every uncommitted change in the session rather than this one.
 */
function makeController(): ExplorerController {
  const session = { id: 1, rbSupportAvailable: true } as unknown as ActiveSession;
  return new ExplorerController({
    getSelectedSession: () => session,
  } as unknown as SessionManager);
}

const applied = (failed: unknown[]): string =>
  JSON.stringify({ applied: 3, failed, migratedFailures: 0, committed: false });

beforeEach(() => {
  vi.clearAllMocks();
  // reportRenameFailures chains off showErrorMessage, so it has to answer a promise
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
  // The panel drives the apply and hands back whatever it answered.
  // showRenameClassPanel(oldName, newName, start, options, handlers) -- the handlers are the
  // 5th argument, and `apply` is what drives the rename.
  vi.mocked(showRenameClassPanel).mockImplementation(((...args: unknown[]) => {
    const handlers = args[4] as { apply: (ids: string[]) => Promise<unknown> };
    return handlers.apply([]);
  }) as never);
});

describe('a partially applied class rename is still undoable', () => {
  it('records the reversal even when a method failed to recompile', async () => {
    vi.mocked(queries.applyRenameClass).mockReturnValue(
      applied([{ id: '1', label: 'Sub>>#m', error: 'Class not found: Gone' }]) as never,
    );

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    // Asserted by position rather than a whole-call match: the trailing scope/dictionary
    // arguments are undefined here (no dictionary is selected in this harness), and
    // expect.anything() does not match undefined.
    const call = vi.mocked(queries.recordReverseRename).mock.calls[0];
    expect(call[1]).toBe('classRename');
    expect(call[2]).toBe('Shadowed'); // the class is bound under the NEW name now
    expect(call[4]).toBe('ShadowedAAAAA'); // and the reversal renames it back
    expect(call[6]).toBe('GsRenameClassRefactoring');

    // Recording in the stone is only half of it: the button stays dark until an entry is
    // pushed onto the client's stack, which this path used to return before doing.
    expect(armRefactoringUndo).toHaveBeenCalled();
    expect(notifyRefactoringApplied).not.toHaveBeenCalled(); // the failure toast is shown instead
  });

  it('still records it on a clean apply', async () => {
    vi.mocked(queries.applyRenameClass).mockReturnValue(applied([]) as never);

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    expect(queries.recordReverseRename).toHaveBeenCalledTimes(1);
    // The success path arms the undo through the toast, as it always has.
    expect(notifyRefactoringApplied).toHaveBeenCalled();
  });
});
