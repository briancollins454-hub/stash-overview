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

  // Stitch enrichment: fetch individual jobs with full artwork/decoration data
  if (action === 'enrich_stitch' && Array.isArray(jobIds)) {
    try {
      const PARALLEL = 5;
      const allResults: any[] = [];
      
      for (let i = 0; i < jobIds.length; i += PARALLEL) {
        const batch = jobIds.slice(i, i + PARALLEL);
        const promises = batch.map(async (jobId: string) => {
          try {
            const qp = new URLSearchParams();
            qp.append('username', username);
            qp.append('password', password);
            qp.append('field', '1');
            qp.append('condition', '1');
            qp.append('string', String(jobId).trim());
            qp.append('limit', '1');
            qp.append('include_workflow_data', '1');
            qp.append('include_product_data', '1');
            qp.append('include_decoration_data', '1');
            qp.append('include_artwork_data', '1');
            qp.append('skip_login_token', '1');
            const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
            const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
            const data = await resp.json();
            const order = data.orders?.[0];
            if (order) return { jobId, order };
          } catch { }
          return { jobId, order: null };
        });
        const results = await Promise.all(promises);
        allResults.push(...results);
      }
      
      return res.status(200).json({ results: allResults });
    } catch (error: any) {
      return res.status(500).json({ error: 'Stitch enrichment failed', details: error.message });
    }
  }

  // Bulk fetch: fetch multiple jobs by ID in parallel on the server
  if (action === 'bulk' && Array.isArray(jobIds)) {
    try {
      const PARALLEL = 10;
      const allResults: any[] = [];
      
      for (let i = 0; i < jobIds.length; i += PARALLEL) {
        const batch = jobIds.slice(i, i + PARALLEL);
        const promises = batch.map(async (jobId: string) => {
          const fields = ['1', '2', '7'];
          for (const field of fields) {
            try {
              const qp = new URLSearchParams();
              qp.append('username', username);
              qp.append('password', password);
              qp.append('field', field);
              qp.append('condition', '1');
              qp.append('string', String(jobId).trim());
              qp.append('criteria', String(jobId).trim());
              qp.append('limit', '1');
              qp.append('include_workflow_data', '1');
              qp.append('skip_login_token', '1');
              const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
              const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) });
              const data = await resp.json();
              const order = data.orders?.[0];
              if (order) return { jobId, order };
            } catch { }
          }
          return { jobId, order: null };
        });
        const results = await Promise.all(promises);
        allResults.push(...results);
      }
      
      return res.status(200).json({ results: allResults });
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
