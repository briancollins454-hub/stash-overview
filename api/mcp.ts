import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createStashMcpServer } from './mcp-lib/server.js';
import { unauthorizedMcpHeaders, verifyAccessToken } from './mcp-lib/oauth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyAccessToken(req.headers.authorization as string | undefined)) {
    res.status(401);
    for (const [k, v] of Object.entries(unauthorizedMcpHeaders())) {
      res.setHeader(k, v);
    }
    return res.json({ error: 'Unauthorized' });
  }

  const server = createStashMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    if (req.method === 'POST') {
      await transport.handleRequest(req, res, req.body);
      return;
    }
    if (req.method === 'GET') {
      await transport.handleRequest(req, res);
      return;
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[MCP] handler error', (e as Error).message, (e as Error).stack);
    if (!res.headersSent) {
      return res.status(500).json({ error: (e as Error).message });
    }
  } finally {
    try {
      await server.close();
    } catch {
      /* ignore */
    }
  }
}
