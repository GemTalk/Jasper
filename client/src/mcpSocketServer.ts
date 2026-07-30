// In-extension MCP server (stdio/socket). Serves the tools in mcpTools.ts to AI
// clients connecting to a running GemStone session.
// Full design: docs/mcp-server.md
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ActiveSession } from './sessionManager';
import { registerMcpTools } from './mcpTools';
import { appendSysadmin } from './sysadminChannel';
import { defaultSidecarPath, deleteOwnerSidecar, writeOwnerSidecar } from './mcpOwnerSidecar';
import { extensionPathFrom } from './extensionPath';
import { isWindows } from './wslBridge';

/**
 * Single, user-scoped server name. Every MCP client (Claude Code, Claude
 * Desktop, etc.) sees the same `jasper` entry; whichever Jasper window owns
 * the socket at any moment answers the tool calls. Named `jasper` (not
 * `gemstone`) so the name `gemstone` stays free for the separate,
 * GemStone-native MCP server.
 */
export const MCP_SERVER_NAME = 'jasper';

/**
 * The previous server name. Jasper wrote `mcpServers.gemstone` into clients'
 * config files before the rename to `jasper`; on activation we remove that
 * stale entry (see the config writers below) — but only when it still points
 * at Jasper's own proxy, so we never clobber the native `gemstone` server's
 * entry.
 */
export const LEGACY_MCP_SERVER_NAME = 'gemstone';

/**
 * Fixed socket / named-pipe path. Stable across reboots and shared across
 * every VS Code window, so the path baked into Claude clients' config files
 * stays valid forever — no per-launch registration required.
 *
 * The first Jasper window to activate becomes the listening owner; later
 * windows detect a live listener and run in passive mode. If the owner exits,
 * the next Jasper to start finds a stale socket file (or no pipe) and claims
 * ownership cleanly.
 */
export function defaultSocketPath(): string {
  if (isWindows()) {
    return '\\\\.\\pipe\\jasper-mcp';
  }
  return extensionPathFrom('mcp.sock');
}

export interface McpSocketServerOptions {
  /** Returns the user's currently selected GemStone session, or undefined. */
  getSession: () => ActiveSession | undefined;
  /**
   * Override the socket path. Production code should let this default to
   * {@link defaultSocketPath}; tests use it to avoid the shared global path.
   */
  socketPath?: string;
  /**
   * Workspace path written into the owner sidecar so passive Jasper windows
   * can display "MCP server is owned by /path/to/other/workspace". Falls back
   * to "(no workspace)" if not provided.
   */
  workspacePath?: string;
  /**
   * Override the owner sidecar path. Tests use this to avoid touching the
   * shared global path; production code lets it default.
   */
  sidecarPath?: string;
  /**
   * Formatter for the selected session's human-readable label, written into
   * the sidecar so passive windows can show which session the owner is
   * currently serving. Return `undefined` when no session is selected.
   */
  getSessionLabel?: () => string | undefined;
}

/**
 * A Unix socket / named-pipe server that speaks the MCP protocol. Each
 * incoming connection gets its own McpServer instance bound to Jasper's
 * current selected session via {@link registerMcpTools}.
 *
 * The spawned thin proxy (mcp-server/out/index.js --proxy-socket …) connects
 * here; Claude clients' stdio is piped through the proxy into this socket.
 * Tools therefore run inside the extension host against the user's live GCI
 * session.
 */
export class McpSocketServer {
  private server: net.Server | undefined;
  private _isOwner = false;
  private claimedAtIso = '';
  /**
   * Caller-provided formatter: returns a human-readable label for the active
   * session (or `undefined` if none). Lets the socket server keep its sidecar
   * up to date as the owning window switches sessions, without dragging
   * `loginTypes`/`sessionManager` formatting into this file.
   */
  private getSessionLabel: () => string | undefined;
  readonly socketPath: string;
  readonly sidecarPath: string;

