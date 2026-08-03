import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  analyzePushMethod: vi.fn(),
  startPushMethodPreview: vi.fn(),
  pagePushMethodPreview: vi.fn(),
  applyPushMethod: vi.fn(),
  clearPushMethodPreview: vi.fn(),
}));
vi.mock('../pushMethodPanel', () => ({
  showPushMethodPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showPushMethodPanel } from '../pushMethodPanel';
import { pushMethod, PushMethodRequest } from '../pushMethodCommand';
import type { ActiveSession } from '../../sessionManager';

/**
 * Drives the push-up / push-down COMMAND orchestrator (not the engine). Pins the
 * pre-flight → preview → apply → reveal flow and the "always say why nothing happened"
 * contract: engine-unavailable, a global decline, nothing-movable (1-vs-many wording), a
 * failed pre-flight / preview (with token cleanup), an out-of-scope or empty preview, a
 * failed apply, the "everything un-ticked" (applied === 0) case, and the reveal target the
 * outcome carries for each direction. The parsers run for real; only the GCI queries and
 * the preview panel are mocked.
 */

const req = (over: Partial<PushMethodRequest> = {}): PushMethodRequest => ({
  session: { id: 1, rbSupportAvailable: true } as unknown as ActiveSession,
  direction: 'up',
  sourceClass: 'Sub',
  selectors: ['foo'],
  isMeta: false,
  ...over,
});

const analysisJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    targetClass: 'Super',
    globalDecline: null,
    movableCount: 1,
    selectors: [{ selector: 'foo', decline: null, warning: null }],
    ...over,
  });

const change = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a',
  kind: 'methodAdd',
  className: 'Super',
  isMeta: false,
  selector: 'foo',
  category: 'x',
  oldSource: '',
  newSource: 'foo\n\t^ 1',
  warning: null,
  ...over,
});

const startJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 'tok',
    total: 2,
    targetClass: 'Super',
    movableCount: 1,
    outOfScope: { collision: null, decline: null },
    skippedMethods: [],
    page: {
      changes: [change(), change({ id: 'b', kind: 'methodRemove', className: 'Sub' })],
      nextOffset: 3,
      done: true,
    },
    ...over,
  });

beforeEach(() => vi.clearAllMocks());

describe('push method command', () => {
  it('does not run a pre-flight when the engine is unavailable and the user declines install', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    const outcome = await pushMethod(
      req({ session: { id: 1, rbSupportAvailable: false } as ActiveSession }),
    );

    expect(outcome).toBeUndefined();
    expect(queries.analyzePushMethod).not.toHaveBeenCalled();
  });

  it('reports a failed pre-flight and never opens the preview', async () => {
    vi.mocked(queries.analyzePushMethod).mockRejectedValue(new Error('boom'));

    await pushMethod(req());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(queries.startPushMethodPreview).not.toHaveBeenCalled();
  });

  it('refuses a global decline and never opens the preview', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(
      analysisJson({ globalDecline: 'Cannot push up: Object has no superclass.', movableCount: 0 }),
    );

    await pushMethod(req());

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no superclass'),
    );
    expect(queries.startPushMethodPreview).not.toHaveBeenCalled();
  });

  it('leads with the single decline reason when nothing is movable', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(
      analysisJson({
        movableCount: 0,
        selectors: [
          { selector: 'foo', decline: 'Cannot push up #foo: it sends super.', warning: null },
        ],
      }),
    );

    await pushMethod(req());

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('it sends super'),
    );
    expect(queries.startPushMethodPreview).not.toHaveBeenCalled();
  });

  it('counts and leads when several selectors cannot be pushed', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(
      analysisJson({
        movableCount: 0,
        selectors: [
          { selector: 'foo', decline: 'Cannot push up #foo: it sends super.', warning: null },
          { selector: 'bar', decline: 'Cannot push up #bar: ivar.', warning: null },
        ],
      }),
    );

    await pushMethod(req({ selectors: ['foo', 'bar'] }));

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 methods cannot be pushed'),
    );
  });

  it('reports a failed preview and clears the token', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startPushMethodPreview).mockRejectedValue(new Error('kaboom'));

    await pushMethod(req());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(queries.clearPushMethodPreview).toHaveBeenCalled();
    expect(showPushMethodPanel).not.toHaveBeenCalled();
  });

  it('refuses an out-of-scope decline from the preview and clears the token', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startPushMethodPreview).mockResolvedValue(
      startJson({ outOfScope: { collision: null, decline: 'no can do' } }),
    );

    await pushMethod(req());

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no can do'),
    );
    expect(queries.clearPushMethodPreview).toHaveBeenCalled();
    expect(showPushMethodPanel).not.toHaveBeenCalled();
  });

  it('refuses when the preview has nothing to push', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startPushMethodPreview).mockResolvedValue(
      startJson({ total: 0, page: { changes: [], nextOffset: 1, done: true } }),
    );

    await pushMethod(req());

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing to push'),
    );
    expect(showPushMethodPanel).not.toHaveBeenCalled();
  });

  it('does nothing further when the user cancels the preview', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startPushMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showPushMethodPanel).mockResolvedValue(undefined);

    const outcome = await pushMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports a failed apply', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startPushMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showPushMethodPanel).mockResolvedValue({
      applied: 0,
      failed: [{ id: 'a', label: 'Super>>foo', error: 'boom' }],
    });

    await pushMethod(req());

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('reports when every target was left un-ticked (nothing applied)', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startPushMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showPushMethodPanel).mockResolvedValue({ applied: 0, failed: [] });

    const outcome = await pushMethod(req());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('every target was left un-ticked'),
    );
  });

  it('reveals the superclass after a push-up', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson());
    vi.mocked(queries.startPushMethodPreview).mockResolvedValue(startJson());
    vi.mocked(showPushMethodPanel).mockResolvedValue({ applied: 2, failed: [] });

    const outcome = await pushMethod(req({ direction: 'up' }));

    expect(outcome?.revealClass).toBe('Super');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Pushed #foo up'),
    );
  });

  it('reveals the first fresh recipient subclass after a push-down', async () => {
    vi.mocked(queries.analyzePushMethod).mockResolvedValue(analysisJson({ targetClass: null }));
    vi.mocked(queries.startPushMethodPreview).mockResolvedValue(
      startJson({
        targetClass: null,
        total: 3,
        page: {
          changes: [
            change({ id: 'over', className: 'Cat', warning: 'overwrites Cat>>foo' }),
            change({ id: 'fresh', className: 'Dog', warning: null }),
            change({ id: 'rm', kind: 'methodRemove', className: 'Sub' }),
          ],
          nextOffset: 4,
          done: true,
        },
      }),
    );
    vi.mocked(showPushMethodPanel).mockResolvedValue({ applied: 2, failed: [] });

    const outcome = await pushMethod(req({ direction: 'down' }));

    expect(outcome?.revealClass).toBe('Dog');
  });
});
