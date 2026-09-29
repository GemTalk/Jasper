import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from './sessionManager';
import { loginLabel } from './loginTypes';
import { SMALLTALK_LANGUAGE } from './languageIds';

// Workspaces and notebooks run in the ACTIVE session, which can change under
// them in multiple-session mode — so each names it, and redraws when it moves.

export function multipleSessionMode(): boolean {
  return vscode.workspace.getConfiguration('gemstone').get<string>('sessionMode') === 'multiple';
}

export function describeSession(session: ActiveSession): string {
  return `${sessionTag(session.id)} · ${loginLabel(session.login)}`;
}

// The short form, for tab and panel titles where the login does not fit. The
// number alone is enough because the session's row shows it too.
export function sessionTag(sessionId: number): string {
  return `Session ${sessionId}`;
}

/**
 * Let the user pick the active session. It asks whenever there is more than one
 * session to choose between, even with one already active — changing it is the
 * point, from the status bar, a workspace's session line or Switch Session. With
 * only one, it says so rather than doing nothing visible.
 */
export async function chooseActiveSession(sessionManager: SessionManager): Promise<void> {
  const sessions = sessionManager.getSessions();
  if (sessions.length === 1) {
    sessionManager.selectSession(sessions[0].id);
    vscode.window.showInformationMessage(
      `Only one session is logged in (${describeSession(sessions[0])}).`,
    );
    return;
  }
  await sessionManager.resolveSession({
    alwaysAsk: true,
    placeHolder: 'Select the active GemStone session',
  });
}

export function onDidChangeSessionMode(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('gemstone.sessionMode')) listener();
  });
}

/**
 * Calls `apply` now, and again whenever the active session or the session mode
 * changes, with the active session's {@link describeSession} — or undefined in
 * single-session mode, where there is nothing to tell apart, or with none active.
 * The mode, not the session count, decides: labels that appeared the moment a
 * second login landed would move every tab and view header at once.
 */
export function followActiveSessionLabel(
  sessionManager: SessionManager,
  apply: (label: string | undefined) => void,
): vscode.Disposable {
  const update = () => {
    const session = multipleSessionMode() ? sessionManager.getSelectedSession() : undefined;
    apply(session ? describeSession(session) : undefined);
  };
  update();
  return vscode.Disposable.from(
    onDidChangeActiveSession(sessionManager, update),
    onDidChangeSessionMode(update),
  );
}

/**
 * The title of a panel bound to one session (a debugger, an inspector, the
 * Spotter): its own title, plus {@link sessionTag} in multiple-session mode.
 * The panel's title must be set through {@link setTitle}, or the tag is lost.
 */
export class SessionPanelTitle implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly panel: { title: string },
    private sessionId: number,
    private title: string,
  ) {
    this.apply();
    this.subscription = onDidChangeSessionMode(() => this.apply());
  }

  setTitle(title: string): void {
    this.title = title;
    this.apply();
  }

  setSession(sessionId: number): void {
    this.sessionId = sessionId;
    this.apply();
  }

  private apply(): void {
    this.panel.title = multipleSessionMode()
      ? `${this.title} · ${sessionTag(this.sessionId)}`
      : this.title;
  }

  dispose(): void {
    this.subscription.dispose();
  }
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

/**
 * A line above the first line of a workspace naming the session it runs in —
 * in multiple-session mode only, like Switch Session; with one session there
 * is nothing to tell apart.
 */
export class WorkspaceSessionLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly sessionManager: SessionManager) {
    this.subscription = vscode.Disposable.from(
      onDidChangeActiveSession(sessionManager, () => this.changed.fire()),
      onDidChangeSessionMode(() => this.changed.fire()),
    );
  }

  provideCodeLenses(): vscode.CodeLens[] {
    if (!multipleSessionMode()) return [];
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
