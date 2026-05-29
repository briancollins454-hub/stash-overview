import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── Reminder rule logic (inlined; mirror of utils/reminderRules.ts) ────────
// Self-contained on purpose: Vercel's function bundler in this project does
// not reliably include cross-file imports.
type ReminderRuleId = 'due_2d' | 'overdue_7' | 'overdue_30' | 'overdue_60' | 'overdue_90' | 'statement';
interface ReminderTemplate { enabled: boolean; subject: string; body: string }
interface ReminderConfig { mode: 'preview' | 'live'; rules: Record<ReminderRuleId, ReminderTemplate> }
interface ReminderTemplateVars {
  customer?: string; invoice?: string; amount?: string; due_date?: string;
  days_overdue?: string | number; balance?: string; statement?: string;
}
interface StatementInvoice { docNumber: string | null; balance: number; dueDate: string | null; txnDate: string | null }

const RULE_IDS: ReminderRuleId[] = ['due_2d', 'overdue_7', 'overdue_30', 'overdue_60', 'overdue_90', 'statement'];
const OVERDUE_THRESHOLDS: { id: ReminderRuleId; threshold: number }[] = [
  { id: 'overdue_90', threshold: 90 },
  { id: 'overdue_60', threshold: 60 },
  { id: 'overdue_30', threshold: 30 },
  { id: 'overdue_7', threshold: 7 },
];
const DEFAULT_BODY = 'Dear {{customer}},\n\nThis is a reminder that invoice {{invoice}} for {{amount}} was due on {{due_date}}.\n\nPlease arrange payment at your earliest convenience.\n\nKind regards,\nMarx Corporate Accounts';
const DEFAULT_STATEMENT_BODY = 'Dear {{customer}},\n\nPlease find your account statement below. Total amount due: {{balance}}.\n\n{{statement}}\n\nKind regards,\nMarx Corporate Accounts';

function defaultReminderConfig(): ReminderConfig {
  return {
    mode: 'preview',
    rules: {
      due_2d: { enabled: false, subject: 'Invoice {{invoice}} due soon', body: 'Dear {{customer}},\n\nA quick reminder that invoice {{invoice}} for {{amount}} is due on {{due_date}}.\n\nKind regards,\nMarx Corporate Accounts' },
      overdue_7: { enabled: false, subject: 'Invoice {{invoice}} now overdue', body: DEFAULT_BODY },
      overdue_30: { enabled: false, subject: 'Reminder: invoice {{invoice}} 30 days overdue', body: DEFAULT_BODY },
      overdue_60: { enabled: false, subject: 'Reminder: invoice {{invoice}} 60 days overdue', body: DEFAULT_BODY },
      overdue_90: { enabled: false, subject: 'Final reminder: invoice {{invoice}} 90 days overdue', body: DEFAULT_BODY },
      statement: { enabled: false, subject: 'Your monthly account statement', body: DEFAULT_STATEMENT_BODY },
    },
  };
}

function normalizeReminderConfig(raw: unknown): ReminderConfig {
  const base = defaultReminderConfig();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<ReminderConfig>;
  const mode = r.mode === 'live' ? 'live' : 'preview';
  const rules = { ...base.rules };
  if (r.rules && typeof r.rules === 'object') {
    for (const id of RULE_IDS) {
      const stored = (r.rules as Record<string, Partial<ReminderTemplate>>)[id];
      if (stored) {
        rules[id] = {
          enabled: Boolean(stored.enabled),
          subject: typeof stored.subject === 'string' ? stored.subject : base.rules[id].subject,
          body: typeof stored.body === 'string' ? stored.body : base.rules[id].body,
        };
      }
    }
  }
  return { mode, rules };
}

function daysPastDue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const iso = dueDate.slice(0, 10);
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return 0;
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today.getTime() - due.getTime()) / 86400000);
}

