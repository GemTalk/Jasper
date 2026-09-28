import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { loginLabel } from './loginTypes';
import { SMALLTALK_LANGUAGE } from './languageIds';

// Workspaces and notebooks run in the ACTIVE session, which can change under
// them in multiple-session mode — so each names it, and redraws when it moves.

export function describeSession(session: ActiveSession): string {
  return `Session ${session.id} · ${loginLabel(session.login)}`;
}

/**
 * Let the user pick the active session. It always asks, even with one already
 * active — changing it is the point, when it comes from the status bar or a
 * workspace's session line.
 */
export async function chooseActiveSession(sessionManager: SessionManager): Promise<void> {
  await sessionManager.resolveSession({
    alwaysAsk: true,
    placeHolder: 'Select the active GemStone session',
  });
}

/** Fires whenever the active session, or the set of sessions, changes. */
export function onDidChangeActiveSession(
  sessionManager: SessionManager,
  listener: () => void,
): vscode.Disposable {
  return vscode.Disposable.from(
    sessionManager.onDidChangeSelection(listener),
    sessionManager.onDidAddSession(listener),
    sessionManager.onDidRemoveSession(listener),
  );
}

// Untitled and saved workspace buffers. Notebook cells share the language but
// not these schemes; they show the session in the kernel label instead.
export const WORKSPACE_SESSION_SELECTORS: vscode.DocumentFilter[] = [
  { scheme: 'untitled', language: SMALLTALK_LANGUAGE },
  { scheme: 'file', language: SMALLTALK_LANGUAGE },
];

/** A line above the first line of a workspace naming the session it runs in. */
export class WorkspaceSessionLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly sessionManager: SessionManager) {
    this.subscription = onDidChangeActiveSession(sessionManager, () => this.changed.fire());
  }

  provideCodeLenses(): vscode.CodeLens[] {
    const top = new vscode.Range(0, 0, 0, 0);
    const session = this.sessionManager.getSelectedSession();
    if (session) {
      return [
        new vscode.CodeLens(top, {
          title: `$(database) Runs in ${describeSession(session)}`,
          tooltip: 'Click to change the active session',
          command: 'gemstone.selectSession',
        }),
      ];
    }
    if (this.sessionManager.getSessions().length > 0) {
      return [
        new vscode.CodeLens(top, {
          title: '$(database) No active session — click to choose one',
          command: 'gemstone.selectSession',
        }),
      ];
    }
    // An empty command id renders as plain, unclickable text.
    return [new vscode.CodeLens(top, { title: '$(database) Not logged in', command: '' })];
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}
