import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  startUndoRefactoringPreview: vi.fn(),
  pageUndoRefactoringPreview: vi.fn(),
  applyUndoRefactoring: vi.fn(),
  clearUndoRefactoringPreview: vi.fn(),
}));
vi.mock('../undoRefactoringPanel', () => ({ showUndoRefactoringPanel: vi.fn() }));
vi.mock('../refactoringUndoAvailability', () => ({
  checkRefactoringUndoAvailable: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showUndoRefactoringPanel } from '../undoRefactoringPanel';
import { checkRefactoringUndoAvailable } from '../refactoringUndoAvailability';
import { undoLastRefactoringCommand } from '../undoRefactoringCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * The refactoring REVERSER (#434) — what `undo/undoLastCommand.ts` calls when the entry it
 * pops is a refactoring. What is pinned here is the order of the gates (session → engine →
 * "is there an undo" → preview) and that "nothing to undo" is a plain refusal rather than
 * an empty panel. Whether the entry survives the apply is the DISPATCHER's question, and is
 * pinned in `undo/__tests__/undoLastCommand.test.ts`.
 */

const START = JSON.stringify({
  token: 't1',
  label: 'Rename #total to #sum',
  engine: 'GsRenameMethodRefactoring',
  sequence: 1,
  drifted: 0,
  total: 2,
  page: { changes: [], nextOffset: 0, done: true },
});

const status = (available: boolean) => ({
  available,
  label: 'Rename #total to #sum',
  engine: 'GsRenameMethodRefactoring',
  mechanism: 'changeSet' as const,
  reverseKind: null,
  sequence: 1,
  total: 2,
});

const sessionsWith = (
  rbSupportAvailable: boolean,
  session: Record<string, unknown> | null = { id: 1 },
): SessionManager =>
  ({
    getSelectedSession: () => (session ? { ...session, rbSupportAvailable } : undefined),
  }) as unknown as SessionManager;

/** A SessionManager with nothing selected. (`sessionsWith(true, undefined)` would not
 *  do it — an explicit `undefined` still takes the default parameter.) */
const noSession = (): SessionManager => sessionsWith(true, null);

describe('undoLastRefactoringCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(true));
    vi.mocked(queries.startUndoRefactoringPreview).mockResolvedValue(START);
    vi.mocked(showUndoRefactoringPanel).mockResolvedValue({ applied: 2, failed: [] });
    vi.mocked(queries.applyUndoRefactoring).mockResolvedValue('{"applied":2,"failed":[]}');
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
  });

  it('wires the panel straight to the stone, carrying the preview token', async () => {
    // The panel is UI-only: it hands back "fetch page N" and "undo, skipping these ids", and
    // the command is what turns those into GCI calls against the token this preview opened.
    // Mocked away in every other test here, so these two arrows had no coverage at all.
    vi.mocked(queries.pageUndoRefactoringPreview).mockResolvedValue(
      JSON.stringify({ changes: [], nextOffset: 9, done: true }),
    );
    vi.mocked(showUndoRefactoringPanel).mockImplementation(async (_start, handlers) => {
      await handlers.loadPage(4);
      return handlers.apply(['c1']);
    });

    await undoLastRefactoringCommand(sessionsWith(true));

    // The token is the command's own, minted when it opened the preview -- not the one the
    // stone echoed back. Paging or applying against any other token is a different session.
    const opened = vi.mocked(queries.startUndoRefactoringPreview).mock.calls[0][1];
    const [, token, offset, maxBytes] = vi.mocked(queries.pageUndoRefactoringPreview).mock.calls[0];
    expect(token).toBe(opened);
    expect(offset).toBe(4);
    expect(maxBytes).toBeGreaterThan(0);
    expect(queries.applyUndoRefactoring).toHaveBeenCalledWith(expect.anything(), opened, ['c1']);
  });

  it('refuses without a session, before touching the stone', async () => {
    await undoLastRefactoringCommand(noSession());
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(queries.startUndoRefactoringPreview).not.toHaveBeenCalled();
  });

  it('refuses when the refactoring engine is not loaded and the user declines to install', async () => {
    await undoLastRefactoringCommand(sessionsWith(false));
    expect(queries.startUndoRefactoringPreview).not.toHaveBeenCalled();
  });

  it('refuses plainly when there is nothing to undo, without opening a panel', async () => {
    vi.mocked(checkRefactoringUndoAvailable).mockReturnValue(status(false));

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no refactoring to undo'),
    );
    expect(showUndoRefactoringPanel).not.toHaveBeenCalled();
  });

  it('previews before undoing anything', async () => {
    await undoLastRefactoringCommand(sessionsWith(true));

    expect(queries.startUndoRefactoringPreview).toHaveBeenCalled();
    expect(showUndoRefactoringPanel).toHaveBeenCalled();
    // Nothing is applied by the command itself — the panel's Undo button drives it.
    expect(queries.applyUndoRefactoring).not.toHaveBeenCalled();
  });

  it('drops the preview session and reports when the preview cannot be built', async () => {
    vi.mocked(queries.startUndoRefactoringPreview).mockRejectedValue(new Error('boom'));

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(queries.clearUndoRefactoringPreview).toHaveBeenCalled();
    expect(showUndoRefactoringPanel).not.toHaveBeenCalled();
  });

  it('says so, and undoes nothing, when the record turns out to be empty', async () => {
    vi.mocked(queries.startUndoRefactoringPreview).mockResolvedValue(
      JSON.stringify({
        token: 't',
        label: 'x',
        total: 0,
        page: { changes: [], nextOffset: 0, done: true },
      }),
    );

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('nothing left to undo'),
    );
    expect(showUndoRefactoringPanel).not.toHaveBeenCalled();
  });

  it('does nothing further when the panel is cancelled', async () => {
    vi.mocked(showUndoRefactoringPanel).mockResolvedValue(undefined);

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('probes once, on the way in — the dispatcher owns the after-probe', async () => {
    await undoLastRefactoringCommand(sessionsWith(true));
    expect(checkRefactoringUndoAvailable).toHaveBeenCalledTimes(1);
  });

  it('lands the Explorer on the method that came back', async () => {
    // Undoing a rename restores the ORIGINAL selector; leaving the tree where it was makes the
    // user hunt for what just happened. The inverse set is ordered restore-first, so the
    // methodAdd row is the restored method.
    vi.mocked(queries.startUndoRefactoringPreview).mockResolvedValue(
      JSON.stringify({
        token: 't1',
        label: 'Rename #total to #sum',
        mechanism: 'changeSet',
        total: 2,
        page: {
          changes: [
            {
              id: '1',
              kind: 'methodAdd',
              className: 'Account',
              isMeta: false,
              selector: 'total',
              newName: null,
              category: 'computing',
              oldSource: null,
              newSource: 'total ^ 42',
              warning: null,
            },
            {
              id: '2',
              kind: 'methodRemove',
              className: 'Account',
              isMeta: false,
              selector: 'sum',
              newName: null,
              category: 'computing',
              oldSource: 'sum ^ 42',
              newSource: null,
              warning: null,
            },
          ],
          nextOffset: 0,
          done: true,
        },
      }),
    );

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealMethodByName',
      'Account',
      'total',
      false,
    );
  });

  it('lands on the class when a class came back rather than a method', async () => {
    // A reversed class rename ends up under the name it went BACK to, which the row carries as
    // newName -- landing on the pre-undo name would select the class that no longer exists.
    vi.mocked(queries.startUndoRefactoringPreview).mockResolvedValue(
      JSON.stringify({
        token: 't1',
        label: 'Rename class Renamed to Original',
        mechanism: 'mirror',
        reverseKind: 'classRename',
        total: 1,
        page: {
          changes: [
            {
              id: '1',
              kind: 'classRename',
              className: 'Renamed',
              isMeta: false,
              selector: null,
              newName: 'Original',
              category: null,
              oldSource: 'a',
              newSource: 'b',
              warning: null,
            },
          ],
          nextOffset: 0,
          done: true,
        },
      }),
    );

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.findClass',
      'Original',
    );
  });

  it('lands on the reshaped class after a history revert', async () => {
    vi.mocked(queries.startUndoRefactoringPreview).mockResolvedValue(
      JSON.stringify({
        token: 't1',
        label: 'Push down balance',
        mechanism: 'historyRevert',
        total: 1,
        page: {
          changes: [
            {
              id: '1',
              kind: 'classDefinitionEdit',
              className: 'Account',
              isMeta: false,
              selector: null,
              newName: null,
              category: null,
              oldSource: 'a',
              newSource: 'b',
              warning: null,
            },
          ],
          nextOffset: 0,
          done: true,
        },
      }),
    );

    await undoLastRefactoringCommand(sessionsWith(true));

    // No method row, so no method reveal -- but the class it reshaped is selected.
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'gemstone.explorer.revealMethodByName',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.findClass',
      'Account',
    );
  });

  it('refreshes the Explorer and reports what was reversed', async () => {
    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Undid Rename #total to #sum'),
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('NOT committed'),
    );
  });

  it('reports a whole-apply error instead of claiming success', async () => {
    vi.mocked(showUndoRefactoringPanel).mockResolvedValue({
      applied: 0,
      failed: [],
      error: 'preview session expired',
    });

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Undo failed: preview session expired',
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('names what could not be reversed, and does not claim a clean undo', async () => {
    vi.mocked(showUndoRefactoringPanel).mockResolvedValue({
      applied: 1,
      failed: [{ id: '2', label: 'Account>>total', error: 'did not recompile' }],
    });

    await undoLastRefactoringCommand(sessionsWith(true));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Account>>total'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
