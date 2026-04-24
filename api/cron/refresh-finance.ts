import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Nightly Vercel Cron job: rebuild the finance cache end-to-end against
 * Deco and upsert it into Supabase `stash_finance_cache` so every staff
 * member sees fresh figures (shipped-not-invoiced, outstanding balances,
 * aged debtors) first thing in the morning without anyone having to hit
 * "Full Reload" on the Finance page.
 *
 * Scheduled via vercel.json -> crons. Vercel sends
 *   Authorization: Bearer <CRON_SECRET>
 * on every cron invocation. This handler REQUIRES the env var to be set
 * and the header to match — anonymous calls are refused so random
 * callers on the internet can't burn our Deco quota or mutate the
 * finance cache.
 */

// ─── Lean finance job shape ─────────────────────────────────────────────
// Mirror of the `lean` projection used client-side in
// FinancialDashboard.saveToSupabase. Keeping the shape identical means
// nothing downstream has to change — the client reads rows[0].data
// straight into state.
interface LeanItem {
  name: string;
  productCode: string;
  vendorSku?: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  isReceived: boolean;
  isProduced: boolean;
  isShipped: boolean;
}

interface LeanFinanceJob {
  id: string;
  jobNumber: string;
  poNumber: string;
  jobName: string;
  customerName: string;
  status: string;
  dateOrdered?: string;
  productionDueDate: string;
  dateDue?: string;
  dateShipped?: string;
  itemsProduced: number;
  totalItems: number;
  notes: string;
  productCode: string;
  items: LeanItem[];
  orderTotal?: number;
  orderSubtotal?: number;
  orderTax?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  discount?: number;
  couponCode?: string;
  outstandingBalance: number;
  billableAmount: number;
  creditUsed: number;
  accountTerms?: string;
  dateInvoiced?: string;
  isQuote: boolean;
  payments: Array<{
    id?: string;
    datePaid?: string;
    method: string;
    amount: number;
    refundedAmount: number;
  }>;
  refunds: Array<{ id?: string; amount: number; date: string }>;
  salesPerson?: string;
}

// ─── Deco status -> canonical string (subset of mapDecoStatus) ─────────
const DECO_STATUS_MAP: Record<string, string> = {
  '1': 'Order', '2': 'Quote', '3': 'Shipped', '4': 'Cancelled',
  '5': 'Hold', '6': 'Awaiting Processing', '7': 'Awaiting Stock',
  '8': 'In Production', '9': 'Ready for Shipping', '10': 'Partially Shipped',
  '11': 'Completed', '12': 'Awaiting Artwork', '13': 'Awaiting PO',
};
function mapStatus(raw: any): string {
  if (raw == null) return 'Unknown';
  if (typeof raw === 'string' && isNaN(Number(raw))) return raw;
  const key = String(raw);
  return DECO_STATUS_MAP[key] || `Status ${key}`;
}

