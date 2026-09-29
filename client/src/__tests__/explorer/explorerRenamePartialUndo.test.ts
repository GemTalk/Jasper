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
  getDictionaryNames: vi.fn(() => ['DictionaryA', 'DictionaryB']),
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
  // clearAllMocks clears calls, not implementations, so a test that makes the stone decline
  // would otherwise leak that into the next one.
  vi.mocked(queries.recordReverseRename).mockReturnValue('ok');
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

    // Asserted by position rather than a whole-call match: the scope argument is undefined
    // here, and expect.anything() does not match undefined.
    const call = vi.mocked(queries.recordReverseRename).mock.calls[0];
    expect(call[1]).toBe('classRename');
    expect(call[2]).toBe('Shadowed'); // the class is bound under the NEW name now
    expect(call[4]).toBe('ShadowedAAAAA'); // and the reversal renames it back
    expect(call[6]).toBe('GsRenameClassRefactoring');
    // The dictionary the rename was RESOLVED through, not the tree selection. Recording the
    // selection instead sent the reversal looking in the wrong dictionary, where it either
    // declined or renamed a same-named class (#396).
    expect(call[8]).toBe(5);

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

describe('the recorded dictionary is the class’s, not the tree selection', () => {
  it('records the resolved dictionary even when a different one is selected', async () => {
    // A rename started from a Hierarchy ancestor, or of an inherited variable at the cursor,
    // acts on a class in a dictionary other than the selected one. Recording the selection sent
    // the reversal to the wrong dictionary (#396).
    vi.mocked(queries.applyRenameClass).mockReturnValue(applied([]) as never);
    const ctl = makeController();
    ctl.state.dictIndex = 9;
    ctl.state.dictName = 'SelectedElsewhere';

    await ctl.renameClassNamed('ShadowedAAAAA', 5);

    const call = vi.mocked(queries.recordReverseRename).mock.calls[0];
    expect(call[8]).toBe(5);
    expect(call[8]).not.toBe(9);
  });

  it('records a dictionary given by name, as a hierarchy node supplies it', async () => {
    vi.mocked(queries.applyRenameClass).mockReturnValue(applied([]) as never);
    const ctl = makeController();
    ctl.state.dictIndex = 9;

    await ctl.renameClassNamed('ShadowedAAAAA', 'Globals');

    expect(vi.mocked(queries.recordReverseRename).mock.calls[0][8]).toBe('Globals');
  });
});

