import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import * as net from 'net';
import { McpSession, McpSessionConfig } from './mcpSession';
import { registerTools } from './tools';

export type Transport = 'stdio' | 'sse' | 'proxy';

export interface CliArgs {
  transport: Transport;
  /** Unix socket / named pipe path — required for proxy mode. */
  proxySocket?: string;
  /** Fields below are required only for sse mode (isolated MCP session). */
  libraryPath?: string;
  stoneNrs?: string;
  gemNrs?: string;
  gsUser?: string;
  gemstone?: string;
  gemstoneGlobalDir?: string;
  hostUser?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length - 1; i += 2) {
    const key = args[i].replace(/^--/, '');
    result[key] = args[i + 1];
  }

  // Proxy mode is inferred from --proxy-socket (transport=proxy is implicit).
  const proxySocket = result['proxy-socket'];
  let transport: Transport;
  const rawTransport = result['transport'];
  if (proxySocket) {
    transport = 'proxy';
  } else {
    transport = (rawTransport ?? 'stdio') as Transport;
    if (transport !== 'stdio' && transport !== 'sse') {
      throw new Error(
        `Invalid --transport: ${rawTransport} (expected "stdio", "sse", or use --proxy-socket)`,
      );
    }
  }

  if (transport === 'sse' || transport === 'stdio') {
    const required = [
      'library-path',
      'stone-nrs',
      'gem-nrs',
      'gs-user',
      'gemstone',
      'gemstone-global-dir',
    ];
    for (const key of required) {
      if (!result[key]) {
        throw new Error(`Missing required argument: --${key}`);
      }
    }
  }

  return {
    transport,
    proxySocket,
    libraryPath: result['library-path'],
    stoneNrs: result['stone-nrs'],
    gemNrs: result['gem-nrs'],
    gsUser: result['gs-user'],
    gemstone: result['gemstone'],
    gemstoneGlobalDir: result['gemstone-global-dir'],
    hostUser: result['host-user'],
  };
}

export function createSessionConfig(args: CliArgs): McpSessionConfig {
  if (!args.libraryPath || !args.stoneNrs || !args.gemNrs || !args.gsUser) {
    throw new Error('Session config requires library-path, stone-nrs, gem-nrs, and gs-user');
  }
  return {
    libraryPath: args.libraryPath,
    stoneNrs: args.stoneNrs,
    gemNrs: args.gemNrs,
    gsUser: args.gsUser,
    gsPassword: process.env.GS_PASSWORD || '',
    hostUser: args.hostUser,
    hostPassword: process.env.HOST_PASSWORD,
  };
}

export function createHttpServer(mcpServer: McpServer) {
  const app = express();

  const transports = new Map<string, SSEServerTransport>();

  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });
    await mcpServer.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(404).send('Session not found');
    }
  });

  return app;
}

/**
 * Proxy mode: act as a byte pipe between Claude Code's stdin/stdout (the MCP
 * protocol stream) and a Unix socket / named pipe exposed by Jasper. All MCP
 * tools run inside Jasper's extension host, backed by the user's current
 * selected GemStone session.
 */
export function runProxyMode(socketPath: string): void {
  const socket = net.createConnection(socketPath);

  socket.on('error', (err) => {
    process.stderr.write(
      `MCP proxy: cannot connect to Jasper socket at ${socketPath}: ${err.message}\n` +
        'Is Jasper running, with jasper.mcp.enabled on?\n',
    );
    process.exit(1);
  });

  socket.on('connect', () => {
    process.stderr.write(`MCP proxy: connected to ${socketPath}\n`);
  });

  // Pipe stdio <-> socket. The MCP protocol flows through the socket to
  // Jasper's extension host, which handles each tool call with the user's
  // current session.
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);

  socket.on('close', () => {
    process.stderr.write('MCP proxy: socket closed\n');
    process.exit(0);
  });

  const shutdown = () => {
    process.stderr.write('MCP proxy: shutting down\n');
    socket.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.transport === 'proxy') {
    runProxyMode(args.proxySocket!);
    return;
  }

  // SSE / stdio modes: load GCI and run an isolated MCP session (Inspector).
  process.env.GEMSTONE = args.gemstone!;
  process.env.GEMSTONE_GLOBAL_DIR = args.gemstoneGlobalDir!;
  if (process.platform === 'darwin') {
    process.env.DYLD_LIBRARY_PATH = `${args.gemstone}/lib`;
  } else {
    process.env.LD_LIBRARY_PATH = `${args.gemstone}/lib`;
  }

  const sessionConfig = createSessionConfig(args);
  const session = new McpSession(sessionConfig);
  process.stderr.write(`MCP server: logged in as ${args.gsUser}\n`);

  const mcpServer = new McpServer({
    // Must match MCP_SERVER_NAME in client/src/mcpSocketServer.ts. Named
    // `jasper` so `gemstone` stays free for the GemStone-native MCP server.
    name: 'jasper',
    version: '1.0.0',
  });
  registerTools(mcpServer, session);

  if (args.transport === 'sse') {
    const app = createHttpServer(mcpServer);
    const httpServer = app.listen(0, () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      process.stdout.write(JSON.stringify({ port }) + '\n');
      process.stderr.write(`MCP server: listening on port ${port}\n`);
    });
    const shutdown = () => {
      process.stderr.write('MCP server: shutting down\n');
      session.logout();
      httpServer.close();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } else {
    // stdio — kept for manual/CLI testing with an isolated session.
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    process.stderr.write('MCP server: connected via stdio (isolated session)\n');
    const shutdown = () => {
      process.stderr.write('MCP server: shutting down\n');
      session.logout();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

if (!process.env.VITEST) {
  main().catch((err) => {
    process.stderr.write(`MCP server failed: ${err.message}\n`);
    process.exit(1);
  });
}
