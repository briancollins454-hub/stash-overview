import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const domain = process.env.DECO_DOMAIN;
  const username = process.env.DECO_USERNAME;
  const password = process.env.DECO_PASSWORD;

  if (!domain || !username || !password) {
    return res.status(500).json({ error: 'Deco credentials not configured on server' });
  }

  const { action, endpoint, params, jobIds } = req.body || {};

  // Helper: fetch all orders via date-range pagination and filter by requested IDs
  async function fetchOrdersByIds(requestedIds: string[], includeDecoration: boolean): Promise<{jobId: string, order: any}[]> {
    const idSet = new Set(requestedIds.map(id => String(id).trim()));
    const found = new Map<string, any>();
    const lookbackDays = 200;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - lookbackDays);
    const dateStr = minDate.toISOString().split('T')[0] + ' 00:00:00';

    console.log(`[Deco API] fetchOrdersByIds called`, { requestedIds, lookbackDays, dateStr, includeDecoration });

    let offset = 0;
    const BATCH = 100;
    const MAX = 800;
    let totalScanned = 0;
    let apiTotal = 0;

    while (offset < MAX) {
      try {
        const qp = new URLSearchParams();
        qp.append('username', username);
        qp.append('password', password);
        qp.append('field', '1');
        qp.append('condition', '4');
        qp.append('date1', dateStr);
        qp.append('limit', BATCH.toString());
        qp.append('offset', offset.toString());
        qp.append('include_workflow_data', '1');
        qp.append('skip_login_token', '1');
        if (includeDecoration) {
          qp.append('include_product_data', '1');
          qp.append('include_decoration_data', '1');
          qp.append('include_artwork_data', '1');
        }
        const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
        const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
        const data = await resp.json();
        const orders = data.orders || [];
        totalScanned += orders.length;
        apiTotal = data.total || apiTotal;

        console.log(`[Deco API] Batch offset=${offset}: ${orders.length} orders, total=${data.total}, found so far=${found.size}/${idSet.size}`);
        if (orders.length > 0) {
          const sampleIds = orders.slice(0, 5).map((o: any) => o.order_id);
          console.log(`[Deco API] Sample order_ids in batch:`, sampleIds);
        }

        for (const order of orders) {
          const oid = String(order.order_id);
          if (idSet.has(oid) && !found.has(oid)) {
            found.set(oid, order);
          }
        }

        // Stop if we found all requested IDs or no more results
        if (found.size >= idSet.size) { console.log(`[Deco API] ✅ All IDs found`); break; }
        if (orders.length < BATCH || offset + orders.length >= (data.total || 0)) { console.log(`[Deco API] End of results: batch=${orders.length}, offset=${offset}, total=${data.total}`); break; }
        offset += orders.length;
      } catch {
        break;
      }
    }

    console.log(`[Deco API] Search complete: scanned ${totalScanned}/${apiTotal} orders in ${offset / BATCH + 1} batches, found ${found.size}/${idSet.size}`);
    if (found.size < idSet.size) {
      const missing = requestedIds.filter(id => !found.has(String(id).trim()));
      console.warn(`[Deco API] ❌ Missing IDs:`, missing, `(lookback: ${lookbackDays} days, maxOffset: ${MAX})`);
    }

    return requestedIds.map(id => ({
      jobId: id,
      order: found.get(String(id).trim()) || null
    }));
  }

  // Stitch enrichment: fetch jobs with full artwork/decoration data
  if (action === 'enrich_stitch' && Array.isArray(jobIds)) {
    try {
      const results = await fetchOrdersByIds(jobIds, true);
      return res.status(200).json({ results });
    } catch (error: any) {
      return res.status(500).json({ error: 'Stitch enrichment failed', details: error.message });
    }
  }

  // Bulk fetch: fetch multiple jobs by ID
  if (action === 'bulk' && Array.isArray(jobIds)) {
    try {
      const results = await fetchOrdersByIds(jobIds, false);
      return res.status(200).json({ results });
    } catch (error: any) {
      return res.status(500).json({ error: 'Bulk fetch failed', details: error.message });
    }
  }

  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'endpoint is required' });
  }

  // Only allow safe Deco API paths
  if (!endpoint.startsWith('api/json/manage_orders/') && !endpoint.startsWith('api/json/manage_products/')) {
    return res.status(403).json({ error: 'API endpoint not allowed' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    const queryParams = new URLSearchParams();
    queryParams.append('username', username);
    queryParams.append('password', password);
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([key, value]) => {
        queryParams.append(key, String(value));
      });
    }

    const url = `https://${domain}/${endpoint}?${queryParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.send(data);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Deco API timeout' });
    }
    return res.status(500).json({ error: 'Deco API failed', details: error.message });
  }
}
