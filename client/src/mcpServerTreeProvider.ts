import * as vscode from 'vscode';
import { loginLabel } from './loginTypes';
import { ActiveSession } from './sessionManager';
import { McpOwnerInfo, isPidAlive, readOwnerSidecar } from './mcpOwnerSidecar';

// No view is contributed for the tree provider below any more: MCP state is
// reported on the session rows in Logins & Sessions (see loginTreeProvider's
// sessionMcpState), because which session MCP serves is a property of a
// session. resolveOwnership is the live part — it is what those rows call.
// The provider and its renderers are kept so that contributing a pane again is
// a package.json change and nothing more.

// Three states ownership can be in. Resolved fresh on every call — cheap (one
// sidecar read) and avoids drift between "real" state and cached state when
// other windows claim/release.
export type McpOwnership =
  | { kind: 'this'; selectedSession?: ActiveSession; socketPath: string; httpsUrl?: string }
  | { kind: 'other'; info: McpOwnerInfo }
  | { kind: 'none' };

export interface McpServerTreeDeps {
  isOwner: () => boolean;
  socketPath: string;
  httpsUrl: () => string | undefined;
  getSession: () => ActiveSession | undefined;
  sidecarPath?: string;
}

export function resolveOwnership(deps: McpServerTreeDeps): McpOwnership {
  if (deps.isOwner()) {
    return {
      kind: 'this',
      selectedSession: deps.getSession(),
      socketPath: deps.socketPath,
      httpsUrl: deps.httpsUrl(),
    };
  }
  const info = readOwnerSidecar(deps.sidecarPath);
  if (info && isPidAlive(info.pid)) {
    return { kind: 'other', info };
  }
  return { kind: 'none' };
}

class McpNode extends vscode.TreeItem {
  constructor(label: string, collapsibleState = vscode.TreeItemCollapsibleState.None) {
    super(label, collapsibleState);
  }
}

export class McpServerTreeProvider implements vscode.TreeDataProvider<McpNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private deps: McpServerTreeDeps) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: McpNode): vscode.TreeItem {
    return element;
  }

  getChildren(): McpNode[] {
    const ownership = resolveOwnership(this.deps);
    return renderOwnership(ownership);
  }
}

export function renderOwnership(ownership: McpOwnership): McpNode[] {
  if (ownership.kind === 'this') {
    return renderThisWindow(ownership);
  }
  if (ownership.kind === 'other') {
    return renderOtherWindow(ownership.info);
  }
  return renderNoOwner();
}

function renderThisWindow(ownership: Extract<McpOwnership, { kind: 'this' }>): McpNode[] {
  const status = new McpNode('Status: This window owns the MCP server');
  status.iconPath = new vscode.ThemeIcon('pass-filled');
  status.tooltip =
    'MCP tool calls from Claude Code / Claude Desktop are answered by this Jasper window. ' +
    'The active GemStone session determines which database the tools act on, and that ' +
    'can change as you switch sessions in this window.';

  const sessionNode = ownership.selectedSession
    ? activeSessionNode(ownership.selectedSession)
    : noActiveSessionNode();

  const socket = new McpNode(`Socket: ${ownership.socketPath}`);
  socket.iconPath = new vscode.ThemeIcon('plug');
  socket.tooltip = 'Local stdio socket consumed by the Claude Code proxy. Click to copy the path.';
  socket.contextValue = 'mcpSocket';
  socket.command = {
    command: 'jasper.copyMcpSocketPath',
    title: 'Copy MCP Socket Path',
    arguments: [ownership.socketPath],
  };

  const nodes: McpNode[] = [status, sessionNode, socket];

  if (ownership.httpsUrl) {
    const https = new McpNode(`HTTPS: ${ownership.httpsUrl}`);
    https.iconPath = new vscode.ThemeIcon('globe');
    https.tooltip =
      'HTTPS/SSE endpoint for Claude Desktop "Add custom connector" and the MCP Inspector.';
    https.contextValue = 'mcpHttps';
    https.command = {
      command: 'jasper.copyMcpUrl',
      title: 'Copy MCP Server URL',
    };
    nodes.push(https);

    const inspector = new McpNode('Open MCP Inspector');
    inspector.iconPath = new vscode.ThemeIcon('rocket');
    inspector.tooltip =
      "Launch MCP Inspector against this window's MCP server in a dedicated terminal. " +
      'Requires Node.js / npx on PATH; first run downloads @modelcontextprotocol/inspector via npx ' +
      "(several seconds). The inspector's own browser tab opens automatically with the server URL pre-filled.";
    inspector.contextValue = 'mcpInspector';
    inspector.command = {
      command: 'jasper.openMcpInspector',
      title: 'Open MCP Inspector',
    };
    nodes.push(inspector);
  }

  return nodes;
}

