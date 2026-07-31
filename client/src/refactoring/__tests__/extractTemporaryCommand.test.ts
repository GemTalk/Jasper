import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
vi.mock('../../browserQueries', () => ({
  analyzeExtractTemporary: vi.fn(),
  startExtractTemporaryPreview: vi.fn(),
  pageExtractTemporaryPreview: vi.fn(),
  applyExtractTemporary: vi.fn(),
  clearExtractTemporaryPreview: vi.fn(),
}));
vi.mock('../extractTemporaryPanel', () => ({
  showExtractTemporaryPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showExtractTemporaryPanel } from '../extractTemporaryPanel';
import { extractTemporaryCommand } from '../extractTemporaryCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the extract-temporary COMMAND (not the engine). Pins down the selection →
 * pre-flight → prompt → replace-all gate → preview → apply → reload flow and the
 * "always tell the user why nothing happened" contract: an empty selection or a hard
 * decline surfaces a warning and never opens the preview.
 */

const SOURCE = ['compute', '\tself a + self a.', '\t^ total'].join('\n');

function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  const offsetAt = (pos: vscode.Position): number =>
    lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character;
  return {
    uri: vscode.Uri.parse('gemstone://7/UserGlobals/M3Demo/instance/demo/compute?dict=2'),
    isDirty: false,
    getText: (range?: vscode.Range) => {
      if (!range) return SOURCE;
      return SOURCE.slice(offsetAt(range.start), offsetAt(range.end));
    },
    offsetAt,
    save: vi.fn(async () => true),
  } as unknown as vscode.TextDocument;
}

/** Install an active gemstone editor with the given selection (defaults to the
 *  expression on line 1). */
function installEditor(selection?: { start: vscode.Position; end: vscode.Position }): void {
  const document = makeDocument();
  const start = selection?.start ?? new vscode.Position(1, 1);
  const end = selection?.end ?? new vscode.Position(1, 13);
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
    document,
    selection: {
      isEmpty: start.line === end.line && start.character === end.character,
      start,
      end,
    },
    viewColumn: 1,
  };
}

const sessions = {
  getSession: () => ({ id: 7, rbSupportAvailable: true }),
} as unknown as SessionManager;

const analysis = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ occurrenceCount: 1, decline: null, ...over });

const startEnvelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 't',
    total: 1,
    newName: 't',
    occurrenceCount: 1,
    outOfScope: { references: 0, skipped: 0, collision: null, decline: null },
    page: {
      changes: [
        {
          id: '1',
          kind: 'methodRecompile',
          className: 'M3Demo',
          isMeta: false,
          selector: 'compute',
          oldSource: 'compute\n\tself a + self a',
          newSource: 'compute\n\t| t | t := self a. ^ t + t',
        },
      ],
      nextOffset: 2,
      done: true,
    },
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extract-temporary command', () => {
  it('refuses an empty selection without a pre-flight', async () => {
    installEditor({ start: new vscode.Position(0, 0), end: new vscode.Position(0, 0) });

    await extractTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Select an expression'),
    );
    expect(queries.analyzeExtractTemporary).not.toHaveBeenCalled();
  });

  it('surfaces a hard pre-flight decline and never prompts', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(
      analysis({ decline: 'The selection is a whole return.' }),
    );

    await extractTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('whole return'),
    );
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  it('does not preview when the name prompt is cancelled', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    await extractTemporaryCommand(sessions);

    expect(queries.startExtractTemporaryPreview).not.toHaveBeenCalled();
  });

  it('offers replace-all and previews with replaceAll on when the user picks it', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis({ occurrenceCount: 2 }));
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      'Replace all 2 occurrences' as unknown as vscode.QuickPickItem,
    );
    vi.mocked(queries.startExtractTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractTemporaryPanel).mockResolvedValue(undefined);

    await extractTemporaryCommand(sessions);

    expect(queries.startExtractTemporaryPreview).toHaveBeenCalledWith(
      expect.anything(),
      'M3Demo',
      'compute',
      false,
      expect.any(Number),
      expect.any(Number),
      't',
      true,
      expect.any(String),
      expect.any(Number),
      expect.anything(),
    );
  });

  it('does not open the replace-all picker when only one occurrence is in scope', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis({ occurrenceCount: 1 }));
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(queries.startExtractTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractTemporaryPanel).mockResolvedValue(undefined);

    await extractTemporaryCommand(sessions);

    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(queries.startExtractTemporaryPreview).toHaveBeenCalledWith(
      expect.anything(),
      'M3Demo',
      'compute',
      false,
      expect.any(Number),
      expect.any(Number),
      't',
      false,
      expect.any(String),
      expect.any(Number),
      expect.anything(),
    );
  });

  it('does not preview when the replace-all picker is cancelled', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis({ occurrenceCount: 2 }));
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await extractTemporaryCommand(sessions);

    expect(queries.startExtractTemporaryPreview).not.toHaveBeenCalled();
  });

  it('refuses (and does not open the panel) on a collision from the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(queries.startExtractTemporaryPreview).mockResolvedValue(
      startEnvelope({
        total: 0,
        outOfScope: {
          references: 0,
          skipped: 0,
          collision: 'the name t is already an instance variable',
          decline: null,
        },
      }),
    );

    await extractTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('already an instance variable'),
    );
    expect(showExtractTemporaryPanel).not.toHaveBeenCalled();
  });

  it('refuses (and does not open the panel) on a hard decline from the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(queries.startExtractTemporaryPreview).mockResolvedValue(
      startEnvelope({
        total: 0,
        outOfScope: { references: 0, skipped: 0, collision: null, decline: 'cannot extract' },
      }),
    );

    await extractTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('cannot extract'),
    );
    expect(showExtractTemporaryPanel).not.toHaveBeenCalled();
  });

  it('reloads the editor after a successful apply', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(queries.startExtractTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractTemporaryPanel).mockResolvedValue({ applied: 1, failed: [] });

    await extractTemporaryCommand(sessions);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
  });

  it('reports a failed apply', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(queries.startExtractTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractTemporaryPanel).mockResolvedValue({
      applied: 0,
      failed: [{ id: '1', label: 'M3Demo>>compute', error: 'boom' }],
    });

    await extractTemporaryCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  // An expired preview token answers `applied:0` with an EMPTY `failed`, so it parses
  // cleanly — without the `result.error` check it reached the success path.
  it('reports an expired preview token instead of taking the success path', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractTemporary).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('t');
    vi.mocked(queries.startExtractTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractTemporaryPanel).mockResolvedValue({
      applied: 0,
      failed: [],
      error: 'preview session expired',
    });

    await extractTemporaryCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('preview session expired'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
