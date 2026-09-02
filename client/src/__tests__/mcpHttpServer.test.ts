/**
 * Unit + integration tests for the HTTPS/SSE MCP surface. Unit tests cover URL
 * construction and dispose-before-start. Integration tests bind real sockets
 * on random ports (port 0) and verify: SSE endpoint reachable, EADDRINUSE on
 * collision, dispose frees the port, and a full MCP handshake via SSE
 * roundtrips.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => 'ok'),
  implementorsOf: vi.fn(() => [] as unknown[]),
  sendersOf: vi.fn(() => [] as unknown[]),
  referencesToObject: vi.fn(() => [] as unknown[]),
  getClassDefinition: vi.fn(() => ''),
  getClassHierarchy: vi.fn(() => [] as unknown[]),
  getMethodSource: vi.fn(() => ''),
  getMethodList: vi.fn(() => [] as unknown[]),
  getDictionaryNames: vi.fn(() => ['Globals']),
  getClassNames: vi.fn(() => [] as string[]),
  getDictionaryEntries: vi.fn(() => [] as unknown[]),
  getAllClassNames: vi.fn(() => [] as unknown[]),
  searchMethodSource: vi.fn(() => [] as unknown[]),
  describeClass: vi.fn(() => ''),
  referrersOf: vi.fn(() => ({ kind: 'ok', groups: [], scanMillis: 0 })),
  classCensus: vi.fn(() => ({ kind: 'ok', classes: [], scanMillis: 0 })),
  referenceEdges: vi.fn(() => ({ kind: 'ok', edges: [], unattributed: [], scanMillis: 0 })),
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
  SunitQueryError: class SunitQueryError extends Error {
    gciErrorNumber: number;
    constructor(msg: string, num = 0) {
      super(msg);
      this.gciErrorNumber = num;
    }
  },
}));

import * as https from 'https';
import type * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { DEFAULT_MCP_HTTP_PORT, McpHttpServer } from '../mcpHttpServer';
import { ensureSelfSignedCert } from '../tlsCert';

/** Fetch headers only, then close. SSE responses never end, so we can't wait
 *  for body completion — just confirm the server responded. rejectUnauthorized
 *  is disabled because we serve a self-signed cert. */
function fetchHeaders(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
      res.destroy();
      req.destroy();
    });
    req.on('error', reject);
    req.setTimeout(2000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

// Generate one cert for the whole suite — cert generation is ~500ms, reuse keeps tests fast.
let testTls: { cert: Buffer; key: Buffer };
let testCertDir: string;
let origRejectUnauthorized: string | undefined;

beforeAll(async () => {
  testCertDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-mcp-test-'));
  const material = await ensureSelfSignedCert(testCertDir);
  testTls = { cert: material.cert, key: material.key };
  // SSEClientTransport uses the global fetch/EventSource which respects this env var.
  // Scope to tests and restore afterwards.
  origRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
});

afterAll(() => {
  if (origRejectUnauthorized === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = origRejectUnauthorized;
  }
  if (testCertDir && fs.existsSync(testCertDir)) {
    fs.rmSync(testCertDir, { recursive: true, force: true });
  }
});

describe('DEFAULT_MCP_HTTP_PORT', () => {
  it('is 27101', () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(27101);
  });
});

describe('McpHttpServer (unit)', () => {
  it('reports the requested port before start', () => {
    const server = new McpHttpServer({ getSession: () => undefined, port: 42000, tls: testTls });
    expect(server.port).toBe(42000);
  });

  it('builds a loopback https /sse URL from the port', () => {
    const server = new McpHttpServer({ getSession: () => undefined, port: 42000, tls: testTls });
    expect(server.url).toBe('https://127.0.0.1:42000/sse');
  });

  it('dispose before start resolves without error', async () => {
    const server = new McpHttpServer({ getSession: () => undefined, port: 42000, tls: testTls });
    await expect(server.dispose()).resolves.toBeUndefined();
  });
});

describe('McpHttpServer (integration)', () => {
  let server: McpHttpServer;

  afterEach(async () => {
    if (server) {
      await server.dispose();
    }
  });

  it('binds and exposes the actual port via `port` after start', async () => {
    server = new McpHttpServer({ getSession: () => undefined, port: 0, tls: testTls });
    await server.start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.port).not.toBe(0);
    expect(server.url).toBe(`https://127.0.0.1:${server.port}/sse`);
  });

  it('serves /sse with a text/event-stream content type over TLS', async () => {
    server = new McpHttpServer({ getSession: () => undefined, port: 0, tls: testTls });
    await server.start();
    const resp = await fetchHeaders(server.url);
    expect(resp.status).toBe(200);
    expect(String(resp.headers['content-type'] ?? '')).toMatch(/text\/event-stream/);
  });

  it('rejects a second listener on the same port with EADDRINUSE', async () => {
    server = new McpHttpServer({ getSession: () => undefined, port: 0, tls: testTls });
    await server.start();
    const port = server.port;
    const other = new McpHttpServer({ getSession: () => undefined, port, tls: testTls });
    try {
      await expect(other.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await other.dispose();
    }
  });

  it('dispose frees the port so it can be re-bound', async () => {
    server = new McpHttpServer({ getSession: () => undefined, port: 0, tls: testTls });
    await server.start();
    const port = server.port;
    await server.dispose();
    const again = new McpHttpServer({ getSession: () => undefined, port, tls: testTls });
    try {
      await expect(again.start()).resolves.toBeUndefined();
      expect(again.port).toBe(port);
    } finally {
      await again.dispose();
    }
  });

  it('completes an MCP handshake and lists tools via SSE over TLS', async () => {
    server = new McpHttpServer({ getSession: () => undefined, port: 0, tls: testTls });
    await server.start();

    const client = new Client({ name: 'probe', version: '0.0.1' });
    const transport = new SSEClientTransport(new URL(server.url));
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain('status');
      expect(names).toContain('execute_code');
    } finally {
      await client.close();
    }
  });
});
