import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  fetchOrderByQuery,
  labelPrinterCorsAllowed,
  mapOrderToJob,
} from '../utils/labelPrinter.js';

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (labelPrinterCorsAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const domain = process.env.DECO_DOMAIN?.trim();
  const username = process.env.DECO_USERNAME?.trim();
  const password = process.env.DECO_PASSWORD?.trim();
  if (!domain || !username || !password) {
    return res.status(500).json({ error: 'Deco credentials not configured on server' });
  }

  const query = String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    const order = await fetchOrderByQuery(domain, username, password, query);
    if (!order) return res.status(200).json({ job: null });
    return res.status(200).json({ job: mapOrderToJob(order) });
  } catch (e: any) {
    console.error('[label-printer] lookup failed:', e.message);
    return res.status(502).json({ error: 'Failed to reach Deco API' });
  }
}