function selectRuleForInvoice(inv: { dueDate: string | null }, config: ReminderConfig): ReminderRuleId | null {
  const dpd = daysPastDue(inv.dueDate);
  for (const rule of OVERDUE_THRESHOLDS) {
    if (dpd >= rule.threshold && config.rules[rule.id].enabled) return rule.id;
  }
  if (dpd <= 0 && dpd >= -2 && config.rules.due_2d.enabled) return 'due_2d';
  return null;
}

function renderTemplate(template: string, vars: ReminderTemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const v = (vars as Record<string, unknown>)[key];
    return v === undefined || v === null ? match : String(v);
  });
}

function bodyToHtml(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;white-space:pre-wrap;line-height:1.5">${escaped}</div>`;
}

function dateSlash(iso: string | null): string {
  if (!iso) return '—';
  const p = iso.slice(0, 10).split('-');
  if (p.length !== 3) return '—';
  return `${p[2]}/${p[1]}/${p[0]}`;
}

function buildStatementText(customerName: string, invoices: StatementInvoice[], asAt: Date): string {
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
  const m = (v: number) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sorted = [...invoices].sort((a, b) => (a.txnDate || a.dueDate || '').localeCompare(b.txnDate || b.dueDate || ''));
  const total = sorted.reduce((s, i) => s + i.balance, 0);
  const asAtShort = `${String(asAt.getDate()).padStart(2, '0')}/${String(asAt.getMonth() + 1).padStart(2, '0')}/${asAt.getFullYear()}`;
  return [
    'OPEN ITEM STATEMENT — Marx Corporate',
    `Customer: ${customerName}`,
    `As at ${asAtShort}`,
    '',
    pad('Date', 12) + pad('Invoice', 14) + pad('Due', 12) + 'Open Amount',
    '-'.repeat(54),
    ...sorted.map(i => pad(dateSlash(i.txnDate), 12) + pad(i.docNumber || '—', 14) + pad(dateSlash(i.dueDate) + (daysPastDue(i.dueDate) > 0 ? ' *' : ''), 12) + m(i.balance)),
    '-'.repeat(54),
    pad('TOTAL DUE GBP', 38) + m(total),
    '',
    '* = past due',
  ].join('\n');
}

// ─── Nightly cron: automated QuickBooks payment reminders ───────────────────
// Replaces QuickBooks' paid "workflow automation". Each morning it pulls
// unpaid invoices + customers from QBO, decides which (if any) reminder rule
// each invoice has reached, and emails the customer from accounts@marxcorporate.com
// via /api/send-digest. The monthly statement runs only on the 1st.
//
// Safety:
//   • Runs in PREVIEW mode unless config.mode === 'live' (set from the UI).
//     Preview logs exactly what WOULD send without emailing anyone.
//   • The stash_reminder_log unique dedupe_key guarantees a customer never
//     gets the same reminder twice.
//   • Master kill-switch: env REMINDERS_DISABLED=true stops everything.
//
// Scheduled via vercel.json -> crons. Vercel sends Authorization: Bearer
// <CRON_SECRET>; anonymous calls are refused.

const CONFIG_ROW_ID = 'reminder_config';
const MAX_SENDS_PER_RUN = 200; // hard ceiling; the wall-clock budget below usually binds first

interface QbInvoice {
  id: string;
  docNumber: string | null;
  customerName: string;
  customerId: string;
  totalAmount: number;
  balance: number;
  dueDate: string | null;
  txnDate: string | null;
}

interface QbCustomer {
  id: string;
  name: string;
  email: string | null;
  balance: number;
  addressLines: string[];
}

const formatGbp = (v: number) => '£' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

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

// Resolve a base URL for internal API calls. Must avoid the *.vercel.app
// deployment URL (VERCEL_URL) because Vercel deployment protection returns 401
// for server-to-server calls there. The public custom domain is not protected.
const PROD_BASE_URL = 'https://www.stashoverview.co.uk';
function selfBaseUrl(req: VercelRequest): string {
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  if (host && !host.endsWith('.vercel.app')) return `${proto}://${host}`;
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && !envUrl.includes('localhost')) return envUrl.replace(/\/$/, '');
  return PROD_BASE_URL;
}

