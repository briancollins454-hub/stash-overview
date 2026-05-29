// ─── Automated payment reminders — shared logic (server, self-contained) ────
// Lives inside /api/_lib (underscore = not exposed as a route, and reliably
// bundled into each function) so both api/reminders.ts and the cron can share
// it WITHOUT importing across top-level directories — which Vercel's function
// bundler does not pick up in this repo. The frontend re-exports this module
// via utils/reminderRules.ts so there is a single source of truth.

export type ReminderRuleId =
  | 'due_2d'
  | 'overdue_7'
  | 'overdue_30'
  | 'overdue_60'
  | 'overdue_90'
  | 'statement';

export interface ReminderRuleDef {
  id: ReminderRuleId;
  label: string;
  description: string;
  threshold?: number;
  isStatement?: boolean;
}

export const REMINDER_RULES: ReminderRuleDef[] = [
  { id: 'due_2d', label: 'Invoice due in 2 days', description: 'Gentle reminder sent ~2 days before an invoice falls due.' },
  { id: 'overdue_7', label: 'Invoice 7 days overdue', description: 'First chase once an invoice is 7 days past its due date.', threshold: 7 },
  { id: 'overdue_30', label: 'Invoice 30 days overdue', description: 'Follow-up at 30 days past due.', threshold: 30 },
  { id: 'overdue_60', label: 'Invoice 60 days overdue', description: 'Follow-up at 60 days past due.', threshold: 60 },
  { id: 'overdue_90', label: 'Invoice 90 days overdue', description: 'Final reminder at 90 days past due.', threshold: 90 },
  { id: 'statement', label: 'Monthly statement (1st of month)', description: 'Full account statement emailed on the 1st of each month to any customer with an open balance.', isStatement: true },
];

export const OVERDUE_RULES: ReminderRuleDef[] = REMINDER_RULES
  .filter(r => typeof r.threshold === 'number')
  .sort((a, b) => (b.threshold || 0) - (a.threshold || 0));

export interface ReminderTemplate {
  enabled: boolean;
  subject: string;
  body: string;
}

export interface ReminderConfig {
  mode: 'preview' | 'live';
  rules: Record<ReminderRuleId, ReminderTemplate>;
}

export const TEMPLATE_PLACEHOLDERS: { token: string; description: string }[] = [
  { token: '{{customer}}', description: 'Customer / company name' },
  { token: '{{invoice}}', description: 'Invoice number (per-invoice reminders)' },
  { token: '{{amount}}', description: 'Amount outstanding on that invoice, e.g. £123.45' },
  { token: '{{due_date}}', description: 'Invoice due date, e.g. 20/05/2026' },
  { token: '{{days_overdue}}', description: 'How many days past due' },
  { token: '{{balance}}', description: 'Total balance the customer owes' },
  { token: '{{statement}}', description: 'Full open-item statement (statement email only)' },
];

const DEFAULT_BODY =
  'Dear {{customer}},\n\nThis is a reminder that invoice {{invoice}} for {{amount}} was due on {{due_date}}.\n\nPlease arrange payment at your earliest convenience.\n\nKind regards,\nMarx Corporate Accounts';

const DEFAULT_STATEMENT_BODY =
  'Dear {{customer}},\n\nPlease find your account statement below. Total amount due: {{balance}}.\n\n{{statement}}\n\nKind regards,\nMarx Corporate Accounts';

export function defaultReminderConfig(): ReminderConfig {
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

export function normalizeReminderConfig(raw: unknown): ReminderConfig {
  const base = defaultReminderConfig();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<ReminderConfig>;
  const mode = r.mode === 'live' ? 'live' : 'preview';
  const rules = { ...base.rules };
  if (r.rules && typeof r.rules === 'object') {
    for (const def of REMINDER_RULES) {
      const stored = (r.rules as Record<string, Partial<ReminderTemplate>>)[def.id];
      if (stored) {
        rules[def.id] = {
          enabled: Boolean(stored.enabled),
          subject: typeof stored.subject === 'string' ? stored.subject : base.rules[def.id].subject,
          body: typeof stored.body === 'string' ? stored.body : base.rules[def.id].body,
        };
      }
    }
  }
  return { mode, rules };
}

export interface ReminderTemplateVars {
  customer?: string;
  invoice?: string;
  amount?: string;
  due_date?: string;
  days_overdue?: string | number;
  balance?: string;
  statement?: string;
}

export function renderTemplate(template: string, vars: ReminderTemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const v = (vars as Record<string, unknown>)[key];
    return v === undefined || v === null ? match : String(v);
  });
}

export function bodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;white-space:pre-wrap;line-height:1.5">${escaped}</div>`;
}

/** Days past due date (negative = not yet due). Self-contained copy. */
export function daysPastDue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const iso = dueDate.slice(0, 10);
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return 0;
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today.getTime() - due.getTime()) / 86400000);
}

export interface ReminderInvoiceInput {
  dueDate: string | null;
}

export function selectRuleForInvoice(
  inv: ReminderInvoiceInput,
  config: ReminderConfig,
): ReminderRuleId | null {
  const dpd = daysPastDue(inv.dueDate);
  for (const rule of OVERDUE_RULES) {
    if (dpd >= (rule.threshold as number) && config.rules[rule.id].enabled) {
      return rule.id;
    }
  }
  if (dpd <= 0 && dpd >= -2 && config.rules.due_2d.enabled) {
    return 'due_2d';
  }
  return null;
}

// ─── Minimal open-item statement text (no PDF/browser deps) ─────────────────
export interface StatementInvoice {
  docNumber: string | null;
  balance: number;
  dueDate: string | null;
  txnDate: string | null;
}

const money = (v: number) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function dateSlash(iso: string | null): string {
  if (!iso) return '—';
  const p = iso.slice(0, 10).split('-');
  if (p.length !== 3) return '—';
  return `${p[2]}/${p[1]}/${p[0]}`;
}

/** Plain-text open-item statement for the monthly statement email body. */
export function buildStatementText(customerName: string, invoices: StatementInvoice[], asAt: Date = new Date()): string {
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
  const sorted = [...invoices].sort((a, b) => (a.txnDate || a.dueDate || '').localeCompare(b.txnDate || b.dueDate || ''));
  const total = sorted.reduce((s, i) => s + i.balance, 0);
  const asAtShort = `${String(asAt.getDate()).padStart(2, '0')}/${String(asAt.getMonth() + 1).padStart(2, '0')}/${asAt.getFullYear()}`;
  const lines = [
    'OPEN ITEM STATEMENT — Marx Corporate',
    `Customer: ${customerName}`,
    `As at ${asAtShort}`,
    '',
    pad('Date', 12) + pad('Invoice', 14) + pad('Due', 12) + 'Open Amount',
    '-'.repeat(54),
    ...sorted.map(i =>
      pad(dateSlash(i.txnDate), 12)
      + pad(i.docNumber || '—', 14)
      + pad(dateSlash(i.dueDate) + (daysPastDue(i.dueDate) > 0 ? ' *' : ''), 12)
      + money(i.balance),
    ),
    '-'.repeat(54),
    pad('TOTAL DUE GBP', 38) + money(total),
    '',
    '* = past due',
  ];
  return lines.join('\n');
}
