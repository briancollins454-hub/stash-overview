import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const domain = process.env.SHOPIFY_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return res.status(500).json({ error: 'Shopify credentials not configured on server' });
  }

  const { action, query, variables, restPath, restMethod, restBody } = req.body || {};

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000);

    let response: globalThis.Response;

    if (action === 'rest' && restPath) {
      // REST API call (e.g. fulfillment, events)
      const url = `https://${domain}${restPath}`;
      const fetchOpts: RequestInit = {
        method: restMethod || 'GET',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };
      if (restBody && restMethod && restMethod.toUpperCase() !== 'GET') {
        fetchOpts.body = typeof restBody === 'string' ? restBody : JSON.stringify(restBody);
      }
      response = await fetch(url, fetchOpts);
    } else {
      // GraphQL (default)
      if (!query) {
        clearTimeout(timeoutId);
        return res.status(400).json({ error: 'query is required for GraphQL calls' });
      }
      const endpoint = `https://${domain}/admin/api/2025-01/graphql.json`;
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);
    const data = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    return res.send(data);
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Shopify API timeout' });
    }
    return res.status(500).json({ error: 'Shopify API failed', details: error.message });
  }
}
