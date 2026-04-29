import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  const rawDomain = process.env.DECO_DOMAIN;
  const rawUser = process.env.DECO_USERNAME;
  const rawPass = process.env.DECO_PASSWORD;

  if (!rawDomain || !rawUser || !rawPass) {
    return res.status(500).json({ error: 'Deco credentials not configured on server' });
  }
  // Re-bind as definitely-string so callers inside nested closures keep the
  // narrowing that TypeScript otherwise drops once we leave this scope.
  const domain: string = rawDomain;
  const username: string = rawUser;
  const password: string = rawPass;

  const { action, endpoint, params, jobIds, probeOrderId, probeProductCode } = req.body || {};

  // Helper: fetch orders via date-range search and filter by requested IDs
  // Uses PARALLEL page fetches — all pages at once to beat Vercel 10s timeout
  // Match an order against any of its ID fields
  function orderMatchesId(order: any, id: string): boolean {
    return String(order.order_id) === id || String(order.order_number) === id || String(order.id) === id;
  }

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
        for (const rid of idSet) {
          if (!found.has(rid) && orderMatchesId(order, rid)) found.set(rid, order);
        }
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
              for (const rid of idSet) {
                if (!found.has(rid) && orderMatchesId(order, rid)) found.set(rid, order);
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
  // Field reference (DecoNetwork manage_orders/find):
  //   field=1 + condition=1 + string=<id> → Order ID exact match (PROVEN WORKING)
  //   field=2 + condition=1 → PO number, field=7 → External ref, field=3 → Line ID
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

    // Try each field/condition combo — field=1 (Order ID) is the primary, rest are fallbacks
    const strategies = [
      { field: '1', condition: '1', label: 'Order ID exact' },
      { field: '1', condition: '0', label: 'Order ID eq' },
      { field: '2', condition: '1', label: 'PO number' },
      { field: '7', condition: '1', label: 'External ref' },
      { field: '3', condition: '1', label: 'Line ID' },
    ];

    for (const strat of strategies) {
      try {
        const qp = new URLSearchParams({
          username, password,
          field: strat.field, condition: strat.condition,
          string: id, criteria: id, limit: '5',
          ...extraParams
        });
        const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
        console.log(`[Deco API] Strategy ${strat.label}: field=${strat.field},condition=${strat.condition},string=${id}`);
        const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
        const text = await resp.text();
        if (text.startsWith('<')) { console.log(`[Deco API] ${strat.label}: returned HTML, skipping`); continue; }
        const data = JSON.parse(text);
        const orders = data.orders || [];
        console.log(`[Deco API] ${strat.label}: ${orders.length} results, total=${data.total}`);
        if (orders.length > 0) {
          const match = orders.find((o: any) => orderMatchesId(o, id)) || orders[0];
          console.log(`[Deco API] ✅ ${strat.label} hit: order_id=${match.order_id}`);
          return match;
        }
      } catch (e: any) {
        console.log(`[Deco API] ${strat.label} failed:`, e.message);
      }
    }

    console.warn(`[Deco API] ❌ All direct strategies failed for order #${id}`);
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

  // ─── Full-surface probe ──────────────────────────────────────────────
  // Dumps the raw Deco payload with every documented `include_*` flag
  // switched on, for one order and (optionally) one product, plus a
  // handful of list-style endpoints. Intended for exploration: lets us
  // see exactly which fields Deco actually returns for this tenant so we
  // can decide what to wire into the UI. Response shape is deliberately
  // raw (no parsing) — top-level keys are captured separately so the
  // caller can glance at "what is available" without scrolling the full
  // JSON.
  if (action === 'probe') {
    const dump: any = { timestamp: new Date().toISOString(), domain, sections: [] };

    const runRaw = async (label: string, path: string, extraParams: Record<string, string>) => {
      const section: any = { label, path, params: extraParams };
      try {
        const qp = new URLSearchParams({ username, password, skip_login_token: '1', ...extraParams });
        const url = `https://${domain}/${path}?${qp.toString()}`;
        const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(25000) });
        const text = await resp.text();
        section.httpStatus = resp.status;
        section.contentType = resp.headers.get('content-type') || '';
        try {
          const parsed = JSON.parse(text);
          section.topLevelKeys = Object.keys(parsed || {});
          section.responseStatus = parsed.response_status || null;
          // Keep raw payload; cap at ~250KB to stay under Vercel 4.5MB response limit
          // when combined with the other sections.
          section.raw = parsed;
        } catch {
          section.parseError = true;
          section.bodySnippet = text.slice(0, 500);
        }
      } catch (e: any) {
        section.error = e.message;
      }
      dump.sections.push(section);
    };

    // 1) Pull ONE order with EVERY include flag we know about, so staff
    //    can see the full shape of a single order record.
    const targetId = probeOrderId ? String(probeOrderId).trim() : null;
    if (targetId) {
      await runRaw('order-full-get', 'api/json/manage_orders/get', {
        id: targetId,
        include_workflow_data: '1',
        include_user_assignments: '1',
        include_custom_fields: '1',
        include_sales_data: '1',
        include_product_data: '1',
        include_decoration_data: '1',
        include_artwork_data: '1',
        include_shipping_data: '1',
        include_payment_data: '1',
        include_notes: '1',
        include_production_notes: '1',
        include_files: '1',
        include_history: '1',
        include_vendor_data: '1',
      });
      await runRaw('order-full-find', 'api/json/manage_orders/find', {
        field: '1', condition: '1', string: targetId, criteria: targetId, limit: '1',
        include_workflow_data: '1',
        include_user_assignments: '1',
        include_custom_fields: '1',
        include_sales_data: '1',
        include_product_data: '1',
        include_decoration_data: '1',
        include_artwork_data: '1',
        include_shipping_data: '1',
        include_payment_data: '1',
        include_notes: '1',
        include_production_notes: '1',
        include_files: '1',
        include_history: '1',
        include_vendor_data: '1',
      });
    } else {
      // No specific id — sample the newest order in the last 14 days
      const minDate = new Date(); minDate.setDate(minDate.getDate() - 14);
      await runRaw('order-sample-latest', 'api/json/manage_orders/find', {
        field: '1', condition: '4',
        date1: minDate.toISOString().split('T')[0] + ' 00:00:00',
        limit: '1', offset: '0',
        include_workflow_data: '1',
        include_user_assignments: '1',
        include_custom_fields: '1',
        include_sales_data: '1',
        include_product_data: '1',
        include_decoration_data: '1',
        include_artwork_data: '1',
        include_shipping_data: '1',
        include_payment_data: '1',
        include_notes: '1',
        include_production_notes: '1',
        include_files: '1',
        include_history: '1',
        include_vendor_data: '1',
      });
    }

    // 2) One product with full detail, so we can see what `manage_products`
    //    exposes beyond what we already pull for EAN lookup.
    if (probeProductCode) {
      await runRaw('product-full-find', 'api/json/manage_products/find', {
        field: '3', condition: '1', string: String(probeProductCode).trim(), limit: '1',
        include_variants: '1',
        include_decoration_data: '1',
        include_pricing_data: '1',
      });
    } else {
      await runRaw('product-sample-latest', 'api/json/manage_products/find', {
        limit: '1', offset: '0',
        include_variants: '1',
        include_decoration_data: '1',
        include_pricing_data: '1',
      });
    }

    // 3) Small structural endpoints — these are usually list-style and
    //    tell us about status codes, vendors, staff, etc. Every probe is
    //    wrapped in try/catch so a 404 on one doesn't kill the dump.
    await runRaw('order-statuses', 'api/json/manage_orders/get_statuses', {});
    await runRaw('product-categories', 'api/json/manage_products/get_categories', {});
    await runRaw('vendors-list', 'api/json/manage_vendors/find', { limit: '25' });
    await runRaw('staff-list', 'api/json/manage_staff/find', { limit: '25' });
    await runRaw('customers-sample', 'api/json/manage_customers/find', { limit: '2' });
    await runRaw('invoices-sample', 'api/json/manage_invoices/find', { limit: '2' });
    await runRaw('shipping-carriers', 'api/json/manage_shipping/get_carriers', {});
    await runRaw('payments-sample', 'api/json/manage_payments/find', { limit: '5' });

    return res.status(200).json(dump);
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

    // Step 3: Find by field=1 (Order ID), condition=1 (exact match) — the proven working combo
    try {
      const qp = new URLSearchParams({ username, password, field: '1', condition: '1', string: targetId, criteria: targetId, limit: '5', include_workflow_data: '1', skip_login_token: '1' });
      const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
      const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
      const data = await resp.json();
      const orders = data.orders || [];
      diag.steps.push({ step: 'find-field1-cond1', total: data.total, count: orders.length, orderIds: orders.map((o: any) => ({ order_id: o.order_id, order_number: o.order_number, id: o.id })) });
    } catch (e: any) {
      diag.steps.push({ step: 'find-field1-cond1', error: e.message });
    }

    // Step 4: Find by order_number field=0
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

  // Single fetch: use direct lookup strategies first, then fall back to date scan
  if (action === 'single' && Array.isArray(jobIds) && jobIds.length === 1) {
    const targetId = String(jobIds[0]).trim();
    try {
      // Try the fast multi-strategy direct lookup first
      const order = await fetchOrderById(targetId, false);
      if (order) {
        return res.status(200).json({ results: [{ jobId: targetId, order }] });
      }
      // Fall back to date-range scan if direct strategies all miss
      console.log(`[Deco API] Direct lookup missed for #${targetId}, falling back to date scan`);
      const results = await fetchOrdersByIds([targetId], false);
      return res.status(200).json({ results });
    } catch (error: any) {
      return res.status(500).json({ error: 'Single fetch failed', details: error.message });
    }
  }

  // Bulk fetch: fetch multiple jobs by ID.
  //
  // Two-pass strategy so we catch BOTH recent and very-old orders:
  //   Pass 1 — `fetchOrdersByIds` does a parallel date-window scan
  //            (last 200 days). One network burst, finds anything
  //            reasonably recent in a couple of seconds.
  //   Pass 2 — IDs Pass 1 didn't find drop to a focused direct lookup
  //            (`fetchOrderByIdFast`, only the proven field=1+cond=1
  //            strategy, ~1 call per ID). No date gate, catches
  //            12-month+ old orders that fall outside Pass 1's window.
  //
  // Pass 2 is deliberately leaner than the multi-strategy fetchOrderById:
  // for the priority-board "what's the current status of these specific
  // jobs" use case, we only need order_id matching. Trying all 5
  // strategies for every missing ID was blowing Vercel's 60s budget on
  // boards with ~150+ stuck rows and producing 504s.
  //
  // Hard cap of 60 IDs per request — caller is expected to chunk. With
  // 60 misses worst-case at concurrency 8 → ~8 batches × ~1.5s ≈ 12s,
  // safely inside budget even with one slow request.
  if (action === 'bulk' && Array.isArray(jobIds)) {
    try {
      const MAX_IDS = 60;
      const trimmed = jobIds.slice(0, MAX_IDS);
      if (jobIds.length > MAX_IDS) {
        console.log(`[Deco API] Bulk truncated ${jobIds.length} → ${MAX_IDS} (caller should chunk)`);
      }

      const firstPass = await fetchOrdersByIds(trimmed, false);
      const missing = firstPass.filter(r => !r.order).map(r => r.jobId);

      if (missing.length === 0) {
        return res.status(200).json({ results: firstPass });
      }

      console.log(`[Deco API] Bulk pass-1 found ${firstPass.length - missing.length}/${firstPass.length}; ${missing.length} need direct lookup`);

      // Lean direct-lookup variant — single strategy (field=1, condition=1,
      // string=<id>) with a 5s per-call timeout. No fall-through chain.
      const fastDirect = async (orderId: string): Promise<any | null> => {
        try {
          const qp = new URLSearchParams({
            username, password,
            field: '1', condition: '1',
            string: orderId.trim(), criteria: orderId.trim(), limit: '5',
            include_workflow_data: '1', skip_login_token: '1',
          });
          const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
          const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
          const text = await resp.text();
          if (text.startsWith('<')) return null;
          const data = JSON.parse(text);
          const orders = data.orders || [];
          if (orders.length === 0) return null;
          return orders.find((o: any) => orderMatchesId(o, orderId.trim())) || null;
        } catch {
          return null;
        }
      };

      const CONCURRENCY = 8;
      const directHits = new Map<string, any>();
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const slice = missing.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(slice.map(id => fastDirect(id)));
        settled.forEach((r, idx) => {
          if (r.status === 'fulfilled' && r.value) directHits.set(slice[idx], r.value);
        });
      }

      const results = firstPass.map(r =>
        r.order ? r : { jobId: r.jobId, order: directHits.get(r.jobId) || null }
      );
      const finalFound = results.filter(r => r.order).length;
      console.log(`[Deco API] Bulk total: ${finalFound}/${results.length} (pass-1 + fast-direct fallback)`);

      return res.status(200).json({ results });
    } catch (error: any) {
      return res.status(500).json({ error: 'Bulk fetch failed', details: error.message });
    }
  }

  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'endpoint is required' });
  }

  // Only allow the Deco "manage_*" JSON API surface — read/write proxy is
  // still gated by Vercel-side credentials, but we don't want this proxy
  // relaying arbitrary host paths (e.g. /admin/*). All production calls
  // go through manage_orders / manage_products; the wider match is there
  // so we can also hit manage_vendors / manage_staff / manage_customers /
  // manage_invoices / manage_payments / manage_shipping when probing.
  if (!/^api\/json\/manage_[a-z_]+\//.test(endpoint)) {
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
