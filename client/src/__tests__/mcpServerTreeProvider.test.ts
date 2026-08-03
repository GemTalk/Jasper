import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { ActiveSession } from '../sessionManager';
import { writeOwnerSidecar } from '../mcpOwnerSidecar';
import { resolveOwnership, renderOwnership } from '../mcpServerTreeProvider';
import { safelyRemovePath, temporarySidecarPath } from './support/file';

function fakeSession(id = 7): ActiveSession {
  return {
    id,
    gci: {} as ActiveSession['gci'],
    handle: null,
    login: {
      label: '',
      version: '3.7',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: 'swordfish',
      netldi: '',
      host_user: '',
      host_password: '',
    },
    stoneVersion: '3.7.1',
  };
}

describe('resolveOwnership', () => {
  let sidecarPath: string;
  beforeEach(() => {
    sidecarPath = temporarySidecarPath();
  });
  afterEach(() => {
    safelyRemovePath(sidecarPath);
  });

  it('returns "this" with the active session when this window is owner', () => {
    const session = fakeSession(42);
    const ownership = resolveOwnership({
      isOwner: () => true,
      socketPath: '/tmp/sock',
      httpsUrl: () => 'https://127.0.0.1:27101/sse',
      getSession: () => session,
      sidecarPath,
    });
    expect(ownership.kind).toBe('this');
    if (ownership.kind === 'this') {
      expect(ownership.selectedSession).toBe(session);
      expect(ownership.socketPath).toBe('/tmp/sock');
      expect(ownership.httpsUrl).toBe('https://127.0.0.1:27101/sse');
    }
  });

  it('returns "other" with the sidecar info when another live window owns the socket', () => {
    writeOwnerSidecar(
      {
        pid: process.pid, // alive
        workspacePath: '/Users/me/other-workspace',
        socketPath: '/tmp/sock',
        claimedAt: '2026-05-23T00:00:00Z',
      },
      sidecarPath,
    );
    const ownership = resolveOwnership({
      isOwner: () => false,
      socketPath: '/tmp/sock',
      httpsUrl: () => undefined,
      getSession: () => undefined,
      sidecarPath,
    });
    expect(ownership.kind).toBe('other');
    if (ownership.kind === 'other') {
      expect(ownership.info.workspacePath).toBe('/Users/me/other-workspace');
    }
  });

  it('returns "none" when the sidecar names a dead pid (stale)', () => {
    writeOwnerSidecar(
      {
        pid: 999999, // not alive on any reasonable system
        workspacePath: '/Users/me/dead-workspace',
        socketPath: '/tmp/sock',
        claimedAt: '2026-05-23T00:00:00Z',
      },
      sidecarPath,
    );
    const ownership = resolveOwnership({
      isOwner: () => false,
      socketPath: '/tmp/sock',
      httpsUrl: () => undefined,
      getSession: () => undefined,
      sidecarPath,
    });
    expect(ownership.kind).toBe('none');
  });

  it('returns "none" when no sidecar exists', () => {
    const ownership = resolveOwnership({
      isOwner: () => false,
      socketPath: '/tmp/sock',
      httpsUrl: () => undefined,
      getSession: () => undefined,
      sidecarPath,
    });
    expect(ownership.kind).toBe('none');
  });
});

