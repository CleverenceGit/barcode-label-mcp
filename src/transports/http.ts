import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../server.js';

const sessions: Record<string, StreamableHTTPServerTransport> = {};

function sendJsonRpcError(res: ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    }),
  );
}

function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export async function runHttp(port: number, baseUrl?: string): Promise<Server> {
  const app = createMcpExpressApp();

  app.get('/health', (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });

  app.all(
    '/mcp',
    async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && sessions[sessionId]) {
        transport = sessions[sessionId];
      } else if (
        !sessionId &&
        req.method === 'POST' &&
        isInitializeRequest(req.body)
      ) {
        const apiKey = extractBearerToken(req);
        if (!apiKey) {
          sendJsonRpcError(
            res,
            401,
            'Unauthorized: provide a Cleverence Label API key via Authorization: Bearer <key>',
          );
          return;
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions[sid] = transport!;
          },
        });
        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid && sessions[sid]) delete sessions[sid];
        };
        const server = createMcpServer(apiKey, baseUrl);
        await server.connect(transport);
      } else if (sessionId && !sessions[sessionId]) {
        sendJsonRpcError(res, 404, 'Session not found');
        return;
      } else {
        sendJsonRpcError(res, 400, 'Bad Request: No valid session ID provided');
        return;
      }

      await transport.handleRequest(req, res, req.body);
    },
  );

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.error(`Cleverence Label MCP server listening on http://127.0.0.1:${port}`);
      console.error('  Streamable HTTP: POST/GET/DELETE /mcp');
      resolve(server);
    });
    server.once('error', reject);

    const shutdown = async () => {
      for (const sid of Object.keys(sessions)) {
        try {
          await sessions[sid].close();
        } catch {
          // ignore
        }
        delete sessions[sid];
      }
      server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
