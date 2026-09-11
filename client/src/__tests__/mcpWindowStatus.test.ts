import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { mcpHeader, mcpReport } from '../mcpWindowStatus';
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

const ownedElsewhere = (selectedSession?: string): McpOwnership => ({
  kind: 'other',
  info: {
    pid: 4242,
    workspacePath: '/somewhere/else',
    socketPath: '/tmp/jasper.sock',
    claimedAt: '2026-01-01T00:00:00.000Z',
    ...(selectedSession ? { selectedSession } : {}),
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

  it('carries the owning window so the user can be sent there', () => {
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
    });
    expect(report.detail).toContain('Stop MCP there');
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

describe('mcpHeader', () => {
  it('puts the state beside the Databases title in every running state', () => {
    expect(mcpHeader(mcpReport(owned(makeSession(7)))).description).toBe('MCP: this window');
    expect(mcpHeader(mcpReport(ownedElsewhere())).description).toBe('MCP: other window');
    expect(mcpHeader(mcpReport({ kind: 'none' })).description).toBe('MCP: unclaimed');
  });

  it('says nothing at all when MCP is not running in this window', () => {
    // Not "unclaimed": the header would be reporting on a server this window
    // was never going to claim.
    expect(mcpHeader(mcpReport(undefined))).toEqual({
      description: undefined,
      message: undefined,
    });
  });

  it('spends a line in the view only when the fix is in another window', () => {
    // Everything else the user needs is one click away in the tab; this is the
    // case where they have to go somewhere else entirely.
    expect(mcpHeader(mcpReport(ownedElsewhere())).message).toContain('Stop MCP there');
    expect(mcpHeader(mcpReport(owned(makeSession(7)))).message).toBeUndefined();
    expect(mcpHeader(mcpReport({ kind: 'none' })).message).toBeUndefined();
  });
});
