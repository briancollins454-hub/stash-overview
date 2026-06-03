// Self-contained MCP tool server for Vercel — do not import from outside api/
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

function textResult(data: unknown) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

function textError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

const SHOPIFY_LOCATIONS = [
  { id: 'gid://shopify/Location/111232942466', name: 'Local Stock' },
  { id: 'gid://shopify/Location/22963719', name: '20 Church Street' },
];

function shopifyCreds() {
  const domain = process.env.SHOPIFY_DOMAIN?.trim();
  const token = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  if (!domain || !token) return null;
  return { domain, token };
}

async function shopifyGraphql(query: string, variables?: Record<string, unknown>) {
  const creds = shopifyCreds();
  if (!creds) throw new Error('SHOPIFY_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set');
  const resp = await fetch(`https://${creds.domain}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': creds.token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(55_000),
  });
  return resp.json();
}

async function shopifyInventorySearch(locationId: string, search: string) {
  const gql = `query ($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges { node {
        id title vendor productType
        variants(first: 100) { edges { node {
          id title price sku barcode inventoryQuantity
          inventoryItem { id
            inventoryLevel(locationId: "${locationId}") {
              quantities(names: ["available", "on_hand", "committed"]) { name quantity }
            }
          }
        }}}
      }}
    }
  }`;
  const data = await shopifyGraphql(gql, { query: search, first: 20 });
  const products = (data.data?.products?.edges || []).map((pe: { node: Record<string, unknown> }) => {
    const p = pe.node;
    const variants = ((p.variants as { edges?: { node: Record<string, unknown> }[] })?.edges || []).map((ve) => {
      const v = ve.node;
      const level = (v.inventoryItem as { inventoryLevel?: { quantities?: { name: string; quantity: number }[] } })
        ?.inventoryLevel;
      const qMap: Record<string, number> = {};
      (level?.quantities || []).forEach((q) => { qMap[q.name] = q.quantity; });
      return {
        variantId: v.id, title: v.title, sku: v.sku,
        available: qMap.available ?? (v.inventoryQuantity as number) ?? 0,
      };
    });
    return { productId: p.id, title: p.title, variants };
  });
  return { products };
}

async function supabaseRead(path: string) {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) throw new Error('SUPABASE_URL and a Supabase key must be set');
  const normalized = path.replace(/^\//, '');
  if (!/^stash_(orders|deco_jobs|reminder_settings|reminder_log)(\/|$|\?)/.test(normalized)) {
    throw new Error('Read path must target stash_orders, stash_deco_jobs, stash_reminder_settings, or stash_reminder_log');
  }
  const resp = await fetch(`${url}/rest/v1/${normalized}`, {
    method: 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await resp.text();
  const body = text ? JSON.parse(text) : null;
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${text.slice(0, 200)}`);
  return body;
}

async function decoFindOrders(jobIds: string[]) {
  const domain = process.env.DECO_DOMAIN?.trim();
  const username = process.env.DECO_USERNAME?.trim();
  const password = process.env.DECO_PASSWORD?.trim();
  if (!domain || !username || !password) throw new Error('Deco credentials not configured');
  const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const ids = jobIds.map((id) => String(id).trim()).filter(Boolean);
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 200);
  const dateStr = `${minDate.toISOString().split('T')[0]} 00:00:00`;
  const buildUrl = (limit: number, offset: number) => {
    const qp = new URLSearchParams();
    qp.append('username', username);
    qp.append('password', password);
    qp.append('field', '1');
    qp.append('condition', '4');
    qp.append('date1', dateStr);
    qp.append('limit', String(limit));
    qp.append('offset', String(offset));
    qp.append('include_workflow_data', '1');
    qp.append('skip_login_token', '1');
    return `https://${host}/api/json/manage_orders/find?${qp.toString()}`;
  };
  const first = await fetch(buildUrl(1, 0), { signal: AbortSignal.timeout(15_000) });
  const firstData = await first.json();
  const found = new Map<string, Record<string, unknown>>();
  const idSet = new Set(ids);
  const match = (o: Record<string, unknown>, id: string) =>
    String(o.order_id) === id || String(o.order_number) === id || String(o.id) === id;
  for (const order of firstData.orders || []) {
    for (const rid of idSet) {
      if (!found.has(rid) && match(order, rid)) found.set(rid, order);
    }
  }
  return ids.map((jobId) => ({ jobId, order: found.get(jobId) ?? null }));
}

export function createStashMcpServer() {
  const server = new McpServer({ name: 'stash-overview', version: '1.0.0' });

  server.tool('shopify_inventory_locations', 'List Stash Shopify warehouse locations', {}, async () => {
    try {
      return textResult({ locations: SHOPIFY_LOCATIONS });
    } catch (e) {
      return textError((e as Error).message);
    }
  });

  server.tool(
    'shopify_inventory_search',
    'Search Shopify products/variants and stock at a location',
    {
      locationId: z.string(),
      search: z.string(),
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
    'Run a Shopify Admin GraphQL query',
    { query: z.string(), variables: z.record(z.string(), z.unknown()).optional() },
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
    'Read Stash Supabase tables (GET only)',
    { path: z.string() },
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
    'Look up DecoNetwork jobs by order ID (last ~200 days)',
    { jobIds: z.array(z.string()).min(1).max(20) },
    async ({ jobIds }) => {
      try {
        return textResult(await decoFindOrders(jobIds));
      } catch (e) {
        return textError((e as Error).message);
      }
    },
  );

  return server;
}
