/**
 * End-to-end integration test for the stdio-proxy MCP architecture.
 *
 * Starts a real {@link McpSocketServer}, connects a real MCP SDK Client over a
 * Unix socket (or named pipe on Windows), and verifies that tool calls flow
 * through to the session returned by `getSession()`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Delegate browserQueries so we can observe which tool ran without invoking
// real GCI. The integration we care about is: MCP client → socket → McpServer
// → registerMcpTools → getSession() → browserQueries.*
vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => ''),
  implementorsOf: vi.fn(() => [] as unknown[]),
  sendersOf: vi.fn(() => [] as unknown[]),
  referencesToObject: vi.fn(() => [] as unknown[]),
  getClassDefinition: vi.fn(() => 'Array definition'),
  getClassHierarchy: vi.fn(() => [] as unknown[]),
  getMethodSource: vi.fn(() => ''),
  getMethodList: vi.fn(() => [] as unknown[]),
  getDictionaryNames: vi.fn(() => ['Globals', 'UserGlobals']),
  getClassNames: vi.fn(() => [] as string[]),
  getDictionaryEntries: vi.fn(() => [] as unknown[]),
  getAllClassNames: vi.fn(() => [] as unknown[]),
  searchMethodSource: vi.fn(() => [] as unknown[]),
  describeClass: vi.fn(() => ''),
  fileOutClass: vi.fn(() => ''),
  compileMethod: vi.fn(() => ''),
  compileClassDefinition: vi.fn(() => ''),
  setClassComment: vi.fn(() => ''),
  deleteMethod: vi.fn(() => ''),
  deleteClass: vi.fn(() => ''),
  addDictionary: vi.fn(() => ''),
  removeDictionary: vi.fn(() => ''),
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(msg: string, num = 0) {
      super(msg);
      this.gciErrorNumber = num;
    }
  },
}));
vi.mock('../sunitQueries', () => ({
  runTestMethod: vi.fn(() => ({
    className: '',
    selector: '',
    status: 'passed',
    message: '',
    durationMs: 0,
  })),
  runTestClass: vi.fn(() => []),
  runFailingTests: vi.fn(() => []),
  discoverTestClasses: vi.fn(() => [] as Array<{ dictName: string; className: string }>),
  describeTestFailure: vi.fn(() => ({ status: 'passed' })),
  SunitQueryError: class SunitQueryError extends Error {
    gciErrorNumber: number;
    constructor(msg: string, num = 0) {
      super(msg);
      this.gciErrorNumber = num;
    }
  },
}));
vi.mock('../pythonQueries', () => ({
  evalPython: vi.fn(() => ''),
  compilePython: vi.fn(() => ''),
}));

import * as net from 'net';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { McpSocketServer } from '../mcpSocketServer';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';

// ── A minimal client Transport that wraps a raw socket ───────────────────

class SocketClientTransport implements Transport {
  private buffer = '';
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private socket: net.Socket) {}

  async start(): Promise<void> {
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let newlineIdx: number;
      while ((newlineIdx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.substring(0, newlineIdx).replace(/\r$/, '');
        this.buffer = this.buffer.substring(newlineIdx + 1);
        if (!line) continue;
        try {
          this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
        } catch (err) {
          this.onerror?.(err as Error);
        }
      }
    });
    this.socket.on('close', () => this.onclose?.());
    this.socket.on('error', (err) => this.onerror?.(err));
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.socket.write(JSON.stringify(message) + '\n');
  }

  async close(): Promise<void> {
    this.socket.end();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function makeMockSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: { label: 'DataCurator on gs64stone (localhost)' } as ActiveSession['login'],
    stoneVersion: '3.7.4',
  };
}

async function connectClient(socketPath: string): Promise<{ client: Client; socket: net.Socket }> {
  const socket = net.connect(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const transport = new SocketClientTransport(socket);
  const client = new Client({ name: 'jasper-tests', version: '0.0.1' });
  await client.connect(transport);
  return { client, socket };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('McpSocketServer integration', () => {
  let server: McpSocketServer;
  let session: ActiveSession | undefined;

  beforeEach(async () => {
    session = makeMockSession();
    server = new McpSocketServer({
      getSession: () => session,
      // Randomize per test so parallel runs don't collide on the fixed socket path.
      socketPath: path.join(
        os.tmpdir(),
        `jasper-mcp-test-${crypto.randomBytes(6).toString('hex')}.sock`,
      ),
      sidecarPath: path.join(
        os.tmpdir(),
        `jasper-mcp-owner-${crypto.randomBytes(6).toString('hex')}.json`,
      ),
    });
    await server.start();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('lists the registered tools over the socket', async () => {
    const { client, socket } = await connectClient(server.socketPath);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'abort',
        'add_dictionary',
        'commit',
        'compile_class_definition',
        'compile_method',
        'compile_python',
        'delete_class',
        'delete_method',
        'describe_class',
        'describe_test_failure',
        'eval_python',
        'execute_code',
        'export_class_source',
        'find_implementors',
        'find_references_to',
        'find_senders',
        'get_class_definition',
        'get_class_hierarchy',
        'get_method_source',
        'list_all_classes',
        'list_classes',
        'list_dictionaries',
        'list_dictionary_entries',
        'list_failing_tests',
        'list_methods',
        'list_test_classes',
        'refresh',
        'remove_dictionary',
        'run_test_class',
        'run_test_method',
        'search_method_source',
        'set_class_comment',
        'status',
      ]);
    } finally {
      await client.close();
      socket.destroy();
    }
  });

  it('routes a tool call through to the current session', async () => {
    const { client, socket } = await connectClient(server.socketPath);
    try {
      const result = await client.callTool({
        name: 'get_class_definition',
        arguments: { className: 'Array' },
      });

      // The session-backed tool reached our mocked browserQueries.
      expect(queries.getClassDefinition).toHaveBeenCalledWith(session, 'Array');
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toBe('Array definition');
    } finally {
      await client.close();
      socket.destroy();
    }
  });

  it('routes list_dictionaries through to queries.getDictionaryNames', async () => {
    const { client, socket } = await connectClient(server.socketPath);
    try {
      const result = await client.callTool({
        name: 'list_dictionaries',
        arguments: {},
      });

      expect(queries.getDictionaryNames).toHaveBeenCalledWith(session);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toBe('Globals\nUserGlobals');
    } finally {
      await client.close();
      socket.destroy();
    }
  });

  it('returns a graceful error response when no session is selected', async () => {
    session = undefined; // Simulate "no logged-in session"
    const { client, socket } = await connectClient(server.socketPath);
    try {
      const result = await client.callTool({
        name: 'execute_code',
        arguments: { code: '42' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/No active GemStone session/);
      // The session was never queried because we short-circuited.
      expect(queries.executeFetchString).not.toHaveBeenCalled();
    } finally {
      await client.close();
      socket.destroy();
    }
  });

  it('picks up a session change between calls (no stale caching)', async () => {
    session = undefined;
    const { client, socket } = await connectClient(server.socketPath);
    try {
      const first = await client.callTool({
        name: 'get_class_definition',
        arguments: { className: 'Array' },
      });
      expect(first.isError).toBe(true);
      expect(queries.getClassDefinition).not.toHaveBeenCalled();

      // User logs in on the Jasper side — session becomes available.
      session = makeMockSession();

      const second = await client.callTool({
        name: 'get_class_definition',
        arguments: { className: 'Array' },
      });
      expect(second.isError).toBeUndefined();
      expect(queries.getClassDefinition).toHaveBeenCalledWith(session, 'Array');
    } finally {
      await client.close();
      socket.destroy();
    }
  });

  // Verifies the actionable-error zod error map flows end-to-end: the SDK
  // serializes zod issues into the JSON-RPC error response verbatim, so the
  // installed custom map's text must reach the client untouched. Without
  // this guard, a future SDK upgrade that started templating its own messages
  // would silently regress the "Missing required parameter 'X'" phrasing
  // back to the bare zod default.
  it('routes a missing-parameter validation failure through the custom error map', async () => {
    const { client, socket } = await connectClient(server.socketPath);
    try {
      const result = await client.callTool({
        name: 'get_method_source',
        arguments: { className: 'Array', selector: 'size' }, // isMeta omitted
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Missing required parameter 'isMeta'");
      expect(text).toContain('expected boolean');
    } finally {
      await client.close();
      socket.destroy();
    }
  });
});