  constructor(private options: McpSocketServerOptions) {
    this.socketPath = options.socketPath ?? defaultSocketPath();
    this.sidecarPath = options.sidecarPath ?? defaultSidecarPath();
    this.getSessionLabel = options.getSessionLabel ?? (() => undefined);
  }

  /** True after {@link start} has successfully claimed the listening socket. */
  get isOwner(): boolean {
    return this._isOwner;
  }

  /**
   * Try to claim the socket as the listening owner.
   *
   * - No other Jasper running → bind and listen (unlinking any stale file).
   * - Another Jasper already listening → return `false`; this window is
   *   passive. Configs already point at the right socket, so MCP clients keep
   *   working through whichever window does own it.
   */
  async start(): Promise<boolean> {
    if (!isWindows()) {
      const dir = path.dirname(this.socketPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.socketPath)) {
        // Distinguish a live owner from a leftover file (crash, kill -9).
        const live = await isSocketLive(this.socketPath);
        if (live) {
          appendSysadmin(
            `MCP socket at ${this.socketPath} is owned by another Jasper window; this window is passive.`,
          );
          return false;
        }
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          /* ignore — bind will error below if the file truly can't be removed */
        }
      }
    }

    const server = net.createServer((socket) => this.handleConnection(socket));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.socketPath, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        // Windows named pipes (and a tight race on Unix) can land here.
        appendSysadmin(
          `MCP socket at ${this.socketPath} is owned by another Jasper window; this window is passive.`,
        );
        return false;
      }
      throw err;
    }

    this.server = server;
    this._isOwner = true;
    this.claimedAtIso = new Date().toISOString();
    this.writeSidecarSnapshot();
    appendSysadmin(`MCP socket listening at ${this.socketPath}`);
    return true;
  }

  /**
   * Re-write the sidecar with the current session label. Call after a session
   * selection change in the owning window so passive Jasper windows see the
   * new session in their MCP Server panel. No-op when not owner.
   */
  refreshSidecar(): void {
    if (!this._isOwner) return;
    this.writeSidecarSnapshot();
  }

  private writeSidecarSnapshot(): void {
    const label = this.getSessionLabel();
    try {
      writeOwnerSidecar(
        {
          pid: process.pid,
          workspacePath: this.options.workspacePath ?? '(no workspace)',
          socketPath: this.socketPath,
          claimedAt: this.claimedAtIso,
          ...(label !== undefined ? { selectedSession: label } : {}),
        },
        this.sidecarPath,
      );
    } catch (err) {
      appendSysadmin(
        `Failed to write MCP owner sidecar at ${this.sidecarPath}: ${(err as Error).message}`,
      );
    }
  }

  private handleConnection(socket: net.Socket): void {
    appendSysadmin('MCP client connected');
    const mcpServer = new McpServer({ name: MCP_SERVER_NAME, version: '1.0.0' });
    registerMcpTools(mcpServer, this.options.getSession);

    const transport = new StdioServerTransport(socket, socket);
    mcpServer.connect(transport).catch((err) => {
      appendSysadmin(`MCP connection error: ${(err as Error).message}`);
      socket.destroy();
    });

    socket.on('close', () => {
      appendSysadmin('MCP client disconnected');
    });

    socket.on('error', (err) => {
      appendSysadmin(`MCP socket error: ${err.message}`);
    });
  }

  async dispose(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    const wasOwner = this._isOwner;
    this._isOwner = false;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (wasOwner && !isWindows() && fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }
    if (wasOwner) {
      deleteOwnerSidecar(process.pid, this.sidecarPath);
    }
  }
}

/**
 * Probe whether the given socket file has a live listener.
 * - `connect` succeeds → live (another Jasper owns it).
 * - `ECONNREFUSED` / other connect error → stale file (the previous owner
 *   crashed or was force-quit without cleaning up).
 *
 * A short hard timeout guards against hung kernel state.
 */
