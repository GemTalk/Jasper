// Host-side tests for the MCP Server tab: that there is one per window, that
// every button reaches the action it names, and that the tab redraws itself
// when ownership changes underneath it. The drawing half is covered in
// mcpView.test.ts; nothing here renders anything.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { McpPanel, McpPanelDeps } from '../mcpPanel';
import type { McpReport } from '../mcpWindowStatus';

const serving: McpReport = {
  state: 'this',
  headline: 'MCP: this window',
  detail: 'served here',
  socketPath: '/tmp/jasper.sock',
};

function deps(report: McpReport = serving): McpPanelDeps {
  return {
    report: vi.fn(() => report),
    claim: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    requestRelease: vi.fn(async () => {}),
    revealOwner: vi.fn(async () => {}),
  };
}

type MockPanel = {
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
};

function lastPanel(): MockPanel {
  const results = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  return results[results.length - 1].value as MockPanel;
}

/** Drive the webview's side of the conversation. */
async function send(panel: MockPanel, message: unknown): Promise<void> {
  const handler = panel.webview.onDidReceiveMessage.mock.calls[0][0] as (m: unknown) => unknown;
  await handler(message);
}

function posted(panel: MockPanel): { command: string; report: McpReport; readAt: string }[] {
  return panel.webview.postMessage.mock.calls.map(
    (c) => c[0] as { command: string; report: McpReport; readAt: string },
  );
}

/** Close whatever panel a test opened, so the singleton does not leak. */
function closeOpenPanel(): void {
  const results = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  if (results.length === 0) return;
  const panel = results[results.length - 1].value as MockPanel;
  const onDispose = panel.onDidDispose.mock.calls[0]?.[0] as (() => void) | undefined;
  onDispose?.();
}

beforeEach(() => {
  closeOpenPanel();
  vi.mocked(vscode.window.createWebviewPanel).mockClear();
  vi.mocked(vscode.env.clipboard.writeText).mockClear();
});

describe('opening the tab', () => {
  it('creates one panel titled MCP Server', () => {
    McpPanel.show(deps());

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'jasperMcpServer',
      'MCP Server',
      expect.anything(),
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('reveals the existing panel rather than opening a second', () => {
    // The subject is this window's relationship to one machine-wide server, so
    // a second tab would say the same thing twice.
    McpPanel.show(deps());
    McpPanel.show(deps());

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(lastPanel().reveal).toHaveBeenCalled();
  });

  it('re-posts the report when revealing, so a stale tab is refreshed', () => {
    McpPanel.show(deps());
    const panel = lastPanel();
    panel.webview.postMessage.mockClear();

    McpPanel.show(deps());

    expect(posted(panel)).toHaveLength(1);
  });

  it('loads no external resource, and locks the webview down', () => {
    McpPanel.show(deps());

    const html = lastPanel().webview.html;
    expect(html).toContain("default-src 'none'");
    expect(html).toMatch(/script-src 'nonce-[0-9a-f]{32}'/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('opens a fresh panel once the old one is closed', () => {
    McpPanel.show(deps());
    closeOpenPanel();

    McpPanel.show(deps());

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });
});

describe('what the tab asks the host to do', () => {
  it('sends the report on ready, stamped with the time it was read', async () => {
    const d = deps();
    McpPanel.show(d);
    const panel = lastPanel();

    await send(panel, { command: 'ready' });

    const messages = posted(panel);
    expect(messages[messages.length - 1].command).toBe('report');
    expect(messages[messages.length - 1].report).toEqual(serving);
    expect(messages[messages.length - 1].readAt).toBeDefined();
  });

  it('re-reads on refresh rather than replaying a cached answer', async () => {
    // Ownership changes in other processes, so the report is read fresh every
    // time — that is what Refresh is for.
    const d = deps();
    McpPanel.show(d);
    vi.mocked(d.report).mockClear();

    await send(lastPanel(), { command: 'refresh' });

    expect(d.report).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['claim', 'claim'],
    ['stop', 'stop'],
    ['requestRelease', 'requestRelease'],
  ] as const)('routes %s to the host, then redraws', async (command, dep) => {
    const d = deps();
    McpPanel.show(d);
    const panel = lastPanel();
    panel.webview.postMessage.mockClear();

    await send(panel, { command });

    expect(d[dep]).toHaveBeenCalled();
    // Every action can change ownership, so the tab is redrawn after it.
    expect(posted(panel)).toHaveLength(1);
  });

  it('passes the workspace through when opening the owning window', async () => {
    const d = deps();
    McpPanel.show(d);

    await send(lastPanel(), { command: 'revealOwner', workspacePath: '/their/workspace' });

    expect(d.revealOwner).toHaveBeenCalledWith('/their/workspace');
  });

  it('copies text without redrawing, since nothing changed', async () => {
    const d = deps();
    McpPanel.show(d);
    const panel = lastPanel();
    panel.webview.postMessage.mockClear();

    await send(panel, { command: 'copyText', text: '/tmp/jasper.sock' });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('/tmp/jasper.sock');
    expect(posted(panel)).toHaveLength(0);
  });
});

describe('keeping up with ownership', () => {
  it('redraws an open tab when ownership changes under it', () => {
    // Another window claiming or releasing arrives via the sidecar watcher,
    // not through the tab — so the tab must not sit stale until Refresh.
    McpPanel.show(deps());
    const panel = lastPanel();
    panel.webview.postMessage.mockClear();

    McpPanel.refreshIfOpen();

    expect(posted(panel)).toHaveLength(1);
  });

  it('is a no-op when no tab is open', () => {
    expect(() => McpPanel.refreshIfOpen()).not.toThrow();
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
  });
});
