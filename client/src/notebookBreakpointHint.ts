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
  // Changing a cell's language reopens its text document under the new language id. Asking
  // VS Code to re-query then is what drops the hint from a cell switched away from Smalltalk
  // (and adds it to one switched to it), rather than leaving whatever was drawn first.
  const changed = new vscode.EventEmitter<void>();
  const reopened = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.uri.scheme === 'vscode-notebook-cell') changed.fire();
  });
  const provider = vscode.notebooks.registerNotebookCellStatusBarItemProvider(
    GEMSTONE_NOTEBOOK_TYPE,
    {
      onDidChangeCellStatusBarItems: changed.event,
      provideCellStatusBarItems(cell) {
        if (cell.kind !== vscode.NotebookCellKind.Code) return [];
        if (cell.document.languageId !== SMALLTALK_LANGUAGE) return [];
        const item = new vscode.NotebookCellStatusBarItem(
          // The status bar draws a codicon at its own fixed size, so the words are what make
          // the hint noticeable; the icon alone was a speck beside the language label.
          '$(question) Breakpoints not honored',
          vscode.NotebookCellStatusBarAlignment.Right,
        );
        item.tooltip = NOTEBOOK_BREAKPOINT_HINT;
        item.command = 'gemstone.openWorkspace';
        return [item];
      },
    },
  );
  return vscode.Disposable.from(provider, reopened, changed);
}
