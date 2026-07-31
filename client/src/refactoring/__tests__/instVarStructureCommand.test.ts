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
import { moveInstVar, convertTempToInstVarCommand } from '../instVarStructureCommand';
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

// Drives the shared runInstVarStructure flow through the live entry point (the general #move);
// the pre-flight/preview/apply contract below is the same whatever direction or op reaches it.
const runFlow = (): Promise<boolean> =>
  moveInstVar(session, 'up', 'V2Dog', 'tailLength', ['V2Animal'], 2);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureRbSupport).mockResolvedValue(true);
  vi.mocked(saveIfDirty).mockResolvedValue(true);
});

describe('instance-variable structure command — apply/decline flow', () => {
  it('does not run a pre-flight when the engine is unavailable', async () => {
    vi.mocked(ensureRbSupport).mockResolvedValue(false);

    expect(await runFlow()).toBe(false);
    expect(queries.analyzeInstVarStructure).not.toHaveBeenCalled();
  });

  it('surfaces a pre-flight failure and never previews', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockRejectedValue(new Error('kaboom'));

    expect(await runFlow()).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(queries.startInstVarStructurePreview).not.toHaveBeenCalled();
  });

  it('refuses on a hard pre-flight decline and never previews', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(
      analysis({ decline: 'it is not an instance variable declared in V2Dog' }),
    );

    expect(await runFlow()).toBe(false);
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('not an instance variable'));
    expect(queries.startInstVarStructurePreview).not.toHaveBeenCalled();
  });

  it('reports a failed preview and clears the session', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockRejectedValue(new Error('splat'));

    expect(await runFlow()).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('splat'));
    expect(queries.clearInstVarStructurePreview).toHaveBeenCalled();
    expect(showInstVarStructurePanel).not.toHaveBeenCalled();
  });

  it('refuses on a preview-time (outOfScope) decline', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(
      startEnvelope({ outOfScope: { decline: 'still uses it', note: null } }),
    );

    expect(await runFlow()).toBe(false);
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('still uses it'));
    expect(showInstVarStructurePanel).not.toHaveBeenCalled();
  });

  it('refuses when the preview has nothing to change', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope({ total: 0 }));

    expect(await runFlow()).toBe(false);
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('Nothing to change'));
  });

  it('returns false without a success message when the panel is cancelled', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(undefined);

    expect(await runFlow()).toBe(false);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('surfaces a whole-apply engine error instead of a hollow success (H2)', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(
      applyResult({ applied: 0, error: 'preview session expired' }),
    );

    expect(await runFlow()).toBe(false);
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

    expect(await runFlow()).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('reports a committing apply with the migrate note', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(
      applyResult({ committed: true, migratedFailures: 2 }),
    );

    expect(await runFlow()).toBe(true);
    const msg = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0];
    expect(msg).toContain('committed');
    expect(msg).toContain('2 instance');
  });
});

describe('move instance variable command', () => {
  it('threads the chosen destinations and direction through as a move, opting into accessors', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(applyResult());

    await moveInstVar(session, 'down', 'V4Mid', 'shared', ['V4LeafA', 'V4LeafB'], 2);

    expect(queries.analyzeInstVarStructure).toHaveBeenCalledWith(
      session,
      'move',
      'V4Mid',
      'shared',
      2,
      undefined,
      true,
      { targets: ['V4LeafA', 'V4LeafB'], direction: 'down' },
    );
  });

  it('names the source class and single destination in an up-move heading', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(applyResult());

    expect(await moveInstVar(session, 'up', 'V4Leaf', 'shared', ['V4Base'], 2)).toBe(true);

    const heading = vi.mocked(showInstVarStructurePanel).mock.calls[0][0];
    expect(heading).toContain("'shared' from V4Leaf up to V4Base");
  });

  it('names each destination in a down-move heading', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(applyResult());

    await moveInstVar(session, 'down', 'V4Mid', 'shared', ['V4LeafA', 'V4LeafB'], 2);

    const heading = vi.mocked(showInstVarStructurePanel).mock.calls[0][0];
    expect(heading).toContain('from V4Mid down to V4LeafA, V4LeafB');
  });

  it('falls back to a subclass count once there are more destinations than fit', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(analysis());
    vi.mocked(queries.startInstVarStructurePreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInstVarStructurePanel).mockResolvedValue(applyResult());

    await moveInstVar(session, 'down', 'V4Mid', 'shared', ['A', 'B', 'C', 'D'], 2);

    const heading = vi.mocked(showInstVarStructurePanel).mock.calls[0][0];
    expect(heading).toContain('from V4Mid down to 4 subclasses');
  });

  it('refuses on a hard decline and never previews', async () => {
    vi.mocked(queries.analyzeInstVarStructure).mockResolvedValue(
      analysis({ decline: 'GsVSTwig still uses it in 1 of its own method(s): #usesPush.' }),
    );

    expect(await moveInstVar(session, 'down', 'V4Mid', 'shared', ['V4LeafA'], 2)).toBe(false);
    expect(queries.startInstVarStructurePreview).not.toHaveBeenCalled();
    expect(refuse).toHaveBeenCalledWith(expect.stringContaining('still uses it'));
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
