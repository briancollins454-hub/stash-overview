import type { VercelRequest, VercelResponse } from '@vercel/node';
import { defaultInvoiceConfig, normalizeInvoiceConfig, type InvoiceConfig } from '../utils/invoiceSettings.js';

const CONFIG_ROW_ID = 'invoice_config';

function cors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (
    origin === 'https://stashoverview.co.uk'
    || origin === 'https://www.stashoverview.co.uk'
    || origin === 'http://localhost:3000'
    || (origin.endsWith('.vercel.app') && origin.includes('stash-overview'))
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-Id-Token');
}

function supabaseCreds() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (
    process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const creds = supabaseCreds();
  if (!creds) return res.status(500).json({ error: 'Supabase not configured' });
  const { url, key } = creds;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const body = (req.body || {}) as Record<string, unknown>;
  const action = body.action as string;

  try {
    if (action === 'get-config') {
      const r = await fetch(
        `${url}/rest/v1/stash_invoice_settings?id=eq.${CONFIG_ROW_ID}&select=data`,
        { headers, signal: AbortSignal.timeout(8000) },
      );
      const rows = r.ok ? await r.json() : [];
      const data = Array.isArray(rows) && rows.length > 0 ? rows[0].data : null;
      return res.status(200).json({ ok: true, config: normalizeInvoiceConfig(data) });
    }

    if (action === 'save-config') {
      const config: InvoiceConfig = normalizeInvoiceConfig(body.config);
      const updatedBy = typeof body.updatedBy === 'string' ? body.updatedBy : null;
      const r = await fetch(`${url}/rest/v1/stash_invoice_settings`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: CONFIG_ROW_ID,
          data: config,
          updated_at: new Date().toISOString(),
          updated_by: updatedBy,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(500).json({ error: `Save failed (${r.status})`, detail: text.slice(0, 300) });
      }
      return res.status(200).json({ ok: true, config });
    }

    return res.status(400).json({ error: 'Unknown action', known: ['get-config', 'save-config'] });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
}
