/**
 * Opening a method's document moves the GemStone Explorer to it, even when that document is
 * already the active editor. VS Code reports no editor change for that open, so the Explorer's
 * usual trigger never fires and it stayed wherever the user had browsed to.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logWarning: vi.fn() }));
vi.mock('../matchHighlights', () => ({
  firstMatchSelection: vi.fn((_doc: unknown, m?: unknown[]) => (m ? 'first-match' : undefined)),
  markMatches: vi.fn(),
}));

import * as vscode from 'vscode';
import { openDocumentAndSyncExplorer } from '../openDocumentAndSyncExplorer';
import { logWarning } from '../gciLog';
import { markMatches } from '../matchHighlights';

const uri = vscode.Uri.parse('gemstone://1/Globals/Object/instance/printing/printString');

function fakeExplorer() {
  const calls: string[] = [];
  return {
    calls,
    markAttributedOpen: vi.fn(() => calls.push('mark')),
    clearAttributedOpen: vi.fn(() => calls.push('clear')),
    syncToEditor: vi.fn(async () => {
      calls.push('sync');
    }),
  };
}

/** Make `showTextDocument` hand back `editor`, as VS Code does when the tab is already active. */
function showReturns(editor: unknown) {
  vi.mocked(vscode.window.showTextDocument).mockResolvedValueOnce(editor as vscode.TextEditor);
}

const window = vscode.window as { activeTextEditor: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  window.activeTextEditor = undefined;
});

describe('openDocumentAndSyncExplorer', () => {
  it('syncs the Explorer itself when the document was already the active editor', async () => {
    const active = { document: { uri } };
    window.activeTextEditor = active;
    showReturns(active);
    const explorer = fakeExplorer();

    await openDocumentAndSyncExplorer(explorer, uri);

    expect(explorer.syncToEditor).toHaveBeenCalledWith(uri);
    // The sync runs while the claim stands, so it is read as a deliberate navigation.
    expect(explorer.calls).toEqual(['mark', 'sync', 'clear']);
  });

  it('leaves the sync to the editor-change event when another editor becomes active', async () => {
    window.activeTextEditor = { document: { uri: vscode.Uri.parse('gemstone://1/x') } };
    showReturns({ document: { uri } });
    const explorer = fakeExplorer();

    await openDocumentAndSyncExplorer(explorer, uri);

    expect(explorer.syncToEditor).not.toHaveBeenCalled();
    expect(explorer.calls).toEqual(['mark', 'clear']);
  });

  it('does not sync when focus is preserved', async () => {
    const active = { document: { uri } };
    window.activeTextEditor = active;
    showReturns(active);
    const explorer = fakeExplorer();

    await openDocumentAndSyncExplorer(explorer, uri, { preserveFocus: true });

    expect(explorer.syncToEditor).not.toHaveBeenCalled();
  });

  it('passes the open options through, defaulting to a preview tab', async () => {
    await openDocumentAndSyncExplorer(fakeExplorer(), uri, { viewColumn: 2, preserveFocus: true });
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(expect.anything(), {
      preview: true,
      viewColumn: 2,
      preserveFocus: true,
    });
  });

  it('still opens, logs, and drops the claim when the Explorer cannot follow', async () => {
    const active = { document: { uri } };
    window.activeTextEditor = active;
    showReturns(active);
    const explorer = fakeExplorer();
    explorer.syncToEditor.mockRejectedValueOnce(new Error('session busy'));

    await expect(openDocumentAndSyncExplorer(explorer, uri)).resolves.toBeUndefined();
    expect(explorer.calls).toEqual(['mark', 'clear']);
    expect(vi.mocked(logWarning)).toHaveBeenCalledWith(expect.stringContaining('session busy'));
  });

  it('drops the claim when the open throws', async () => {
    vi.mocked(vscode.workspace.openTextDocument).mockRejectedValueOnce(new Error('gone'));
    const explorer = fakeExplorer();

    await expect(openDocumentAndSyncExplorer(explorer, uri)).rejects.toThrow('gone');
    expect(explorer.calls).toEqual(['mark', 'clear']);
  });

  it("selects a regex hit's first match and marks them all", async () => {
    const shown = { document: { uri } };
    showReturns(shown);
    const matches = [
      { start: 0, end: 3 },
      { start: 5, end: 9 },
    ];

    await openDocumentAndSyncExplorer(fakeExplorer(), uri, { matches });

    expect(vi.mocked(vscode.window.showTextDocument).mock.calls[0][1]).toMatchObject({
      selection: 'first-match',
    });
    expect(markMatches).toHaveBeenCalledWith(shown, matches);
  });

  it('marks nothing for an open without matches', async () => {
    showReturns({ document: { uri } });

    await openDocumentAndSyncExplorer(fakeExplorer(), uri);

    expect(markMatches).not.toHaveBeenCalled();
  });
});
