import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
vi.mock('../../browserQueries', () => ({
  analyzeInstVar: vi.fn(),
  startInstVarPreview: vi.fn(),
  pageInstVarPreview: vi.fn(),
  applyInstVar: vi.fn(),
  clearInstVarPreview: vi.fn(),
}));
vi.mock('../instVarRefactorPanel', () => ({
  showInstVarRefactorPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showInstVarRefactorPanel } from '../instVarRefactorPanel';
import { runInstVarRefactor, InstVarRefactorRequest } from '../instVarRefactorCommand';
import type { ActiveSession } from '../../sessionManager';
import type { ApplyResult } from '../instVarRefactorPreview';

/**
 * Drives the add / remove instance-variable COMMAND orchestrator (not the engine). Pins the
 * ensure-engine → pre-flight → preview → panel → apply → report flow and the "always say why
 * nothing happened" contract: engine-unavailable, a failed pre-flight, an analysis decline, a
 * failed preview (with token cleanup), an out-of-scope or empty preview (with cleanup), user
 * cancel, a failed apply, the dropped-methods / committed notes, and the loadPage / apply /
 * cleanup callbacks the command wires into the panel. The parsers run for real; only the GCI
 * queries and the preview panel are mocked.
 */

const req = (over: Partial<InstVarRefactorRequest> = {}): InstVarRefactorRequest => ({
  session: { id: 1, rbSupportAvailable: true } as unknown as ActiveSession,
  op: 'add',
  className: 'Foo',
  ivarName: 'bar',
  dict: 1,
  ...over,
});

const analysisJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    decline: null,
    operation: 'add',
    sourceClass: 'Foo',
    affectedCount: 2,
    willNotRecompileCount: 0,
    ...over,
  });

const change = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c1',
  kind: 'classDefinitionEdit',
  className: 'Foo',
  dictName: 'UserGlobals',
  oldSource: "instVarNames: #('a')",
  newSource: "instVarNames: #('a' 'bar')",
  ...over,
});

const startJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 'tok',
    total: 2,
    sourceClass: 'Foo',
    outOfScope: {
      decline: null,
      willNotRecompile: [],
      actedOnClass: 'Foo',
      note: null,
    },
    page: {
      changes: [change(), change({ id: 'c2', kind: 'classReparent', className: 'FooSub' })],
      nextOffset: 3,
      done: true,
    },
    ...over,
  });