// ─── Map one raw Deco order -> lean finance job ────────────────────────
function mapOrder(job: any): LeanFinanceJob {
  const custName =
    job.billing_details?.company ||
    `${job.billing_details?.firstname || ''} ${job.billing_details?.lastname || ''}`.trim() ||
    'Unknown';

  const salesPerson = (() => {
    const at = job.assigned_to;
    if (at && typeof at === 'object' && (at.firstname || at.lastname))
      return `${at.firstname || ''} ${at.lastname || ''}`.trim();
    if (typeof at === 'string') return at;
    const ss = job.sales_staff_account || job.sales_staff || job.staff_account;
    if (ss && typeof ss === 'object' && (ss.firstname || ss.lastname))
      return `${ss.firstname || ''} ${ss.lastname || ''}`.trim();
    if (typeof ss === 'string') return ss;
    const cb = job.created_by;
    if (cb && typeof cb === 'object' && (cb.firstname || cb.lastname))
      return `${cb.firstname || ''} ${cb.lastname || ''}`.trim();
    return undefined;
  })();

  return {
    id: String(job.order_id),
    jobNumber: String(job.order_number || job.order_id),
    poNumber: job.customer_po_number || '',
    jobName: job.job_name || '',
    customerName: custName,
    status: mapStatus(job.order_status_name || job.order_status),
    dateOrdered: job.date_ordered,
    productionDueDate: job.date_scheduled || '',
    dateDue: job.date_due,
    dateShipped: job.date_shipped || job.date_completed,
    itemsProduced: 0,
    totalItems: 0,
    notes: '',
    productCode: '',
    items: [], // The finance cache doesn't need per-line decoration detail.
    orderTotal:
      parseFloat(job.total) ||
      parseFloat(job.order_total) ||
      parseFloat(job.item_amount) ||
      undefined,
    orderSubtotal: parseFloat(job.item_amount) || undefined,
    orderTax: parseFloat(job.tax_amount) || parseFloat(job.tax) || undefined,
    paymentStatus: job.payment_status?.toString(),
    paymentMethod: job.payment_details?.payment_type_name || job.payment_method || undefined,
    discount: parseFloat(job.discount_amount) || undefined,
    couponCode: job.coupon_code || undefined,
    outstandingBalance: parseFloat(job.outstanding_balance) || 0,
    billableAmount: parseFloat(job.billable_amount) || 0,
    creditUsed: parseFloat(job.credit_used) || 0,
    accountTerms: job.account_terms || undefined,
    dateInvoiced: job.date_invoiced || undefined,
    isQuote:
      job.is_quote === true ||
      job.is_quote === 1 ||
      job.order_type === 2 ||
      job.order_type === '2' ||
      false,
    payments: Array.isArray(job.payments)
      ? job.payments.map((p: any) => ({
          id: p.id || p.payment_id,
          datePaid: p.date_paid,
          method: p.payment_method || 'Unknown',
          amount: parseFloat(p.paid_amount) || 0,
          refundedAmount: parseFloat(p.refunded_amount) || 0,
        }))
      : [],
    refunds: Array.isArray(job.refunds)
      ? job.refunds.map((r: any) => ({
          id: r.id,
          amount: parseFloat(r.amount || r.refund_amount) || 0,
          date: r.date || r.date_refunded || '',
        }))
      : [],
    salesPerson,
  };
}

// Single-page Deco timeout (ms). A hung page shouldn't freeze the whole
// cron — better to drop that page and carry on with the rest. 25s gives
// Deco's slowest real responses plenty of headroom while leaving room
// for several retries inside the 60s function cap.
const PAGE_TIMEOUT_MS = 25_000;

