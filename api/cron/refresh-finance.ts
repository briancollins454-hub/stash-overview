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
 * on every cron invocation when CRON_SECRET is configured; this handler
 * enforces that when the env var is set, and falls back to open access
 * otherwise so the endpoint remains usable for a manual dry-run.
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

async function fetchDecoPage(
  domain: string,
  username: string,
  password: string,
  offset: number,
  batch: number,
): Promise<{ orders: any[]; total: number }> {
  const qp = new URLSearchParams({
    username,
    password,
    field: '1',
    condition: '4',
    date1: '2020-01-01',
    limit: String(batch),
    offset: String(offset),
    skip_login_token: '1',
    include_workflow_data: '1',
    include_user_assignments: '1',
    include_custom_fields: '1',
    include_sales_data: '1',
  });
  const url = `https://${domain}/api/json/manage_orders/find?${qp.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Deco HTTP ${res.status}`);
  const data: any = await res.json();
  const status = data?.response_status;
  if (status && parseInt(status.code) !== 10001 && !Array.isArray(data.orders)) {
    throw new Error(`Deco error ${status.code}: ${status.description || 'unknown'}`);
  }
  return { orders: data.orders || [], total: data.total || 0 };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CRON auth — Vercel sends Authorization: Bearer <CRON_SECRET> when the
  // env var is configured. Reject anything that doesn't match so random
  // callers on the internet can't burn our Deco quota.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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

  try {
    // Page 1 gives us the grand total so we can parallel-fetch the rest.
    const BATCH = 100; // Deco caps at 100 per request when include flags are on
    const first = await fetchDecoPage(domain, username, password, 0, BATCH);
    const total = first.total;
    const allRaw: any[] = [...first.orders];

    // Fire remaining pages in parallel waves of 10 to be nice to Deco
    // while keeping us under Vercel's 60s ceiling.
    const WAVE = 10;
    const pagesNeeded = Math.max(0, Math.ceil((total - first.orders.length) / BATCH));
    const offsets: number[] = [];
    for (let i = 1; i <= pagesNeeded; i++) offsets.push(i * BATCH);

    for (let i = 0; i < offsets.length; i += WAVE) {
      const wave = offsets.slice(i, i + WAVE);
      const results = await Promise.all(
        wave.map(off => fetchDecoPage(domain, username, password, off, BATCH).catch(err => {
          console.warn(`[cron/refresh-finance] page @ offset=${off} failed:`, err?.message || err);
          return { orders: [], total: 0 };
        })),
      );
      for (const r of results) allRaw.push(...r.orders);
    }

    const lean = allRaw.map(mapOrder);
    const syncedAt = new Date().toISOString();

    // Upsert into stash_finance_cache via PostgREST. merge-duplicates on the
    // primary key (id='finance_jobs') behaves as an UPSERT.
    const upsertUrl = `${supabaseUrl}/rest/v1/stash_finance_cache`;
    const upsertRes = await fetch(upsertUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: 'finance_jobs',
        data: lean,
        last_synced: syncedAt,
        updated_at: syncedAt,
      }),
    });

    if (!upsertRes.ok) {
      const text = await upsertRes.text();
      throw new Error(`Supabase upsert failed (${upsertRes.status}): ${text}`);
    }

    const durationMs = Date.now() - startedAt;
    const summary = {
      ok: true,
      syncedAt,
      ordersPulled: allRaw.length,
      ordersExpected: total,
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
