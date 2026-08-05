import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getSiblingClassNames: vi.fn(),
  candidatesForExtractSuperclass: vi.fn(),
  analyzeExtractSuperclass: vi.fn(),
  startExtractSuperclassPreview: vi.fn(),
  pageExtractSuperclassPreview: vi.fn(),
  applyExtractSuperclass: vi.fn(),
  clearExtractSuperclassPreview: vi.fn(),
}));
vi.mock('../extractSuperclassPanel', () => ({
  showExtractSuperclassPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showExtractSuperclassPanel } from '../extractSuperclassPanel';
import {
  insertSuperclassCommand,
  extractSuperclassCommand,
  ExtractSuperContext,
} from '../extractSuperclassCommand';
import type { ActiveSession } from '../../sessionManager';

/**
 * Drives the extract-superclass COMMAND orchestrator (not the engine). Pins the picker →
 * pre-flight → preview → apply → reveal flow and the "say why nothing happened" branches:
 * engine unavailable, name/picker cancellation, a decline, a failed apply, and the sibling +
 * member selection wiring. The parsers run for real; only the queries and the panel are mocked.
 */

const ctx = (over: Partial<ExtractSuperContext> = {}): ExtractSuperContext => ({
  session: { id: 1, rbSupportAvailable: true } as unknown as ActiveSession,
  className: 'Dog',
  dict: 3,
  ...over,
});

const analysisJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    decline: null,
    newClass: 'Pet',
    sharedParent: 'Animal',
    affectedCount: 3,
    ...over,
  });

const startJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 'tok',
    total: 3,
    newClass: 'Pet',
    sharedParent: 'Animal',
    outOfScope: { decline: null, note: null },
    page: {
      changes: [
        {
          id: '1',
          kind: 'classAdd',
          className: 'Pet',
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

const candidatesJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    decline: null,
    sharedParent: 'Animal',
    methods: [{ selector: 'eat', kind: 'identical', defaultChecked: true, reason: null }],
    instVars: [{ name: 'name', kind: 'identical', defaultChecked: true }],
    ...over,
  });

const setOpenDocs = (docs: unknown[]): void => {
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = docs;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => setOpenDocs([]));

describe('insert superclass command', () => {
  it('does nothing when the engine is unavailable', async () => {
    const outcome = await insertSuperclassCommand(
      ctx({ session: { id: 1, rbSupportAvailable: false } as ActiveSession }),
    );

    expect(outcome).toBeUndefined();
    expect(queries.analyzeExtractSuperclass).not.toHaveBeenCalled();
  });

  it('does nothing when the name prompt is cancelled', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    const outcome = await insertSuperclassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(queries.analyzeExtractSuperclass).not.toHaveBeenCalled();
  });

  it('inserts with no siblings and no hoisted members, then reports the new class', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');
    vi.mocked(queries.analyzeExtractSuperclass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startExtractSuperclassPreview).mockResolvedValue(startJson());
    vi.mocked(showExtractSuperclassPanel).mockResolvedValue({ applied: 3, failed: [] });

    const outcome = await insertSuperclassCommand(ctx());

    expect(outcome).toEqual({ newClass: 'Pet', applied: 3 });
    const [, , newName, siblings, hoist] = vi.mocked(queries.analyzeExtractSuperclass).mock
      .calls[0];
    expect(newName).toBe('Pet');
    expect(siblings).toEqual([]);
    expect(hoist).toEqual({ methods: [], instVars: [] });
  });

  it('refuses an analysis decline and never previews', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');
    vi.mocked(queries.analyzeExtractSuperclass).mockResolvedValue(
      analysisJson({ decline: 'a class of that name already exists' }),
    );

    await insertSuperclassCommand(ctx());

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );
    expect(queries.startExtractSuperclassPreview).not.toHaveBeenCalled();
  });
});

