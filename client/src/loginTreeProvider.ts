import * as vscode from 'vscode';
import { GemStoneLogin, loginLabel, sessionsForLogin } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { ActiveSession, SessionManager } from './sessionManager';

/** A configured login (tree root). Its active sessions appear as children. */
export class GemStoneLoginItem extends vscode.TreeItem {
  constructor(
    public readonly login: GemStoneLogin,
    public readonly index = 0,
    hasSessions = false,
    connecting = false,
  ) {
    super(
      loginLabel(login),
      hasSessions ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    this.description = login.version || '';
    this.tooltip = `${loginLabel(login)} (${login.version || ''})`;
    // A connect can take a while — it may start the stone and its NetLDI before
    // logging in — so the row it was launched from spins while that happens.
    this.iconPath = new vscode.ThemeIcon(connecting ? 'loading~spin' : 'server');
    this.contextValue = hasSessions ? 'gemstoneLoginConnected' : 'gemstoneLogin';
    // Encode connection state in the id so that when a login gains its first
    // session VS Code sees a "new" node and honors the Expanded state above,
    // rather than preserving the row's previous collapsed/leaf state. The
    // connecting flag is encoded for the same reason: reusing the id would
    // leave the stale icon on screen when the spinner starts or stops.
    this.id = `login-${index}-${hasSessions ? 'open' : 'closed'}${connecting ? '-connecting' : ''}`;
    // Clicking a login opens its editor. A connected login opens read-only
    // (its config is viewable but editing requires logging out); an idle one
    // opens for editing. The editLogin command picks the mode from session state.
    this.command = {
      command: 'gemstone.editLogin',
      title: hasSessions ? 'View Login' : 'Edit Login',
      arguments: [this],
    };
  }
}

/** An active session (tree child of the login that started it). */
export class GemStoneSessionItem extends vscode.TreeItem {
  constructor(
    public readonly activeSession: ActiveSession,
    isSelected: boolean,
  ) {
    super(loginLabel(activeSession.login), vscode.TreeItemCollapsibleState.None);
    const { id, stoneVersion } = activeSession;
    this.id = `session-${id}`;
    this.description = `Session ${id} (${stoneVersion})`;
    this.tooltip = `Session ${id}: ${loginLabel(activeSession.login)} (${stoneVersion})`;
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'debug-start' : 'plug');
    this.contextValue = 'gemstoneSession';
  }
}

type LoginTreeNode = GemStoneLoginItem | GemStoneSessionItem;

/**
 * Two-level tree: configured logins are roots, the sessions started from each
 * login are its children. The presence of child rows is the connection
 * indicator; single- vs. multiple-session mode only changes how many children
 * a root may have (enforced at login time by evaluateLoginPolicy).
 */
export class LoginTreeProvider implements vscode.TreeDataProvider<LoginTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LoginTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private storage: LoginStorage,
    private sessionManager?: SessionManager,
  ) {
    sessionManager?.onDidChangeSelection(() => this.refresh());
  }

  // Logins with a connect attempt in flight, by position in getLogins(). Held
  // here rather than derived because nothing else knows about an attempt that
  // has not produced a session yet.
  private connecting = new Set<number>();

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Show or hide the spinner on a login's row while a connect runs. */
  setConnecting(index: number, connecting: boolean): void {
    if (connecting) {
      this.connecting.add(index);
    } else {
      this.connecting.delete(index);
    }
    this.refresh();
  }

  getTreeItem(element: LoginTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: LoginTreeNode): LoginTreeNode[] {
    const logins = this.storage.getLogins();
    const sessions = this.sessionManager?.getSessions() ?? [];

    if (!element) {
      return logins.map(
        (l, i) =>
          new GemStoneLoginItem(
            l,
            i,
            sessionsForLogin(i, logins, sessions).length > 0,
            this.connecting.has(i),
          ),
      );
    }

    if (element instanceof GemStoneLoginItem) {
      const selectedId = this.sessionManager?.selectedId;
      return sessionsForLogin(element.index, logins, sessions).map(
        (s) => new GemStoneSessionItem(s, s.id === selectedId),
      );
    }

    return [];
  }
}
