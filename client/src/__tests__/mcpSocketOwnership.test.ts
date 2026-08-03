/**
 * Owner/passive lifecycle tests for {@link McpSocketServer}. Uses real
 * Unix sockets in `os.tmpdir()`, so it intentionally does NOT mock `fs`.
 * The mocked-fs tests for the Claude Desktop config writer live in
 * mcpSocketServer.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { McpSocketServer } from '../mcpSocketServer';

const tmpSocketPath = () =>
  path.join(os.tmpdir(), `jasper-mcp-test-${crypto.randomBytes(6).toString('hex')}.sock`);

// Each test gets its own sidecar path so parallel runs (and a real Jasper on
// the same machine) don't collide on the default `EXTENSION_FOLDER/mcp.owner.json`.
const tmpSidecarPath = () =>
  path.join(os.tmpdir(), `jasper-mcp-owner-${crypto.randomBytes(6).toString('hex')}.json`);

const newServer = (socketPath: string) =>
  new McpSocketServer({
    getSession: () => undefined,
    socketPath,
    sidecarPath: tmpSidecarPath(),
  });

describe('McpSocketServer ownership', () => {
  let servers: McpSocketServer[] = [];

  beforeEach(() => {
    servers = [];
  });

  afterEach(async () => {
    for (const s of servers) {
      await s.dispose().catch(() => undefined);
    }
  });

  it('the first server to start becomes the owner and creates the socket file', async () => {
    const socketPath = tmpSocketPath();
    const server = newServer(socketPath);
    servers.push(server);

    const isOwner = await server.start();

    expect(isOwner).toBe(true);
    expect(server.isOwner).toBe(true);
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it('a second server on the same path is passive (EADDRINUSE)', async () => {
    const socketPath = tmpSocketPath();

    const first = newServer(socketPath);
    servers.push(first);
    expect(await first.start()).toBe(true);

    const second = newServer(socketPath);
    servers.push(second);
    expect(await second.start()).toBe(false);
    expect(second.isOwner).toBe(false);
  });

  it('a stale socket file (no listener) is reclaimed by the next start', async () => {
    const socketPath = tmpSocketPath();
    // Simulate a previous owner that crashed without unlinking the file.
    fs.writeFileSync(socketPath, '');

    const server = newServer(socketPath);
    servers.push(server);

    expect(await server.start()).toBe(true);
  });

  it('dispose() removes the socket file only when this instance was the owner', async () => {
    const socketPath = tmpSocketPath();

    const first = newServer(socketPath);
    await first.start();
    expect(first.isOwner).toBe(true);

    const second = newServer(socketPath);
    await second.start();
    expect(second.isOwner).toBe(false);

    // Passive dispose must leave the file alone — the real owner still uses it.
    await second.dispose();
    expect(fs.existsSync(socketPath)).toBe(true);

    // Owner dispose unlinks.
    await first.dispose();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('writes the owner sidecar on claim and removes it on dispose', async () => {
    const socketPath = tmpSocketPath();
    const sidecarPath = tmpSidecarPath();
    const server = new McpSocketServer({
      getSession: () => undefined,
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/example-workspace',
    });
    servers.push(server);

    expect(await server.start()).toBe(true);
    expect(fs.existsSync(sidecarPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(written.pid).toBe(process.pid);
    expect(written.workspacePath).toBe('/tmp/example-workspace');
    expect(written.socketPath).toBe(socketPath);
    expect(typeof written.claimedAt).toBe('string');

    await server.dispose();
    // Remove from afterEach cleanup list since we already disposed.
    servers = servers.filter((s) => s !== server);
    expect(fs.existsSync(sidecarPath)).toBe(false);
  });

  it('writes the selectedSession label into the sidecar on claim when one is set', async () => {
    const socketPath = tmpSocketPath();
    const sidecarPath = tmpSidecarPath();
    const server = new McpSocketServer({
      getSession: () => undefined,
      getSessionLabel: () => 'foo (id 12)',
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/labeled',
    });
    servers.push(server);

    expect(await server.start()).toBe(true);
    const written = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(written.selectedSession).toBe('foo (id 12)');
  });

  it('omits selectedSession from the sidecar when the owner has no session', async () => {
    const socketPath = tmpSocketPath();
    const sidecarPath = tmpSidecarPath();
    const server = new McpSocketServer({
      getSession: () => undefined,
      getSessionLabel: () => undefined,
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/no-session',
    });
    servers.push(server);

    expect(await server.start()).toBe(true);
    const written = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect('selectedSession' in written).toBe(false);
  });

  it('refreshSidecar rewrites the sidecar with the current session label', async () => {
    const socketPath = tmpSocketPath();
    const sidecarPath = tmpSidecarPath();
    let label: string | undefined = undefined;
    const server = new McpSocketServer({
      getSession: () => undefined,
      getSessionLabel: () => label,
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/refresh',
    });
    servers.push(server);

    expect(await server.start()).toBe(true);
    expect(JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')).selectedSession).toBeUndefined();

    label = 'bar (id 7)';
    server.refreshSidecar();
    expect(JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')).selectedSession).toBe('bar (id 7)');

    label = undefined;
    server.refreshSidecar();
    const written = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect('selectedSession' in written).toBe(false);
  });

  it('refreshSidecar is a no-op when this instance is not the owner', async () => {
    const socketPath = tmpSocketPath();
    const sidecarPath = tmpSidecarPath();
    const owner = new McpSocketServer({
      getSession: () => undefined,
      getSessionLabel: () => 'owner-session',
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/owner',
    });
    servers.push(owner);
    expect(await owner.start()).toBe(true);

    const passive = new McpSocketServer({
      getSession: () => undefined,
      getSessionLabel: () => 'passive-session-that-should-not-leak',
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/passive',
    });
    servers.push(passive);
    expect(await passive.start()).toBe(false);

    passive.refreshSidecar();
    const written = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(written.workspacePath).toBe('/tmp/owner');
    expect(written.selectedSession).toBe('owner-session');
  });

  it('passive instances do not overwrite the sidecar', async () => {
    const socketPath = tmpSocketPath();
    const sidecarPath = tmpSidecarPath();
    const first = new McpSocketServer({
      getSession: () => undefined,
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/first',
    });
    servers.push(first);
    expect(await first.start()).toBe(true);

    const second = new McpSocketServer({
      getSession: () => undefined,
      socketPath,
      sidecarPath,
      workspacePath: '/tmp/second-passive',
    });
    servers.push(second);
    expect(await second.start()).toBe(false);

    const written = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(written.workspacePath).toBe('/tmp/first');
  });

  it('creates the parent directory if missing', async () => {
    const dir = path.join(os.tmpdir(), `jasper-mcp-dir-${crypto.randomBytes(6).toString('hex')}`);
    const socketPath = path.join(dir, 'mcp.sock');
    expect(fs.existsSync(dir)).toBe(false);

    const server = newServer(socketPath);
    servers.push(server);

    expect(await server.start()).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);

    // Clean up the dir after the server is disposed.
    await server.dispose();
    try {
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  });
});
