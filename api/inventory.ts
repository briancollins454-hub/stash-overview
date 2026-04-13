import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const domain = process.env.SHOPIFY_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) return res.status(500).json({ error: 'Shopify credentials not configured' });

  const { action, locationId, cursor, search, inventoryItemId, quantity, price, variantId } = req.body || {};
  const gqlHeaders = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' };
  const gqlUrl = `https://${domain}/admin/api/2025-01/graphql.json`;

  async function gql(query: string, variables?: any) {
    const resp = await fetch(gqlUrl, {
      method: 'POST', headers: gqlHeaders,
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(55000),
    });
    return resp.json();
  }

  const restHeaders = { 'X-Shopify-Access-Token': token, Accept: 'application/json' };
  const restBase = `https://${domain}/admin/api/2025-01`;

  try {
    // List all warehouse locations
    if (action === 'locations') {
      // Paginate through ALL products to discover every location_id via inventory_levels
      try {
        const locIds = new Set<number>();
        let sinceId = 0;
        // Page through products (250 per page, up to 8 pages = 2000 products)
        for (let page = 0; page < 8; page++) {
          const prodResp = await fetch(`${restBase}/products.json?limit=250&since_id=${sinceId}&fields=id,variants`, {
            headers: restHeaders, signal: AbortSignal.timeout(12000),
          });
          if (!prodResp.ok) break;
          const prodData = await prodResp.json();
          const products = prodData.products || [];
          if (!products.length) break;

          // One variant per product
          const itemIds: number[] = [];
          for (const prod of products) {
            const v = prod.variants?.[0];
            if (v?.inventory_item_id) itemIds.push(v.inventory_item_id);
            sinceId = Math.max(sinceId, prod.id);
          }

          // Query inventory levels in batches of 50
          for (let i = 0; i < itemIds.length; i += 50) {
            const batch = itemIds.slice(i, i + 50);
            const levResp = await fetch(`${restBase}/inventory_levels.json?inventory_item_ids=${batch.join(',')}`, {
              headers: restHeaders, signal: AbortSignal.timeout(10000),
            });
            if (levResp.ok) {
              const levData = await levResp.json();
              for (const lev of levData.inventory_levels || []) {
                if (lev.location_id) locIds.add(lev.location_id);
              }
            }
          }

          // Stop early once we've found 2+ locations
          if (locIds.size >= 2) break;
        }

        if (!locIds.size) throw new Error('No location IDs found');

        // Resolve location names via GraphQL
        const locations: any[] = [];
        for (const lid of locIds) {
          const gid = `gid://shopify/Location/${lid}`;
          try {
            const nameData = await gql(`{
              inventoryItems(first: 1) {
                edges { node {
                  inventoryLevel(locationId: "${gid}") {
                    location { id name }
                  }
                }}
              }
            }`);
            const loc = nameData.data?.inventoryItems?.edges?.[0]?.node?.inventoryLevel?.location;
            if (loc?.name) {
              locations.push({ id: gid, name: loc.name, address: {}, isActive: true });
              continue;
            }
          } catch {}
          locations.push({ id: gid, name: `Location ${lid}`, address: {}, isActive: true });
        }
        return res.status(200).json({ locations });
      } catch (e: any) {
        // fallback
      }

      return res.status(200).json({ locations: [], errors: [{ message: 'Could not discover locations.' }] });
    }

    // Fetch inventory levels for a location (paginated)
    if (action === 'inventory' && locationId) {
      const pageSize = 50;
      const query = `query ($locationId: ID!, $first: Int!, $after: String) {
        location(id: $locationId) {
          id name
          inventoryLevels(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node {
              id
              quantities(names: ["available", "on_hand", "committed", "incoming"]) { name quantity }
              item {
                id sku
                variant {
                  id title price displayName
                  product { id title vendor productType featuredImage { url } }
                  inventoryQuantity
                  barcode
                }
              }
            }}
          }
        }
      }`;
      const data = await gql(query, { locationId, first: pageSize, after: cursor || null });
      const loc = data.data?.location;
      if (!loc) return res.status(404).json({ error: 'Location not found' });
      const levels = loc.inventoryLevels;
      const items = (levels.edges || []).map((e: any) => {
        const n = e.node;
        const qMap: Record<string, number> = {};
        (n.quantities || []).forEach((q: any) => { qMap[q.name] = q.quantity; });
        const variant = n.item?.variant;
        const product = variant?.product;
        return {
          inventoryItemId: n.item?.id,
          inventoryLevelId: n.id,
          sku: n.item?.sku || '',
          barcode: variant?.barcode || '',
          variantId: variant?.id,
          variantTitle: variant?.title,
          displayName: variant?.displayName,
          price: variant?.price,
          productId: product?.id,
          productTitle: product?.title,
          vendor: product?.vendor,
          productType: product?.productType,
          imageUrl: product?.featuredImage?.url,
          available: qMap.available ?? 0,
          onHand: qMap.on_hand ?? 0,
          committed: qMap.committed ?? 0,
          incoming: qMap.incoming ?? 0,
        };
      });
      return res.status(200).json({
        items,
        pageInfo: levels.pageInfo,
        locationName: loc.name,
      });
    }

    // Search products across a location
    if (action === 'search' && locationId && search) {
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
      const data = await gql(query, { query: search, first: 20 });
      const products = (data.data?.products?.edges || []).map((pe: any) => {
        const p = pe.node;
        const variants = (p.variants?.edges || []).map((ve: any) => {
          const v = ve.node;
          const level = v.inventoryItem?.inventoryLevel;
          const qMap: Record<string, number> = {};
          (level?.quantities || []).forEach((q: any) => { qMap[q.name] = q.quantity; });
          return {
            variantId: v.id, title: v.title, price: v.price, displayName: v.displayName,
            barcode: v.barcode, sku: v.sku, inventoryItemId: v.inventoryItem?.id,
            inventoryLevelId: level?.id,
            available: qMap.available ?? v.inventoryQuantity ?? 0,
            onHand: qMap.on_hand ?? 0, committed: qMap.committed ?? 0,
          };
        });
        return {
          productId: p.id, title: p.title, vendor: p.vendor,
          productType: p.productType, imageUrl: p.featuredImage?.url, variants,
        };
      });
      return res.status(200).json({ products });
    }

    // Adjust inventory quantity
    if (action === 'adjust' && inventoryItemId && locationId && typeof quantity === 'number') {
      const mutation = `mutation ($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup { reason }
          userErrors { field message }
        }
      }`;
      const data = await gql(mutation, {
        input: {
          reason: 'correction',
          name: 'available',
          changes: [{ delta: quantity, inventoryItemId, locationId }],
        },
      });
      const errors = data.data?.inventoryAdjustQuantities?.userErrors || [];
      if (errors.length > 0) return res.status(400).json({ error: errors[0].message, errors });
      return res.status(200).json({ success: true });
    }

    // Update variant price
    if (action === 'updatePrice' && variantId && price) {
      const mutation = `mutation ($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
          productVariant { id price }
          userErrors { field message }
        }
      }`;
      const data = await gql(mutation, { input: { id: variantId, price: String(price) } });
      const errors = data.data?.productVariantUpdate?.userErrors || [];
      if (errors.length > 0) return res.status(400).json({ error: errors[0].message, errors });
      return res.status(200).json({ success: true, price: data.data?.productVariantUpdate?.productVariant?.price });
    }

    // Fetch sales velocity for forecasting (last 90 days of orders for items at a location)
    if (action === 'salesVelocity' && locationId) {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 90);
      const sinceStr = sinceDate.toISOString();
      // Get recent orders and count line-item quantities by variant
      let allLineItems: { variantId: string; quantity: number; date: string }[] = [];
      let orderCursor: string | null = null;
      for (let page = 0; page < 5; page++) {
        const q = `query ($first: Int!, $after: String, $query: String!) {
          orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
            edges { node {
              createdAt
              lineItems(first: 100) {
                edges { node { quantity variant { id } } }
              }
            }}
          }
        }`;
        const data = await gql(q, { first: 50, after: orderCursor, query: `created_at:>=${sinceStr}` });
        const edges = data.data?.orders?.edges || [];
        for (const oe of edges) {
          const o = oe.node;
          for (const le of (o.lineItems?.edges || [])) {
            const li = le.node;
            if (li.variant?.id) {
              allLineItems.push({ variantId: li.variant.id, quantity: li.quantity, date: o.createdAt });
            }
          }
        }
        const pi = data.data?.orders?.pageInfo;
        if (!pi?.hasNextPage) break;
        orderCursor = pi.endCursor;
      }
      // Aggregate by variant
      const velocityMap: Record<string, { totalSold: number; orderCount: number; lastSold: string }> = {};
      for (const item of allLineItems) {
        if (!velocityMap[item.variantId]) velocityMap[item.variantId] = { totalSold: 0, orderCount: 0, lastSold: '' };
        velocityMap[item.variantId].totalSold += item.quantity;
        velocityMap[item.variantId].orderCount++;
        if (!velocityMap[item.variantId].lastSold || item.date > velocityMap[item.variantId].lastSold) {
          velocityMap[item.variantId].lastSold = item.date;
        }
      }
      return res.status(200).json({ velocity: velocityMap, periodDays: 90, totalOrders: allLineItems.length });
    }

    return res.status(400).json({ error: 'Invalid action. Use: locations, inventory, search, adjust, updatePrice, salesVelocity' });
  } catch (error: any) {
    if (error.name === 'AbortError') return res.status(504).json({ error: 'Timeout' });
    return res.status(500).json({ error: 'Inventory API failed', details: error.message });
  }
}
