import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;

  // Fall back to client-provided auth if env vars not set
  const { url, auth: clientAuth, method: reqMethod, body: reqBody } = req.body || {};

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

  // Use server-side credentials if available, otherwise client-provided
  let authHeader: string;
  if (apiKey && apiSecret) {
    authHeader = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  } else if (clientAuth && typeof clientAuth === 'string') {
    authHeader = clientAuth;
  } else {
    return res.status(500).json({ error: 'ShipStation credentials not configured' });
  }

  const fetchMethod = (reqMethod || 'GET').toUpperCase();
  const allowedMethods = ['GET', 'POST', 'PUT'];
  if (!allowedMethods.includes(fetchMethod)) {
    return res.status(400).json({ error: `Method ${fetchMethod} not allowed` });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    const fetchOptions: RequestInit = {
      method: fetchMethod,
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    };

    if (fetchMethod !== 'GET' && reqBody) {
      fetchOptions.body = JSON.stringify(reqBody);
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || '';

    // Label endpoints return PDF binary
    if (contentType.includes('application/pdf') || url.includes('label')) {
      const buffer = await response.arrayBuffer();
      res.status(response.status);
      res.setHeader('Content-Type', contentType || 'application/pdf');
      return res.send(Buffer.from(buffer));
    }

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
