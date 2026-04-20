import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * QuickBooks Online API proxy — pulls A/P Ageing Summary, A/R balance, and customer credits.
 *
 * POST /api/quickbooks
 * Body: { action: 'ap-aging' | 'ar-balance' | 'customer-credits' | 'test-connection' | 'diagnose' }
 *
 * Credentials are resolved in order:
 *   1. Client-provided in request body (realmId, accessToken)
 *   2. Stored OAuth tokens in Supabase (from /api/qbo-auth flow)
 *   3. Raw env vars (QBO_REALM_ID, QBO_ACCESS_TOKEN)
 */

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const TOKEN_ROW_ID = 'qbo_tokens';

function envFirst(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return '';
}

async function getStoredTokens(): Promise<{ realmId: string; accessToken: string; refreshToken: string; updatedAt: string; expiresIn: number } | null> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/stash_qbo_tokens?id=eq.${TOKEN_ROW_ID}&select=*`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    if (!row.access_token || !row.realm_id) return null;
    return {
      realmId: row.realm_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token || '',
      updatedAt: row.updated_at || row.created_at || '',
      expiresIn: row.expires_in || 3600,
    };
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const clientId = process.env.QBO_CLIENT_ID?.trim();
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(QBO_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok || !data.access_token) return null;

    // Update stored tokens
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
    if (supabaseUrl && supabaseKey) {
      await fetch(`${supabaseUrl}/rest/v1/stash_qbo_tokens`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          id: TOKEN_ROW_ID,
          access_token: data.access_token,
          refresh_token: data.refresh_token || refreshToken,
          expires_in: data.expires_in || 3600,
          updated_at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }

    return {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string) || refreshToken,
      expiresIn: (data.expires_in as number) || 3600,
    };
  } catch {
    return null;
  }
}

async function resolveConfig(body: Record<string, unknown>) {
  // 1. Client-provided creds
  let realmId = (body.realmId as string)?.trim() || '';
  let accessToken = (body.accessToken as string)?.trim() || '';
  const baseUrl = ((body.baseUrl as string)?.trim() || envFirst('QBO_BASE_URL', 'QUICKBOOKS_BASE_URL', 'QB_BASE_URL') || 'https://quickbooks.api.intuit.com').replace(/\/$/, '');
  const minorVersion = (body.minorVersion as string)?.trim() || envFirst('QBO_MINOR_VERSION') || '75';

  if (realmId && accessToken) return { realmId, accessToken, baseUrl, minorVersion, source: 'client' as const };

  // 2. Stored OAuth tokens from Supabase
  const stored = await getStoredTokens();
  if (stored) {
    const updatedMs = new Date(stored.updatedAt).getTime();
    const isExpired = Date.now() > updatedMs + (stored.expiresIn * 1000) - 60000; // 1 min buffer

    if (isExpired && stored.refreshToken) {
      const refreshed = await refreshAccessToken(stored.refreshToken);
      if (refreshed) {
        return { realmId: stored.realmId, accessToken: refreshed.accessToken, baseUrl, minorVersion, source: 'oauth-refreshed' as const };
      }
    }

    if (!isExpired) {
      return { realmId: stored.realmId, accessToken: stored.accessToken, baseUrl, minorVersion, source: 'oauth' as const };
    }
  }

  // 3. Raw env vars
  realmId = envFirst('QBO_REALM_ID', 'QUICKBOOKS_REALM_ID', 'QB_REALM_ID');
  accessToken = envFirst('QBO_ACCESS_TOKEN', 'QUICKBOOKS_ACCESS_TOKEN', 'QB_ACCESS_TOKEN');
  if (realmId && accessToken) return { realmId, accessToken, baseUrl, minorVersion, source: 'env' as const };

  return { realmId, accessToken, baseUrl, minorVersion, source: 'none' as const };
}

function escapeQboString(value: string) {
  return value.replace(/'/g, "\\'");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const origin = req.headers.origin || '';
  if (origin === 'https://stashoverview.co.uk' || origin === 'https://www.stashoverview.co.uk' || origin === 'http://localhost:3000' || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = (req.body || {}) as Record<string, unknown>;
  const action = body.action as string;

  // Diagnostics endpoint — reports which env vars are detected (never exposes values)
  if (action === 'diagnose') {
    const config = await resolveConfig(body);
    const envVars = ['QBO_REALM_ID', 'QBO_ACCESS_TOKEN', 'QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_BASE_URL', 'SUPABASE_URL'];
    const detected: Record<string, boolean> = {};
    envVars.forEach(k => { detected[k] = !!(process.env[k]?.trim()); });
    const stored = await getStoredTokens();
    return res.json({
      hasRealmId: !!config.realmId,
      hasAccessToken: !!config.accessToken,
      source: config.source,
      hasStoredTokens: !!stored,
      storedTokenExpired: stored ? Date.now() > new Date(stored.updatedAt).getTime() + (stored.expiresIn * 1000) : null,
      envVarsDetected: detected,
      baseUrl: config.baseUrl,
    });
  }

  const config = await resolveConfig(body);

  if (!config.realmId || !config.accessToken) {
    return res.status(400).json({
      error: 'QuickBooks not connected. Use the "Connect to QuickBooks" button on the Financial Dashboard, or set QBO_REALM_ID and QBO_ACCESS_TOKEN as env vars.',
      hasRealmId: !!config.realmId,
      hasAccessToken: !!config.accessToken,
      source: config.source,
    });
  }

  const queryEndpoint = `${config.baseUrl}/v3/company/${encodeURIComponent(config.realmId)}/query?minorversion=${encodeURIComponent(config.minorVersion)}`;
  const authHeaders = {
    authorization: `Bearer ${config.accessToken}`,
    accept: 'application/json',
  };

  async function runQuery(sql: string) {
    const url = `${queryEndpoint}&query=${encodeURIComponent(sql)}`;
    const response = await fetch(url, { method: 'GET', headers: authHeaders, signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    if (!response.ok) return { ok: false as const, status: response.status, text };
    try {
      return { ok: true as const, data: JSON.parse(text) };
    } catch {
      return { ok: false as const, status: 502, text: 'Invalid JSON from QBO' };
    }
  }

  try {
    if (action === 'test-connection') {
      const result = await runQuery('SELECT Id FROM CompanyInfo');
      if (!result.ok) return res.status(result.status).json({ error: `QBO returned ${result.status}`, detail: result.text.slice(0, 500) });
      return res.json({ ok: true, status: 200 });
    }

    if (action === 'ap-aging') {
      const result = await runQuery("SELECT Id, VendorRef, TotalAmt, DueDate, TxnDate, Balance, EmailStatus FROM Bill WHERE Balance > '0' MAXRESULTS 1000");
      if (!result.ok) return res.status(result.status).json({ error: `QBO AP query failed (${result.status})`, detail: result.text.slice(0, 500) });

      const bills = (result.data?.QueryResponse?.Bill || []) as Record<string, unknown>[];

      const results = bills.map(bill => ({
        id: String(bill.Id ?? ''),
        vendorName: typeof bill.VendorRef === 'object' && bill.VendorRef !== null ? String((bill.VendorRef as any).name ?? '') : '',
        vendorId: typeof bill.VendorRef === 'object' && bill.VendorRef !== null ? String((bill.VendorRef as any).value ?? '') : '',
        totalAmount: typeof bill.TotalAmt === 'number' ? bill.TotalAmt : Number(bill.TotalAmt) || 0,
        balance: typeof bill.Balance === 'number' ? bill.Balance : Number(bill.Balance) || 0,
        dueDate: typeof bill.DueDate === 'string' ? bill.DueDate : null,
        txnDate: typeof bill.TxnDate === 'string' ? bill.TxnDate : null,
        emailStatus: typeof bill.EmailStatus === 'string' ? bill.EmailStatus : null,
      }));

      return res.json({ ok: true, bills: results, count: results.length });
    }

    if (action === 'ar-balance') {
      const result = await runQuery("SELECT Id, DocNumber, CustomerRef, TotalAmt, Balance, DueDate, TxnDate FROM Invoice WHERE Balance > '0' MAXRESULTS 1000");
      if (!result.ok) return res.status(result.status).json({ error: `QBO AR query failed (${result.status})`, detail: result.text.slice(0, 500) });

      const invoices = (result.data?.QueryResponse?.Invoice || []) as Record<string, unknown>[];

      const results = invoices.map(inv => ({
        id: String(inv.Id ?? ''),
        docNumber: typeof inv.DocNumber === 'string' ? inv.DocNumber : null,
        customerName: typeof inv.CustomerRef === 'object' && inv.CustomerRef !== null ? String((inv.CustomerRef as any).name ?? '') : '',
        customerId: typeof inv.CustomerRef === 'object' && inv.CustomerRef !== null ? String((inv.CustomerRef as any).value ?? '') : '',
        totalAmount: typeof inv.TotalAmt === 'number' ? inv.TotalAmt : Number(inv.TotalAmt) || 0,
        balance: typeof inv.Balance === 'number' ? inv.Balance : Number(inv.Balance) || 0,
        dueDate: typeof inv.DueDate === 'string' ? inv.DueDate : null,
        txnDate: typeof inv.TxnDate === 'string' ? inv.TxnDate : null,
      }));

      const totalOwed = results.reduce((s, inv) => s + inv.balance, 0);

      return res.json({ ok: true, invoices: results, count: results.length, totalOwed });
    }

    // Also support pulling customer credit balances (negative balances / overpayments)
    if (action === 'customer-credits') {
      const result = await runQuery("SELECT Id, DisplayName, Balance FROM Customer WHERE Balance < '0' MAXRESULTS 500");
      if (!result.ok) return res.status(result.status).json({ error: `QBO customer credits query failed (${result.status})`, detail: result.text.slice(0, 500) });

      const customers = (result.data?.QueryResponse?.Customer || []) as Record<string, unknown>[];

      const results = customers.map(c => ({
        id: String(c.Id ?? ''),
        name: typeof c.DisplayName === 'string' ? c.DisplayName : '',
        balance: typeof c.Balance === 'number' ? c.Balance : Number(c.Balance) || 0,
        creditAmount: Math.abs(typeof c.Balance === 'number' ? c.Balance : Number(c.Balance) || 0),
      }));

      const totalCredit = results.reduce((s, c) => s + c.creditAmount, 0);

      return res.json({ ok: true, customers: results, count: results.length, totalCredit });
    }

    return res.status(400).json({ error: `Unknown action: ${action}. Use 'ap-aging', 'ar-balance', 'customer-credits', or 'test-connection'.` });

  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'QuickBooks API call failed' });
  }
}
