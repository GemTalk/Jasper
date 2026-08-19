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
  refreshRefactoringUndoContext: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showUndoRefactoringPanel } from '../undoRefactoringPanel';
import { refreshRefactoringUndoContext } from '../refactoringUndoAvailability';
import { undoLastRefactoringCommand } from '../undoRefactoringCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * The undo COMMAND (#434) — the one flow all three entry points land in. What is
 * pinned here is the order of the gates (session → engine → "is there an undo" →
 * preview), that "nothing to undo" is a plain refusal rather than an empty panel, and
 * that the entry's fate is RE-PROBED after an apply instead of assumed (a clean undo
 * consumes it in the stone; a partial one does not).
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
    vi.mocked(refreshRefactoringUndoContext).mockReturnValue(status(true));
    vi.mocked(queries.startUndoRefactoringPreview).mockResolvedValue(START);
    vi.mocked(showUndoRefactoringPanel).mockResolvedValue({ applied: 2, failed: [] });
    vi.mocked(queries.applyUndoRefactoring).mockResolvedValue('{"applied":2,"failed":[]}');
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
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
    vi.mocked(refreshRefactoringUndoContext).mockReturnValue(status(false));

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
    // The entry survives a cancel, so the context key is left exactly as the pre-flight
    // probe published it.
    expect(refreshRefactoringUndoContext).toHaveBeenCalledTimes(1);
  });

  it('re-probes the entry after an apply rather than assuming it was consumed', async () => {
    await undoLastRefactoringCommand(sessionsWith(true));
    expect(refreshRefactoringUndoContext).toHaveBeenCalledTimes(2);
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
