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

export async function shopifyGraphql(query: string, variables?: Record<string, unknown>) {
  const creds = shopifyCreds();
  if (!creds) throw new Error('SHOPIFY_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set');
  const url = `https://${creds.domain}/admin/api/2025-01/graphql.json`;
  const resp = await fetch(url, {
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

export function shopifyInventoryLocations() {
  return { locations: SHOPIFY_LOCATIONS };
}

export async function shopifyInventorySearch(locationId: string, search: string) {
  const query = `query ($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges { node {
        id title vendor productType featuredImage { url }
        variants(first: 100) {
          edges { node {
            id title price displayName barcode sku
            inventoryQuantity
            inventoryItem { id
              inventoryLevel(locationId: "${locationId}") {
                id
                quantities(names: ["available", "on_hand", "committed"]) { name quantity }
              }
            }
          }}
        }
      }}
    }
  }`;
  const data = await shopifyGraphql(query, { query: search, first: 20 });
  const products = (data.data?.products?.edges || []).map((pe: { node: Record<string, unknown> }) => {
    const p = pe.node as Record<string, unknown>;
    const variantEdges = (p.variants as { edges?: { node: Record<string, unknown> }[] })?.edges || [];
    const variants = variantEdges.map((ve) => {
      const v = ve.node;
      const level = (v.inventoryItem as { inventoryLevel?: { quantities?: { name: string; quantity: number }[] } })
        ?.inventoryLevel;
      const qMap: Record<string, number> = {};
      (level?.quantities || []).forEach((q) => { qMap[q.name] = q.quantity; });
      return {
        variantId: v.id,
        title: v.title,
        price: v.price,
        sku: v.sku,
        barcode: v.barcode,
        available: qMap.available ?? (v.inventoryQuantity as number) ?? 0,
        onHand: qMap.on_hand ?? 0,
        committed: qMap.committed ?? 0,
      };
    });
    const img = p.featuredImage as { url?: string } | undefined;
    return {
      productId: p.id,
      title: p.title,
      vendor: p.vendor,
      productType: p.productType,
      imageUrl: img?.url,
      variants,
    };
  });
  return { products };
}

function supabaseCreds() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) return null;
  return { url, key };
}

const SUPABASE_READ_TABLES = /^stash_(orders|deco_jobs|reminder_settings|reminder_log)(\/|$|\?)/;

export async function supabaseRead(path: string) {
  const creds = supabaseCreds();
  if (!creds) throw new Error('SUPABASE_URL and a Supabase key must be set');
  const normalized = path.replace(/^\//, '');
  if (!SUPABASE_READ_TABLES.test(normalized)) {
    throw new Error('Read path must target stash_orders, stash_deco_jobs, stash_reminder_settings, or stash_reminder_log');
  }
  if (/\b(insert|update|delete|upsert)\b/i.test(normalized)) {
    throw new Error('Only read (GET) paths are allowed');
  }
  const url = `${creds.url}/rest/v1/${normalized}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await resp.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  if (!resp.ok) {
    throw new Error(`Supabase ${resp.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

function decoCreds() {
  const domain = process.env.DECO_DOMAIN?.trim();
  const username = process.env.DECO_USERNAME?.trim();
  const password = process.env.DECO_PASSWORD?.trim();
  if (!domain || !username || !password) return null;
  const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return { host, username, password };
}

export async function decoFindOrders(jobIds: string[]) {
  const creds = decoCreds();
  if (!creds) throw new Error('DECO_DOMAIN, DECO_USERNAME, and DECO_PASSWORD must be set');
  const ids = jobIds.map((id) => String(id).trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('At least one job ID is required');

  const minDate = new Date();
  minDate.setDate(minDate.getDate() - 200);
  const dateStr = `${minDate.toISOString().split('T')[0]} 00:00:00`;
  const idSet = new Set(ids);
  const found = new Map<string, Record<string, unknown>>();

  const buildUrl = (limit: number, offset: number) => {
    const qp = new URLSearchParams();
    qp.append('username', creds.username);
    qp.append('password', creds.password);
    qp.append('field', '1');
    qp.append('condition', '4');
    qp.append('date1', dateStr);
    qp.append('limit', String(limit));
    qp.append('offset', String(offset));
    qp.append('include_workflow_data', '1');
    qp.append('skip_login_token', '1');
    qp.append('include_product_data', '1');
    qp.append('include_decoration_data', '1');
    return `https://${creds.host}/api/json/manage_orders/find?${qp.toString()}`;
  };

  const match = (order: Record<string, unknown>, id: string) =>
    String(order.order_id) === id
    || String(order.order_number) === id
    || String(order.id) === id;

  const first = await fetch(buildUrl(1, 0), { signal: AbortSignal.timeout(15_000) });
  const firstData = await first.json();
  const total = Number(firstData.total) || 0;
  for (const order of firstData.orders || []) {
    for (const rid of idSet) {
      if (!found.has(rid) && match(order, rid)) found.set(rid, order);
    }
  }

  const BATCH = 200;
  const offsets: number[] = [];
  for (let o = 0; o < total; o += BATCH) offsets.push(o);
  if (found.size < idSet.size && offsets.length > 1) {
    await Promise.allSettled(
      offsets.slice(1).map(async (offset) => {
        const resp = await fetch(buildUrl(BATCH, offset), { signal: AbortSignal.timeout(50_000) });
        const data = await resp.json();
        for (const order of data.orders || []) {
          for (const rid of idSet) {
            if (!found.has(rid) && match(order, rid)) found.set(rid, order);
          }
        }
      }),
    );
  }

  return ids.map((jobId) => ({ jobId, order: found.get(jobId) ?? null }));
}
