import * as https from 'https';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ActiveSession } from './sessionManager';
import { registerMcpTools } from './mcpTools';
import { appendSysadmin } from './sysadminChannel';
import { MCP_SERVER_NAME } from './mcpSocketServer';

export const DEFAULT_MCP_HTTP_PORT = 27101;

export interface McpHttpServerOptions {
  /** Returns the user's currently selected GemStone session, or undefined. */
  getSession: () => ActiveSession | undefined;
  /** Told which session may have left or entered a transaction, after an MCP tool
   *  that can move it — so the session row, the status bar and the transaction
   *  context keys are not left describing the session as it was before Claude
   *  committed or aborted it. */
  onTransactionStateMayHaveMoved?: (sessionId: number) => void;
  /** Port to bind on 127.0.0.1. Stable across restarts so the URL pasted
   *  into an MCP client's connector UI stays valid. */
  port: number;
  /** TLS material — required. Claude Desktop's "Add custom connector" dialog
   *  rejects plain-http URLs, so we always serve https. See tlsCert.ts. */
  tls: { cert: Buffer; key: Buffer };
}

/**
 * Localhost HTTPS/SSE MCP surface for clients whose connector UI takes a URL
 * (such as Claude Desktop's "Add custom connector") rather than a command to
 * spawn. Parallel to {@link McpSocketServer} — same `getSession` routing, same
 * tool surface, different transport. Binds `127.0.0.1` only; never exposes
 * the port off-host.
 *
 * Multi-workspace note: the port is a single integer, so the first workspace
 * to activate wins. Later activations get `EADDRINUSE` from {@link start} and
 * should log it; `jasper.mcp.httpPort` can be overridden per-workspace in
 * `.vscode/settings.json` to run more than one window simultaneously.
 */
export class McpHttpServer {
  private readonly requestedPort: number;
  private boundPort: number | undefined;
  private httpServer: https.Server | undefined;

  constructor(private readonly options: McpHttpServerOptions) {
    this.requestedPort = options.port;
  }

  /** Port the server is actually bound to, falling back to the requested
   *  value before {@link start} resolves. If `options.port` was 0 the kernel
   *  assigns a port; {@link start} updates this to the real value. */
  get port(): number {
    return this.boundPort ?? this.requestedPort;
  }

  /** URL to paste into an MCP client's connector/remote-URL field. */
  get url(): string {
    return `https://127.0.0.1:${this.port}/sse`;
  }

  async start(): Promise<void> {
    const app = express();
    const transports = new Map<string, SSEServerTransport>();

    app.get('/sse', async (req, res) => {
      appendSysadmin(`MCP HTTP: SSE GET from ${req.ip ?? '?'}`);
      try {
        const transport = new SSEServerTransport('/messages', res);
        transports.set(transport.sessionId, transport);
        const mcpServer = new McpServer({ name: MCP_SERVER_NAME, version: '1.0.0' });
        registerMcpTools(
          mcpServer,
          this.options.getSession,
          this.options.onTransactionStateMayHaveMoved,
        );
        res.on('close', () => {
          transports.delete(transport.sessionId);
        });
        await mcpServer.connect(transport);
      } catch (err) {
        const e = err as Error;
        appendSysadmin(`MCP HTTP /sse error: ${e.message}\n${e.stack ?? ''}`);
        if (!res.headersSent) {
          res.status(500).send(`MCP SSE setup failed: ${e.message}`);
        } else {
          res.end();
        }
      }
    });

    app.post('/messages', async (req, res) => {
      try {
        const sessionId = req.query.sessionId as string;
        const transport = transports.get(sessionId);
        if (transport) {
          await transport.handlePostMessage(req, res);
        } else {
          res.status(404).send('Session not found');
        }
      } catch (err) {
        const e = err as Error;
        appendSysadmin(`MCP HTTP /messages error: ${e.message}\n${e.stack ?? ''}`);
        if (!res.headersSent) {
          res.status(500).send(`MCP message handling failed: ${e.message}`);
        } else {
          res.end();
        }
      }
    });

    // Catch-all express error handler for any unhandled errors.
    app.use(
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        appendSysadmin(`MCP HTTP unhandled error: ${err.message}\n${err.stack ?? ''}`);
        if (!res.headersSent) {
          res.status(500).send(`MCP unhandled error: ${err.message}`);
        } else {
          res.end();
        }
      },
    );

    await new Promise<void>((resolve, reject) => {
      const server = https.createServer(
        { cert: this.options.tls.cert, key: this.options.tls.key },
        app,
      );
      server.listen(this.requestedPort, '127.0.0.1');
      const onError = (err: NodeJS.ErrnoException) => {
        this.httpServer = undefined;
        reject(err);
      };
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        this.httpServer = server;
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          this.boundPort = addr.port;
        }
        resolve();
      });
    });
  }

  async dispose(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}
