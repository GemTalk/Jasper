import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { openMcpInspector } from '../openMcpInspector';

function state(): { terminal: vscode.Terminal | undefined } {
  return { terminal: undefined };
}

describe('openMcpInspector', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.createTerminal).mockClear();
  });

  it('creates a terminal named "MCP Inspector" and runs the inspector command', () => {
    const s = state();
    openMcpInspector('https://127.0.0.1:27101/sse', s);

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'MCP Inspector',
      env: undefined,
    });
    const terminal = vi.mocked(vscode.window.createTerminal).mock.results[0].value;
    expect(terminal.show).toHaveBeenCalled();
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    expect(terminal.sendText).toHaveBeenCalledWith(
      `${npx} @modelcontextprotocol/inspector --transport sse --server-url https://127.0.0.1:27101/sse`,
    );
    expect(s.terminal).toBe(terminal);
  });

  it('sets NODE_EXTRA_CA_CERTS when an extra CA cert path is provided', () => {
    const s = state();
    openMcpInspector('https://127.0.0.1:27101/sse', s, {
      extraCaCertPath: '/path/to/mcp-tls-cert.pem',
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'MCP Inspector',
      env: { NODE_EXTRA_CA_CERTS: '/path/to/mcp-tls-cert.pem' },
    });
  });

  it('leaves env undefined when no extra CA cert path is provided', () => {
    const s = state();
    openMcpInspector('https://127.0.0.1:27101/sse', s, {});

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'MCP Inspector',
      env: undefined,
    });
  });

  it('disposes the previous terminal when opened again', () => {
    const s = state();
    const first = openMcpInspector('https://127.0.0.1:27101/sse', s);
    const second = openMcpInspector('https://127.0.0.1:27101/sse', s);

    expect(first.dispose).toHaveBeenCalled();
    expect(s.terminal).toBe(second);
    expect(vscode.window.createTerminal).toHaveBeenCalledTimes(2);
  });

  it('returns the created terminal', () => {
    const s = state();
    const returned = openMcpInspector('https://127.0.0.1:27101/sse', s);

    expect(returned).toBe(vi.mocked(vscode.window.createTerminal).mock.results[0].value);
  });

  describe('platform-specific npx invocation', () => {
    const originalPlatform = process.platform;
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    function runFor(platform: NodeJS.Platform): string {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      const s = state();
      openMcpInspector('https://127.0.0.1:27101/sse', s);
      const terminal = vi.mocked(vscode.window.createTerminal).mock.results[0].value;
      return vi.mocked(terminal.sendText).mock.calls[0][0] as string;
    }

    it('uses npx.cmd on Windows to bypass PowerShell ExecutionPolicy', () => {
      const sent = runFor('win32');
      expect(sent.startsWith('npx.cmd ')).toBe(true);
    });

    it('uses plain npx on macOS', () => {
      const sent = runFor('darwin');
      expect(sent.startsWith('npx ')).toBe(true);
      expect(sent.startsWith('npx.cmd')).toBe(false);
    });

    it('uses plain npx on Linux', () => {
      const sent = runFor('linux');
      expect(sent.startsWith('npx ')).toBe(true);
      expect(sent.startsWith('npx.cmd')).toBe(false);
    });
  });
});
