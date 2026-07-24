import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));
vi.mock('../../browserQueries', () => ({
  analyzeInlineSend: vi.fn(),
  startInlineMethodPreview: vi.fn(),
  pageInlineMethodPreview: vi.fn(),
  applyInlineMethod: vi.fn(),
  clearInlineMethodPreview: vi.fn(),
}));
vi.mock('../inlineMethodPanel', () => ({
  showInlineMethodPanel: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { showInlineMethodPanel } from '../inlineMethodPanel';
import { inlineMethodCommand } from '../inlineMethodCommand';
import type { SessionManager } from '../../sessionManager';

/**
 * Drives the inline-method COMMAND (not the engine). Pins down the pre-flight →
 * preview → apply → reveal flow and the "always tell the user why nothing happened"
 * contract: a hard decline surfaces a warning and never opens the preview; the
 * Explorer is only refreshed when a removal was offered.
 */

const SOURCE = ['report', '\t^ self total', ''].join('\n');

function makeDocument(): vscode.TextDocument {
  const lines = SOURCE.split('\n');
  const offsetAt = (pos: vscode.Position): number =>
    lines.slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.character;
  return {
    uri: vscode.Uri.parse('gemstone://7/UserGlobals/Account/instance/printing/report?dict=2'),
    isDirty: false,
    getText: (range?: vscode.Range) => {
      if (!range) return SOURCE;
      return SOURCE.slice(offsetAt(range.start), offsetAt(range.end));
    },
    offsetAt,
    save: vi.fn(async () => true),
  } as unknown as vscode.TextDocument;
}

/** Install an active gemstone editor with the caret on `self total`. */
function installEditor(): void {
  const document = makeDocument();
  const caret = new vscode.Position(1, 7);
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
  JSON.stringify({
    targetClass: 'Account',
    targetSelector: 'total',
    lastSender: false,
    decline: null,
    ...over,
  });

const startEnvelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    token: 't',
    total: 1,
    targetSelector: 'total',
    lastSender: false,
    outOfScope: { collision: null, decline: null },
    page: {
      changes: [
        {
          id: '1',
          kind: 'methodRecompile',
          className: 'Account',
          isMeta: false,
          selector: 'report',
          oldSource: 'report\n\t^ self total',
          newSource: 'report\n\t^ balance',
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

describe('inline-method command', () => {
  it('surfaces a hard pre-flight decline and never opens the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(
      analysis({ decline: 'Inline Method works on a self or super send.' }),
    );

    await inlineMethodCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('self or super'),
    );
    expect(queries.startInlineMethodPreview).not.toHaveBeenCalled();
  });

  it('does not run a pre-flight when the engine is unavailable and the user declines install', async () => {
    installEditor();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await inlineMethodCommand(sessionsWith(false));

    expect(queries.analyzeInlineSend).not.toHaveBeenCalled();
  });

  it('reports a failed pre-flight and never opens the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockRejectedValue(new Error('boom'));

    await inlineMethodCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(queries.startInlineMethodPreview).not.toHaveBeenCalled();
  });

  it('reports a failed preview and never opens the panel', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineMethodPreview).mockRejectedValue(new Error('kaboom'));

    await inlineMethodCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('kaboom'));
    expect(showInlineMethodPanel).not.toHaveBeenCalled();
  });

  it('refuses (and does not open the panel) on a hard decline from the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineMethodPreview).mockResolvedValue(
      startEnvelope({ total: 0, outOfScope: { collision: null, decline: 'cannot inline' } }),
    );

    await inlineMethodCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('cannot inline'),
    );
    expect(showInlineMethodPanel).not.toHaveBeenCalled();
  });

  it('refuses when the preview finds nothing to inline', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineMethodPreview).mockResolvedValue(startEnvelope({ total: 0 }));

    await inlineMethodCommand(sessions);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Nothing to inline'),
    );
    expect(showInlineMethodPanel).not.toHaveBeenCalled();
  });

  it('does nothing further when the user cancels the preview', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineMethodPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInlineMethodPanel).mockResolvedValue(undefined);

    await inlineMethodCommand(sessions);

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('reloads the caller editor after a successful inline, without refreshing the Explorer when not last-sender', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineMethodPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInlineMethodPanel).mockResolvedValue({ applied: 1, failed: [] });

    await inlineMethodCommand(sessions);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('refreshes the Explorer after inlining the last sender (a removal was offered)', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(analysis({ lastSender: true }));
    vi.mocked(queries.startInlineMethodPreview).mockResolvedValue(
      startEnvelope({ total: 2, lastSender: true }),
    );
    vi.mocked(showInlineMethodPanel).mockResolvedValue({ applied: 2, failed: [] });

    await inlineMethodCommand(sessions);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('reports a failed apply', async () => {
    installEditor();
    vi.mocked(queries.analyzeInlineSend).mockResolvedValue(analysis());
    vi.mocked(queries.startInlineMethodPreview).mockResolvedValue(startEnvelope());
    vi.mocked(showInlineMethodPanel).mockResolvedValue({
      applied: 0,
      failed: [{ id: '1', label: 'Account>>report', error: 'boom' }],
    });

    await inlineMethodCommand(sessions);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