async function isSocketLive(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = net.createConnection(socketPath);
    let settled = false;
    const finish = (live: boolean) => {
      if (settled) return;
      settled = true;
      probe.removeAllListeners();
      probe.destroy();
      resolve(live);
    };
    probe.once('connect', () => finish(true));
    probe.once('error', () => finish(false));
    setTimeout(() => finish(false), 500);
  });
}

/** Absolute path to the stdio proxy script shipped in the extension. */
export function proxyScriptPath(extensionPath: string): string {
  return path.join(extensionPath, 'mcp-server', 'out', 'index.js');
}

// ── Claude Desktop config writer ────────────────────────────────────────────

/**
 * Platform-specific path for Claude Desktop's MCP config. Desktop has a
 * single global config file (no per-project or CLI-based registration path
 * like Claude Code), so a VS Code extension has to write it directly.
 */
export function claudeDesktopConfigPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(
      home,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (isWindows()) {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

interface ClaudeDesktopSettings {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readDesktopSettings(configPath: string): ClaudeDesktopSettings {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // Corrupt or unreadable — treat as empty so we don't destroy user content
    // beyond the mcpServers entry we own. The subsequent write will recreate
    // the file with our entry plus whatever survived parsing (i.e. nothing).
    return {};
  }
}

function writeDesktopSettings(configPath: string, settings: ClaudeDesktopSettings): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2) + '\n');
}

const LEGACY_PER_WORKSPACE_KEY = /^gemstone-[a-f0-9]{10}$/;

/**
 * True when an `mcpServers.<key>` value is Jasper's own stdio proxy entry —
 * `node <…>/mcp-server/out/index.js --proxy-socket <path>`. Used to safely
 * remove the pre-rename `gemstone` entry without ever touching a foreign
 * `gemstone` entry (such as the GemStone-native MCP server's).
 */
export function isJasperProxyEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  const args = (entry as { args?: unknown }).args;
  if (!Array.isArray(args)) {
    return false;
  }
  const strArgs = args.filter((a): a is string => typeof a === 'string');
  return (
    strArgs.includes('--proxy-socket') &&
    strArgs.some((a) => a.replace(/\\/g, '/').endsWith('mcp-server/out/index.js'))
  );
}

/**
 * Write the single global `jasper` entry into Claude Desktop's config and
 * clean up leftovers from older Jasper versions: legacy per-workspace
 * `gemstone-<hash>` entries, and the pre-rename top-level `gemstone` entry
 * (only when it's still Jasper's own proxy — never a foreign `gemstone`).
 * Idempotent — only writes the file when something actually changes.
 */
export function writeClaudeDesktopMcpConfig(extensionPath: string, socketPath: string): string {
  const configPath = claudeDesktopConfigPath();
  const settings = readDesktopSettings(configPath);

  const desired = {
    command: 'node',
    args: [proxyScriptPath(extensionPath), '--proxy-socket', socketPath],
  };

  const mcpServers = settings.mcpServers ?? {};
  let dirty = false;
  if (JSON.stringify(mcpServers[MCP_SERVER_NAME]) !== JSON.stringify(desired)) {
    mcpServers[MCP_SERVER_NAME] = desired;
    dirty = true;
  }
  // Remove the pre-rename `gemstone` entry, but only if it's still our own
  // proxy entry — never a foreign `gemstone` (e.g. the native MCP server).
  if (isJasperProxyEntry(mcpServers[LEGACY_MCP_SERVER_NAME])) {
    delete mcpServers[LEGACY_MCP_SERVER_NAME];
    dirty = true;
  }
  for (const key of Object.keys(mcpServers)) {
    if (LEGACY_PER_WORKSPACE_KEY.test(key)) {
      delete mcpServers[key];
      dirty = true;
    }
  }

  if (dirty) {
    settings.mcpServers = mcpServers;
    writeDesktopSettings(configPath, settings);
  }
  return configPath;
}
