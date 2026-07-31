import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
vi.mock('../../browserQueries', () => ({
  analyzeInstVarStructure: vi.fn(),
  startInstVarStructurePreview: vi.fn(),
  pageInstVarStructurePreview: vi.fn(),
  applyInstVarStructure: vi.fn(),
  clearInstVarStructurePreview: vi.fn(),
}));
vi.mock('../instVarStructurePanel', () => ({
  showInstVarStructurePanel: vi.fn(),
}));
vi.mock('../renameAtCursorShared', () => ({
  ensureRbSupport: vi.fn(async () => true),
  refuse: vi.fn(),
  resolveMethodEditor: vi.fn(),
  wordAt: vi.fn(),
  saveIfDirty: vi.fn(async () => true),
  reloadMethodEditor: vi.fn(),
}));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showInstVarStructurePanel } from '../instVarStructurePanel';
import {
  ensureRbSupport,
  refuse,
  resolveMethodEditor,
  wordAt,
  saveIfDirty,
} from '../renameAtCursorShared';
import { pushInstVar, convertTempToInstVarCommand } from '../instVarStructureCommand';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import type { ActiveSession, SessionManager } from '../../sessionManager';

/**
 * Drives the instance-variable-structure COMMAND (not the engine). Pins the
 * pre-flight → preview → apply flow and the "always tell the user why nothing
 * happened" contract, plus that a whole-apply engine `error` is surfaced (not shown
 * as a hollow success) and that a class-side convert-temp threads meta through.
 */

const session = { id: 7, rbSupportAvailable: true } as unknown as ActiveSession;

const analysis = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ decline: null, topClass: 'V2Animal', affectedCount: 2, ...over });

const startEnvelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 'tok',
    total: 2,
    topClass: 'V2Animal',
    outOfScope: { decline: null, note: null },
    page: { changes: [], nextOffset: 1, done: true },
    ...over,
  });

const applyResult = (over: Record<string, unknown> = {}) => ({
  applied: 2,
  failed: [],
  committed: false,
  migratedFailures: 0,
  ...over,
});

const pushUp = (): Promise<boolean> => pushInstVar(session, 'up', 'V2Dog', 'tailLength', 2);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureRbSupport).mockResolvedValue(true);
  vi.mocked(saveIfDirty).mockResolvedValue(true);
});

describe('push instance variable command', () => {
  it('does not run a pre-flight when the engine is unavailable', async () => {
    vi.mocked(ensureRbSupport).mockResolvedValue(false);

    expect(await pushUp()).toBe(false);
    expect(queries.analyzeInstVarStructure).not.toHaveBeenCalled();
  });

  it('always opts into moving simple accessors on a push', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(applyResult());

    await pushUp();

    // Assert the whole argument list (not a positional index) so inserting or reordering a
    // parameter fails loudly here instead of silently asserting on the wrong argument.
    expect(queries.analyzeInstVarStructure).toHaveBeenCalledWith(
      session,
      'pushUp',
      'V2Dog',
      'tailLength',
      2,
      undefined,
      true,
    );
    expect(queries.startInstVarStructurePreview).toHaveBeenCalledWith(
      session,
      'pushUp',
      'V2Dog',
      'tailLength',
      expect.any(String),
      PREVIEW_PAGE_BYTES,
      2,
      undefined,
      true,
    );
  });

  it('surfaces a pre-flight failure and never previews', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockRejectedValue(new Error('kaboom'));

    expect(await pushUp()).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(queries.startInstVarStructurePreview).not.toHaveBeenCalled();
  });

  it('refuses on a hard pre-flight decline and never previews', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(
      analysis({ decline: 'it is not an instance variable declared in V2Dog' }),
    );

    expect(await pushUp()).toBe(false);
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('not an instance variable'));
    expect(queries.startInstVarStructurePreview).not.toHaveBeenCalled();
  });

  it('reports a failed preview and clears the session', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockRejectedValue(new Error('splat'));

    expect(await pushUp()).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('splat'));
    expect(queries.clearInstVarStructurePreview).toHaveBeenCalled();
    expect(showInstVarStructurePanel).not.toHaveBeenCalled();
  });

  it('refuses on a preview-time (outOfScope) decline', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(
      startEnvelope({ outOfScope: { decline: 'still uses it', note: null } }),
    );

    expect(await pushUp()).toBe(false);
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('still uses it'));
    expect(showInstVarStructurePanel).not.toHaveBeenCalled();
  });

  it('refuses when the preview has nothing to change', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope({ total: 0 }));

    expect(await pushUp()).toBe(false);
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('Nothing to change'));
  });

  it('returns false without a success message when the panel is cancelled', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(undefined);

    expect(await pushUp()).toBe(false);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('surfaces a whole-apply engine error instead of a hollow success (H2)', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(
      applyResult({ applied: 0, error: 'preview session expired' }),
    );

    expect(await pushUp()).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('preview session expired'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('reports a per-change failure', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(
      applyResult({ failed: [{ id: '1', label: 'V2Dog', error: 'boom' }] }),
    );

    expect(await pushUp()).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('reports a committing apply with the migrate note', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(
      applyResult({ committed: true, migratedFailures: 2 }),
    );

    expect(await pushUp()).toBe(true);
    const msg = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0];
    expect(msg).toContain('committed');
    expect(msg).toContain('2 instance');
  });
});

describe('convert temporary to instance variable command', () => {
  const sessions = {} as unknown as SessionManager;

  it('threads the class-side (meta) flag through to the engine, which declines it (H1)', async () => {
    vi.mocked(resolveMethodEditor).mockReturnValue({
      editor: {} as unknown,
      parsed: { className: 'V5Demo', selector: 'classM', isMeta: true },
      session,
      dict: 2,
    } as unknown as ReturnType<typeof resolveMethodEditor>);
    vi.mocked(wordAt).mockReturnValue({ name: 'c' } as unknown as ReturnType<typeof wordAt>);
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(
      analysis({ decline: 'converting a temporary in a class-side method is not supported' }),
    );

    await convertTempToInstVarCommand(sessions);

    const call = vi.mocked(queries.analyzeInstVarStructure).mock.calls[0];
    expect(call[1]).toBe('convertTemp');
    expect(call[5]).toMatchObject({ selector: 'classM', isMeta: true, varName: 'c' });
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('class-side method'));
  });
});
