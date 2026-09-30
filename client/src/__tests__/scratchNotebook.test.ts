import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import * as vscode from 'vscode';
import { buildScratchNotebook, openScratchNotebook } from '../scratchNotebook';
import { GEMSTONE_NOTEBOOK_TYPE } from '../gemstoneNotebookKernel';
import { SMALLTALK_CONTROLLER_ID, SMALLTALK_LANGUAGE_ID } from '../smalltalkNotebookController';

describe('scratch notebook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts as one empty Smalltalk code cell — a working notebook, not a lesson', () => {
    const { cells } = buildScratchNotebook();
    expect(cells).toHaveLength(1);
    expect(cells[0].kind).toBe(vscode.NotebookCellKind.Code);
    expect(cells[0].languageId).toBe(SMALLTALK_LANGUAGE_ID);
    expect(cells[0].value).toBe('');
  });

  it('declares Smalltalk as the notebook language so the ipynb round trip keeps it', () => {
    expect(buildScratchNotebook().metadata).toEqual({
      metadata: { language_info: { name: SMALLTALK_LANGUAGE_ID } },
    });
  });

  it('opens an untitled jupyter notebook and selects the Smalltalk kernel', async () => {
    await openScratchNotebook();

    const [type] = vi.mocked(vscode.workspace.openNotebookDocument).mock.calls[0];
    expect(type).toBe(GEMSTONE_NOTEBOOK_TYPE);
    expect(vscode.window.showNotebookDocument).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('notebook.selectKernel', {
      id: SMALLTALK_CONTROLLER_ID,
      extension: 'gemtalksystems.gemstone-ide',
    });
  });

  it('reports a clear error when notebook support is unavailable', async () => {
    vi.mocked(vscode.workspace.openNotebookDocument).mockRejectedValueOnce(
      new Error('no notebook serializer'),
    );

    await openScratchNotebook();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('still opens the notebook when VS Code refuses the kernel selection', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('no such kernel'));

    await openScratchNotebook();

    expect(vscode.window.showNotebookDocument).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('opens a new notebook on every click — no limit', async () => {
    for (let i = 0; i < 3; i++) await openScratchNotebook();

    const calls = vi.mocked(vscode.workspace.openNotebookDocument).mock.calls;
    expect(calls).toHaveLength(3);
    // (type, data) is an anonymous untitled notebook: VS Code gives each a fresh
    // Untitled-N, so none is ever reused.
    for (const [typeOrUri, data] of calls) {
      expect(typeOrUri).toBe(GEMSTONE_NOTEBOOK_TYPE);
      expect(data).toBeDefined();
    }
    expect(vscode.window.showNotebookDocument).toHaveBeenCalledTimes(3);
  });
});
