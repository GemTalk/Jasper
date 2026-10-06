import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { evalPythonInScope, resetPythonScope } from './pythonQueries';
import { logError } from './gciLog';
import { GemStoneNotebookKernel } from './gemstoneNotebookKernel';
import { sessionKernelId } from './sessionKernels';

// Grail (GemStone-Python) as a Python kernel — see gemstoneNotebookKernel.ts
// for the Jupyter integration mechanics.
//
// Cells share state the way Jupyter users expect (`x = 1` in one cell, `x + 2`
// in the next): each notebook gets a persistent module scope on the GemStone
// side, keyed by the notebook URI — see evalPythonInScope in queries/python.ts
// and ModuleAst's `evaluateSource:usingModuleScope:` REPL contract.

export const GRAIL_CONTROLLER_ID = 'gemstone-grail';
export const GRAIL_CONTROLLER_LABEL = 'Grail (GemStone Python)';
export const GRAIL_RESET_SCOPE_COMMAND = 'gemstone.resetGrailNotebookScope';

/** The Grail kernel bound to one session — one per logged-in session, in multiple-session mode. */
export function grailSessionKernel(
  sessionManager: SessionManager,
  sessionId: number,
): GemStoneNotebookKernel {
  return new GemStoneNotebookKernel(sessionManager, {
    id: sessionKernelId(GRAIL_CONTROLLER_ID, sessionId),
    label: GRAIL_CONTROLLER_LABEL,
    description: `Always runs Python in Session ${sessionId}`,
    supportedLanguages: ['python'],
    evaluate: (session, source, scopeId) => evalPythonInScope(session, source, scopeId),
    sessionId,
  });
}

export class GrailNotebookController extends GemStoneNotebookKernel {
  private readonly resetCommand: vscode.Disposable;

  constructor(sessionManager: SessionManager) {
    super(sessionManager, {
      id: GRAIL_CONTROLLER_ID,
      label: GRAIL_CONTROLLER_LABEL,
      description: 'Run Python in GemStone via Grail',
      supportedLanguages: ['python'],
      evaluate: (session, source, scopeId) => evalPythonInScope(session, source, scopeId),
    });

    this.resetCommand = vscode.commands.registerCommand(GRAIL_RESET_SCOPE_COMMAND, () =>
      this.resetActiveNotebookScope(),
    );
  }

  dispose(): void {
    super.dispose();
    this.resetCommand.dispose();
  }

  // "Restart kernel" equivalent: forget the active notebook's module scope so
  // the next cell run starts with fresh globals.
  async resetActiveNotebookScope(): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active notebook to reset.');
      return;
    }
    // The scope lives in the session the notebook runs in: its bound session
    // when it is on a per-session kernel, the active one otherwise.
    const boundId = GemStoneNotebookKernel.sessionBoundTo(editor.notebook);
    const session =
      boundId === undefined
        ? await this.sessionManager.resolveSession()
        : this.sessionManager.getSession(boundId);
    if (!session) {
      if (boundId !== undefined) {
        vscode.window.showErrorMessage(
          `Session ${boundId} has logged out, so there is no scope to reset.`,
        );
      }
      return;
    }

    try {
      await resetPythonScope(session, editor.notebook.uri.toString());
      vscode.window.showInformationMessage('Grail notebook scope reset.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(session.id, `Grail notebook scope reset failed: ${msg}`);
      vscode.window.showErrorMessage(`Failed to reset Grail notebook scope: ${msg}`);
    }
  }
}
