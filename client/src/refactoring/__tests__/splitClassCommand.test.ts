import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  candidatesForSplitClass: vi.fn(),
  analyzeSplitClass: vi.fn(),
  startSplitClassPreview: vi.fn(),
  pageSplitClassPreview: vi.fn(),
  applySplitClass: vi.fn(),
  clearSplitClassPreview: vi.fn(),
  captureClassHistory: vi.fn(),
  commitHistoryRevert: vi.fn(),
  discardPendingCapture: vi.fn(),
  refactoringUndoStatus: vi.fn(() => '{"available":false}'),
}));
vi.mock('../splitClassPanel', () => ({
  showSplitClassPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showSplitClassPanel } from '../splitClassPanel';
import { splitClassCommand, SplitClassContext } from '../splitClassCommand';
import { peekUndoEntry, resetUndoStacks } from '../../undo/undoStack';
import type { ActiveSession } from '../../sessionManager';

/**
 * Drives the split-class COMMAND orchestrator (not the engine). Pins the gate → candidate list →
 * ivar multi-pick → name prompt → pre-flight → preview → apply flow and the "say why nothing
 * happened" branches: engine unavailable, no ivars, empty/cancelled pick, name cancellation, an
 * analysis decline (stops before the panel), and a failed / zero-applied apply (no false success).
 * The parsers run for real; only the queries and the panel are mocked.
 */

const ctx = (over: Partial<SplitClassContext> = {}): SplitClassContext => ({
  session: { id: 1, rbSupportAvailable: true } as unknown as ActiveSession,
  className: 'Person',
  dict: 3,
  ...over,
});

const candidatesJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    sourceClass: 'Person',
    instVars: [{ name: 'street' }, { name: 'city' }],
    ...over,
  });

const analysisJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    decline: null,
    newClass: 'Address',
    sourceClass: 'Person',
    movableCount: 2,
    affectedCount: 3,
    ...over,
  });

const startJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 'tok',
    total: 3,
    newClass: 'Address',
    sourceClass: 'Person',
    outOfScope: { decline: null, note: null },
    page: {
      changes: [
        {
          id: '1',
          kind: 'classAdd',
          className: 'Address',
          isMeta: false,
          selector: null,
          category: null,
          oldSource: '',
          newSource: 'x',
        },
      ],
      nextOffset: 2,
      done: true,
    },
    ...over,
  });

const setOpenDocs = (docs: unknown[]): void => {
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = docs;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => setOpenDocs([]));