function activeSessionNode(session: ActiveSession): McpNode {
  const node = new McpNode(`Active session: ${loginLabel(session.login)}`);
  node.description = `id ${session.id}`;
  node.iconPath = new vscode.ThemeIcon('database');
  node.tooltip =
    `MCP tools currently act on session ${session.id} (${loginLabel(session.login)}). ` +
    'Switching the active session in this window changes which session MCP tools use.';
  return node;
}

function noActiveSessionNode(): McpNode {
  const node = new McpNode('Active session: (none — tool calls will return "no session selected")');
  node.iconPath = new vscode.ThemeIcon('circle-slash');
  node.tooltip =
    'No GemStone session is currently selected in this window. Log in or pick a session ' +
    'to start serving MCP tool calls.';
  return node;
}

function renderOtherWindow(info: McpOwnerInfo): McpNode[] {
  const status = new McpNode('Status: Owned by another VS Code window');
  status.iconPath = new vscode.ThemeIcon('window');
  status.tooltip =
    'A different Jasper window is currently serving MCP tool calls. ' +
    'Tools will act on whatever session is active in that window — not this one.';

  const workspace = new McpNode(`Workspace: ${info.workspacePath}`);
  workspace.iconPath = new vscode.ThemeIcon('folder');
  workspace.tooltip = `pid ${info.pid}, claimed ${info.claimedAt}`;

  const sessionNode = info.selectedSession
    ? otherWindowSessionNode(info.selectedSession)
    : otherWindowNoSessionNode();

  const socket = new McpNode(`Socket: ${info.socketPath}`);
  socket.iconPath = new vscode.ThemeIcon('plug');
  socket.tooltip = 'Local stdio socket consumed by the Claude Code proxy. Click to copy the path.';
  socket.contextValue = 'mcpSocket';
  socket.command = {
    command: 'jasper.copyMcpSocketPath',
    title: 'Copy MCP Socket Path',
    arguments: [info.socketPath],
  };

  return [status, workspace, sessionNode, socket];
}

function otherWindowSessionNode(label: string): McpNode {
  const node = new McpNode(`Owner's active session: ${label}`);
  node.iconPath = new vscode.ThemeIcon('database');
  node.tooltip =
    'The owning Jasper window has this GemStone session selected; MCP tool ' +
    'calls from any Claude client are answered against it.';
  return node;
}

function otherWindowNoSessionNode(): McpNode {
  const node = new McpNode(
    'Owner\'s active session: (none — tool calls will return "no session selected")',
  );
  node.iconPath = new vscode.ThemeIcon('warning');
  node.tooltip =
    'The owning Jasper window has no GemStone session selected, so MCP tool ' +
    'calls will fail. Either log in over there, or take ownership in this ' +
    'window (close/disable Jasper in the owning workspace first).';
  return node;
}

function renderNoOwner(): McpNode[] {
  const status = new McpNode('Status: No MCP server claimed yet');
  status.iconPath = new vscode.ThemeIcon('circle-outline');
  status.tooltip =
    'No Jasper window has claimed the MCP server. ' +
    'Click "Claim MCP Server" to make this window the owner.';

  const claim = new McpNode('Claim MCP Server');
  claim.iconPath = new vscode.ThemeIcon('flame');
  claim.tooltip =
    "Make this Jasper window the MCP server owner. Claude clients' tool " +
    'calls will then be answered by whichever GemStone session you select here.';
  claim.contextValue = 'mcpClaim';
  claim.command = {
    command: 'jasper.claimMcpServer',
    title: 'Claim MCP Server',
  };

  return [status, claim];
}
