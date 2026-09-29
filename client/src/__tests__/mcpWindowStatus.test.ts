import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { canRevealOwnerWindow, mcpReport } from '../mcpWindowStatus';
import { DEFAULT_LOGIN } from '../loginTypes';
import type { McpOwnership } from '../mcpServerTreeProvider';
import type { ActiveSession } from '../sessionManager';

function makeSession(id: number): ActiveSession {
  return { id, login: { ...DEFAULT_LOGIN, label: 'Test' }, stoneVersion: '3.7.2' } as ActiveSession;
}

const owned = (selected?: ActiveSession, httpsUrl?: string): McpOwnership => ({
  kind: 'this',
  selectedSession: selected,
  socketPath: '/tmp/jasper.sock',
  httpsUrl,
});

const ownedElsewhere = (
  selectedSession?: string,
  extra: { workspaceName?: string; workspaceFile?: string; workspacePath?: string } = {},
): McpOwnership => ({
  kind: 'other',
  info: {
    pid: 4242,
    workspacePath: '/somewhere/else',
    socketPath: '/tmp/jasper.sock',
    claimedAt: '2026-01-01T00:00:00.000Z',
    ...(selectedSession ? { selectedSession } : {}),
    ...extra,
  },
});

describe('mcpReport', () => {
  it('says MCP is off here when the surface is not running in this window', () => {
    // `jasper.mcp.enabled` false, or no folder open. A window that was never
    // going to claim the server should not report it as unclaimed.
    const report = mcpReport(undefined);
    expect(report.state).toBe('disabled');
    expect(report.headline).toBeUndefined();
    expect(report.detail).toContain('jasper.mcp.enabled');
  });

  it('names the session this window serves, and where the server is', () => {
    const report = mcpReport(owned(makeSession(7), 'https://127.0.0.1:27101/sse'));
    expect(report.state).toBe('this');
    expect(report.headline).toBe('MCP: this window');
    expect(report.servedSession).toContain('id 7');
    expect(report.socketPath).toBe('/tmp/jasper.sock');
    expect(report.httpsUrl).toBe('https://127.0.0.1:27101/sse');
  });

  it('owns the server but warns when no session is selected to serve', () => {
    const report = mcpReport(owned(undefined));
    expect(report.state).toBe('this');
    expect(report.servedSession).toBeUndefined();
    expect(report.detail).toContain('no session selected');
  });

  it('carries the socket path in every running state, not just ours', () => {
    // One socket per machine; the sidecar records it, and it is what Claude's
    // config points at either way.
    expect(mcpReport(ownedElsewhere()).socketPath).toBe('/tmp/jasper.sock');
    expect(mcpReport(owned(makeSession(7))).socketPath).toBe('/tmp/jasper.sock');
    expect(mcpReport({ kind: 'none' }).socketPath).toBeUndefined();
  });

  it('carries the owning window, so the tab can say which one it is', () => {
    // The one state whose fix is in another window — the socket is held until
    // its owner lets go, so the report has to say which window that is.
    // Whether it can also be *opened* is a separate question; see below.
    const report = mcpReport(ownedElsewhere('bar (id 3)'));
    expect(report.state).toBe('other');
    expect(report.headline).toBe('MCP: other window');
    expect(report.owner).toEqual({
      workspacePath: '/somewhere/else',
      pid: 4242,
      claimedAt: '2026-01-01T00:00:00.000Z',
      selectedSession: 'bar (id 3)',
      canReveal: true,
    });
    // The handover leads, because it is the one route that works regardless of
    // whether the owning window can be navigated to at all.
    expect(report.detail).toContain('Ask it to release');
    expect(report.detail).toContain('stop MCP there');
  });

  it('reports an owning window that has no session, since its tools fail', () => {
    const report = mcpReport(ownedElsewhere());
    expect(report.owner?.selectedSession).toBeUndefined();
    expect(report.detail).toContain('no session selected');
  });

  it('reports an unclaimed server as claimable from here', () => {
    const report = mcpReport({ kind: 'none' });
    expect(report.state).toBe('none');
    expect(report.headline).toBe('MCP: unclaimed');
    expect(report.detail).toContain('Claim it');
  });
});