describe('split class command', () => {
  it('gates on RB support first and does nothing when the engine is unavailable', async () => {
    const outcome = await splitClassCommand(
      ctx({ session: { id: 1, rbSupportAvailable: false } as ActiveSession }),
    );

    expect(outcome).toBeUndefined();
    expect(queries.candidatesForSplitClass).not.toHaveBeenCalled();
  });

  it('informs and stops when the class has no own instance variables', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson({ instVars: [] }));

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('no own instance variables'),
    );
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('stays silent when the ivar pick is cancelled', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('tells the user why nothing happened when the pick is confirmed with nothing selected', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue([] as never);

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('no instance variables selected'),
    );
  });

  it('does nothing when the name prompt is cancelled', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(queries.analyzeSplitClass).not.toHaveBeenCalled();
  });

  it('threads the chosen ivars + new name into analyze, then applies and reports', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street', 'city'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(startJson());
    vi.mocked(showSplitClassPanel).mockResolvedValue({ applied: 6, failed: [] });

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toEqual({ newClass: 'Address', applied: 6 });
    const [, className, newName, extractIvars] = vi.mocked(queries.analyzeSplitClass).mock.calls[0];
    expect(className).toBe('Person');
    expect(newName).toBe('Address');
    expect(extractIvars).toEqual(['street', 'city']);
  });

  it('refuses an analysis decline and never opens the panel', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(
      analysisJson({ decline: 'a class named Address already exists' }),
    );

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );
    expect(queries.startSplitClassPreview).not.toHaveBeenCalled();
    expect(showSplitClassPanel).not.toHaveBeenCalled();
  });

  it('offers to undo the split, on the toast and on the undo stack', async () => {
    // The split records its reversal in the stone; a bare toast left that record with no way to
    // reach it — no button, and nothing on the status bar or Ctrl+K U.
    resetUndoStacks();
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(startJson());
    vi.mocked(showSplitClassPanel).mockResolvedValue({ applied: 2, failed: [] });
    vi.mocked(queries.refactoringUndoStatus).mockReturnValue(
      JSON.stringify({
        available: true,
        label: 'Split Person into Address',
        engine: 'GsSplitClassRefactoring',
        sequence: 1,
        total: 2,
      }),
    );

    await splitClassCommand(ctx());

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('applied 2 change(s)'),
      'Undo',
    );
    expect(peekUndoEntry(1)).toMatchObject({ kind: 'refactoring', sequence: 1 });
  });

  it('reports a failed apply and does not claim success', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(startJson());
    vi.mocked(showSplitClassPanel).mockResolvedValue({
      applied: 1,
      failed: [{ id: '2', label: 'Person>>#foo', error: 'boom' }],
    });

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('treats zero applied changes as a failure, not a success', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(startJson());
    vi.mocked(showSplitClassPanel).mockResolvedValue({ applied: 0, failed: [] });

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('applied no changes'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('surfaces an apply error envelope as a failure', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(startJson());
    vi.mocked(showSplitClassPanel).mockResolvedValue({
      applied: 0,
      failed: [],
      error: 'engine blew up',
    });

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('engine blew up'),
    );
  });

  it('saves dirty gemstone method editors before analyzing, leaving other buffers alone', async () => {
    const dirtyMethod = vi.fn(async () => true);
    const cleanMethod = vi.fn(async () => true);
    const dirtyFile = vi.fn(async () => true);
    setOpenDocs([
      { isDirty: true, uri: { scheme: 'gemstone' }, save: dirtyMethod },
      { isDirty: false, uri: { scheme: 'gemstone' }, save: cleanMethod },
      { isDirty: true, uri: { scheme: 'file' }, save: dirtyFile },
    ]);
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(startJson());
    vi.mocked(showSplitClassPanel).mockResolvedValue({ applied: 1, failed: [] });

    await splitClassCommand(ctx());

    expect(dirtyMethod).toHaveBeenCalledTimes(1);
    expect(cleanMethod).not.toHaveBeenCalled();
    expect(dirtyFile).not.toHaveBeenCalled();
    expect(queries.analyzeSplitClass).toHaveBeenCalled();
  });

  it('aborts before analyzing when a dirty method buffer will not save', async () => {
    setOpenDocs([{ isDirty: true, uri: { scheme: 'gemstone' }, save: vi.fn(async () => false) }]);
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(queries.analyzeSplitClass).not.toHaveBeenCalled();
  });

  it('reports why the candidate lookup failed', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockRejectedValue(new Error('gci down'));

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Could not read instance variables'),
    );
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('reports why pre-flight failed', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockRejectedValue(new Error('preflight boom'));

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Pre-flight failed'),
    );
    expect(queries.startSplitClassPreview).not.toHaveBeenCalled();
  });

  it('reports why the preview failed and clears the token', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockRejectedValue(new Error('preview boom'));

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Preview failed'),
    );
    expect(queries.clearSplitClassPreview).toHaveBeenCalled();
    expect(showSplitClassPanel).not.toHaveBeenCalled();
  });

  it('refuses a decline that only surfaces at preview start, and clears the token', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(
      JSON.stringify({ decline: 'Class not found: Person' }),
    );

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Class not found'),
    );
    expect(queries.clearSplitClassPreview).toHaveBeenCalled();
    expect(showSplitClassPanel).not.toHaveBeenCalled();
  });

  it('stops with a reason when the preview has nothing to change', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Address');
    vi.mocked(queries.analyzeSplitClass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startSplitClassPreview).mockResolvedValue(
      startJson({ total: 0, page: { changes: [], nextOffset: 0, done: true } }),
    );

    const outcome = await splitClassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing to change'),
    );
    expect(queries.clearSplitClassPreview).toHaveBeenCalled();
    expect(showSplitClassPanel).not.toHaveBeenCalled();
  });

  it('validates the new class name at the input box', async () => {
    vi.mocked(queries.candidatesForSplitClass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(['street'] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined); // cancel after we capture the validator

    await splitClassCommand(ctx());

    const opts = vi.mocked(vscode.window.showInputBox).mock.calls[0][0];
    const validate = opts?.validateInput as (v: string) => string | undefined;
    // Assert the message the user actually sees, not just that some message came back — a
    // regression to a different (or generic) rejection reason has to fail here.
    expect(validate('')).toContain('Enter a class name');
    expect(validate('lowercase')).toContain('uppercase letter');
    expect(validate('9x')).toContain('uppercase letter');
    expect(validate('Address')).toBeUndefined();
  });
});