describe('extract superclass command', () => {
  it('threads the chosen siblings and hoisted members into the preview', async () => {
    vi.mocked(queries.getSiblingClassNames).mockReturnValue(['Cat', 'Fish']);
    vi.mocked(vscode.window.showQuickPick)
      .mockResolvedValueOnce(['Cat'] as never)
      .mockResolvedValueOnce([
        { label: 'eat', memberType: 'method', key: 'eat' },
        { label: 'name', memberType: 'ivar', key: 'name' },
      ] as never);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');
    vi.mocked(queries.candidatesForExtractSuperclass).mockResolvedValue(candidatesJson());
    vi.mocked(queries.analyzeExtractSuperclass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startExtractSuperclassPreview).mockResolvedValue(startJson());
    vi.mocked(showExtractSuperclassPanel).mockResolvedValue({ applied: 4, failed: [] });

    const outcome = await extractSuperclassCommand(ctx());

    expect(outcome).toEqual({ newClass: 'Pet', applied: 4 });
    const [, , , siblings, hoist] = vi.mocked(queries.analyzeExtractSuperclass).mock.calls[0];
    expect(siblings).toEqual(['Cat']);
    expect(hoist).toEqual({ methods: ['eat'], instVars: ['name'] });
  });

  it('saves dirty gemstone method editors before classifying, leaving other buffers alone', async () => {
    const dirtyMethod = vi.fn(async () => true);
    const cleanMethod = vi.fn(async () => true);
    const dirtyFile = vi.fn(async () => true);
    setOpenDocs([
      { isDirty: true, uri: { scheme: 'gemstone' }, save: dirtyMethod },
      { isDirty: false, uri: { scheme: 'gemstone' }, save: cleanMethod },
      { isDirty: true, uri: { scheme: 'file' }, save: dirtyFile },
    ]);
    vi.mocked(queries.getSiblingClassNames).mockReturnValue([]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue([] as never);
    vi.mocked(queries.candidatesForExtractSuperclass).mockResolvedValue(candidatesJson());
    vi.mocked(queries.analyzeExtractSuperclass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startExtractSuperclassPreview).mockResolvedValue(startJson());
    vi.mocked(showExtractSuperclassPanel).mockResolvedValue({ applied: 1, failed: [] });

    await extractSuperclassCommand(ctx());

    expect(dirtyMethod).toHaveBeenCalledTimes(1);
    expect(cleanMethod).not.toHaveBeenCalled();
    expect(dirtyFile).not.toHaveBeenCalled();
    expect(queries.candidatesForExtractSuperclass).toHaveBeenCalled();
  });

  it('aborts before classifying when a dirty method buffer will not save', async () => {
    setOpenDocs([{ isDirty: true, uri: { scheme: 'gemstone' }, save: vi.fn(async () => false) }]);
    vi.mocked(queries.getSiblingClassNames).mockReturnValue([]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');

    const outcome = await extractSuperclassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(queries.candidatesForExtractSuperclass).not.toHaveBeenCalled();
  });

  it('skips the sibling picker when the class is an only child', async () => {
    vi.mocked(queries.getSiblingClassNames).mockReturnValue([]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');
    vi.mocked(queries.candidatesForExtractSuperclass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue([] as never);
    vi.mocked(queries.analyzeExtractSuperclass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startExtractSuperclassPreview).mockResolvedValue(startJson());
    vi.mocked(showExtractSuperclassPanel).mockResolvedValue({ applied: 1, failed: [] });

    await extractSuperclassCommand(ctx());

    const [, , , siblings] = vi.mocked(queries.analyzeExtractSuperclass).mock.calls[0];
    expect(siblings).toEqual([]);
  });

  it('does nothing when the sibling picker is cancelled', async () => {
    vi.mocked(queries.getSiblingClassNames).mockReturnValue(['Cat']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    const outcome = await extractSuperclassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  it('refuses a candidates decline', async () => {
    vi.mocked(queries.getSiblingClassNames).mockReturnValue([]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');
    vi.mocked(queries.candidatesForExtractSuperclass).mockResolvedValue(
      candidatesJson({ decline: 'no can do' }),
    );

    await extractSuperclassCommand(ctx());

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no can do'),
    );
    expect(queries.analyzeExtractSuperclass).not.toHaveBeenCalled();
  });

  it('reports a failed apply and does not reveal', async () => {
    vi.mocked(queries.getSiblingClassNames).mockReturnValue([]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Pet');
    vi.mocked(queries.candidatesForExtractSuperclass).mockResolvedValue(candidatesJson());
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue([] as never);
    vi.mocked(queries.analyzeExtractSuperclass).mockResolvedValue(analysisJson());
    vi.mocked(queries.startExtractSuperclassPreview).mockResolvedValue(startJson());
    vi.mocked(showExtractSuperclassPanel).mockResolvedValue({
      applied: 1,
      failed: [{ id: '2', label: 'Dog', error: 'boom' }],
    });

    const outcome = await extractSuperclassCommand(ctx());

    expect(outcome).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
