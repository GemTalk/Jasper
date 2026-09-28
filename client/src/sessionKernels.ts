import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { multipleSessionMode } from './activeSessionDisplay';

// One notebook kernel per logged-in session, so the kernel picker lists every
// session: a kernel is added at login and removed at logout. They sit beside
// the default kernels, which follow the active session, and exist only in
// multiple-session mode — with one session they would only duplicate them.

// Session numbers restart at 1 in every window, and VS Code rebinds a notebook
// to a remembered kernel id when one registers again. Tagging each id with this
// window run keeps a notebook pinned to yesterday's "Session 2" from landing on
// whatever stone is Session 2 today; it falls back to the default kernel.
const WINDOW_RUN = Math.random().toString(36).slice(2, 8);

/** The kernel id for `baseId` bound to `sessionId`, unique to this window run. */
export function sessionKernelId(baseId: string, sessionId: number): string {
  return `${baseId}.session-${sessionId}-${WINDOW_RUN}`;
}

type KernelFactory = (sessionManager: SessionManager, sessionId: number) => vscode.Disposable;

export class SessionKernels implements vscode.Disposable {
  private readonly kernels = new Map<number, vscode.Disposable[]>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly factories: KernelFactory[],
  ) {
    this.sync();
    this.subscriptions = [
      sessionManager.onDidAddSession((id) => {
        if (multipleSessionMode()) this.add(id);
      }),
      sessionManager.onDidRemoveSession((id) => this.remove(id)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('gemstone.sessionMode')) this.sync();
      }),
    ];
  }

  // Match the kernels to the mode: one per session in multiple-session mode,
  // none otherwise.
  private sync(): void {
    if (multipleSessionMode()) {
      this.sessionManager.getSessions().forEach((s) => this.add(s.id));
    } else {
      [...this.kernels.keys()].forEach((id) => this.remove(id));
    }
  }

  private add(sessionId: number): void {
    if (this.kernels.has(sessionId)) return;
    this.kernels.set(
      sessionId,
      this.factories.map((make) => make(this.sessionManager, sessionId)),
    );
  }

  private remove(sessionId: number): void {
    this.kernels.get(sessionId)?.forEach((k) => k.dispose());
    this.kernels.delete(sessionId);
  }

  dispose(): void {
    this.subscriptions.forEach((d) => d.dispose());
    [...this.kernels.keys()].forEach((id) => this.remove(id));
  }
}
