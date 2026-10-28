import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { mcpReport } from '../mcpWindowStatus';
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
    // `jasper.mcp.enabled` false. A window that was never going to claim the
    // server should not report it as unclaimed.
    const report = mcpReport(undefined);
    expect(report.state).toBe('disabled');
    expect(report.headline).toBeUndefined();
    expect(report.detail).toContain('jasper.mcp.enabled');
    expect(report.detail).not.toContain('folder');
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
    const report = mcpReport(ownedElsewhere('bar (id 3)'));
    expect(report.state).toBe('other');
    expect(report.headline).toBe('MCP: other window');
    expect(report.owner).toEqual({
      workspacePath: '/somewhere/else',
      pid: 4242,
      claimedAt: '2026-01-01T00:00:00.000Z',
      selectedSession: 'bar (id 3)',
      lookFor: 'the window whose title includes "else" (/somewhere/else)',
    });
    // The handover leads, because it needs no trip to the other window at all.
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

describe('what to pick in the window list', () => {
  // The list shows window titles: `<file> — <folder or workspace name> — Visual Studio
  // Code`, or only `<file> — Visual Studio Code` with no folder. Logins never appear there.
  it('is the window name when the owner recorded one, since its title includes it', () => {
    const report = mcpReport(ownedElsewhere('bar (id 3)', { workspaceName: 'myproj' }));
    expect(report.owner?.lookFor).toBe('the window whose title includes "myproj"');
  });

  it('is the folder name for an older owner that recorded only its path', () => {
    expect(mcpReport(ownedElsewhere()).owner?.lookFor).toBe(
      'the window whose title includes "else" (/somewhere/else)',
    );
  });

  it('says what a folderless title looks like, with the login only as context', () => {
    const report = mcpReport(ownedElsewhere('bar (id 3)', { workspacePath: '(no workspace)' }));
    expect(report.owner?.lookFor).toBe(
      'the window with no folder open, whose title shows only its open file ' +
        '(it is logged in to bar (id 3))',
    );
  });

  it('still says something when the owner recorded neither a folder nor a session', () => {
    const report = mcpReport(ownedElsewhere(undefined, { workspacePath: '(no workspace)' }));
    expect(report.owner?.lookFor).toBe(
      'the window with no folder open, whose title shows only its open file',
    );
  });
});