describe('a rename whose own #classRename failed arms nothing', () => {
  it('records no reversal when the class was never bound under the new name', async () => {
    // With the rename itself failed, `Shadowed` is whatever else binds it — for a shadowed name,
    // another dictionary's class. An Undo armed here would rename THAT class to ShadowedAAAAA,
    // and would not decline, because this dictionary binds no ShadowedAAAAA any more (#396).
    vi.mocked(queries.applyRenameClass).mockReturnValue(
      JSON.stringify({
        applied: 0,
        failed: [{ id: '1', label: 'ShadowedAAAAA', error: 'Class not found: ShadowedAAAAA' }],
        migratedFailures: 0,
        committed: false,
        renameFailed: true,
      }) as never,
    );

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    expect(queries.recordReverseRename).not.toHaveBeenCalled();
    expect(armRefactoringUndo).not.toHaveBeenCalled();
    expect(notifyRefactoringApplied).not.toHaveBeenCalled();
    // the user is still told what went wrong
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('still records one when only a method recompile failed', async () => {
    vi.mocked(queries.applyRenameClass).mockReturnValue(
      JSON.stringify({
        applied: 3,
        failed: [{ id: '9', label: 'Sub>>#m', error: 'nope' }],
        migratedFailures: 0,
        committed: false,
        renameFailed: false,
      }) as never,
    );

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    expect(queries.recordReverseRename).toHaveBeenCalledTimes(1);
    expect(armRefactoringUndo).toHaveBeenCalled();
  });
});

describe('the shadowing-rename warning names which class the new name will mean', () => {
  /** Drive the rename far enough to raise the warning, and answer its modal detail text. */
  async function warningDetail(destination: string, elsewhere: string[]): Promise<string> {
    vi.mocked(queries.applyRenameClass).mockReturnValue(applied([]) as never);
    vi.mocked(queries.dictionariesContainingClass).mockReturnValue(elsewhere);
    // where the class being renamed actually lives — the rename files it back into this one
    vi.mocked(queries.classDefiningDictionaryName).mockReturnValue(destination);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Rename anyway' as never);
    await makeController().renameClassNamed('ShadowedAAAAA', destination);
    const call = vi.mocked(vscode.window.showWarningMessage).mock.calls[0];
    return (call[1] as { detail: string }).detail;
  }

  it('says the other class wins when its dictionary comes first', async () => {
    // "may not be this one" was an understatement: the symbol list has an order, and the answer
    // is knowable. Renaming into DictionaryB while DictionaryA (position 1) binds the name means
    // every unqualified reference — including inside the renamed class — lands on A's (#396).
    const detail = await warningDetail('DictionaryB', ['DictionaryA']);
    expect(detail).toContain('DictionaryA comes first');
    expect(detail).toContain("will then mean DictionaryA's class");
    expect(detail).not.toContain('may not be this one');
  });

  it('says this class still wins when the other dictionary comes later', async () => {
    const detail = await warningDetail('DictionaryA', ['DictionaryB']);
    expect(detail).toContain('This dictionary comes first');
    expect(detail).toContain('still means this class');
  });
});

describe('arming the Undo button follows what the stone actually recorded', () => {
  it('does not arm when the stone declined to record the reversal', async () => {
    // armRefactoringUndo pushes whatever entry the stone currently holds, and pushUndoEntry
    // drops every other refactoring entry first. Arming after a failed record therefore lifts
    // the PREVIOUS refactoring's entry above the user's newer method edits, and Undo reverses
    // that one instead.
    vi.mocked(queries.applyRenameClass).mockReturnValue(
      applied([{ id: '1', label: 'Sub>>#m', error: 'nope' }]) as never,
    );
    vi.mocked(queries.recordReverseRename).mockReturnValue('unsupported');

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    expect(armRefactoringUndo).not.toHaveBeenCalled();
  });

  it('does not arm when the recording query throws', async () => {
    vi.mocked(queries.applyRenameClass).mockReturnValue(
      applied([{ id: '1', label: 'Sub>>#m', error: 'nope' }]) as never,
    );
    vi.mocked(queries.recordReverseRename).mockImplementation(() => {
      throw new Error('no session');
    });

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    expect(armRefactoringUndo).not.toHaveBeenCalled();
  });

  it('offers Undo on the failure toast when one was armed', async () => {
    vi.mocked(queries.applyRenameClass).mockReturnValue(
      applied([{ id: '1', label: 'Sub>>#m', error: 'nope' }]) as never,
    );

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    const call = vi.mocked(vscode.window.showErrorMessage).mock.calls.at(-1);
    expect(call?.[0]).toContain('Undo reverses this rename');
    expect(call?.slice(1)).toContain('Undo');
  });

  it('offers only Show Details when nothing was armed', async () => {
    vi.mocked(queries.applyRenameClass).mockReturnValue(
      applied([{ id: '1', label: 'Sub>>#m', error: 'nope' }]) as never,
    );
    vi.mocked(queries.recordReverseRename).mockReturnValue('unsupported');

    await makeController().renameClassNamed('ShadowedAAAAA', 5);

    const call = vi.mocked(vscode.window.showErrorMessage).mock.calls.at(-1);
    expect(call?.slice(1)).not.toContain('Undo');
    expect(call?.slice(1)).toContain('Show Details');
  });
});
