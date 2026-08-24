import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { refreshExplorer, reloadVisibleGemstoneEditors, revealMethod } from '../afterUndo';

/**
 * Putting the IDE back in step (#434).
 *
 * The rule with teeth is the DIRTY one: a reverted method's editor is reloaded, but an editor
 * with unsaved edits is left alone. Reverting it would discard the user's typing, and an undo
 * of something else is not licence to do that. Everything else here is best-effort by design —
 * a pane that is not open must never fail the undo that was otherwise fine.
 */

function editor(scheme: string, isDirty: boolean, id = scheme) {
  return { document: { uri: { scheme, toString: () => id }, isDirty } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.showTextDocument).mockResolvedValue(undefined as never);
  vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
  Object.defineProperty(vscode.window, 'activeTextEditor', { value: undefined, writable: true });
});

describe('reloadVisibleGemstoneEditors', () => {
  it('reverts a clean GemStone editor so it shows the restored source', async () => {
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('gemstone', false)],
      writable: true,
    });

    await reloadVisibleGemstoneEditors();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.revert');
  });

  it('leaves a DIRTY GemStone editor alone', async () => {
    // Reverting it would silently discard what the user has typed.
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('gemstone', true)],
      writable: true,
    });

    await reloadVisibleGemstoneEditors();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('ignores editors that are not GemStone documents', async () => {
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('file', false)],
      writable: true,
    });

    await reloadVisibleGemstoneEditors();

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('puts focus back where it started', async () => {
    // Reverting an editor means focusing it, so a reload of some OTHER method's editor would
    // otherwise leave the user looking at a tab they did not open.
    const active = editor('gemstone', false, 'active');
    const other = editor('gemstone', false, 'other');
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [other],
      writable: true,
    });
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: active, writable: true });
    // Model what showTextDocument actually does: it moves focus.
    vi.mocked(vscode.window.showTextDocument).mockImplementation(((doc: unknown) => {
      const target = [active, other].find((e) => e.document === doc);
      Object.defineProperty(vscode.window, 'activeTextEditor', { value: target, writable: true });
      return Promise.resolve(undefined);
    }) as never);

    await reloadVisibleGemstoneEditors();

    expect(vscode.window.activeTextEditor).toBe(active);
  });

  it('leaves focus alone when nothing moved it', async () => {
    const active = editor('gemstone', false, 'active');
    Object.defineProperty(vscode.window, 'visibleTextEditors', { value: [], writable: true });
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: active, writable: true });

    await reloadVisibleGemstoneEditors();

    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
  });

  it('carries on when one editor cannot be shown', async () => {
    // A tab closed underneath the undo must not fail the undo.
    Object.defineProperty(vscode.window, 'visibleTextEditors', {
      value: [editor('gemstone', false, 'a'), editor('gemstone', false, 'b')],
      writable: true,
    });
    vi.mocked(vscode.window.showTextDocument)
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValue(undefined as never);

    await expect(reloadVisibleGemstoneEditors()).resolves.toBeUndefined();
  });
});

describe('refreshExplorer and revealMethod', () => {
  it('rebuilds the Explorer panes', async () => {
    await refreshExplorer();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('does not fail when the Explorer is not active', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('no such command'));
    await expect(refreshExplorer()).resolves.toBeUndefined();
  });

  it('lands the Explorer on a method, naming its side', async () => {
    await revealMethod('Account', 'balance', true);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealMethodByName',
      'Account',
      'balance',
      true,
    );
  });

  it('does not fail when the row is not in the rebuilt tree', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('not found'));
    await expect(revealMethod('Account', 'balance', false)).resolves.toBeUndefined();
  });
});
