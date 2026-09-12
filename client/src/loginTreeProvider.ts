import * as vscode from 'vscode';
import { GemStoneLogin, loginLabel, sessionsForLogin } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { ActiveSession, SessionManager } from './sessionManager';
import {
  canBegin,
  canCommit,
  modeDescription,
  transactionStateLabel,
} from './queries/transactionMode';

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
 * The row's `contextValue`, which is how `package.json` decides which inline
 * buttons a session gets.
 *
 * A plain context key would not do: keys are global, so in multiple-session mode
 * every row would show the buttons that suit whichever session happens to be
 * selected. Encoding the two answers in the row's own contextValue keeps each
 * row's buttons about that row. The `when` clauses match with `=~` rather than
 * `==` for the same reason — see the session entries in package.json.
 */
export function sessionContextValue(session: ActiveSession): string {
  const { transactionMode, inTransaction } = session;
  return (
    'gemstoneSession' +
    (canCommit(inTransaction) ? '.canCommit' : '') +
    (canBegin(transactionMode, inTransaction) ? '.canBegin' : '')
  );
}

/**
 * The dimmed text beside a session row: which session, which stone, and — once
 * it has been read — which transaction mode.
 *
 * The mode segment is dropped rather than shown as "Unknown" when the state has
 * not been read: a row that has always said `Session 3 (3.7.2)` should not start
 * announcing an absence. The tooltip still says the mode could not be read, for
 * anyone who goes looking.
 */
export function sessionDescription(session: ActiveSession): string {
  const base = `Session ${session.id} (${session.stoneVersion})`;
  if (session.transactionMode === undefined) return base;
  return `${base} · ${transactionStateLabel(session.transactionMode, session.inTransaction)}`;
}

/** An active session (tree child of the login that started it). */
export class GemStoneSessionItem extends vscode.TreeItem {
  constructor(
    public readonly activeSession: ActiveSession,
    isSelected: boolean,
  ) {
    super(loginLabel(activeSession.login), vscode.TreeItemCollapsibleState.None);
    const { id, stoneVersion, transactionMode, inTransaction } = activeSession;
    // The transaction state is in the id so a mode switch redraws the row: VS Code
    // reuses a node whose id is unchanged, which would leave the old mode — and
    // the old set of inline buttons — on screen.
    this.id = `session-${id}-${sessionContextValue(activeSession)}`;
    this.description = sessionDescription(activeSession);
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(
      `**Session ${id}** — ${loginLabel(activeSession.login)} (${stoneVersion})\n\n`,
    );
    tooltip.appendMarkdown(
      `**${transactionStateLabel(transactionMode, inTransaction)}**\n\n${modeDescription(transactionMode)}`,
    );
    this.tooltip = tooltip;
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'debug-start' : 'plug');
    this.contextValue = sessionContextValue(activeSession);
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
    // A mode switch changes what a session row says and which buttons it carries,
    // and nothing else would redraw it — the selection has not moved.
    sessionManager?.onDidChangeTransactionState(() => this.refresh());
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
