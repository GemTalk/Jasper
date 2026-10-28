import { loginLabel } from './loginTypes';
import { McpOwnerInfo, NO_WORKSPACE_RECORDED } from './mcpOwnerSidecar';
import { McpOwnership } from './mcpServerTreeProvider';

/**
 * Everything a window can say about the MCP server, in one shape.
 *
 * Claiming the server is a property of a *window*, not of a session or a
 * database: one Jasper binds the shared socket and every other window is
 * passive (see mcpSocketServer). So this is reported where there is exactly one
 * per window — the Databases section header, and the MCP Server tab — rather
 * than on a row the user has several of, where a per-window fact reads as a
 * per-row one.
 *
 * Which *session* the tools act on is the one genuinely session-scoped part,
 * and it stays marked on the session row it belongs to.
 */
export type McpState = 'disabled' | 'this' | 'other' | 'none';

export interface McpOwnerReport {
  /**
   * What the owning window's title bar says. Absent from a sidecar written by
   * an older Jasper, and from a window with no folder open.
   */
  workspaceName?: string;
  workspacePath: string;
  /** The `.code-workspace` file, when the owner is a multi-root workspace. */
  workspaceFile?: string;
  pid: number;
  claimedAt: string;
  /** The owning window's selected session, as it labelled it. */
  selectedSession?: string;
  /** Which entry to pick in VS Code's window list; see {@link ownerLookFor}. */
  lookFor: string;
}

/**
 * What to pick in VS Code's window list to reach the owning window. Extensions
 * cannot focus another window or read its title, so the switch opens the list
 * and this says which entry it is. The title shows the workspace name; with no
 * name to go on, the GemStone login is what the user will recognise.
 */
export function ownerLookFor(info: {
  workspaceName?: string;
  workspacePath: string;
  workspaceFile?: string;
  selectedSession?: string;
}): string {
  if (info.workspaceName) return `the window titled "${info.workspaceName}"`;
  const noFolder = !info.workspacePath || info.workspacePath === NO_WORKSPACE_RECORDED;
  // A multi-root workspace's path is only its first folder, which the user won't recognise.
  if ((noFolder || info.workspaceFile) && info.selectedSession) {
    return `the window logged in to ${info.selectedSession}`;
  }
  if (noFolder) return 'the window with no folder open';
  return `the window with ${info.workspacePath} open`;
}

export interface McpReport {
  state: McpState;
  /**
   * The whole of what the Databases section header says — a short state beside
   * its title, and nothing more. Absent when disabled: a window that was never
   * going to claim the server should not report on it.
   *
   * Deliberately not a sentence. An explanation there is a paragraph wedged
   * above the database rows, in a section that is not about MCP; `detail` and
   * everything else belong to the MCP Server tab, which is one click away.
   */
  headline?: string;
  /** One sentence saying what the state means, for the tab and the view body. */
  detail: string;
  /**
   * The stdio socket. Present in every running state, not just ours: it is one
   * path per machine, and it is what Claude's config points at, so it is worth
   * reading off whichever window happens to be holding it.
   */
  socketPath?: string;
  /** Present only while this window owns the server; the listener is ours. */
  httpsUrl?: string;
  /** The session this window's tools act on, when it owns the server. */
  servedSession?: string;
  /** Present only when another window owns it — who and where. */
  owner?: McpOwnerReport;
}

/**
 * Reduce ownership to what every MCP surface renders. `ownership` is undefined
 * when the MCP surface isn't running in this window at all, because
 * `jasper.mcp.enabled` is off.
 */
export function mcpReport(ownership: McpOwnership | undefined): McpReport {
  if (!ownership) {
    return {
      state: 'disabled',
      detail: 'MCP is not running in this window, because jasper.mcp.enabled is off.',
    };
  }

  if (ownership.kind === 'this') {
    // Same shape the sidecar records for other windows, so the tab reads the
    // same whether the session is ours or theirs.
    const session = ownership.selectedSession;
    const served = session ? `${loginLabel(session.login)} (id ${session.id})` : undefined;
    return {
      state: 'this',
      headline: 'MCP: this window',
      detail: served
        ? `Claude Code and Claude Desktop run their GemStone tools against this window, on ${served}.`
        : 'Claude Code and Claude Desktop reach this window, but no session is selected here — ' +
          'tool calls return "no session selected" until you pick one.',
      socketPath: ownership.socketPath,
      httpsUrl: ownership.httpsUrl,
      servedSession: served,
    };
  }

  if (ownership.kind === 'other') {
    const info: McpOwnerInfo = ownership.info;
    const { workspaceName, workspacePath, workspaceFile, pid, claimedAt, selectedSession } = info;
    return {
      state: 'other',
      headline: 'MCP: other window',
      // The socket is held until that window releases it, so this is the one
      // state where the fix is somewhere else — say where.
      detail: selectedSession
        ? `Another VS Code window serves MCP, on ${selectedSession}. Ask it to release the server, ` +
          'or stop MCP there, to serve from this window instead.'
        : 'Another VS Code window serves MCP and has no session selected, so tool calls there ' +
          'fail. Ask it to release the server, or stop MCP there, to serve from this window instead.',
      socketPath: info.socketPath,
      owner: {
        ...(workspaceName ? { workspaceName } : {}),
        workspacePath,
        ...(workspaceFile ? { workspaceFile } : {}),
        pid,
        claimedAt,
        ...(selectedSession ? { selectedSession } : {}),
        lookFor: ownerLookFor(info),
      },
    };
  }

  return {
    state: 'none',
    headline: 'MCP: unclaimed',
    detail:
      'No VS Code window is serving MCP, so Claude has no GemStone tools. Claim it to serve ' +
      'from this window.',
  };
}
