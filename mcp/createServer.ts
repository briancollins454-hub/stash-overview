import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStashTools } from './registerStashTools.js';

export function createStashMcpServer() {
  const server = new McpServer({
    name: 'stash-overview',
    version: '1.0.0',
  });
  registerStashTools(server);
  return server;
}
