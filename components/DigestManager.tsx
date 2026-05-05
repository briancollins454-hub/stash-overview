import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { DecoJob } from '../types';
import { getItem, setItem } from '../services/localStore';
import { buildDigest, buildDigestHtml, type DigestData } from '../services/digestService';
import { mergeFinanceAndDecoJobs } from '../services/decoJobSources';

interface Props {
  decoJobs: DecoJob[];
}

const STORAGE_KEY = 'digest_recipients';

export default function DigestManager({ decoJobs }: Props) {
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [digestType, setDigestType] = useState<'daily' | 'weekly'>('daily');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [financeJobs, setFinanceJobs] = useState<DecoJob[]>([]);

  // Load saved recipients + cached finance jobs
  useEffect(() => {
    getItem<string[]>(STORAGE_KEY).then(saved => {
      if (saved) setRecipients(saved);
    });
    getItem<DecoJob[]>('stash_finance_jobs').then(cached => {
      if (cached) setFinanceJobs(cached);
    });
  }, []);

  const allJobs = useMemo(
    () => mergeFinanceAndDecoJobs(financeJobs, decoJobs),
    [decoJobs, financeJobs],
  );

  // Build digest data
  const digestData = useMemo(() => buildDigest(allJobs, digestType), [allJobs, digestType]);
  const digestHtml = useMemo(() => buildDigestHtml(digestData), [digestData]);

  // Save recipients to IndexedDB
  const saveRecipients = useCallback(async (list: string[]) => {
    setRecipients(list);
    await setItem(STORAGE_KEY, list);
  }, []);

  const addRecipient = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailError('Invalid email address');
      return;
    }
    if (recipients.includes(email)) {
      setEmailError('Already added');
      return;
    }
    setEmailError('');
    setNewEmail('');
    saveRecipients([...recipients, email]);
  };

  const removeRecipient = (email: string) => {
    saveRecipients(recipients.filter(e => e !== email));
  };

  const sendDigest = async () => {
    if (recipients.length === 0) {
      setSendResult({ ok: false, msg: 'Add at least one recipient first' });
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const subject = digestType === 'daily'
        ? `Stash Daily Digest \u2014 ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : `Stash Weekly Digest \u2014 ${digestData.periodLabel}`;

      const resp = await fetch('/api/send-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipients, subject, html: digestHtml }),
      });
      const data = await resp.json();
      if (resp.ok && data.success) {
        setSendResult({ ok: true, msg: `Sent to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}` });
      } else {
        setSendResult({ ok: false, msg: data.error || 'Failed to send' });
      }
    } catch (err: any) {
      setSendResult({ ok: false, msg: err.message || 'Network error' });
    } finally {
      setSending(false);
    }
  };

  const s = digestData.summary;

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-12">
      {/* Header */}
      <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 px-6 py-5">
        <h1 className="text-lg font-black text-white tracking-tight">Email Digest</h1>
        <p className="text-xs text-white/40 mt-0.5">Send daily or weekly order summaries to your team</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Recipients + Controls */}
        <div className="space-y-4">
          {/* Recipients */}
          <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 p-5">
            <h2 className="text-sm font-bold text-white mb-3">Recipients</h2>
            <div className="flex gap-2 mb-3">
              <input
                type="email"
                value={newEmail}
                onChange={e => { setNewEmail(e.target.value); setEmailError(''); }}
                onKeyDown={e => e.key === 'Enter' && addRecipient()}
                placeholder="email@example.com"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              <button
                onClick={addRecipient}
                className="px-4 py-2 bg-indigo-500/20 text-indigo-300 rounded-lg text-sm font-bold hover:bg-indigo-500/30 transition-colors"
              >
                Add
              </button>
            </div>
            {emailError && <p className="text-red-400 text-xs mb-2">{emailError}</p>}

            {recipients.length === 0 ? (
              <p className="text-white/20 text-xs text-center py-4">No recipients added yet</p>
            ) : (
              <div className="space-y-1.5">
                {recipients.map(email => (
                  <div key={email} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                    <span className="text-xs text-white/70 truncate">{email}</span>
                    <button
                      onClick={() => removeRecipient(email)}
                      className="text-red-400/60 hover:text-red-400 text-xs font-bold ml-2 shrink-0 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Digest type + send */}
          <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 p-5">
            <h2 className="text-sm font-bold text-white mb-3">Digest Type</h2>
            <div className="flex gap-2 mb-4">
              {(['daily', 'weekly'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setDigestType(t)}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider transition-all ${
                    digestType === t
                      ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <button
              onClick={sendDigest}
              disabled={sending || recipients.length === 0}
              className={`w-full px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                sending || recipients.length === 0
                  ? 'bg-white/5 text-white/20 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 active:scale-[0.98]'
              }`}
            >
              {sending ? 'Sending...' : `Send ${digestType} digest to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}`}
            </button>

            {sendResult && (
              <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
                sendResult.ok ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}>
                {sendResult.msg}
              </div>
            )}
          </div>

          {/* Preview toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="w-full px-4 py-2.5 bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 text-sm font-bold text-indigo-300 hover:bg-white/[0.02] transition-colors"
          >
            {showPreview ? 'Hide Preview' : 'Show Email Preview'}
          </button>
        </div>

        {/* Right: Summary + Preview */}
        <div className="lg:col-span-2 space-y-4">
          {/* Quick summary */}
          <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 p-5">
            <h2 className="text-sm font-bold text-white mb-1">
              {digestType === 'daily' ? 'Daily' : 'Weekly'} Summary
            </h2>
            <p className="text-[11px] text-white/30 mb-4">{digestData.periodLabel}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Active Orders" value={String(s.totalActive)} sub={fmt(s.totalValue)} color="text-indigo-400" />
              <StatCard label="New Orders" value={String(s.newOrders)} sub={fmt(s.newOrdersValue)} color="text-green-400" />
              <StatCard label="Completed" value={String(s.completedOrders)} sub={fmt(s.completedValue)} color="text-blue-400" />
              <StatCard label="Overdue" value={String(s.overdueOrders)} sub={fmt(s.overdueValue)} color={s.overdueOrders > 0 ? 'text-red-400' : 'text-green-400'} />
            </div>

            {/* Status breakdown */}
            {digestData.statusBreakdown.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Status Breakdown</h3>
                <div className="space-y-1">
                  {digestData.statusBreakdown.map(st => (
                    <div key={st.status} className="flex items-center justify-between text-xs">
                      <span className="text-white/60">{st.status}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-white/80 font-bold">{st.count}</span>
                        <span className="text-white/30 w-20 text-right">{fmt(st.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Overdue list */}
            {digestData.urgentOrders.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-bold text-red-400/70 uppercase tracking-wider mb-2">Overdue Orders</h3>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {digestData.urgentOrders.map(o => (
                    <div key={o.jobNumber} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-indigo-400/70 font-mono shrink-0">#{o.jobNumber}</span>
                        <span className="text-white/50 truncate">{o.customer}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-red-400 font-bold">{o.reason}</span>
                        <span className="text-white/30">{fmt(o.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Staff workload */}
            {digestData.staffWorkload.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Staff Workload</h3>
                <div className="space-y-1">
                  {digestData.staffWorkload.map(st => (
                    <div key={st.name} className="flex items-center justify-between text-xs">
                      <span className="text-white/60">{st.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-white/80 font-bold">{st.orders} orders</span>
                        <span className="text-white/30 w-20 text-right">{fmt(st.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* HTML Preview */}
          {showPreview && (
            <div className="bg-white rounded-2xl border border-indigo-500/20 overflow-hidden">
              <div className="bg-[#1e1e3a] px-5 py-3 flex items-center justify-between">
                <span className="text-xs font-bold text-white/50">Email Preview</span>
                <span className="text-[10px] text-white/25">This is how the email will look</span>
              </div>
              <iframe
                srcDoc={digestHtml}
                className="w-full border-0"
                style={{ height: '600px' }}
                title="Digest Preview"
                sandbox="allow-same-origin"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-white/5 rounded-xl p-3 text-center">
      <div className={`text-2xl font-black ${color}`}>{value}</div>
      <div className="text-[11px] font-bold text-white/70 mt-0.5">{label}</div>
      <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>
    </div>
  );
}

function fmt(n: number) {
  return '\u00a3' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
