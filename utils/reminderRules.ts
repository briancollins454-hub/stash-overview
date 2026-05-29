import { daysPastDue } from './openItemStatement';

// ─── Automated payment reminders — shared rule definitions ────────────────
// Used by both the nightly cron (api/cron/invoice-reminders.ts) and the
// settings UI so the two never drift. QuickBooks charges a monthly fee for
// the equivalent "workflow automation"; this replicates it on our own infra.

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
  /** Overdue rules only: minimum days past due to qualify. */
  threshold?: number;
  /** True for the monthly statement (handled separately from per-invoice rules). */
  isStatement?: boolean;
}

/** Catalogue of supported rules, mirroring the QuickBooks workflows. */
export const REMINDER_RULES: ReminderRuleDef[] = [
  { id: 'due_2d', label: 'Invoice due in 2 days', description: 'Gentle reminder sent ~2 days before an invoice falls due.' },
  { id: 'overdue_7', label: 'Invoice 7 days overdue', description: 'First chase once an invoice is 7 days past its due date.', threshold: 7 },
  { id: 'overdue_30', label: 'Invoice 30 days overdue', description: 'Follow-up at 30 days past due.', threshold: 30 },
  { id: 'overdue_60', label: 'Invoice 60 days overdue', description: 'Follow-up at 60 days past due.', threshold: 60 },
  { id: 'overdue_90', label: 'Invoice 90 days overdue', description: 'Final reminder at 90 days past due.', threshold: 90 },
  { id: 'statement', label: 'Monthly statement (1st of month)', description: 'Full account statement emailed on the 1st of each month to any customer with an open balance.', isStatement: true },
];

/** Overdue rule thresholds, highest first — used to pick one escalation per run. */
export const OVERDUE_RULES: ReminderRuleDef[] = REMINDER_RULES
  .filter(r => typeof r.threshold === 'number')
  .sort((a, b) => (b.threshold || 0) - (a.threshold || 0));

export interface ReminderTemplate {
  enabled: boolean;
  subject: string;
  body: string;
}

export interface ReminderConfig {
  /** 'preview' = log only, never sends. 'live' = actually emails customers. */
  mode: 'preview' | 'live';
  rules: Record<ReminderRuleId, ReminderTemplate>;
}

/** Placeholders the user can use in subject/body, with human-readable help. */
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

/** Sensible starting templates — the user is expected to edit these in the UI. */
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

/** Merge a stored (possibly partial) config onto the defaults so new rules appear. */
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

/** Substitute {{token}} placeholders. Unknown tokens are left untouched. */
export function renderTemplate(template: string, vars: ReminderTemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const v = (vars as Record<string, unknown>)[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/** Turn a plain-text template body into simple, safe HTML for email. */
export function bodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;white-space:pre-wrap;line-height:1.5">${escaped}</div>`;
}

export interface ReminderInvoiceInput {
  dueDate: string | null;
}

/**
 * Decide which single overdue/due rule (if any) applies to an invoice today.
 * Picks the highest overdue threshold the invoice has reached, else the
 * "due in 2 days" rule when within the pre-due window. Returns null if none
 * apply or the matching rule is disabled.
 */
export function selectRuleForInvoice(
  inv: ReminderInvoiceInput,
  config: ReminderConfig,
): ReminderRuleId | null {
  const dpd = daysPastDue(inv.dueDate);
  // Overdue: highest applicable enabled threshold wins.
  for (const rule of OVERDUE_RULES) {
    if (dpd >= (rule.threshold as number) && config.rules[rule.id].enabled) {
      return rule.id;
    }
  }
  // Pre-due gentle reminder: due within the next 2 days (and not yet overdue).
  if (dpd <= 0 && dpd >= -2 && config.rules.due_2d.enabled) {
    return 'due_2d';
  }
  return null;
}
