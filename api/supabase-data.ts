import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials not configured on server' });
  }

  const { path, method, body, prefer } = req.body || {};

  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path is required' });
  }

  // Only allow known stash_ table names (no query params in table name)
  const tableName = path.split('?')[0];
  const ALLOWED_TABLES = ['stash_orders', 'stash_mappings', 'stash_stock', 'stash_returns', 'stash_reference_products', 'stash_links', 'stash_product_mappings', 'order_notes'];
  if (!ALLOWED_TABLES.includes(tableName)) {
    return res.status(403).json({ error: 'Table not allowed' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    const headers: Record<string, string> = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    };

    if (prefer) {
      headers['Prefer'] = prefer;
    }

    const reqMethod = (method || 'GET').toUpperCase();
    const fetchOptions: RequestInit = {
      method: reqMethod,
      headers,
      signal: controller.signal,
    };

    if (body && !['GET', 'HEAD'].includes(reqMethod)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const url = `${supabaseUrl}/rest/v1/${path}`;
    const response = await fetch(url, fetchOptions);

    clearTimeout(timeoutId);
    const data = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.send(data);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Supabase API timeout' });
    }
    return res.status(500).json({ error: 'Supabase API failed', details: error.message });
  }
}
