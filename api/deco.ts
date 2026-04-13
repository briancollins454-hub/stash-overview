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

  // Helper: fetch orders via date-range search and filter by requested IDs
  // Uses PARALLEL page fetches — all pages at once to beat Vercel 10s timeout
  async function fetchOrdersByIds(requestedIds: string[], includeDecoration: boolean): Promise<{jobId: string, order: any}[]> {
    const idSet = new Set(requestedIds.map(id => String(id).trim()));
    const found = new Map<string, any>();
    const lookbackDays = 200;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - lookbackDays);
    const dateStr = minDate.toISOString().split('T')[0] + ' 00:00:00';
    const BATCH = 200;

    const buildUrl = (limit: number, offset: number): string => {
      const qp = new URLSearchParams();
      qp.append('username', username);
      qp.append('password', password);
      qp.append('field', '1');
      qp.append('condition', '4');
      qp.append('date1', dateStr);
      qp.append('limit', limit.toString());
      qp.append('offset', offset.toString());
      qp.append('include_workflow_data', '1');
      qp.append('skip_login_token', '1');
      if (includeDecoration) {
        qp.append('include_product_data', '1');
        qp.append('include_decoration_data', '1');
        qp.append('include_artwork_data', '1');
      }
      return `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
    };

    // Step 1: Get total count with a tiny request
    let total = 0;
    try {
      const resp = await fetch(buildUrl(1, 0), { method: 'GET', signal: AbortSignal.timeout(8000) });
      const data = await resp.json();
      total = data.total || 0;
      for (const order of (data.orders || [])) {
        const oid = String(order.order_id);
        if (idSet.has(oid)) found.set(oid, order);
      }
      console.log(`[Deco API] Total orders in ${lookbackDays}-day window: ${total}`);
    } catch (e: any) {
      console.error(`[Deco API] Failed to get total:`, e.message);
      return requestedIds.map(id => ({ jobId: id, order: null }));
    }

    if (found.size >= idSet.size) return requestedIds.map(id => ({ jobId: id, order: found.get(String(id).trim()) || null }));

    // Step 2: Fire ALL page requests in PARALLEL — one network round-trip
    const offsets: number[] = [];
    for (let o = 0; o < total; o += BATCH) {
      offsets.push(o);
    }
    console.log(`[Deco API] Launching ${offsets.length} parallel page fetches for ${total} orders`);

    const pageResults = await Promise.allSettled(
      offsets.map(offset =>
        fetch(buildUrl(BATCH, offset), { method: 'GET', signal: AbortSignal.timeout(50000) })
          .then(r => r.json())
          .then(data => {
            const orders = data.orders || [];
            for (const order of orders) {
              const oid = String(order.order_id);
              if (idSet.has(oid) && !found.has(oid)) {
                found.set(oid, order);
              }
            }
            return orders.length;
          })
      )
    );

    const succeeded = pageResults.filter(r => r.status === 'fulfilled').length;
    const failed = pageResults.filter(r => r.status === 'rejected').length;
    console.log(`[Deco API] Parallel scan done: ${succeeded} pages OK, ${failed} failed, found ${found.size}/${idSet.size}`);

    return requestedIds.map(id => ({
      jobId: id,
      order: found.get(String(id).trim()) || null
    }));
  }

  // Direct lookup: try multiple strategies to find a single order by ID
  async function fetchOrderById(orderId: string, includeDecoration: boolean): Promise<any | null> {
    const id = String(orderId).trim();
    console.log(`[Deco API] Direct lookup for order #${id}`);
    
    const extraParams: Record<string, string> = {
      include_workflow_data: '1',
      skip_login_token: '1',
    };
    if (includeDecoration) {
      extraParams.include_product_data = '1';
      extraParams.include_decoration_data = '1';
      extraParams.include_artwork_data = '1';
    }

    // Strategy 1: manage_orders/get?id=<orderId> (direct get)
    try {
      const qp = new URLSearchParams({ username, password, id, ...extraParams });
      const url = `https://${domain}/api/json/manage_orders/get?${qp.toString()}`;
      console.log(`[Deco API] Strategy 1: manage_orders/get?id=${id}`);
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
      const data = await resp.json();
      if (data && data.order_id) {
        console.log(`[Deco API] ✅ Strategy 1 hit: order_id=${data.order_id}`);
        return data;
      }
      if (data?.order && data.order.order_id) {
        console.log(`[Deco API] ✅ Strategy 1 hit (nested): order_id=${data.order.order_id}`);
        return data.order;
      }
      console.log(`[Deco API] Strategy 1 response:`, JSON.stringify(data).slice(0, 300));
    } catch (e: any) {
      console.log(`[Deco API] Strategy 1 failed:`, e.message);
    }

    // Strategy 2: manage_orders/find with field=0 (order number), condition=0 (equals)
    try {
      const qp = new URLSearchParams({ username, password, field: '0', condition: '0', string: id, criteria: id, limit: '5', ...extraParams });
      const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
      console.log(`[Deco API] Strategy 2: find field=0,condition=0,string=${id}`);
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
      const data = await resp.json();
      const orders = data.orders || [];
      console.log(`[Deco API] Strategy 2: ${orders.length} results, total=${data.total}`);
      const match = orders.find((o: any) => String(o.order_id) === id);
      if (match) { console.log(`[Deco API] ✅ Strategy 2 hit`); return match; }
    } catch (e: any) {
      console.log(`[Deco API] Strategy 2 failed:`, e.message);
    }

    // Strategy 3: manage_orders/find with field=6 (order ID field variant), condition=0
    try {
      const qp = new URLSearchParams({ username, password, field: '6', condition: '0', string: id, criteria: id, limit: '5', ...extraParams });
      const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
      console.log(`[Deco API] Strategy 3: find field=6,condition=0,string=${id}`);
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
      const data = await resp.json();
      const orders = data.orders || [];
      console.log(`[Deco API] Strategy 3: ${orders.length} results, total=${data.total}`);
      const match = orders.find((o: any) => String(o.order_id) === id);
      if (match) { console.log(`[Deco API] ✅ Strategy 3 hit`); return match; }
    } catch (e: any) {
      console.log(`[Deco API] Strategy 3 failed:`, e.message);
    }

    // Strategy 4: manage_orders/find with field=0, condition=2 (contains) — looser match
    try {
      const qp = new URLSearchParams({ username, password, field: '0', condition: '2', string: id, criteria: id, limit: '5', ...extraParams });
      const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
      console.log(`[Deco API] Strategy 4: find field=0,condition=2 (contains),string=${id}`);
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
      const data = await resp.json();
      const orders = data.orders || [];
      console.log(`[Deco API] Strategy 4: ${orders.length} results, total=${data.total}`);
      const match = orders.find((o: any) => String(o.order_id) === id);
      if (match) { console.log(`[Deco API] ✅ Strategy 4 hit`); return match; }
    } catch (e: any) {
      console.log(`[Deco API] Strategy 4 failed:`, e.message);
    }

    console.warn(`[Deco API] ❌ All strategies failed for order #${id}`);
    return null;
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

  // Diagnostic: show exactly what the Deco API returns for a given ID
  if (action === 'diagnose' && jobIds?.length === 1) {
    const targetId = String(jobIds[0]).trim();
    const diag: any = { targetId, steps: [], timestamp: new Date().toISOString() };
    
    // Step 1: Single-page date-scan — what order_ids come back?
    try {
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - 200);
      const dateStr = minDate.toISOString().split('T')[0] + ' 00:00:00';
      const qp = new URLSearchParams({ username, password, field: '1', condition: '4', date1: dateStr, limit: '20', offset: '0', include_workflow_data: '1', skip_login_token: '1' });
      const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
      const data = await resp.json();
      const orders = data.orders || [];
      const sampleIds = orders.slice(0, 20).map((o: any) => ({
        order_id: o.order_id,
        order_number: o.order_number,
        id: o.id,
        name: (o.billing_name || o.company_name || '').slice(0, 30),
        date: o.order_date || o.created_date,
      }));
      diag.steps.push({ step: 'date-scan-page1', total: data.total, count: orders.length, sampleOrders: sampleIds });
      // Check if target is in this batch
      const targetInBatch = orders.find((o: any) => 
        String(o.order_id) === targetId || String(o.order_number) === targetId || String(o.id) === targetId
      );
      if (targetInBatch) {
        diag.steps.push({ step: 'FOUND_IN_BATCH', matchedField: String(targetInBatch.order_id) === targetId ? 'order_id' : String(targetInBatch.order_number) === targetId ? 'order_number' : 'id' });
      }
    } catch (e: any) {
      diag.steps.push({ step: 'date-scan-page1', error: e.message });
    }

    // Step 2: Direct get
    try {
      const qp = new URLSearchParams({ username, password, id: targetId, include_workflow_data: '1', skip_login_token: '1' });
      const url = `https://${domain}/api/json/manage_orders/get?${qp.toString()}`;
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
      const data = await resp.json();
      diag.steps.push({ step: 'direct-get', hasOrderId: !!data?.order_id, hasNestedOrder: !!data?.order?.order_id, keys: Object.keys(data || {}).slice(0, 15), snippet: JSON.stringify(data).slice(0, 500) });
    } catch (e: any) {
      diag.steps.push({ step: 'direct-get', error: e.message });
    }

    // Step 3: Find by order_number field=0
    try {
      const qp = new URLSearchParams({ username, password, field: '0', condition: '0', string: targetId, criteria: targetId, limit: '5', include_workflow_data: '1', skip_login_token: '1' });
      const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
      const data = await resp.json();
      const orders = data.orders || [];
      diag.steps.push({ step: 'find-field0', total: data.total, count: orders.length, orderIds: orders.map((o: any) => ({ order_id: o.order_id, order_number: o.order_number, id: o.id })) });
    } catch (e: any) {
      diag.steps.push({ step: 'find-field0', error: e.message });
    }

    return res.status(200).json(diag);
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
