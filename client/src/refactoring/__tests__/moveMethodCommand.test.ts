import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  analyzeMoveMethod: vi.fn(),
  startMoveMethodPreview: vi.fn(),
  pageMoveMethodPreview: vi.fn(),
  applyMoveMethod: vi.fn(),
  clearMoveMethodPreview: vi.fn(),
}));
vi.mock('../moveMethodPanel', () => ({
  showMoveMethodPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showMoveMethodPanel } from '../moveMethodPanel';
import { moveMethod, MoveMethodRequest } from '../moveMethodCommand';
import type { ActiveSession } from '../../sessionManager';
import type { ApplyResult } from '../moveMethodPreview';

/**
 * Drives the move-method (M6) COMMAND orchestrator (not the engine). Pins the
 * ensure-engine → pre-flight → preview → panel → apply → report flow and the "always say
 * why nothing happened" contract: an empty selector list, engine-unavailable, a global
 * decline, nothing-movable (1-vs-many wording), a failed pre-flight / preview (with token
 * cleanup), an out-of-scope or empty preview, user cancel, an expired preview token, a
 * failed apply, the 1-vs-many success wording, the target label's fallback chain, and the
 * loadPage / apply / cleanup callbacks wired into the panel. The parsers run for real; only
 * the GCI queries and the preview panel are mocked.
 */

const req = (over: Partial<MoveMethodRequest> = {}): MoveMethodRequest => ({
  session: { id: 1, rbSupportAvailable: true } as unknown as ActiveSession,
  sourceClass: 'Foo',
  selectors: ['bar'],
  isMeta: false,
  targetName: 'Baz',
  toMeta: false,
  ...over,
});

const analysisJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    targetClass: 'Baz',
    globalDecline: null,
    movableCount: 1,
    selectors: [{ selector: 'bar', decline: null }],
    ...over,
  });

const change = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a',
  kind: 'methodAdd',
  dictName: 'UserGlobals',
  className: 'Baz',
  isMeta: false,
  selector: 'bar',
  category: 'accessing',
  oldSource: '',
  newSource: 'bar\n\t^ 1',
  ...over,
});

const startJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 'tok',
    total: 2,
    targetClass: 'Baz',
    movableCount: 1,
    outOfScope: { collision: null, decline: null },
    skippedMethods: [],
    page: {
      changes: [change(), change({ id: 'b', kind: 'methodRemove', className: 'Foo' })],
      nextOffset: 3,
      done: true,
    },
    ...over,
  });

