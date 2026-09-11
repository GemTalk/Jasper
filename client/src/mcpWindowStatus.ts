import { loginLabel } from './loginTypes';
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
  workspacePath: string;
  pid: number;
  claimedAt: string;
  /** The owning window's selected session, as it labelled it. */
  selectedSession?: string;
}

export interface McpReport {
  state: McpState;
  /**
   * Short text beside the Databases section title. Absent when disabled: a
   * window that was never going to claim the server should not report on it.
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
 * when the MCP surface isn't running in this window at all — `jasper.mcp.enabled`
 * off, or no folder open.
 */
export function mcpReport(ownership: McpOwnership | undefined): McpReport {
  if (!ownership) {
    return {
      state: 'disabled',
      detail:
        'MCP is not running in this window. Either jasper.mcp.enabled is off, or no folder ' +
        'is open — Jasper only claims the server for a window with a workspace.',
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
    const { workspacePath, pid, claimedAt, selectedSession, socketPath } = ownership.info;
    return {
      state: 'other',
      headline: 'MCP: other window',
      // The socket is held until that window releases it, so this is the one
      // state where the fix is somewhere else — say where.
      detail: selectedSession
        ? `Another VS Code window serves MCP, on ${selectedSession}. Stop MCP there, then claim it here.`
        : 'Another VS Code window serves MCP and has no session selected, so tool calls there ' +
          'fail. Stop MCP there, then claim it here.',
      socketPath,
      owner: { workspacePath, pid, claimedAt, ...(selectedSession ? { selectedSession } : {}) },
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

/** What the Databases section header shows: a headline, and a body line when the fix is elsewhere. */
export function mcpHeader(report: McpReport): { description?: string; message?: string } {
  return {
    description: report.headline,
    // Only the other-window case sends the user somewhere; the rest is in the tab.
    message: report.state === 'other' ? report.detail : undefined,
  };
}
