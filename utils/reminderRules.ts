// ─── Automated payment reminders — shared rule definitions (FRONTEND) ───────
// This is the copy used by the React UI (ReminderSettingsModal). The Vercel
// serverless functions (api/reminders.ts, api/cron/invoice-reminders.ts) keep
// their OWN inlined copies of this logic, because Vercel's function bundler in
// this project does not reliably include cross-file imports — every api/*.ts
// here is deliberately self-contained. Keep the rule IDs and config shape in
// sync across the three copies (the stored config is just JSON keyed by ID).

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
