import * as vscode from 'vscode';
import { GemStoneLogin, loginLabel, sessionsForLogin } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { ActiveSession, SessionManager } from './sessionManager';
import {
  AutoCommitStatus,
  getAutoCommitStatus,
  onAutoCommitChanged,
} from './autoCommit/autoCommitState';

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

/**
 * How a session row says what auto-commit is doing (issue #254).
 *
 * This is the ONLY display of it, which is why it speaks in both directions rather than
 * only when armed. Auto-commit changes what Abort means, so a user who cannot see the state
 * loses work either way round: armed and not knowing it, they reach for Abort and find
 * nothing to abort; off and believing otherwise, they log out over uncommitted work. A row
 * that is silent for "off" cannot be read as saying off — it reads as a row that has not
 * been told, which is exactly the ambiguity worth spending a few characters to remove.
 *
 * On the row rather than the status bar because the state is PER SESSION: a status-bar item
 * can only ever speak for one of them, and this way two sessions with different answers
 * each say their own, side by side.
 */
export function autoCommitRowSuffix(status: AutoCommitStatus): string {
  if (status === 'on') return ' · auto-commit ON';
  if (status === 'failed') return ' · auto-commit FAILED';
  return ' · auto-commit off';
}

/** What the row's tooltip adds under the state — the consequence, not the restatement. */
export function autoCommitRowTooltip(status: AutoCommitStatus): string {
  if (status === 'on') {
    return (
      'Auto-commit is ON: every change is committed as soon as it is made, and Abort will ' +
      'not take one back. Undo still works — it reverses a change by making the opposite one.'
    );
  }
  if (status === 'failed') {
    return (
      'Auto-commit tried to commit and could not — almost always a conflict with another ' +
      'session. Your changes are NOT in the repository, and it has stopped trying. ' +
      'Right-click for the ways out: abort, see the conflicts, or turn it off.'
    );
  }
  return 'Auto-commit is off: changes stay in this session’s transaction until you commit.';
}

/**
 * The row's icon colour. Uncoloured when off, because that is the ordinary state and a tree
 * where every row is painted says nothing; the two states worth catching out of the corner
 * of an eye get the workbench's own warning and error colours. The icon SHAPE goes on saying
 * which session is selected — colour and shape carry different things.
 */
function autoCommitIconColor(status: AutoCommitStatus): vscode.ThemeColor | undefined {
  if (status === 'on') return new vscode.ThemeColor('problemsWarningIcon.foreground');
  if (status === 'failed') return new vscode.ThemeColor('problemsErrorIcon.foreground');
  return undefined;
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
    const autoCommit = getAutoCommitStatus(id);
    this.description = `Session ${id} (${stoneVersion})${autoCommitRowSuffix(autoCommit)}`;
    this.tooltip =
      `Session ${id}: ${loginLabel(activeSession.login)} (${stoneVersion})\n\n` +
      autoCommitRowTooltip(autoCommit);
    this.iconPath = new vscode.ThemeIcon(
      isSelected ? 'debug-start' : 'plug',
      autoCommitIconColor(autoCommit),
    );
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
    // A row carries its session's auto-commit state, so a toggle anywhere has to redraw it.
    onAutoCommitChanged(() => this.refresh());
  }

  // Logins with a connect attempt in flight, by identity. Held here rather than
  // derived because nothing else knows about an attempt that has not produced a
  // session yet — and by identity rather than by position because it outlives a
  // render: starting a stone and its NetLDI takes seconds, the tree stays
  // interactive throughout, and a login deleted or reordered meanwhile would
  // otherwise leave the spinner on whichever login inherited the slot, with
  // nothing able to clear it.
  private connecting = new Set<string>();

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Show or hide the spinner on a login's row while a connect runs. */
  setConnecting(
    login: Pick<GemStoneLogin, 'gs_user' | 'stone' | 'gem_host'>,
    connecting: boolean,
  ): void {
    const key = loginLabel(login);
    if (connecting) {
      this.connecting.add(key);
    } else {
      this.connecting.delete(key);
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
            this.connecting.has(loginLabel(l)),
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