const applied = (over: Partial<ApplyResult> = {}): ApplyResult => ({
  applied: 2,
  failed: [],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('move method command', () => {
  it('does nothing at all when no selectors were given', async () => {
    const outcome = await moveMethod(req({ selectors: [] }));

    expect(outcome).toBeUndefined();
    expect(queries.analyzeMoveMethod).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('does not run a pre-flight when the engine is unavailable and the user declines install', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    const outcome = await moveMethod(
      req({ session: { id: 1, rbSupportAvailable: false } as ActiveSession }),
    );

    expect(outcome).toBeUndefined();
    expect(queries.analyzeMoveMethod).not.toHaveBeenCalled();
  });

  it('reports a failed pre-flight and never opens the preview', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockRejectedValue(new Error('boom'));

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(queries.startMoveMethodPreview).not.toHaveBeenCalled();
  });

  it('refuses a global decline and never opens the preview', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(
      analysisJson({ globalDecline: 'Baz is not in scope.' }),
    );

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not in scope'),
    );
    expect(queries.startMoveMethodPreview).not.toHaveBeenCalled();
  });

  it('leads with the engine reason when a single selector cannot move', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(
      analysisJson({
        movableCount: 0,
        selectors: [{ selector: 'bar', decline: 'Cannot move #bar: it sends super.' }],
      }),
    );

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Cannot move #bar: it sends super.'),
    );
  });

  it('counts the declines when several selectors cannot move', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(
      analysisJson({
        movableCount: 0,
        selectors: [
          { selector: 'bar', decline: 'Cannot move #bar: it sends super.' },
          { selector: 'baz', decline: 'Cannot move #baz: it sends super.' },
        ],
      }),
    );

    await moveMethod(req({ selectors: ['bar', 'baz'] }));

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 methods cannot move.'),
    );
  });

  it('falls back to a generic reason when nothing is movable but no decline was given', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(
      analysisJson({ movableCount: 0, selectors: [] }),
    );

    await moveMethod(req());

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('None of the selected methods can move'),
    );
  });

  it('reports a failed preview and clears the preview token', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockRejectedValue(new Error('kaboom'));

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(queries.clearMoveMethodPreview).toHaveBeenCalled();
    expect(showMoveMethodPanel).not.toHaveBeenCalled();
  });

  it('refuses an out-of-scope decline from the preview and clears the token', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(
      startJson({ outOfScope: { collision: null, decline: 'Out of scope here.' } }),
    );

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Out of scope'),
    );
    expect(queries.clearMoveMethodPreview).toHaveBeenCalled();
    expect(showMoveMethodPanel).not.toHaveBeenCalled();
  });

  it('refuses when the preview has nothing to move and clears the token', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(
      startJson({ total: 0, page: { changes: [], nextOffset: 1, done: true } }),
    );

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing to move'),
    );
    expect(queries.clearMoveMethodPreview).toHaveBeenCalled();
  });

  it('does nothing further when the user cancels the preview', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showMoveMethodPanel).mockResolvedValue(undefined);

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reports a whole-apply error (expired token) instead of a success toast', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showMoveMethodPanel).mockResolvedValue(
      applied({ applied: 0, failed: [], error: 'preview session expired' }),
    );

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('preview session expired'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reports a failed apply and returns no outcome', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showMoveMethodPanel).mockResolvedValue(
      applied({ applied: 0, failed: [{ id: 'a', label: 'Baz>>bar', error: 'boom' }] }),
    );

    const outcome = await moveMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reports a single moved selector and answers the reveal target', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showMoveMethodPanel).mockResolvedValue(applied());

    const outcome = await moveMethod(req({ toMeta: true }));

    expect(outcome).toEqual({ applied: 2, moved: ['bar'], targetClass: 'Baz', toMeta: true });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Moved #bar to Baz.');
  });

  it('reports a count when several selectors moved, listing only the movable subset', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(
      analysisJson({
        movableCount: 2,
        selectors: [
          { selector: 'bar', decline: null },
          { selector: 'baz', decline: null },
          { selector: 'nope', decline: 'Cannot move #nope: it sends super.' },
        ],
      }),
    );
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showMoveMethodPanel).mockResolvedValue(applied({ applied: 4 }));

    const outcome = await moveMethod(req({ selectors: ['bar', 'baz', 'nope'] }));

    expect(outcome?.moved).toEqual(['bar', 'baz']);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Moved 2 methods to Baz.');
  });

  it('prefers the preview target label, then the analysis, then the requested name', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson({ targetClass: null }));
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(startJson({ targetClass: null }));
    vi.mocked(showMoveMethodPanel).mockResolvedValue(applied());

    const outcome = await moveMethod(req({ targetName: 'Requested' }));

    // Neither the preview nor the pre-flight resolved a class, so the requested name is used.
    expect(outcome?.targetClass).toBe('Requested');
    expect(vi.mocked(showMoveMethodPanel).mock.calls[0][0]).toBe('Requested');
  });

  it('wires the panel loadPage / apply / cleanup callbacks to the GCI queries', async () => {
    vi.mocked(queries.analyzeMoveMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startMoveMethodPreview).mockResolvedValue(startJson());
    vi.mocked(queries.pageMoveMethodPreview).mockResolvedValue(
      JSON.stringify({ changes: [change()], nextOffset: 4, done: false }),
    );
    vi.mocked(queries.applyMoveMethod).mockResolvedValue(
      JSON.stringify({ applied: 2, failed: [] }),
    );
    vi.mocked(showMoveMethodPanel).mockResolvedValue(applied());

    await moveMethod(req());

    // The command mints its own preview token and threads it through every call.
    const token = vi.mocked(queries.startMoveMethodPreview).mock.calls[0][6];
    const ops = vi.mocked(showMoveMethodPanel).mock.calls[0][2];

    const page = await ops.loadPage(3);
    expect(queries.pageMoveMethodPreview).toHaveBeenCalledWith(
      expect.anything(),
      token,
      3,
      expect.any(Number),
    );
    expect(page.done).toBe(false);

    const result = await ops.apply(['b']);
    expect(queries.applyMoveMethod).toHaveBeenCalledWith(expect.anything(), token, ['b']);
    expect(result.applied).toBe(2);

    ops.cleanup();
    expect(queries.clearMoveMethodPreview).toHaveBeenCalledWith(expect.anything(), token);
  });
});