const applied = (over: Partial<ApplyResult> = {}): ApplyResult => ({
  applied: 2,
  failed: [],
  dropped: [],
  committed: false,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('add / remove instance variable command', () => {
  it('does not run a pre-flight when the engine is unavailable and the user declines install', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    const outcome = await runInstVarRefactor(
      req({ session: { id: 1, rbSupportAvailable: false } as ActiveSession }),
    );

    expect(outcome).toBeUndefined();
    expect(queries.analyzeInstVar).not.toHaveBeenCalled();
  });

  it('reports a failed pre-flight and never opens the preview', async () => {
    vi.mocked(queries.analyzeInstVar).mockRejectedValue(new Error('boom'));

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(queries.startInstVarPreview).not.toHaveBeenCalled();
  });

  it('refuses an analysis decline and never opens the preview', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(
      analysisJson({ decline: 'Foo already has an instance variable of that name.' }),
    );

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('already has an instance variable'),
    );
    expect(queries.startInstVarPreview).not.toHaveBeenCalled();
  });

  it('reports a failed preview and clears the preview token', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockRejectedValue(new Error('kaboom'));

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(queries.clearInstVarPreview).toHaveBeenCalled();
    expect(showInstVarRefactorPanel).not.toHaveBeenCalled();
  });

  it('refuses an out-of-scope decline from the preview and clears the token', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(
      startJson({
        outOfScope: {
          decline: 'Out of scope here.',
          willNotRecompile: [],
          actedOnClass: 'Foo',
          note: null,
        },
      }),
    );

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Out of scope'),
    );
    expect(queries.clearInstVarPreview).toHaveBeenCalled();
    expect(showInstVarRefactorPanel).not.toHaveBeenCalled();
  });

  it('refuses when the preview has nothing to change and clears the token', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(
      startJson({ total: 0, page: { changes: [], nextOffset: 1, done: true } }),
    );

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing to change'),
    );
    expect(queries.clearInstVarPreview).toHaveBeenCalled();
    expect(showInstVarRefactorPanel).not.toHaveBeenCalled();
  });

  it('does nothing further when the user cancels the preview', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(undefined);

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  // The apply is all-or-nothing: the engine stops at the first failure and aborts the versions
  // it had already staged, so the user must be told the hierarchy is untouched...
  it('says nothing was applied when the engine rolled the transaction back', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({
        applied: 0,
        failed: [{ id: 'c2', label: 'FooSub (reparented)', error: 'boom' }],
        rolledBack: true,
      }),
    );

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing was applied; the transaction was rolled back.'),
    );
  });

  // ...and told to abort themselves when it could NOT roll back (the session already had other
  // uncommitted work, which an abort would have discarded too).
  it('advises aborting when the engine could not roll back', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({
        applied: 1,
        failed: [{ id: 'c2', label: 'FooSub (reparented)', error: 'boom' }],
        rolledBack: false,
      }),
    );

    await runInstVarRefactor(req());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('PARTIAL change'),
    );
  });

  // An engine that predates the rolledBack field: take the conservative branch rather than
  // promise a rollback that may not have happened.
  it('advises aborting when the engine did not report a rollback at all', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({ applied: 1, failed: [{ id: 'c2', label: 'FooSub', error: 'boom' }] }),
    );

    await runInstVarRefactor(req());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('PARTIAL change'),
    );
  });

  it('reports a failed apply and returns no outcome', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({
        applied: 0,
        failed: [{ id: 'c1', label: 'Foo (definition edited)', error: 'boom' }],
      }),
    );

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  // The engine's expired-token path answers `applied:0` with an EMPTY `failed`, so it parses
  // cleanly. The token can expire while the user sits on the preview deciding about the
  // committing checkboxes, so this is reachable — and without the `result.error` check it
  // produced a success toast and a refresh/reveal over an unchanged tree.
  it('reports an expired preview token instead of a success toast', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({ applied: 0, failed: [], error: 'preview session expired' }),
    );

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('preview session expired'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('names the operation in the expired-token error so the user knows what did not happen', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson({ operation: 'remove' }));
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({ applied: 0, failed: [], error: 'preview session expired' }),
    );

    await runInstVarRefactor(req({ op: 'remove', ivarName: 'bar', className: 'Foo' }));

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Remove bar from Foo failed'),
    );
  });

  // Defence in depth: a zero-change apply that reports no error at all is still not a
  // success, because the panel only opens with `total > 0` and every change is required.
  it('treats a zero-change apply with no error as a failure', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(applied({ applied: 0 }));

    const outcome = await runInstVarRefactor(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('nothing was applied'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('titles an add and reports success', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(applied());

    const outcome = await runInstVarRefactor(req({ op: 'add', ivarName: 'bar', className: 'Foo' }));

    expect(outcome).toEqual({ applied: 2, committed: false, dropped: [] });
    expect(vi.mocked(showInstVarRefactorPanel).mock.calls[0][0]).toBe('Add bar to Foo');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Add bar to Foo'),
    );
  });

  it('titles a remove and reports success', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson({ operation: 'remove' }));
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(applied());

    await runInstVarRefactor(req({ op: 'remove', ivarName: 'bar', className: 'Foo' }));

    expect(vi.mocked(showInstVarRefactorPanel).mock.calls[0][0]).toBe('Remove bar from Foo');
  });

  it('notes the dropped methods and pluralizes when several did not recompile', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson({ operation: 'remove' }));
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({
        dropped: [
          { className: 'Foo', selector: 'combine' },
          { className: 'FooSub', selector: 'doubleCount' },
        ],
      }),
    );

    const outcome = await runInstVarRefactor(req({ op: 'remove' }));

    expect(outcome?.dropped).toHaveLength(2);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 methods did not recompile and were dropped'),
    );
  });

  it('uses the singular form when exactly one method did not recompile', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson({ operation: 'remove' }));
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(
      applied({ dropped: [{ className: 'Foo', selector: 'combine' }] }),
    );

    await runInstVarRefactor(req({ op: 'remove' }));

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('1 method did not recompile and was dropped'),
    );
  });

  it('reports that the change was committed when a committing option ran', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(applied({ committed: true }));

    const outcome = await runInstVarRefactor(req());

    expect(outcome?.committed).toBe(true);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Committed.'),
    );
  });

  it('wires the panel loadPage / apply / cleanup callbacks to the GCI queries', async () => {
    vi.mocked(queries.analyzeInstVar).mockResolvedValue(analysisJson());
    vi.mocked(queries.startInstVarPreview).mockResolvedValue(startJson());
    vi.mocked(queries.pageInstVarPreview).mockResolvedValue(
      JSON.stringify({ changes: [change()], nextOffset: 4, done: false }),
    );
    vi.mocked(queries.applyInstVar).mockResolvedValue(
      JSON.stringify({ applied: 1, failed: [], dropped: [], committed: true }),
    );
    vi.mocked(showInstVarRefactorPanel).mockResolvedValue(applied());

    await runInstVarRefactor(req());

    // The command mints its own preview token and threads it through every call.
    const token = vi.mocked(queries.startInstVarPreview).mock.calls[0][4];
    const ops = vi.mocked(showInstVarRefactorPanel).mock.calls[0][2];

    const page = await ops.loadPage(3);
    expect(queries.pageInstVarPreview).toHaveBeenCalledWith(
      expect.anything(),
      token,
      3,
      expect.any(Number),
    );
    expect(page.done).toBe(false);

    const result = await ops.apply(['disallowGciStore'], true, false);
    expect(queries.applyInstVar).toHaveBeenCalledWith(
      expect.anything(),
      token,
      [],
      ['disallowGciStore'],
      true,
      false,
    );
    expect(result.committed).toBe(true);

    ops.cleanup();
    expect(queries.clearInstVarPreview).toHaveBeenCalledWith(expect.anything(), token);
  });
});
