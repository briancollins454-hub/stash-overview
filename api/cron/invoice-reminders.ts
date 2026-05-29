import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  normalizeReminderConfig,
  selectRuleForInvoice,
  renderTemplate,
  bodyToHtml,
  type ReminderConfig,
  type ReminderRuleId,
  type ReminderTemplateVars,
} from '../../utils/reminderRules';
import {
  daysPastDue,
  buildOpenItemStatement,
  formatStatementText,
  type OpenItemInvoice,
} from '../../utils/openItemStatement';

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
const MAX_SENDS_PER_RUN = 200; // stay well within the 60s function cap

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

function selfBaseUrl(req: VercelRequest): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  const host = req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${host}`;
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

async function qbPost(base: string, action: string) {
  const r = await fetch(`${base}/api/quickbooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
    signal: AbortSignal.timeout(35000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data } as { ok: boolean; data: any };
}

async function sendEmail(
  base: string,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${base}/api/send-digest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html, text, kind: 'statement' }),
      signal: AbortSignal.timeout(20000),
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

  // ── 1. Per-invoice due/overdue reminders ────────────────────────────────
  for (const inv of invoices) {
    if (sendBudget <= 0) break;
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

    const sent = await sendEmail(base, recipient, subject, html, text);
    if (sent.ok) results.reminders.sent++; else results.reminders.failed++;
    await insertLog(url, key, {
      dedupe_key: dedupeKey, rule_id: ruleId, mode: 'live', status: sent.ok ? 'sent' : 'failed',
      customer_id: inv.customerId, customer_name: vars.customer, invoice_id: inv.id,
      invoice_no: vars.invoice, recipient, amount: inv.balance, subject,
      error: sent.ok ? null : sent.error,
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

      const openItems: OpenItemInvoice[] = custInvoices.map(i => ({
        id: i.id, docNumber: i.docNumber, customerName, customerId,
        balance: i.balance, totalAmount: i.totalAmount, dueDate: i.dueDate, txnDate: i.txnDate,
      }));
      const statement = buildOpenItemStatement(customerName, customerId, openItems, today);
      const statementText = statement ? formatStatementText(statement) : '';

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
