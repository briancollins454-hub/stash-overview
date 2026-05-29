import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── Reminder config types + normaliser (inlined; see utils/reminderRules.ts) ─
// Kept self-contained because Vercel's function bundler in this project does
// not reliably include cross-file imports.
type ReminderRuleId = 'due_2d' | 'overdue_7' | 'overdue_30' | 'overdue_60' | 'overdue_90' | 'statement';
interface ReminderTemplate { enabled: boolean; subject: string; body: string }
interface ReminderConfig { mode: 'preview' | 'live'; rules: Record<ReminderRuleId, ReminderTemplate> }

const RULE_IDS: ReminderRuleId[] = ['due_2d', 'overdue_7', 'overdue_30', 'overdue_60', 'overdue_90', 'statement'];
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

// ─── Automated payment reminders — settings + log API (browser-facing) ──────
// GET-style actions for the Finance page Reminder Settings panel:
//   { action: 'get-config' }            -> { ok, config }
//   { action: 'save-config', config }   -> { ok }
//   { action: 'get-log', limit? }       -> { ok, rows }
// The nightly cron (api/cron/invoice-reminders.ts) is what actually sends.

const CONFIG_ROW_ID = 'reminder_config';

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
        `${url}/rest/v1/stash_reminder_settings?id=eq.${CONFIG_ROW_ID}&select=data`,
        { headers, signal: AbortSignal.timeout(8000) },
      );
      const rows = r.ok ? await r.json() : [];
      const data = Array.isArray(rows) && rows.length > 0 ? rows[0].data : null;
      return res.status(200).json({ ok: true, config: normalizeReminderConfig(data) });
    }

    if (action === 'save-config') {
      const config: ReminderConfig = normalizeReminderConfig(body.config);
      const updatedBy = typeof body.updatedBy === 'string' ? body.updatedBy : null;
      const r = await fetch(`${url}/rest/v1/stash_reminder_settings`, {
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

    if (action === 'get-log') {
      const limit = Math.min(Number(body.limit) || 100, 500);
      const r = await fetch(
        `${url}/rest/v1/stash_reminder_log?select=*&order=sent_at.desc&limit=${limit}`,
        { headers, signal: AbortSignal.timeout(8000) },
      );
      const rows = r.ok ? await r.json() : [];
      return res.status(200).json({ ok: true, rows: Array.isArray(rows) ? rows : [] });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Reminders API error';
    return res.status(500).json({ error: message });
  }
}
