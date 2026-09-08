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
  it('marks the served session and drops its button, so the state reads two ways', () => {
    const row = new GemStoneSessionItem(makeSession(7), true, 'serving');
    expect(row.description).toContain('· MCP');
    // The inline button is contributed for `gemstoneSession`; the served row
    // takes a different contextValue so VS Code withholds it.
    expect(row.contextValue).toBe('gemstoneSessionServingMcp');
  });

  it('offers the button on every other row, and says so when another window owns it', () => {
    for (const state of ['off', 'idle', 'elsewhere'] as const) {
      const row = new GemStoneSessionItem(makeSession(8), false, state);
      expect(row.description).not.toContain('MCP');
      expect(row.contextValue).toBe('gemstoneSession');
    }
    expect(String(new GemStoneSessionItem(makeSession(8), false, 'elsewhere').tooltip)).toContain(
      'Another VS Code window',
    );
  });
});
