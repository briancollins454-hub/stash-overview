import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * QuickBooks Online API proxy — pulls A/P Ageing Summary and A/R balance data.
 *
 * POST /api/quickbooks
 * Body: { action: 'ap-aging' | 'ar-balance' | 'test-connection', realmId, accessToken, baseUrl?, minorVersion? }
 *
 * We proxy through our server to keep OAuth tokens off the client.
 * Supports passing credentials from client (stored in settings) or env vars.
 */

function envFirst(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return '';
}

function getConfig(body: Record<string, unknown>) {
  const realmId = (body.realmId as string)?.trim() || envFirst('QBO_REALM_ID', 'QUICKBOOKS_REALM_ID', 'QB_REALM_ID');
  const accessToken = (body.accessToken as string)?.trim() || envFirst('QBO_ACCESS_TOKEN', 'QUICKBOOKS_ACCESS_TOKEN', 'QB_ACCESS_TOKEN');
  const baseUrl = ((body.baseUrl as string)?.trim() || envFirst('QBO_BASE_URL', 'QUICKBOOKS_BASE_URL', 'QB_BASE_URL') || 'https://quickbooks.api.intuit.com').replace(/\/$/, '');
  const minorVersion = (body.minorVersion as string)?.trim() || envFirst('QBO_MINOR_VERSION') || '75';
  return { realmId, accessToken, baseUrl, minorVersion };
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
  const config = getConfig(body);

  // Diagnostics endpoint — reports which env vars are detected (never exposes values)
  if (action === 'diagnose') {
    const envVars = ['QBO_REALM_ID', 'QUICKBOOKS_REALM_ID', 'QB_REALM_ID', 'QBO_ACCESS_TOKEN', 'QUICKBOOKS_ACCESS_TOKEN', 'QB_ACCESS_TOKEN', 'QBO_BASE_URL'];
    const detected: Record<string, boolean> = {};
    envVars.forEach(k => { detected[k] = !!(process.env[k]?.trim()); });
    return res.json({
      hasRealmId: !!config.realmId,
      hasAccessToken: !!config.accessToken,
      envVarsDetected: detected,
      baseUrl: config.baseUrl,
    });
  }

  if (!config.realmId || !config.accessToken) {
    return res.status(400).json({
      error: 'QuickBooks credentials not configured. Set QBO_REALM_ID and QBO_ACCESS_TOKEN in environment variables.',
      hasRealmId: !!config.realmId,
      hasAccessToken: !!config.accessToken,
    });
  }

  const endpoint = `${config.baseUrl}/v3/company/${encodeURIComponent(config.realmId)}/query?minorversion=${encodeURIComponent(config.minorVersion)}`;
  const headers = {
    authorization: `Bearer ${config.accessToken}`,
    accept: 'application/json',
    'content-type': 'text/plain',
  };

  try {
    if (action === 'test-connection') {
      // Simple query to verify connection
      const query = 'select Id from CompanyInfo';
      const response = await fetch(endpoint, { method: 'POST', headers, body: query, signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      if (!response.ok) return res.status(response.status).json({ error: `QBO returned ${response.status}`, detail: text.slice(0, 500) });
      return res.json({ ok: true, status: response.status });
    }

    if (action === 'ap-aging') {
      // Pull all unpaid bills (accounts payable) — grouped by vendor with aging
      const query = `select Id, VendorRef, TotalAmt, DueDate, TxnDate, Balance, MetaData from Bill where Balance > '0' order by DueDate asc maxresults 1000`;
      const response = await fetch(endpoint, { method: 'POST', headers, body: query, signal: AbortSignal.timeout(30000) });
      const text = await response.text();
      if (!response.ok) return res.status(response.status).json({ error: `QBO AP query failed (${response.status})`, detail: text.slice(0, 500) });

      let data: unknown;
      try { data = JSON.parse(text); } catch { return res.status(502).json({ error: 'Invalid JSON from QBO' }); }

      const bills = ((data as any)?.QueryResponse?.Bill || []) as Record<string, unknown>[];

      const results = bills.map(bill => ({
        id: String(bill.Id ?? ''),
        vendorName: typeof bill.VendorRef === 'object' && bill.VendorRef !== null ? String((bill.VendorRef as any).name ?? '') : '',
        vendorId: typeof bill.VendorRef === 'object' && bill.VendorRef !== null ? String((bill.VendorRef as any).value ?? '') : '',
        totalAmount: typeof bill.TotalAmt === 'number' ? bill.TotalAmt : Number(bill.TotalAmt) || 0,
        balance: typeof bill.Balance === 'number' ? bill.Balance : Number(bill.Balance) || 0,
        dueDate: typeof bill.DueDate === 'string' ? bill.DueDate : null,
        txnDate: typeof bill.TxnDate === 'string' ? bill.TxnDate : null,
      }));

      return res.json({ ok: true, bills: results, count: results.length });
    }

    if (action === 'ar-balance') {
      // Pull all unpaid invoices (accounts receivable) — for cross-check with Deco
      const query = `select Id, DocNumber, CustomerRef, TotalAmt, Balance, DueDate, TxnDate, MetaData from Invoice where Balance > '0' order by DueDate asc maxresults 1000`;
      const response = await fetch(endpoint, { method: 'POST', headers, body: query, signal: AbortSignal.timeout(30000) });
      const text = await response.text();
      if (!response.ok) return res.status(response.status).json({ error: `QBO AR query failed (${response.status})`, detail: text.slice(0, 500) });

      let data: unknown;
      try { data = JSON.parse(text); } catch { return res.status(502).json({ error: 'Invalid JSON from QBO' }); }

      const invoices = ((data as any)?.QueryResponse?.Invoice || []) as Record<string, unknown>[];

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
      // Pull customer balances including credits (negative = credit owed to customer)
      const query = `select Id, DisplayName, Balance from Customer where Balance < '0' order by Balance asc maxresults 500`;
      const response = await fetch(endpoint, { method: 'POST', headers, body: query, signal: AbortSignal.timeout(30000) });
      const text = await response.text();
      if (!response.ok) return res.status(response.status).json({ error: `QBO customer credits query failed (${response.status})`, detail: text.slice(0, 500) });

      let data: unknown;
      try { data = JSON.parse(text); } catch { return res.status(502).json({ error: 'Invalid JSON from QBO' }); }

      const customers = ((data as any)?.QueryResponse?.Customer || []) as Record<string, unknown>[];

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
