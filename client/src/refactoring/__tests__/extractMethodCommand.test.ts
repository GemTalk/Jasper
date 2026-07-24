import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
vi.mock('../../browserQueries', () => ({
  analyzeExtractSelection: vi.fn(),
  startExtractMethodPreview: vi.fn(),
  pageExtractMethodPreview: vi.fn(),
  applyExtractMethod: vi.fn(),
  clearExtractMethodPreview: vi.fn(),
}));
vi.mock('../extractMethodPanel', () => ({
  showExtractMethodPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showExtractMethodPanel } from '../extractMethodPanel';
import { extractMethodCommand } from '../extractMethodCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the extract-method COMMAND (not the engine). Pins down the pre-flight →
 * prompt → preview → apply → reveal flow and the "always tell the user why nothing
 * happened" contract: an empty selection or a hard decline surfaces a warning and
 * never opens the preview.
 */

const SOURCE = ['demoVoidRun', '\tself reset. self recount.', '\t^total'].join('\n');

function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  const offsetAt = (pos: vscode.Position): number =>
    lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character;
  return {
    uri: vscode.Uri.parse('gemstone://7/UserGlobals/M1Demo/instance/demo/demoVoidRun?dict=2'),
    isDirty: false,
    getText: (range?: vscode.Range) => {
      if (!range) return SOURCE;
      return SOURCE.slice(offsetAt(range.start), offsetAt(range.end));
    },
    offsetAt,
    save: vi.fn(async () => true),
  } as unknown as vscode.TextDocument;
}

/** Install an active gemstone editor with the given selection (defaults to the two
 *  statements on line 1). */
function installEditor(selection?: { start: vscode.Position; end: vscode.Position }): void {
  const document = makeDocument();
  const start = selection?.start ?? new vscode.Position(1, 1);
  const end = selection?.end ?? new vscode.Position(1, 26);
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
  JSON.stringify({
    argCount: 0,
    argNames: [],
    returnVar: null,
    safeVoidShape: true,
    decline: null,
    ...over,
  });

const startEnvelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 't',
    total: 2,
    newSelector: 'helper',
    outOfScope: { collision: null, decline: null },
    page: {
      changes: [
        {
          id: '1',
          kind: 'methodAdd',
          className: 'M1Demo',
          isMeta: false,
          selector: 'helper',
          oldSource: null,
          newSource: 'helper\n\tself reset',
        },
        {
          id: '2',
          kind: 'methodRecompile',
          className: 'M1Demo',
          isMeta: false,
          selector: 'demoVoidRun',
          oldSource: 'a',
          newSource: 'b',
        },
      ],
      nextOffset: 3,
      done: true,
    },
    ...over,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extract-method command', () => {
  it('refuses an empty selection without a pre-flight', async () => {
    installEditor({ start: new vscode.Position(0, 0), end: new vscode.Position(0, 0) });

    await extractMethodCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Select the statements'),
    );
    expect(queries.analyzeExtractSelection).not.toHaveBeenCalled();
  });

  it('surfaces a hard pre-flight decline and never prompts', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractSelection).mockResolvedValue(
      analysis({ decline: 'The selection contains a method return (^).' }),
    );

    await extractMethodCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('method return'),
    );
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
  });

  it('does not preview when the selector prompt is cancelled', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractSelection).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    await extractMethodCommand(sessions);

    expect(queries.startExtractMethodPreview).not.toHaveBeenCalled();
  });

  it('requests the replace-similar pass for a safe void shape', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractSelection).mockResolvedValue(analysis({ safeVoidShape: true }));
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('helper');
    vi.mocked(queries.startExtractMethodPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractMethodPanel).mockResolvedValue(undefined); // user closes the panel

    await extractMethodCommand(sessions);

    expect(queries.startExtractMethodPreview).toHaveBeenCalledWith(
      expect.anything(),
      'M1Demo',
      'demoVoidRun',
      false,
      expect.any(Number),
      expect.any(Number),
      'helper',
      true, // replaceSimilar — safe void shape
      expect.any(String),
      expect.any(Number),
      expect.anything(),
    );
  });

  it('does not request the replace-similar pass for a value-returning extraction', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractSelection).mockResolvedValue(
      analysis({ safeVoidShape: false }),
    );
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('helper');
    vi.mocked(queries.startExtractMethodPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractMethodPanel).mockResolvedValue(undefined);

    await extractMethodCommand(sessions);

    expect(queries.startExtractMethodPreview).toHaveBeenCalledWith(
      expect.anything(),
      'M1Demo',
      'demoVoidRun',
      false,
      expect.any(Number),
      expect.any(Number),
      'helper',
      false, // replaceSimilar off
      expect.any(String),
      expect.any(Number),
      expect.anything(),
    );
  });

  it('refuses (and does not open the panel) on a hard decline from the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractSelection).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('helper');
    vi.mocked(queries.startExtractMethodPreview).mockResolvedValue(
      startEnvelope({ total: 0, outOfScope: { collision: null, decline: 'cannot extract' } }),
    );

    await extractMethodCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('cannot extract'),
    );
    expect(showExtractMethodPanel).not.toHaveBeenCalled();
  });

  it('reveals the new method after a successful apply', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractSelection).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('helper');
    vi.mocked(queries.startExtractMethodPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractMethodPanel).mockResolvedValue({ applied: 2, failed: [] });

    await extractMethodCommand(sessions);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
    // the new method's editor is opened
    const opened = vi
      .mocked(vscode.window.showTextDocument)
      .mock.calls.some((c) => String((c[0] as { path?: string })?.path ?? '').includes('helper'));
    expect(opened).toBe(true);
  });

  it('reports a failed apply', async () => {
    installEditor();
    vi.mocked(queries.analyzeExtractSelection).mockResolvedValue(analysis());
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('helper');
    vi.mocked(queries.startExtractMethodPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showExtractMethodPanel).mockResolvedValue({
      applied: 1,
      failed: [{ id: '2', label: 'M1Demo>>demoVoidRun', error: 'boom' }],
    });

    await extractMethodCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