async function loadConfig(url: string, key: string): Promise<ReminderConfig> {
  try {
    const r = await fetch(
      `${url}/rest/v1/stash_reminder_settings?id=eq.${CONFIG_ROW_ID}&select=data`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) },
    );
    const rows = r.ok ? await r.json() : [];
    const data = Array.isArray(rows) && rows.length > 0 ? rows[0].data : null;
    return normalizeReminderConfig(data);
  } catch {
    return normalizeReminderConfig(null);
  }
}

async function loadSentKeys(url: string, key: string): Promise<Set<string>> {
  try {
    const r = await fetch(
      `${url}/rest/v1/stash_reminder_log?select=dedupe_key`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) },
    );
    const rows = r.ok ? await r.json() : [];
    return new Set(Array.isArray(rows) ? rows.map((x: { dedupe_key: string }) => x.dedupe_key) : []);
  } catch {
    return new Set();
  }
}

async function insertLog(url: string, key: string, row: Record<string, unknown>) {
  try {
    await fetch(`${url}/rest/v1/stash_reminder_log`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* logging best-effort */
  }
}

async function qbPost(base: string, action: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`${base}/api/quickbooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
    signal: AbortSignal.timeout(35000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data } as { ok: boolean; data: any };
}

interface EmailAttachment { filename: string; content: string }

/**
 * Fetch the customer-facing invoice PDF to attach to a reminder.
 *
 * Primary source is the DecoNetwork "quote/invoice" PDF (the branded invoice
 * the customer expects), looked up by the QuickBooks invoice number which
 * matches the Deco order number. Falls back to the QuickBooks-rendered PDF
 * if Deco can't produce one.
 */
async function fetchInvoicePdf(base: string, qbInvoiceId: string, docNumber: string | null): Promise<EmailAttachment | null> {
  const safeNo = (docNumber || qbInvoiceId).replace(/[^a-zA-Z0-9._-]+/g, '-');

  // 1) DecoNetwork branded invoice (preferred). Deco renders on the fly, so allow plenty of time.
  if (docNumber) {
    try {
      const r = await fetch(`${base}/api/deco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invoice-pdf', orderId: docNumber }),
        signal: AbortSignal.timeout(55000),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.ok && typeof data.base64 === 'string') {
        return { filename: `Invoice-${safeNo}.pdf`, content: data.base64 };
      }
    } catch {
      /* fall through to QB */
    }
  }

  // 2) QuickBooks-rendered PDF fallback.
  try {
    const r = await qbPost(base, 'invoice-pdf', { invoiceId: qbInvoiceId });
    if (r.ok && r.data?.ok && typeof r.data.base64 === 'string') {
      return { filename: `Invoice-${safeNo}.pdf`, content: r.data.base64 };
    }
  } catch {
    /* no PDF available */
  }
  return null;
}

