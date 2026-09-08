import * as vscode from 'vscode';
import { GemStoneLogin, loginLabel, sessionsForLogin } from './loginTypes';
import { LoginStorage } from './loginStorage';
import { ActiveSession, SessionManager } from './sessionManager';
import { McpOwnership } from './mcpServerTreeProvider';

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
 * What a session row says about MCP. The server answers tool calls against
 * whichever session is selected in the window that owns it, so exactly one row
 * across all windows can be `serving` — and only ever a selected one.
 *
 * - `off`      MCP is disabled, or no folder is open: say nothing.
 * - `idle`     available, but this row is not the one being served.
 * - `serving`  this window owns the server and this is its selected session.
 * - `elsewhere` another window owns the server; this row can take it over.
 */
export type SessionMcpState = 'off' | 'idle' | 'serving' | 'elsewhere';

/**
 * Reduce MCP ownership to what one session row should show. `ownership` is
 * undefined when the MCP surface isn't running in this window at all.
 */
export function sessionMcpState(
  ownership: McpOwnership | undefined,
  session: ActiveSession,
  isSelected: boolean,
): SessionMcpState {
  if (!ownership) return 'off';
  if (ownership.kind === 'other') return 'elsewhere';
  // Ownership alone isn't enough: the tools follow the selected session, so an
  // unselected row is not the one being served even in the owning window.
  if (ownership.kind === 'this' && isSelected && ownership.selectedSession?.id === session.id) {
    return 'serving';
  }
  return 'idle';
}

/** An active session (tree child of the login that started it). */
export class GemStoneSessionItem extends vscode.TreeItem {
  constructor(
    public readonly activeSession: ActiveSession,
    isSelected: boolean,
    mcp: SessionMcpState = 'off',
  ) {
    super(loginLabel(activeSession.login), vscode.TreeItemCollapsibleState.None);
    const { id, stoneVersion } = activeSession;
    this.id = `session-${id}`;
    this.description =
      mcp === 'serving'
        ? `Session ${id} (${stoneVersion}) · MCP`
        : `Session ${id} (${stoneVersion})`;
    this.tooltip = `Session ${id}: ${loginLabel(activeSession.login)} (${stoneVersion})`;
    if (mcp === 'serving') {
      this.tooltip +=
        '\n\nClaude Code and Claude Desktop run their GemStone tools against this session.';
    } else if (mcp === 'elsewhere') {
      this.tooltip +=
        '\n\nAnother VS Code window owns the MCP server. Serve MCP from This Session to ' +
        'take it over — it will only succeed once that window releases it.';
    }
    this.iconPath = new vscode.ThemeIcon(isSelected ? 'debug-start' : 'plug');
    // The row already serving MCP drops the button — there is nothing to do to
    // it — which also makes the button's absence the second cue that it is the
    // serving one.
    this.contextValue = mcp === 'serving' ? 'gemstoneSessionServingMcp' : 'gemstoneSession';
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
    // Read fresh on every render rather than cached: ownership can change in
    // another window, and the sidecar watcher answers that with a refresh.
    private mcpOwnership: () => McpOwnership | undefined = () => undefined,
  ) {
    sessionManager?.onDidChangeSelection(() => this.refresh());
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
      const ownership = this.mcpOwnership();
      return sessionsForLogin(element.index, logins, sessions).map((s) => {
        const isSelected = s.id === selectedId;
        return new GemStoneSessionItem(s, isSelected, sessionMcpState(ownership, s, isSelected));
      });
    }

    return [];
  }
}
