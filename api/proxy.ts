import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_PROXY_DOMAINS = [
  '.myshopify.com',
  '.shopify.com',
  '.secure-decoration.com',
  '.supabase.co',
  'hooks.slack.com',
];

const isAllowedProxyTarget = (targetUrl: string): boolean => {
  try {
    const parsed = new URL(targetUrl);
    return ALLOWED_PROXY_DOMAINS.some(domain => parsed.hostname.endsWith(domain));
  } catch {
    return false;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, method, headers, body } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!isAllowedProxyTarget(url)) {
    return res.status(403).json({ error: 'Target domain is not allowed' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s (Vercel limit is 60s)

    const fetchOptions: RequestInit = {
      method: method || 'GET',
      headers: headers || {},
      signal: controller.signal,
    };

    if (body && !['GET', 'HEAD'].includes((fetchOptions.method || '').toUpperCase())) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');
    const data = await response.text();

    res.status(response.status);
    if (contentType) res.setHeader('Content-Type', contentType);
    return res.send(data);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Proxy timeout' });
    }
    return res.status(500).json({ error: 'Proxy failed', details: error.message });
  }
}