async function sendEmail(
  base: string,
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments?: EmailAttachment[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${base}/api/send-digest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html, text, kind: 'statement', ...(attachments && attachments.length ? { attachments } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
    if (r.ok) return { ok: true };
    const data = await r.json().catch(() => ({}));
    return { ok: false, error: data?.error || `send failed (${r.status})` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send error' };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  const auth = req.headers['authorization'] || '';
  // Allow a manual ?secret= for ad-hoc testing in addition to the cron header.
  const manualSecret = typeof req.query.secret === 'string' ? req.query.secret : '';
  if (auth !== `Bearer ${cronSecret}` && manualSecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if ((process.env.REMINDERS_DISABLED || '').toLowerCase() === 'true') {
    return res.status(200).json({ ok: true, skipped: 'REMINDERS_DISABLED' });
  }

  const creds = supabaseCreds();
  if (!creds) return res.status(500).json({ error: 'Supabase not configured' });
  const { url, key } = creds;
  const base = selfBaseUrl(req);
  const startedAt = Date.now();

  const config = await loadConfig(url, key);
  const live = config.mode === 'live';

  const anyRuleEnabled = Object.values(config.rules).some(r => r.enabled);
  if (!anyRuleEnabled) {
    return res.status(200).json({ ok: true, mode: config.mode, note: 'No reminder rules enabled', processed: 0 });
  }

  // Pull QB data + already-sent keys in parallel.
  const [arResult, dirResult, sentKeys] = await Promise.all([
    qbPost(base, 'ar-balance'),
    qbPost(base, 'customer-directory'),
    loadSentKeys(url, key),
  ]);

  if (!arResult.ok || !arResult.data?.ok) {
    return res.status(502).json({ error: 'QuickBooks A/R fetch failed', detail: arResult.data?.error });
  }

  const invoices: QbInvoice[] = Array.isArray(arResult.data.invoices) ? arResult.data.invoices : [];
  const customers: QbCustomer[] = dirResult.ok && dirResult.data?.ok && Array.isArray(dirResult.data.customers)
    ? dirResult.data.customers
    : [];
  const customerById = new Map<string, QbCustomer>(customers.map(c => [c.id, c]));

  const today = new Date();
  const isFirstOfMonth = today.getDate() === 1;
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const results = {
    mode: config.mode as 'preview' | 'live',
    invoicesConsidered: invoices.length,
    reminders: { sent: 0, failed: 0, skippedNoEmail: 0, alreadySent: 0 },
    statements: { sent: 0, failed: 0, skippedNoEmail: 0, alreadySent: 0, ran: isFirstOfMonth },
  };

  let sendBudget = MAX_SENDS_PER_RUN;

  // Soft wall-clock budget: fetching Deco PDFs is slow, so stop sending
  // before the function hits its hard limit. Anything not sent this run is
  // picked up next run (dedupe keeps it idempotent).
  const TIME_BUDGET_MS = 270000;

  // ── 1. Per-invoice due/overdue reminders ────────────────────────────────
  for (const inv of invoices) {
    if (sendBudget <= 0) break;
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    if (inv.balance <= 0.005) continue;
    const ruleId = selectRuleForInvoice({ dueDate: inv.dueDate }, config) as ReminderRuleId | null;
    if (!ruleId || ruleId === 'statement') continue;

    const dedupeKey = `inv:${inv.id}:${ruleId}`;
    if (sentKeys.has(dedupeKey)) { results.reminders.alreadySent++; continue; }

    const cust = customerById.get(inv.customerId);
    const recipient = cust?.email || null;
    const tmpl = config.rules[ruleId];

    const vars: ReminderTemplateVars = {
      customer: inv.customerName || cust?.name || 'Customer',
      invoice: inv.docNumber || inv.id,
      amount: formatGbp(inv.balance),
      due_date: inv.dueDate ? inv.dueDate.slice(0, 10).split('-').reverse().join('/') : '—',
      days_overdue: Math.max(0, daysPastDue(inv.dueDate)),
      balance: formatGbp(cust?.balance ?? inv.balance),
    };
    const subject = renderTemplate(tmpl.subject, vars);
    const text = renderTemplate(tmpl.body, vars);
    const html = bodyToHtml(text);

    if (!recipient) {
      results.reminders.skippedNoEmail++;
      await insertLog(url, key, {
        dedupe_key: dedupeKey, rule_id: ruleId, mode: config.mode, status: 'skipped',
        customer_id: inv.customerId, customer_name: vars.customer, invoice_id: inv.id,
        invoice_no: vars.invoice, recipient: null, amount: inv.balance, subject,
        error: 'No customer email in QuickBooks',
      });
      sentKeys.add(dedupeKey);
      continue;
    }

    if (!live) {
      results.reminders.sent++; // counted as "would send" in preview
      await insertLog(url, key, {
        dedupe_key: dedupeKey, rule_id: ruleId, mode: 'preview', status: 'sent',
        customer_id: inv.customerId, customer_name: vars.customer, invoice_id: inv.id,
        invoice_no: vars.invoice, recipient, amount: inv.balance, subject,
      });
      sentKeys.add(dedupeKey);
      sendBudget--;
      continue;
    }

    // Attach the real branded invoice PDF (DecoNetwork) to this reminder.
    const invoicePdf = await fetchInvoicePdf(base, inv.id, inv.docNumber);
    const attachments = invoicePdf ? [invoicePdf] : undefined;

    const sent = await sendEmail(base, recipient, subject, html, text, attachments);
    if (sent.ok) results.reminders.sent++; else results.reminders.failed++;
    await insertLog(url, key, {
      dedupe_key: dedupeKey, rule_id: ruleId, mode: 'live', status: sent.ok ? 'sent' : 'failed',
      customer_id: inv.customerId, customer_name: vars.customer, invoice_id: inv.id,
      invoice_no: vars.invoice, recipient, amount: inv.balance, subject,
      error: sent.ok ? (invoicePdf ? null : 'sent without invoice PDF (QB PDF unavailable)') : sent.error,
    });
    sentKeys.add(dedupeKey);
    sendBudget--;
  }

  // ── 2. Monthly statement (1st of month only) ────────────────────────────
  if (isFirstOfMonth && config.rules.statement.enabled) {
    // Group open invoices by customer.
    const byCustomer = new Map<string, QbInvoice[]>();
    for (const inv of invoices) {
      if (inv.balance <= 0.005) continue;
      const arr = byCustomer.get(inv.customerId) || [];
      arr.push(inv);
      byCustomer.set(inv.customerId, arr);
    }

    const tmpl = config.rules.statement;
    for (const [customerId, custInvoices] of byCustomer) {
      if (sendBudget <= 0) break;
      const cust = customerById.get(customerId);
      const balance = custInvoices.reduce((s, i) => s + i.balance, 0);
      if (balance <= 0.005) continue; // only when QB balance > £0

      const dedupeKey = `stmt:${customerId}:${monthKey}`;
      if (sentKeys.has(dedupeKey)) { results.statements.alreadySent++; continue; }

      const customerName = custInvoices[0]?.customerName || cust?.name || 'Customer';
      const recipient = cust?.email || null;

      const statementInvoices: StatementInvoice[] = custInvoices.map(i => ({
        docNumber: i.docNumber, balance: i.balance, dueDate: i.dueDate, txnDate: i.txnDate,
      }));
      const statementText = buildStatementText(customerName, statementInvoices, today);

      const vars: ReminderTemplateVars = {
        customer: customerName,
        balance: formatGbp(balance),
        statement: statementText,
      };
      const subject = renderTemplate(tmpl.subject, vars);
      const text = renderTemplate(tmpl.body, vars);
      const html = bodyToHtml(text);

      if (!recipient) {
        results.statements.skippedNoEmail++;
        await insertLog(url, key, {
          dedupe_key: dedupeKey, rule_id: 'statement', mode: config.mode, status: 'skipped',
          customer_id: customerId, customer_name: customerName, invoice_id: null,
          invoice_no: null, recipient: null, amount: balance, subject,
          error: 'No customer email in QuickBooks',
        });
        sentKeys.add(dedupeKey);
        continue;
      }

      if (!live) {
        results.statements.sent++;
        await insertLog(url, key, {
          dedupe_key: dedupeKey, rule_id: 'statement', mode: 'preview', status: 'sent',
          customer_id: customerId, customer_name: customerName, invoice_id: null,
          invoice_no: null, recipient, amount: balance, subject,
        });
        sentKeys.add(dedupeKey);
        sendBudget--;
        continue;
      }

      const sent = await sendEmail(base, recipient, subject, html, text);
      if (sent.ok) results.statements.sent++; else results.statements.failed++;
      await insertLog(url, key, {
        dedupe_key: dedupeKey, rule_id: 'statement', mode: 'live', status: sent.ok ? 'sent' : 'failed',
        customer_id: customerId, customer_name: customerName, invoice_id: null,
        invoice_no: null, recipient, amount: balance, subject,
        error: sent.ok ? null : sent.error,
      });
      sentKeys.add(dedupeKey);
      sendBudget--;
    }
  }

  const durationMs = Date.now() - startedAt;
  const summary = { ok: true, ...results, durationMs };
  console.log('[cron/invoice-reminders]', JSON.stringify(summary));
  return res.status(200).json(summary);
}
