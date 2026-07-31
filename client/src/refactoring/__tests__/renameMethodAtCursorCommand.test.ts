import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { renameMethodAtCursorCommand } from '../renameMethodAtCursorCommand';

/**
 * Drives the editor-triggered rename-method command. The target follows the
 * cursor: a SENT selector under it renames that selector; the header (which
 * resolves to the edited method's own selector) or a non-send position renames
 * the method being edited. Anything that is not a saved method editor declines
 * with a warning.
 */

function installEditor(uri: string): void {
  (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
    document: { uri: vscode.Uri.parse(uri), isDirty: false },
    selection: { active: new vscode.Position(0, 0) },
    viewColumn: 1,
  };
}

const noSelector = vi.fn(async () => null);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rename-method from the editor', () => {
  it('renames the edited method when the cursor is not on a message send', async () => {
    installEditor('gemstone://7/UserGlobals/R5Demo/instance/demo/scaleBy%3A?dict=2');
    const beginRename = vi.fn(async () => false);

    await renameMethodAtCursorCommand(beginRename, noSelector);

    expect(beginRename).toHaveBeenCalledWith({
      className: 'R5Demo',
      selector: 'scaleBy:',
      isMeta: false,
      dictIndex: 2,
      dictName: 'UserGlobals',
    });
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('renames the sent selector when the cursor is on a message send in the body', async () => {
    installEditor('gemstone://7/UserGlobals/R5Demo/instance/demo-senders/report');
    const beginRename = vi.fn(async () => false);

    await renameMethodAtCursorCommand(
      beginRename,
      vi.fn(async () => 'runningSum'),
      new vscode.Position(2, 8),
    );

    expect(beginRename).toHaveBeenCalledWith(expect.objectContaining({ selector: 'runningSum' }));
  });

  it('renames the edited method when the cursor is on its own header selector', async () => {
    installEditor('gemstone://7/UserGlobals/R5Demo/instance/demo-senders/report');
    const beginRename = vi.fn(async () => false);

    await renameMethodAtCursorCommand(
      beginRename,
      vi.fn(async () => 'report'),
    );

    expect(beginRename).toHaveBeenCalledWith(expect.objectContaining({ selector: 'report' }));
  });

  it('aborts with a warning when the selector lookup is unavailable (LSP not ready)', async () => {
    installEditor('gemstone://7/UserGlobals/R5Demo/instance/demo-senders/report');
    const beginRename = vi.fn(async () => false);

    await renameMethodAtCursorCommand(
      beginRename,
      vi.fn(async () => {
        throw new Error('LSP not ready');
      }),
    );

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('not available right now'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('targets the class side for a class-side method editor', async () => {
    installEditor('gemstone://7/UserGlobals/R5Demo/class/demo/reset');
    const beginRename = vi.fn(async () => false);

    await renameMethodAtCursorCommand(beginRename, noSelector);

    expect(beginRename).toHaveBeenCalledWith(expect.objectContaining({ isMeta: true }));
  });

  it('declines when the active editor is not a GemStone method', async () => {
    (vscode.window as unknown as Record<string, unknown>).activeTextEditor = {
      document: { uri: vscode.Uri.parse('file:///tmp/scratch.st'), isDirty: false },
      selection: { active: new vscode.Position(0, 0) },
    };
    const beginRename = vi.fn(async () => false);

    await renameMethodAtCursorCommand(beginRename, noSelector);

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(beginRename).not.toHaveBeenCalled();
  });

  it('declines an unsaved new-method editor', async () => {
    installEditor('gemstone://7/UserGlobals/R5Demo/instance/demo/new-method');
    const beginRename = vi.fn(async () => false);

    await renameMethodAtCursorCommand(beginRename, noSelector);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Save the new method first'),
    );
    expect(beginRename).not.toHaveBeenCalled();
  });
});
