import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Save, Bell, CheckCircle2, AlertTriangle, Eye, Send, History, MailCheck } from 'lucide-react';
import {
  REMINDER_RULES,
  TEMPLATE_PLACEHOLDERS,
  normalizeReminderConfig,
  type ReminderConfig,
  type ReminderRuleId,
} from '../utils/reminderRules';

interface Props {
  isDark: boolean;
  onClose: () => void;
  /** Optional identifier of who is editing, stored on save. */
  updatedBy?: string;
}

interface LogRow {
  id: number;
  dedupe_key: string;
  rule_id: string;
  mode: string;
  status: string;
  customer_name: string | null;
  invoice_no: string | null;
  recipient: string | null;
  amount: number | null;
  subject: string | null;
  error: string | null;
  sent_at: string;
}

const ReminderSettingsModal: React.FC<Props> = ({ isDark, onClose, updatedBy }) => {
  const [config, setConfig] = useState<ReminderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'rules' | 'log'>('rules');
  const [log, setLog] = useState<LogRow[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testingRule, setTestingRule] = useState<ReminderRuleId | null>(null);
  const [testMsg, setTestMsg] = useState<{ id: ReminderRuleId; ok: boolean; text: string } | null>(null);

  const post = (payload: Record<string, unknown>) =>
    fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  useEffect(() => {
    (async () => {
      try {
        const r = await post({ action: 'get-config' });
        const data = await r.json();
        setConfig(normalizeReminderConfig(data?.config));
      } catch {
        setError('Could not load reminder settings.');
        setConfig(normalizeReminderConfig(null));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const r = await post({ action: 'get-log', limit: 200 });
      const data = await r.json();
      setLog(Array.isArray(data?.rows) ? data.rows : []);
    } catch {
      setLog([]);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'log') loadLog();
  }, [tab, loadLog]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await post({ action: 'save-config', config, updatedBy });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error || 'Save failed');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const updateRule = (id: ReminderRuleId, patch: Partial<ReminderConfig['rules'][ReminderRuleId]>) => {
    setConfig(c => (c ? { ...c, rules: { ...c.rules, [id]: { ...c.rules[id], ...patch } } } : c));
  };

  const sendTest = async (id: ReminderRuleId) => {
    if (!config) return;
    setTestMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())) {
      setTestMsg({ id, ok: false, text: 'Enter a valid email address above first.' });
      return;
    }
    setTestingRule(id);
    try {
      const rule = config.rules[id];
      const r = await post({ action: 'send-test', to: testEmail.trim(), subject: rule.subject, body: rule.body });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Send failed');
      setTestMsg({ id, ok: true, text: `Test sent to ${testEmail.trim()}` });
    } catch (e) {
      setTestMsg({ id, ok: false, text: e instanceof Error ? e.message : 'Send failed' });
    } finally {
      setTestingRule(null);
    }
  };

  const panel = isDark ? 'bg-slate-800 border-slate-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800';
  const inputCls = `w-full text-xs rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 ${isDark ? 'bg-slate-900 border-slate-600 text-gray-100 placeholder-gray-500' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`;
  const labelCls = `text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-gray-400' : 'text-gray-500'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border shadow-2xl flex flex-col ${panel}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-500" />
            <div>
              <h2 className="text-base font-black">Automated Payment Reminders</h2>
              <p className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Replaces QuickBooks workflow automation. Emails from accounts@marxcorporate.com.</p>
            </div>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className={`flex items-center gap-1 px-5 pt-3 border-b ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
          {([['rules', 'Rules & Messages'], ['log', 'Activity Log']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors ${tab === key ? 'border-indigo-500 text-indigo-500' : `border-transparent ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
          )}

          {!loading && tab === 'rules' && config && (
            <div className="space-y-5">
              {/* Mode toggle */}
              <div className={`rounded-xl border p-4 ${config.mode === 'live' ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-900/20 dark:border-emerald-700' : 'border-amber-400 bg-amber-50/50 dark:bg-amber-900/20 dark:border-amber-700'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-black">
                      {config.mode === 'live' ? <Send className="w-4 h-4 text-emerald-600" /> : <Eye className="w-4 h-4 text-amber-600" />}
                      {config.mode === 'live' ? 'LIVE — emails are being sent' : 'PREVIEW — nothing is sent'}
                    </div>
                    <p className={`text-[11px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                      {config.mode === 'live'
                        ? 'Customers receive reminders on schedule. Switch to Preview to pause.'
                        : 'The system logs what it WOULD send (see Activity Log) but emails nobody. Verify, then switch to Live.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setConfig(c => (c ? { ...c, mode: c.mode === 'live' ? 'preview' : 'live' } : c))}
                    className={`shrink-0 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors ${config.mode === 'live' ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600' : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'}`}>
                    {config.mode === 'live' ? 'Switch to Preview' : 'Go Live'}
                  </button>
                </div>
              </div>

              {/* Placeholders help */}
              <div className={`rounded-lg border px-3 py-2 text-[11px] ${isDark ? 'border-slate-700 bg-slate-900/50 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                <span className="font-bold">Placeholders:</span>{' '}
                {TEMPLATE_PLACEHOLDERS.map(p => (
                  <code key={p.token} title={p.description} className={`mx-0.5 px-1 py-0.5 rounded ${isDark ? 'bg-slate-700 text-indigo-300' : 'bg-white text-indigo-600 border border-gray-200'}`}>{p.token}</code>
                ))}
              </div>

              {/* Test email */}
              <div className={`rounded-xl border p-3 ${isDark ? 'border-indigo-800 bg-indigo-900/20' : 'border-indigo-200 bg-indigo-50/50'}`}>
                <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-indigo-500 mb-1.5">
                  <MailCheck className="w-3.5 h-3.5" /> Test before going live
                </div>
                <p className={`text-[11px] mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  Enter your email, then use the <span className="font-bold">Send test</span> button on any rule below. It sends that message with sample data from accounts@marxcorporate.com — real customers are not affected.
                </p>
                <input type="email" placeholder="you@marxcorporate.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} className={inputCls} />
              </div>

              {/* Rules */}
              {REMINDER_RULES.map(def => {
                const rule = config.rules[def.id];
                return (
                  <div key={def.id} className={`rounded-xl border p-4 ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="text-sm font-black">{def.label}</div>
                        <div className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{def.description}</div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer shrink-0">
                        <span className={labelCls}>{rule.enabled ? 'On' : 'Off'}</span>
                        <input type="checkbox" checked={rule.enabled} onChange={e => updateRule(def.id, { enabled: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                      </label>
                    </div>
                    <div className={`space-y-2 ${rule.enabled ? '' : 'opacity-50'}`}>
                      <div>
                        <label className={labelCls}>Subject</label>
                        <input className={inputCls} value={rule.subject} disabled={!rule.enabled}
                          onChange={e => updateRule(def.id, { subject: e.target.value })} />
                      </div>
                      <div>
                        <label className={labelCls}>Message</label>
                        <textarea className={`${inputCls} font-mono leading-relaxed`} rows={def.isStatement ? 5 : 4} value={rule.body} disabled={!rule.enabled}
                          onChange={e => updateRule(def.id, { body: e.target.value })} />
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button type="button" onClick={() => sendTest(def.id)} disabled={testingRule === def.id}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-colors disabled:opacity-50 ${isDark ? 'bg-slate-700 text-indigo-300 border-slate-600 hover:bg-slate-600' : 'bg-white text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}>
                          {testingRule === def.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <MailCheck className="w-3 h-3" />} Send test
                        </button>
                        {testMsg?.id === def.id && (
                          <span className={`text-[11px] font-bold ${testMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{testMsg.text}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && tab === 'log' && (
            <div>
              {logLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : log.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
                  <History className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm font-medium">No reminders logged yet.</p>
                  <p className="text-[11px]">The cron runs each morning; preview entries will appear here.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {log.map(row => (
                    <div key={row.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-[11px] ${isDark ? 'border-slate-700 bg-slate-900/40' : 'border-gray-100 bg-gray-50'}`}>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${row.mode === 'live' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>{row.mode}</span>
                      <span className={`shrink-0 ${row.status === 'failed' ? 'text-red-500' : row.status === 'skipped' ? 'text-gray-400' : 'text-emerald-500'}`}>
                        {row.status === 'failed' ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold truncate">{row.customer_name || '—'} {row.invoice_no ? `· #${row.invoice_no}` : ''}</div>
                        <div className={`truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{row.recipient || 'no email'} · {row.rule_id}{row.error ? ` · ${row.error}` : ''}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold">{row.amount != null ? '£' + Number(row.amount).toFixed(2) : ''}</div>
                        <div className={isDark ? 'text-gray-500' : 'text-gray-400'}>{new Date(row.sent_at).toLocaleDateString('en-GB')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {tab === 'rules' && !loading && (
          <div className={`flex items-center justify-between gap-3 px-5 py-3 border-t ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
            <div className="text-[11px]">
              {error && <span className="text-red-500 font-bold">{error}</span>}
              {saved && <span className="text-emerald-500 font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Saved</span>}
            </div>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReminderSettingsModal;