async function fetchDecoPage(
  domain: string,
  username: string,
  password: string,
  offset: number,
  batch: number,
  sinceDate: string,
): Promise<{ orders: any[]; total: number }> {
  const qp = new URLSearchParams({
    username,
    password,
    field: '1',
    condition: '4',
    date1: sinceDate,
    limit: String(batch),
    offset: String(offset),
    skip_login_token: '1',
    include_workflow_data: '1',
    include_user_assignments: '1',
    include_custom_fields: '1',
    include_sales_data: '1',
  });
  const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Deco HTTP ${res.status}`);
    const data: any = await res.json();
    const status = data?.response_status;
    if (status && parseInt(status.code) !== 10001 && !Array.isArray(data.orders)) {
      throw new Error(`Deco error ${status.code}: ${status.description || 'unknown'}`);
    }
    return { orders: data.orders || [], total: data.total || 0 };
  } finally {
    clearTimeout(timer);
  }
}

// Pull the existing finance cache row from Supabase so we can merge
// rather than clobber. Returns an empty array on first run (or if the
// row is missing / malformed) — merge still works because it'll just
// be the recent pull on its own.
async function loadExistingCache(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<LeanFinanceJob[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const url = `${supabaseUrl}/rest/v1/stash_finance_cache?id=eq.finance_jobs&select=data`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0].data)) {
      return rows[0].data as LeanFinanceJob[];
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CRON auth — Vercel sends Authorization: Bearer <CRON_SECRET> on
  // every scheduled invocation. REQUIRE the env var to be configured;
  // without it the endpoint would be wide open and callable by anyone
  // who knows the URL, letting them burn Deco quota and mutate the
  // shared finance cache. Hard-fail instead of silently falling back.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(503).json({ error: 'CRON_SECRET not configured' });
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const domain = process.env.DECO_DOMAIN;
  const username = process.env.DECO_USERNAME;
  const password = process.env.DECO_PASSWORD;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!domain || !username || !password) {
    return res.status(500).json({ error: 'Deco credentials not configured' });
  }
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  const startedAt = Date.now();

  // How far back to pull fresh data from Deco. Most real-world changes
  // (new orders, payments hitting invoiced jobs, items shipping) happen
  // well inside 120 days. Older data is kept verbatim from what's
  // already in Supabase so a 6-year order history doesn't get
  // re-downloaded every single night.
  const LOOKBACK_DAYS = 120;
  const sinceDateObj = new Date();
  sinceDateObj.setDate(sinceDateObj.getDate() - LOOKBACK_DAYS);
  const sinceDate = sinceDateObj.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    // Kick off the Supabase read and the first Deco page together so
    // neither blocks the other.
    const existingPromise = loadExistingCache(supabaseUrl, supabaseKey);
    const BATCH = 100; // Deco caps at 100 per request when include flags are on
    const first = await fetchDecoPage(domain, username, password, 0, BATCH, sinceDate);
    const total = first.total;
    const recentRaw: any[] = [...first.orders];

    // Remaining pages in parallel waves of 10 — typically only 2-4
    // waves needed for a 120-day window vs. ~25 for the full history.
    const WAVE = 10;
    const pagesNeeded = Math.max(0, Math.ceil((total - first.orders.length) / BATCH));
    const offsets: number[] = [];
    for (let i = 1; i <= pagesNeeded; i++) offsets.push(i * BATCH);

    for (let i = 0; i < offsets.length; i += WAVE) {
      const wave = offsets.slice(i, i + WAVE);
      const results = await Promise.all(
        wave.map(off => fetchDecoPage(domain, username, password, off, BATCH, sinceDate).catch(err => {
          console.warn(`[cron/refresh-finance] page @ offset=${off} failed:`, err?.message || err);
          return { orders: [], total: 0 };
        })),
      );
      for (const r of results) recentRaw.push(...r.orders);
    }

    const recent: LeanFinanceJob[] = recentRaw.map(mapOrder);
    const existing = await existingPromise;

    // Merge: recent pull wins on overlap, older cached jobs pass through
    // untouched, brand-new jobs get appended. Same behaviour as the
    // client-side incrementalSync.
    const recentByNumber = new Map(recent.map(j => [j.jobNumber, j]));
    const seenNumbers = new Set<string>();
    const merged: LeanFinanceJob[] = existing.map(j => {
      seenNumbers.add(j.jobNumber);
      return recentByNumber.get(j.jobNumber) || j;
    });
    let added = 0;
    for (const j of recent) {
      if (!seenNumbers.has(j.jobNumber)) {
        merged.push(j);
        added++;
      }
    }

    const updated = recent.length - added;
    const syncedAt = new Date().toISOString();

    // Upsert into stash_finance_cache via PostgREST. merge-duplicates on the
    // primary key (id='finance_jobs') behaves as an UPSERT.
    const upsertUrl = `${supabaseUrl}/rest/v1/stash_finance_cache`;
    const upsertCtrl = new AbortController();
    const upsertTimer = setTimeout(() => upsertCtrl.abort(), 20_000);
    let upsertRes: Response;
    try {
      upsertRes = await fetch(upsertUrl, {
        method: 'POST',
        signal: upsertCtrl.signal,
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          id: 'finance_jobs',
          data: merged,
          last_synced: syncedAt,
          updated_at: syncedAt,
        }),
      });
    } finally {
      clearTimeout(upsertTimer);
    }

    if (!upsertRes.ok) {
      const text = await upsertRes.text();
      throw new Error(`Supabase upsert failed (${upsertRes.status}): ${text}`);
    }

    const durationMs = Date.now() - startedAt;
    const summary = {
      ok: true,
      syncedAt,
      lookbackDays: LOOKBACK_DAYS,
      recentPulled: recent.length,
      newlyAdded: added,
      updatedInPlace: updated,
      keptFromExisting: existing.length - updated,
      totalInCache: merged.length,
      durationMs,
    };
    console.log('[cron/refresh-finance]', summary);
    return res.status(200).json(summary);
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    console.error('[cron/refresh-finance] FAILED', { error: err?.message || String(err), durationMs });
    return res.status(500).json({ ok: false, error: err?.message || String(err), durationMs });
  }
}