describe('what the Databases section header shows', () => {
  it('is a short state in every running case, and nothing else', () => {
    // The header is a line above the database rows in a section that is not
    // about MCP. Anything longer wedges a paragraph in there; the explanation
    // belongs to the tab, one click away.
    expect(mcpReport(owned(makeSession(7))).headline).toBe('MCP: this window');
    expect(mcpReport(ownedElsewhere()).headline).toBe('MCP: other window');
    expect(mcpReport({ kind: 'none' }).headline).toBe('MCP: unclaimed');
  });

  it('says nothing at all when MCP is not running in this window', () => {
    // Not "unclaimed": the header would be reporting on a server this window
    // was never going to claim.
    expect(mcpReport(undefined).headline).toBeUndefined();
  });

  it('keeps every headline short enough to sit beside the title', () => {
    for (const ownership of [owned(makeSession(7)), ownedElsewhere(), { kind: 'none' } as const]) {
      const headline = mcpReport(ownership).headline ?? '';
      expect(headline.length).toBeLessThanOrEqual(24);
      expect(headline).not.toContain('.');
    }
  });
});

describe('naming the owning window', () => {
  it('carries the window name the owner recorded, which is what its title bar says', () => {
    // A folder path does not identify a window to a person; the title bar does.
    const report = mcpReport(ownedElsewhere(undefined, { workspaceName: 'myproj (Workspace)' }));
    expect(report.owner?.workspaceName).toBe('myproj (Workspace)');
  });

  it('falls back to the path when an older Jasper wrote the sidecar', () => {
    // workspaceName is optional precisely so an old owner still reports.
    const report = mcpReport(ownedElsewhere());
    expect(report.owner?.workspaceName).toBeUndefined();
    expect(report.owner?.workspacePath).toBe('/somewhere/else');
  });
});

describe('whether the owning window can be opened', () => {
  it('offers it for an ordinary single-folder owner', () => {
    expect(canRevealOwnerWindow({ workspacePath: '/their/workspace' })).toEqual({
      canReveal: true,
    });
    expect(mcpReport(ownedElsewhere()).owner?.canReveal).toBe(true);
  });

  it('withholds it for a multi-root owner, and says why', () => {
    // The path is only the workspace's first folder, so opening it gives a new
    // single-folder window rather than switching to the owner.
    const result = canRevealOwnerWindow({
      workspacePath: '/their/first-folder',
      workspaceFile: '/their/proj.code-workspace',
    });
    expect(result.canReveal).toBe(false);
    expect(result.canReveal === false && result.reason).toContain('multi-root');

    const report = mcpReport(
      ownedElsewhere(undefined, { workspaceFile: '/their/proj.code-workspace' }),
    );
    expect(report.owner?.canReveal).toBe(false);
    expect(report.owner?.revealBlockedReason).toContain('first folder');
  });

  it('withholds it for an owner with no folder open, and says why', () => {
    const result = canRevealOwnerWindow({ workspacePath: '(no workspace)' });
    expect(result.canReveal).toBe(false);
    expect(result.canReveal === false && result.reason).toContain('no folder open');
  });

  it('points at Ask It to Release whenever it withholds the jump', () => {
    // The handover needs no navigation, so it is the way out of every case
    // where the jump cannot be offered.
    for (const info of [
      { workspacePath: '(no workspace)' },
      { workspacePath: '/x', workspaceFile: '/x/p.code-workspace' },
    ]) {
      const result = canRevealOwnerWindow(info);
      expect(result.canReveal === false && result.reason).toContain('Ask It to Release');
    }
  });
});
