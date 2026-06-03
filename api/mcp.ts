import type { VercelRequest, VercelResponse } from '@vercel/node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createStashMcpServer } from '../mcp/createServer.js';
import {
  unauthorizedMcpHeaders,
  verifyAccessToken,
} from '../lib/mcp-oauth.js';

let mcpReady: Promise<StreamableHTTPServerTransport> | null = null;

function getTransport(): Promise<StreamableHTTPServerTransport> {
  if (!mcpReady) {
    mcpReady = (async () => {
      const server = createStashMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      return transport;
    })();
  }
  return mcpReady;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!verifyAccessToken(req.headers.authorization as string | undefined)) {
    res.status(401);
    for (const [k, v] of Object.entries(unauthorizedMcpHeaders())) {
      res.setHeader(k, v);
    }
    return res.json({ error: 'Unauthorized' });
  }

  try {
    const transport = await getTransport();
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
    return res.status(500).json({ error: (e as Error).message });
  }
}
