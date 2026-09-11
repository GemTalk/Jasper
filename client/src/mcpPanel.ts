// MCP Server panel — a standalone editor-tab webview that answers, in one
// place, every question a developer has about Jasper's MCP server: whether
// this window serves it, which session Claude's tools act on, where the socket
// and HTTPS endpoint are, and — when another window holds it — which window
// that is and how to get there.
//
// It exists because MCP state was previously spread across a sidebar pane and
// the session rows, and the one state that needs an action (another window owns
// the server) is exactly the one neither could act on — the old pane had no
// release at all, so the only way to hand the server over was to close or
// disable Jasper in the owning window. The tab can: Claim takes the server,
// Stop releases it, Ask It to Release has the *other* window let go so this one
// can claim, Open Owning Window jumps there when that is possible at all, and
// Refresh re-reads everything.
//
// One panel per window — the subject is the window itself, so a second tab
// would say the same thing twice.
//
// Follows the webview conventions established in debuggerPanel.ts and
// configurationPanel.ts: createWebviewPanel with a strict CSP, styling in the
// host <style>, behavior in a companion mcpView.js read at module load and
// injected as a nonce'd <script>. It takes a dependency bag rather than
// importing extension.ts, to avoid a circular import.

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { readWebviewScript } from './webviewAssets';
import { McpReport } from './mcpWindowStatus';

const mcpViewJs = readWebviewScript('mcpView.js');

/** What the panel needs to report on, and act on, the MCP server. */
export interface McpPanelDeps {
  /** Read fresh on every render — ownership changes in other windows. */
  report: () => McpReport;
  /** Take the server for this window. Resolves once the attempt has settled. */
  claim: () => Promise<void>;
  /** Release the server this window holds, so another window can claim it. */
  stop: () => Promise<void>;
  /** Ask the window that holds the server to release it, then claim it here. */
  requestRelease: () => Promise<void>;
  /** Focus the VS Code window whose workspace is at this path. */
  revealOwner: (workspacePath: string) => Promise<void>;
}

type Inbound =
  | { command: 'ready' }
  | { command: 'refresh' }
  | { command: 'claim' }
  | { command: 'stop' }
  | { command: 'requestRelease' }
  | { command: 'revealOwner'; workspacePath: string }
  | { command: 'copyText'; text: string };

export class McpPanel {
  static readonly viewType = 'jasperMcpServer';
  // One per window: the panel's subject is this window's relationship to a
  // machine-wide server, and there is only one of each.
  private static current: McpPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  /** Open the MCP panel, revealing the existing one if it is already open. */
  static show(deps: McpPanelDeps): void {
    if (McpPanel.current) {
      McpPanel.current.panel.reveal(undefined, false);
      McpPanel.current.post();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      McpPanel.viewType,
      'MCP Server',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Glyphs are inline SVG, so the webview loads no external resource.
        localResourceRoots: [],
      },
    );
    McpPanel.current = new McpPanel(panel, deps);
  }

  /**
   * Redraw the open panel, if there is one. Called when ownership changes
   * under it — this window claims or stops, or the sidecar watcher sees
   * another window claim or release — so the tab does not go stale behind
   * the user's back between Refresh clicks.
   */
  static refreshIfOpen(): void {
    McpPanel.current?.post();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: McpPanelDeps,
  ) {
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: Inbound) => void this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private async handleMessage(msg: Inbound): Promise<void> {
    switch (msg.command) {
      case 'ready':
      case 'refresh':
        this.post();
        return;
      case 'claim':
        await this.deps.claim();
        this.post();
        return;
      case 'stop':
        await this.deps.stop();
        this.post();
        return;
      case 'requestRelease':
        await this.deps.requestRelease();
        this.post();
        return;
      case 'revealOwner':
        await this.deps.revealOwner(msg.workspacePath);
        return;
      case 'copyText':
        await vscode.env.clipboard.writeText(msg.text);
        return;
    }
  }

  /** Send the current report, stamped so Refresh visibly did something. */
  private post(): void {
    void this.panel.webview.postMessage({
      command: 'report',
      report: this.deps.report(),
      readAt: new Date().toLocaleTimeString(),
    });
  }

  private dispose(): void {
    McpPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>MCP Server</title>
  <style>${CSS}</style>
</head>
<body>
  <main id="root" class="content" aria-live="polite"></main>
  <script nonce="${nonce}">${mcpViewJs}</script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    JasperMcpView.init({ root: document.getElementById('root') }, vscode);
    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}

// Styles live in the host (convention: styling in the host <style>, behavior in
// the companion .js). Everything is styled through --vscode-* theme variables,
// so the panel matches VS Code's chrome in either theme.
const CSS = `
:root {
  --gm-ok: var(--vscode-testing-iconPassed, #2ea043);
  --gm-warn: var(--vscode-editorWarning-foreground, #cca700);
  --gm-off: var(--vscode-disabledForeground, #888);
  --gm-line: var(--vscode-widget-border, rgba(128,128,128,.22));
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 1.25rem 1.5rem;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
.state { display: flex; align-items: baseline; gap: .6rem; margin-bottom: .35rem; }
.dot { width: .6rem; height: .6rem; border-radius: 50%; flex: none; }
.dot.this { background: var(--gm-ok); }
.dot.other { background: var(--gm-warn); }
.dot.none, .dot.disabled { background: var(--gm-off); }
h1 { font-size: 1.15rem; font-weight: 600; margin: 0; }
.detail { color: var(--vscode-descriptionForeground); margin: 0 0 1.1rem; max-width: 62ch; line-height: 1.45; }
.actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.4rem; }
button {
  font-family: inherit; font-size: inherit;
  padding: .35rem .85rem; border: 1px solid transparent; border-radius: 2px; cursor: pointer;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
}
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: .5; cursor: default; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .8rem 1.1rem; margin: 0; }
dt { color: var(--vscode-descriptionForeground); white-space: nowrap; }
dd { margin: 0; overflow-wrap: anywhere; max-width: 68ch; }
.mono { font-family: var(--vscode-editor-font-family); }
/* The removed pane could only say this on hover. Here it is the line under the
   value it explains — recessive enough to skip when you already know. */
dd .hint {
  color: var(--vscode-descriptionForeground);
  font-size: .9em; line-height: 1.45; margin-top: .2rem;
}
dd button.link {
  background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground);
  text-decoration: underline; cursor: pointer; font-size: inherit; text-align: left;
}
.section { border-top: 1px solid var(--gm-line); padding-top: 1rem; margin-top: 1.2rem; }
.section h2 { font-size: .82rem; text-transform: uppercase; letter-spacing: .06em;
  color: var(--vscode-descriptionForeground); margin: 0 0 .7rem; font-weight: 600; }
.stamp { color: var(--vscode-descriptionForeground); font-size: .85em; margin-top: 1.4rem; }
`;
