import * as vscode from 'vscode';
import { GEMSTONE_NOTEBOOK_TYPE } from './gemstoneNotebookKernel';
import { SMALLTALK_LANGUAGE } from './languageIds';

// A notebook cell runs with GCI flags 0, which GemStone reads as "debugger disabled", so a
// method breakpoint never stops one; Execute It passes GCI_PERFORM_FLAG_ENABLE_DEBUG and does.
// The client cannot tell whether a cell would reach a breakpointed method, so rather than
// guessing per run, every Smalltalk cell carries the same standing note beside its language
// label. Real debugging from a cell is #559; this goes away with it.

export const NOTEBOOK_BREAKPOINT_HINT =
  "Breakpoints don't stop in notebook cells. Use Execute It in a workspace to debug. Click to open one.";

export function registerNotebookBreakpointHint(): vscode.Disposable {
  return vscode.notebooks.registerNotebookCellStatusBarItemProvider(GEMSTONE_NOTEBOOK_TYPE, {
    provideCellStatusBarItems(cell) {
      if (cell.kind !== vscode.NotebookCellKind.Code) return [];
      if (cell.document.languageId !== SMALLTALK_LANGUAGE) return [];
      const item = new vscode.NotebookCellStatusBarItem(
        '$(debug-breakpoint-unsupported)',
        vscode.NotebookCellStatusBarAlignment.Right,
      );
      item.tooltip = NOTEBOOK_BREAKPOINT_HINT;
      item.command = 'gemstone.openWorkspace';
      return [item];
    },
  });
}
