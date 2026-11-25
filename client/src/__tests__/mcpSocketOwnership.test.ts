/**
 * Owner/passive lifecycle tests for {@link McpSocketServer}. Uses a real
 * socket (Unix domain socket, or named pipe on Windows) in `os.tmpdir()`,
 * so it intentionally does NOT mock `fs`. The mocked-fs tests for the
 * Claude Desktop config writer live in mcpSocketServer.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as net from 'net';
import { McpSocketServer } from '../mcpSocketServer';
import { temporarySidecarPath, withTemporaryFileDo } from './support/file';
import { temporarySocketPath } from './support/socket';
import { onSupportedPosixDescribe } from './platformGates';

// Each test gets its own sidecar path so parallel runs (and a real Jasper on
// the same machine) don't collide on the default `EXTENSION_FOLDER/mcp.owner.json`.
const newServer = (socketPath: string) =>
  new McpSocketServer({
    getSession: () => undefined,
    socketPath,
    sidecarPath: temporarySidecarPath(),
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

  it('the first server to start becomes the owner', async () => {
    const socketPath = temporarySocketPath();
    const server = newServer(socketPath);
    servers.push(server);

    const isOwner = await server.start();

    expect(isOwner).toBe(true);
    expect(server.isOwner).toBe(true);
  });

  it('a second server on the same path is passive (EADDRINUSE)', async () => {
    const socketPath = temporarySocketPath();

    const first = newServer(socketPath);
    servers.push(first);
    expect(await first.start()).toBe(true);

    const second = newServer(socketPath);
    servers.push(second);
    expect(await second.start()).toBe(false);
    expect(second.isOwner).toBe(false);
  });

  it('writes the owner sidecar on claim and removes it on dispose', async () => {
    const socketPath = temporarySocketPath();
    const sidecarPath = temporarySidecarPath();
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
    const socketPath = temporarySocketPath();
    const sidecarPath = temporarySidecarPath();
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
    const socketPath = temporarySocketPath();
    const sidecarPath = temporarySidecarPath();
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
    const socketPath = temporarySocketPath();
    const sidecarPath = temporarySidecarPath();
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
    const socketPath = temporarySocketPath();
    const sidecarPath = temporarySidecarPath();
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
    const socketPath = temporarySocketPath();
    const sidecarPath = temporarySidecarPath();
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

  onSupportedPosixDescribe('real socket file behavior', () => {
    it('creates the socket file at the given path', async () => {
      const socketPath = temporarySocketPath();
      const server = newServer(socketPath);
      servers.push(server);

      await server.start();

      expect(fs.existsSync(socketPath)).toBe(true);
    });

    it('a stale socket file (no listener) is reclaimed by the next start', async () => {
      const socketPath = temporarySocketPath();
      // Simulate a previous owner that crashed without unlinking the file.
      fs.writeFileSync(socketPath, '');

      const server = newServer(socketPath);
      servers.push(server);

      expect(await server.start()).toBe(true);
    });

    it('dispose() removes the socket file only when this instance was the owner', async () => {
      const socketPath = temporarySocketPath();

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

    it('a window letting go of the server leaves the socket of the window that takes it over', async () => {
      const socketPath = temporarySocketPath();
      const departing = newServer(socketPath);
      await departing.start();
      const next = newServer(socketPath);
      servers.push(next);

      // Have the next window claim the path the moment the departing one has
      // stopped listening, before dispose() goes on.
      const listener = (departing as unknown as { server: net.Server }).server;
      const close = listener.close.bind(listener);
      vi.spyOn(listener, 'close').mockImplementation((done) =>
        close(() => void next.start().finally(() => done?.())),
      );

      await departing.dispose();

      expect(next.isOwner).toBe(true);
      expect(fs.existsSync(socketPath)).toBe(true);
      await expect(connectsTo(socketPath)).resolves.toBe(true);
    });

    it('a window lets go of the server while an MCP client is still connected', async () => {
      const socketPath = temporarySocketPath();
      const owner = newServer(socketPath);
      await owner.start();
      const client = net.connect(socketPath);
      await new Promise((resolve) => client.once('connect', resolve));
      const clientClosed = new Promise((resolve) => client.once('close', resolve));

      const outcome = await Promise.race([
        owner.dispose().then(() => 'released'),
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2000)),
      ]);

      expect(outcome).toBe('released');
      await clientClosed;
      const next = newServer(socketPath);
      servers.push(next);
      expect(await next.start()).toBe(true);
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

    it('rejects when the socket path is inside a file instead of a directory', async () => {
      await withTemporaryFileDo(async (filePath) => {
        const socketPath = path.join(filePath, 'mcp.sock');
        const server = newServer(socketPath);
        servers.push(server);

        await expect(server.start()).rejects.toThrow(/ENOTDIR/);
      });
    });
  });
});

function connectsTo(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}