describe('renderOwnership', () => {
  it('renders this-window state with status + session + socket', () => {
    const session = fakeSession(3);
    const nodes = renderOwnership({
      kind: 'this',
      selectedSession: session,
      socketPath: '/tmp/sock',
      httpsUrl: 'https://127.0.0.1:27101/sse',
    });
    const labels = nodes.map((n) => String(n.label));
    expect(labels[0]).toMatch(/This window owns the MCP server/);
    expect(labels[1]).toMatch(/Active session/);
    expect(labels[2]).toMatch(/^Socket: \/tmp\/sock$/);
    expect(labels[3]).toMatch(/^HTTPS: https:\/\/127\.0\.0\.1:27101\/sse$/);
  });

  it('renders this-window state with "(none)" session indicator when not logged in', () => {
    const nodes = renderOwnership({
      kind: 'this',
      selectedSession: undefined,
      socketPath: '/tmp/sock',
      httpsUrl: undefined,
    });
    const labels = nodes.map((n) => String(n.label));
    expect(labels[1]).toMatch(/Active session: \(none/);
    expect(labels.find((l) => l.startsWith('HTTPS:'))).toBeUndefined();
  });

  it('exposes an "Open MCP Inspector" action when this window owns HTTPS', () => {
    const nodes = renderOwnership({
      kind: 'this',
      selectedSession: fakeSession(3),
      socketPath: '/tmp/sock',
      httpsUrl: 'https://127.0.0.1:27101/sse',
    });
    const inspector = nodes.find((n) => String(n.label) === 'Open MCP Inspector');
    expect(inspector).toBeDefined();
    expect(inspector!.command).toMatchObject({
      command: 'jasper.openMcpInspector',
    });
    expect(inspector!.contextValue).toBe('mcpInspector');
  });

  it('omits the Open MCP Inspector action when HTTPS is unavailable', () => {
    const nodes = renderOwnership({
      kind: 'this',
      selectedSession: fakeSession(3),
      socketPath: '/tmp/sock',
      httpsUrl: undefined,
    });
    expect(nodes.find((n) => String(n.label) === 'Open MCP Inspector')).toBeUndefined();
  });

  it('omits the Open MCP Inspector action when another window owns the server', () => {
    const nodes = renderOwnership({
      kind: 'other',
      info: {
        pid: 1234,
        workspacePath: '/Users/me/other',
        socketPath: '/tmp/sock',
        claimedAt: '2026-05-23T00:00:00Z',
      },
    });
    expect(nodes.find((n) => String(n.label) === 'Open MCP Inspector')).toBeUndefined();
  });

  it('renders other-window state pointing at the owning workspace', () => {
    const nodes = renderOwnership({
      kind: 'other',
      info: {
        pid: 1234,
        workspacePath: '/Users/me/other',
        socketPath: '/tmp/sock',
        claimedAt: '2026-05-23T00:00:00Z',
      },
    });
    const labels = nodes.map((n) => String(n.label));
    expect(labels[0]).toMatch(/Owned by another VS Code window/);
    expect(labels[1]).toBe('Workspace: /Users/me/other');
  });

  it("surfaces the owner's selected session label when present in the sidecar", () => {
    const nodes = renderOwnership({
      kind: 'other',
      info: {
        pid: 1234,
        workspacePath: '/Users/me/other',
        socketPath: '/tmp/sock',
        claimedAt: '2026-05-23T00:00:00Z',
        selectedSession: 'foo (id 12)',
      },
    });
    const labels = nodes.map((n) => String(n.label));
    expect(labels.some((l) => /Owner's active session: foo \(id 12\)/.test(l))).toBe(true);
  });

  it('warns when the owner has no selected session (likely wrong-window-owner)', () => {
    const nodes = renderOwnership({
      kind: 'other',
      info: {
        pid: 1234,
        workspacePath: '/Users/me/wrong-workspace',
        socketPath: '/tmp/sock',
        claimedAt: '2026-05-23T00:00:00Z',
      },
    });
    const labels = nodes.map((n) => String(n.label));
    expect(labels.some((l) => /Owner's active session: \(none/.test(l))).toBe(true);
  });

  it('exposes a "Claim MCP Server" action in the no-owner state', () => {
    const nodes = renderOwnership({ kind: 'none' });
    const claim = nodes.find((n) => String(n.label) === 'Claim MCP Server');
    expect(claim).toBeDefined();
    expect(claim!.command).toMatchObject({
      command: 'jasper.claimMcpServer',
    });
    expect(claim!.contextValue).toBe('mcpClaim');
  });

  it('this-window Socket node copies its own path on click', () => {
    const nodes = renderOwnership({
      kind: 'this',
      selectedSession: fakeSession(3),
      socketPath: '/tmp/sock',
      httpsUrl: undefined,
    });
    const socket = nodes.find((n) => String(n.label).startsWith('Socket:'))!;
    expect(socket.command).toMatchObject({
      command: 'jasper.copyMcpSocketPath',
      arguments: ['/tmp/sock'],
    });
  });

  it('other-window Socket node also exposes copy — useful for telling the other window where to look', () => {
    const nodes = renderOwnership({
      kind: 'other',
      info: {
        pid: 1234,
        workspacePath: '/Users/me/other',
        socketPath: '/tmp/sock',
        claimedAt: '2026-05-23T00:00:00Z',
      },
    });
    const socket = nodes.find((n) => String(n.label).startsWith('Socket:'))!;
    expect(socket.command).toMatchObject({
      command: 'jasper.copyMcpSocketPath',
      arguments: ['/tmp/sock'],
    });
  });
});
