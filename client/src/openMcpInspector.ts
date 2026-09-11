import * as vscode from 'vscode';

export interface OpenMcpInspectorOptions {
  /** Path to a PEM cert Node should trust in addition to its built-in CA
   *  bundle. Needed when the MCP server presents a self-signed cert: macOS's
   *  keychain trust doesn't apply to Node's TLS stack, so we wire the cert in
   *  via `NODE_EXTRA_CA_CERTS` on the terminal's environment. */
  extraCaCertPath?: string;
}

/**
 * Launch MCP Inspector against the given MCP server URL in a dedicated
 * terminal, or reveal the one already running it. Returns the terminal so the
 * caller can track its lifecycle.
 *
 * A live terminal is revealed rather than replaced. Relaunching used to be
 * unconditional — dispose the old terminal, start a new one — so a second
 * click while the first was still working killed it. That is not a rare
 * mistake: `npx` has to install the Inspector on first use, which is a
 * 130-package download that can run to minutes on a slow link, showing almost
 * nothing while it does. The natural response to "nothing is happening" is to
 * click again, and that threw away every minute of it and left an exit code 1
 * that read as a failure. Only a terminal whose shell has exited is replaced.
 *
 * Windows PowerShell's default ExecutionPolicy blocks `npx` (.ps1); invoking
 * `npx.cmd` goes through CreateProcess directly and works regardless.
 */
export function openMcpInspector(
  url: string,
  state: { terminal: vscode.Terminal | undefined },
  options: OpenMcpInspectorOptions = {},
): vscode.Terminal {
  const existing = state.terminal;
  if (existing && existing.exitStatus === undefined) {
    existing.show();
    return existing;
  }
  existing?.dispose();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const env: Record<string, string> = {};
  if (options.extraCaCertPath) {
    env.NODE_EXTRA_CA_CERTS = options.extraCaCertPath;
  }
  const terminal = vscode.window.createTerminal({
    name: 'MCP Inspector',
    env: Object.keys(env).length > 0 ? env : undefined,
  });
  state.terminal = terminal;
  terminal.show();
  terminal.sendText(`${npx} @modelcontextprotocol/inspector --transport sse --server-url ${url}`);
  return terminal;
}
