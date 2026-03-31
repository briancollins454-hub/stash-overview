import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, auth } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Only allow ShipStation API
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('shipstation.com')) {
      return res.status(403).json({ error: 'Only ShipStation API URLs are allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!auth || typeof auth !== 'string') {
    return res.status(400).json({ error: 'Auth is required' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(data);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'ShipStation API timeout' });
    }
    return res.status(500).json({ error: 'ShipStation API failed', details: error.message });
  }
}
