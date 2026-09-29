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
   * an older Jasper, and from a window with no folder open — `workspacePath`
   * is the fallback, not the identity.
   */
  workspaceName?: string;
  workspacePath: string;
  /** The `.code-workspace` file, when the owner is a multi-root workspace. */
  workspaceFile?: string;
  pid: number;
  claimedAt: string;
  /** The owning window's selected session, as it labelled it. */
  selectedSession?: string;
  /** Whether opening `workspacePath` would actually reach that window. */
  canReveal: boolean;
  /** Why it would not, when `canReveal` is false — shown rather than guessed at. */
  revealBlockedReason?: string;
}

/**
 * Whether opening the owner's workspace path would reach the owner's *window*.
 *
 * VS Code gives an extension no way to focus another window; the only lever is
 * `vscode.openFolder`, which identifies a window by the folder it has open. So
 * this is only ever offered where that identification holds, and withheld —
 * with a reason — where we can see that it does not. Opening a duplicate
 * window is a worse outcome than no button: it looks like the switch worked.
 *
 * The case we cannot see is one directory reachable by two paths — a symlink
 * or a bind mount, so that `/a/project` and `/mnt/a/project` are the same
 * place. Each window records the path it was opened with, and nothing here
 * can tell the two apart, so the jump opens a second window. Ask It to
 * Release needs no navigation and is unaffected.
 */
export function canRevealOwnerWindow(info: {
  workspacePath: string;
  workspaceFile?: string;
}): { canReveal: true } | { canReveal: false; reason: string } {
  if (!info.workspacePath || info.workspacePath === NO_WORKSPACE_RECORDED) {
    return {
      canReveal: false,
      reason:
        'That window has no folder open, so there is nothing to open to reach it. Find it by ' +
        'its title bar, or use Ask It to Release, which needs no navigation.',
    };
  }
  if (info.workspaceFile) {
    return {
      canReveal: false,
      reason:
        'That window has a multi-root workspace open, and the path above is only its first ' +
        'folder — opening it would give you a new window with that one folder rather than ' +
        'switching to the owner. Find it by its title bar, or use Ask It to Release, which ' +
        'needs no navigation.',
    };
  }
  return { canReveal: true };
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
    const info: McpOwnerInfo = ownership.info;
    const { workspaceName, workspacePath, workspaceFile, pid, claimedAt, selectedSession } = info;
    const reveal = canRevealOwnerWindow(info);
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
        canReveal: reveal.canReveal,
        ...(reveal.canReveal ? {} : { revealBlockedReason: reveal.reason }),
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
