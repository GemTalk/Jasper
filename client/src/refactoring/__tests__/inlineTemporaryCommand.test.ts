import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
vi.mock('../../browserQueries', () => ({
  analyzeInlineTemporary: vi.fn(),
  startInlineTemporaryPreview: vi.fn(),
  pageInlineTemporaryPreview: vi.fn(),
  applyInlineTemporary: vi.fn(),
  clearInlineTemporaryPreview: vi.fn(),
}));
vi.mock('../inlineTemporaryPanel', () => ({
  showInlineTemporaryPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showInlineTemporaryPanel } from '../inlineTemporaryPanel';
import { inlineTemporaryCommand } from '../inlineTemporaryCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the inline-temporary COMMAND (not the engine). Pins down the caret →
 * pre-flight → preview → apply → reload flow and the "always tell the user why
 * nothing happened" contract: a caret that is not on a variable, or a hard decline,
 * surfaces a warning and never opens the preview.
 */

const SOURCE = ['report', '\t| t | t := self total. ^ t'].join('\n');

// A minimal TextDocument over SOURCE with real word/offset arithmetic, addressed by
// a genuine gemstone method URI so the command's parseUri sees a method editor.
function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  return {
    uri: vscode.Uri.parse('gemstone://7/UserGlobals/M4Demo/instance/printing/report?dict=2'),
    isDirty: false,
    getWordRangeAtPosition: (pos: vscode.Position, re: RegExp) => {
      const line = lines[pos.line] ?? '';
      const global = new RegExp(re.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = global.exec(line)) !== null) {
        if (m.index <= pos.character && pos.character < m.index + m[0].length) {
          return new vscode.Range(
            new vscode.Position(pos.line, m.index),
            new vscode.Position(pos.line, m.index + m[0].length),
          );
        }
      }
      return undefined;
    },
    getText: (range: vscode.Range) =>
      lines[range.start.line].slice(range.start.character, range.end.character),
    offsetAt: (pos: vscode.Position) =>
      lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character,
    save: vi.fn(async () => true),
  } as unknown as vscode.TextDocument;
}

/** Install an active gemstone editor with the caret at `at` (defaults to the first
 *  `t` on line 1). */
function installEditor(at?: vscode.Position): void {
  const document = makeDocument();
  const caret = at ?? new vscode.Position(1, 3);
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
    document,
    selection: { isEmpty: true, active: caret, start: caret, end: caret },
    viewColumn: 1,
  };
}

const sessionsWith = (rbSupportAvailable: boolean): SessionManager =>
  ({ getSession: () => ({ id: 7, rbSupportAvailable }) }) as unknown as SessionManager;

const sessions = sessionsWith(true);

const analysis = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 't', decline: null, ...over });

const startEnvelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 't',
    total: 1,
    name: 't',
    outOfScope: { references: 0, skipped: 0, collision: null, decline: null },
    page: {
      changes: [
        {
          id: '1',
          kind: 'methodRecompile',
          className: 'M4Demo',
          isMeta: false,
          selector: 'report',
          oldSource: 'report\n\t| t | t := self total. ^ t',
          newSource: 'report\n\t^ self total',
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

describe('inline-temporary command', () => {
  it('warns to place the cursor on a variable when the caret is not on an identifier', async () => {
    installEditor(new vscode.Position(1, 0)); // on the leading tab

    await inlineTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Place the cursor on the temporary'),
    );
    expect(queries.analyzeInlineTemporary).not.toHaveBeenCalled();
  });

  it('does not run a pre-flight when the engine is unavailable and the user declines install', async () => {
    installEditor();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await inlineTemporaryCommand(sessionsWith(false));

    expect(queries.analyzeInlineTemporary).not.toHaveBeenCalled();
  });

  it('surfaces a hard pre-flight decline and never opens the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineTemporary).mockResolvedValue(
      analysis({ name: null, decline: 'the target is an argument, not a temporary' }),
    );

    await inlineTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('an argument'),
    );
    expect(queries.startInlineTemporaryPreview).not.toHaveBeenCalled();
  });

  it('reports a failed preview and never opens the panel', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineTemporary).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineTemporaryPreview).mockRejectedValue(new Error('kaboom'));

    await inlineTemporaryCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(showInlineTemporaryPanel).not.toHaveBeenCalled();
  });

  it('refuses (and does not open the panel) on a hard decline from the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineTemporary).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineTemporaryPreview).mockResolvedValue(
      startEnvelope({
        total: 0,
        outOfScope: { references: 0, skipped: 0, collision: null, decline: 'cannot inline' },
      }),
    );

    await inlineTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('cannot inline'),
    );
    expect(showInlineTemporaryPanel).not.toHaveBeenCalled();
  });

  it('refuses when the preview finds nothing to inline', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineTemporary).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineTemporaryPreview).mockResolvedValue(startEnvelope({ total: 0 }));

    await inlineTemporaryCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing to inline'),
    );
    expect(showInlineTemporaryPanel).not.toHaveBeenCalled();
  });

  it('does nothing further when the user cancels the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineTemporary).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInlineTemporaryPanel).mockResolvedValue(undefined);

    await inlineTemporaryCommand(sessions);

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reloads the caller editor after a successful inline', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineTemporary).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInlineTemporaryPanel).mockResolvedValue({ applied: 1, failed: [] });

    await inlineTemporaryCommand(sessions);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
  });

  it('reports a failed apply', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineTemporary).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineTemporaryPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInlineTemporaryPanel).mockResolvedValue({
      applied: 0,
      failed: [{ id: '1', label: 'M4Demo>>report', error: 'boom' }],
    });

    await inlineTemporaryCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
