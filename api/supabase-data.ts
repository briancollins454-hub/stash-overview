import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  // Only allow stash_ prefixed tables
  const tableName = path.split('?')[0];
  if (!tableName.startsWith('stash_') && tableName !== 'order_notes') {
    return res.status(403).json({ error: 'Only stash_ and order_notes tables are allowed' });
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
