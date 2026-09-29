import * as vscode from 'vscode';
import { GEMSTONE_NOTEBOOK_TYPE } from './gemstoneNotebookKernel';
import {
  SMALLTALK_LANGUAGE_ID,
  selectSmalltalkKernel,
  smalltalkNotebookData,
} from './smalltalkNotebookController';
import { logInfo } from './gciLog';

// A blank Jupyter notebook for ad hoc Smalltalk — the notebook counterpart of
// the Workspace (workspace.ts). Untitled, like the tutorial notebook, so the
// user decides whether it is worth a Save As.

export function buildScratchNotebook(): vscode.NotebookData {
  return smalltalkNotebookData([
    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', SMALLTALK_LANGUAGE_ID),
  ]);
}

/**
 * Open a fresh untitled notebook with the GemStone Smalltalk kernel already
 * selected, so the first Shift+Enter runs Smalltalk instead of asking which
 * kernel to use. It is only the default: the kernel picker still offers the
 * rest.
 */
export async function openScratchNotebook(): Promise<void> {
  logInfo('[Notebook] opening scratch Smalltalk notebook');
  try {
    const doc = await vscode.workspace.openNotebookDocument(
      GEMSTONE_NOTEBOOK_TYPE,
      buildScratchNotebook(),
    );
    await vscode.window.showNotebookDocument(doc);
    await selectSmalltalkKernel();
    logInfo('[Notebook] scratch notebook opened');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`[Notebook] ERROR: ${msg}`);
    vscode.window.showErrorMessage(`Could not open a notebook: ${msg}`);
  }
}
