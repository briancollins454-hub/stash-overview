import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createStashMcpServer } from './createServer.js';

function requireMcpAuth(req: Request, res: Response): boolean {
  const token = process.env.MCP_API_TOKEN?.trim();
  if (!token) {
    res.status(503).json({ error: 'MCP_HTTP is enabled but MCP_API_TOKEN is not set' });
    return false;
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export async function mountStashMcpHttp(app: Express) {
  const server = createStashMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  app.post('/api/mcp', async (req, res) => {
    if (!requireMcpAuth(req, res)) return;
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/api/mcp', async (req, res) => {
    if (!requireMcpAuth(req, res)) return;
    await transport.handleRequest(req, res);
  });
}
