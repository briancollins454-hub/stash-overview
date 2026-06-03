import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  decoFindOrders,
  shopifyGraphql,
  shopifyInventoryLocations,
  shopifyInventorySearch,
  supabaseRead,
} from './stashClient.js';
import { textError, textResult } from './text.js';

export function registerStashTools(server: McpServer) {
  server.tool(
    'shopify_inventory_locations',
    'List Stash Shopify warehouse locations (Local Stock, 20 Church Street)',
    {},
    async () => {
      try {
        return textResult(shopifyInventoryLocations());
      } catch (e) {
        return textError((e as Error).message);
      }
    },
  );

  server.tool(
    'shopify_inventory_search',
    'Search Shopify products/variants and stock at a location (SKU, title, or Shopify search query)',
    {
      locationId: z.string().describe('Shopify location GID from shopify_inventory_locations'),
      search: z.string().describe('Search string, e.g. sku:ABC123 or title:polo'),
    },
    async ({ locationId, search }) => {
      try {
        return textResult(await shopifyInventorySearch(locationId, search));
      } catch (e) {
        return textError((e as Error).message);
      }
    },
  );

  server.tool(
    'shopify_graphql',
    'Run a Shopify Admin GraphQL query (read-focused; mutations only when you intend to change data)',
    {
      query: z.string().describe('GraphQL query or mutation'),
      variables: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('GraphQL variables object'),
    },
    async ({ query, variables }) => {
      try {
        return textResult(await shopifyGraphql(query, variables));
      } catch (e) {
        return textError((e as Error).message);
      }
    },
  );

  server.tool(
    'supabase_read',
    'Read rows from Stash Supabase tables (GET only): stash_orders, stash_deco_jobs, stash_reminder_settings, stash_reminder_log',
    {
      path: z
        .string()
        .describe(
          'PostgREST path, e.g. stash_orders?select=id,order_number,status&limit=20&order=updated_at.desc',
        ),
    },
    async ({ path }) => {
      try {
        return textResult(await supabaseRead(path));
      } catch (e) {
        return textError((e as Error).message);
      }
    },
  );

  server.tool(
    'deco_find_orders',
    'Look up DecoNetwork production jobs by order ID or job number (last ~200 days)',
    {
      jobIds: z
        .array(z.string())
        .min(1)
        .max(20)
        .describe('Deco order IDs or job numbers to find'),
    },
    async ({ jobIds }) => {
      try {
        return textResult(await decoFindOrders(jobIds));
      } catch (e) {
        return textError((e as Error).message);
      }
    },
  );
}
