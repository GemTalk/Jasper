import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { GemStoneSessionItem, sessionMcpState } from '../loginTreeProvider';
import { DEFAULT_LOGIN } from '../loginTypes';
import type { McpOwnership } from '../mcpServerTreeProvider';
import type { ActiveSession } from '../sessionManager';

function makeSession(id: number): ActiveSession {
  return { id, login: { ...DEFAULT_LOGIN, label: 'Test' }, stoneVersion: '3.7.2' } as ActiveSession;
}

const owned = (selected?: ActiveSession): McpOwnership => ({
  kind: 'this',
  selectedSession: selected,
  socketPath: '/tmp/jasper.sock',
});

const elsewhere: McpOwnership = {
  kind: 'other',
  info: {
    pid: 1,
    workspacePath: '/somewhere/else',
    socketPath: '/tmp/jasper.sock',
    claimedAt: '2026-01-01T00:00:00.000Z',
  },
};

describe('sessionMcpState', () => {
  it('says nothing when the MCP surface is not running in this window', () => {
    // `jasper.mcp.enabled` off, or no folder open — the row should not imply
    // there is an MCP server to take over.
    expect(sessionMcpState(undefined, makeSession(7), true)).toBe('off');
  });

  it('marks the selected session of the owning window as the one being served', () => {
    const session = makeSession(7);
    expect(sessionMcpState(owned(session), session, true)).toBe('serving');
  });

  it('does not mark an unselected session even in the owning window', () => {
    // Ownership alone is not enough: the tools follow the active session, which
    // is exactly the confusion the old pane's standalone Claim button caused.
    const selected = makeSession(7);
    const other = makeSession(8);
    expect(sessionMcpState(owned(selected), other, false)).toBe('idle');
  });

  it('marks nothing while the owning window has no session selected', () => {
    expect(sessionMcpState(owned(undefined), makeSession(7), true)).toBe('idle');
  });

  it('reports another window as the owner, for every row', () => {
    expect(sessionMcpState(elsewhere, makeSession(7), true)).toBe('elsewhere');
    expect(sessionMcpState(elsewhere, makeSession(8), false)).toBe('elsewhere');
  });
});

describe('the session row', () => {
  it('marks the served session in its description', () => {
    const row = new GemStoneSessionItem(makeSession(7), true, 'serving');
    expect(row.description).toContain('· MCP');
    expect(String(row.tooltip)).toContain('run their GemStone tools against this session');
  });

  it('says nothing about MCP on any other row', () => {
    for (const state of ['off', 'idle', 'elsewhere'] as const) {
      expect(new GemStoneSessionItem(makeSession(8), false, state).description).not.toContain(
        'MCP',
      );
    }
    expect(String(new GemStoneSessionItem(makeSession(8), false, 'elsewhere').tooltip)).toContain(
      'Another VS Code window',
    );
  });

  it('keeps one contextValue whatever MCP is doing, so the row keeps its actions', () => {
    // File In, Commit, Abort, Session Configuration, Logout and the backup pair
    // are all contributed for `viewItem == gemstoneSession`. Marking the served
    // row with a contextValue of its own took every one of them off that row.
    for (const state of ['off', 'idle', 'serving', 'elsewhere'] as const) {
      expect(new GemStoneSessionItem(makeSession(7), true, state).contextValue).toBe(
        'gemstoneSession',
      );
    }
  });
});
