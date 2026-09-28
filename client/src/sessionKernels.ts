import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';

// One notebook kernel per logged-in session, so the kernel picker lists every
// session: a kernel is added at login and removed at logout. They sit beside
// the default kernels, which follow the active session.

type KernelFactory = (sessionManager: SessionManager, sessionId: number) => vscode.Disposable;

export class SessionKernels implements vscode.Disposable {
  private readonly kernels = new Map<number, vscode.Disposable[]>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly factories: KernelFactory[],
  ) {
    sessionManager.getSessions().forEach((s) => this.add(s.id));
    this.subscriptions = [
      sessionManager.onDidAddSession((id) => this.add(id)),
      sessionManager.onDidRemoveSession((id) => this.remove(id)),
    ];
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
