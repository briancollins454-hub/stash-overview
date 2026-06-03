#!/usr/bin/env node
/**
 * Stash MCP server (stdio) — for Claude Desktop / Cursor.
 *
 * Claude Desktop: copy mcp/claude-desktop-config.example.json to
 * ~/Library/Application Support/Claude/claude_desktop_config.json
 * (uses mcp/run-stash-mcp.sh to load .env — no OAuth connector URL).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStashMcpServer } from './createServer.js';

const server = createStashMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
