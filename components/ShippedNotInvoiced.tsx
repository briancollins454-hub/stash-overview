import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package, Search, ArrowUpDown, AlertTriangle, ExternalLink, Download,
  RefreshCw, Check, Eye, EyeOff, Copy, Undo2,
} from 'lucide-react';
import { DecoJob } from '../types';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';
import { ApiSettings } from './SettingsModal';

interface Props {
  decoJobs: DecoJob[];
  isDark: boolean;
  settings: ApiSettings;
  onNavigateToOrder?: (orderNumber: string) => void;
  currentUserEmail?: string;
}

type SortKey = 'jobNumber' | 'customerName' | 'outstandingBalance' | 'dateShipped' | 'daysSinceShipped' | 'paymentRequestSentAt';
type SortDir = 'asc' | 'desc';

interface PaymentRequestRow {
  job_number: string;
  sent_at: string;
  sent_by: string | null;
}

// ─── Click-to-copy badge ────────────────────────────────────────────────────
// Mirrors the pattern used in PriorityBoard so the UX feels consistent: click
// the job number and it flashes "Copied" for ~1.2s while the value lands on
// the clipboard. Falls back to execCommand for older / non-HTTPS browsers so
// we don't silently fail.
const CopyableJobNum: React.FC<{ jobNumber: string; onNavigate?: () => void }> = ({ jobNumber, onNavigate }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jobNumber);
      } else {
        const ta = document.createElement('textarea');
        ta.value = jobNumber;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* silently ignore — clipboard denied */ }
  };
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Click to copy job number'}
        className={`font-mono font-medium text-xs flex items-center gap-1 transition-colors ${copied ? 'text-emerald-400' : 'text-indigo-400 hover:text-indigo-300'}`}
      >
        {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> {jobNumber}</>}
      </button>
      {onNavigate && (
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(); }}
          title="Go to order"
          className="text-slate-500 hover:text-indigo-300 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

const ShippedNotInvoiced: React.FC<Props> = ({ decoJobs, isDark, settings, onNavigateToOrder, currentUserEmail }) => {
  const [search, setSearch] = useState('');
  // Default to newest ship date first — staff asked for this because the
  // previous default (daysSinceShipped desc) buries freshly-shipped jobs
  // under old ones.
  const [sortKey, setSortKey] = useState<SortKey>('dateShipped');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);

  // Payment-request audit state: map jobNumber → {sent_at, sent_by}. Only
  // sent jobs are in the map; absence means "not sent". Loaded once from
  // Supabase on mount and kept locally in sync with every tick/untick.
  const [paymentSent, setPaymentSent] = useState<Record<string, PaymentRequestRow>>({});
  const [showSent, setShowSent] = useState(false);
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null);

  // Load from the FinancialDashboard's Supabase cache (finance_jobs) —
  // keeps us decoupled from the Finance tab's sync cycle.
  const loadFromFinanceCache = useCallback(async () => {
    if (!isSupabaseReady()) { setNoCache(true); return; }
    setIsLoading(true);
    try {
      const res = await supabaseFetch(
        'stash_finance_cache?id=eq.finance_jobs&select=data,last_synced', 'GET'
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0].data) && rows[0].data.length > 0) {
        setAllJobs(rows[0].data);
        setLastSynced(rows[0].last_synced);
        setNoCache(false);
      } else {
        setNoCache(true);
      }
    } catch {
      setNoCache(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadPaymentSent = useCallback(async () => {
    if (!isSupabaseReady()) return;
    try {
      const res = await supabaseFetch(
        'stash_payment_requests_sent?select=job_number,sent_at,sent_by', 'GET'
      );
      const rows: PaymentRequestRow[] = await res.json();
      if (!Array.isArray(rows)) return;
      const map: Record<string, PaymentRequestRow> = {};
      for (const r of rows) map[r.job_number] = r;
      setPaymentSent(map);
    } catch {
      // Non-fatal — checkbox column just defaults to "not sent".
    }
  }, []);

  useEffect(() => {
    loadFromFinanceCache();
    loadPaymentSent();
  }, [loadFromFinanceCache, loadPaymentSent]);

  const markSent = useCallback(async (jobNumber: string) => {
    if (!isSupabaseReady() || isTogglingId) return;
    setIsTogglingId(jobNumber);

    // Optimistic update so the row can fade out immediately; we roll back if
    // the Supabase write fails.
    const now = new Date().toISOString();
    const optimistic: PaymentRequestRow = { job_number: jobNumber, sent_at: now, sent_by: currentUserEmail || null };
    setPaymentSent(prev => ({ ...prev, [jobNumber]: optimistic }));

    try {
      await supabaseFetch(
        'stash_payment_requests_sent',
        'POST',
        { job_number: jobNumber, sent_at: now, sent_by: currentUserEmail || null, updated_at: now },
        'resolution=merge-duplicates'
      );
    } catch (e) {
      // Roll back — silent alert, row reappears.
      setPaymentSent(prev => {
        const next = { ...prev };
        delete next[jobNumber];
        return next;
      });
      console.error('Failed to mark payment request sent', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [currentUserEmail, isTogglingId]);

  const unmarkSent = useCallback(async (jobNumber: string) => {
    if (!isSupabaseReady() || isTogglingId) return;
    setIsTogglingId(jobNumber);

    // Snapshot so we can restore on error.
    const prevRow = paymentSent[jobNumber];
    setPaymentSent(prev => {
      const next = { ...prev };
      delete next[jobNumber];
      return next;
    });

    try {
      await supabaseFetch(
        `stash_payment_requests_sent?job_number=eq.${encodeURIComponent(jobNumber)}`,
        'DELETE'
      );
    } catch (e) {
      if (prevRow) setPaymentSent(prev => ({ ...prev, [jobNumber]: prevRow }));
      console.error('Failed to unmark payment request', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [paymentSent, isTogglingId]);

  const jobs = useMemo(() => {
    return allJobs.filter(j => {
      const bal = typeof j.outstandingBalance === 'string' ? parseFloat(j.outstandingBalance) : (j.outstandingBalance || 0);
      return !!j.dateShipped && bal > 0 && j.status !== 'Cancelled';
    }).map(j => {
      const outstanding = typeof j.outstandingBalance === 'string'
        ? parseFloat(j.outstandingBalance as any)
        : (j.outstandingBalance || 0);
      const sentRow = paymentSent[j.jobNumber];
      return {
        ...j,
        outstandingBalance: outstanding,
        daysSinceShipped: j.dateShipped
          ? Math.floor((Date.now() - new Date(j.dateShipped).getTime()) / 86400000)
          : 0,
        paymentRequestSentAt: sentRow?.sent_at || null,
        paymentRequestSentBy: sentRow?.sent_by || null,
      };
    });
  }, [allJobs, paymentSent]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = jobs;

    // Hide rows that have had their payment request sent unless the user has
    // explicitly asked to see the archive. Keeping this as a boolean toggle
    // (rather than a separate tab) keeps the layout simple and means the
    // headline "total outstanding" naturally reflects what's still pending.
    if (!showSent) {
      list = list.filter(j => !j.paymentRequestSentAt);
    }

    if (q) {
      list = list.filter(j =>
        j.jobNumber.toLowerCase().includes(q) ||
        j.poNumber?.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.jobName.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'jobNumber': av = a.jobNumber; bv = b.jobNumber; break;
        case 'customerName': av = a.customerName; bv = b.customerName; break;
        case 'outstandingBalance': av = a.outstandingBalance || 0; bv = b.outstandingBalance || 0; break;
        case 'dateShipped': av = a.dateShipped || ''; bv = b.dateShipped || ''; break;
        case 'daysSinceShipped': av = a.daysSinceShipped; bv = b.daysSinceShipped; break;
        case 'paymentRequestSentAt': av = a.paymentRequestSentAt || ''; bv = b.paymentRequestSentAt || ''; break;
        default: av = 0; bv = 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [jobs, search, sortKey, sortDir, showSent]);

  const totalOutstanding = useMemo(() => filtered.reduce((s, j) => s + (j.outstandingBalance || 0), 0), [filtered]);
  const sentCount = useMemo(() => Object.keys(paymentSent).length, [paymentSent]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const fmt = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d?: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (d?: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const exportCsv = () => {
    const header = ['Job Number', 'PO Number', 'Customer', 'Job Name', 'Outstanding', 'Date Shipped', 'Days Since Shipped', 'Payment Request Sent', 'Sent At', 'Sent By'];
    const rows = filtered.map(j => [
      j.jobNumber,
      j.poNumber || '',
      j.customerName,
      j.jobName,
      (j.outstandingBalance || 0).toFixed(2),
      j.dateShipped || '',
      j.daysSinceShipped.toString(),
      j.paymentRequestSentAt ? 'Yes' : 'No',
      j.paymentRequestSentAt || '',
      j.paymentRequestSentBy || '',
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shipped-not-invoiced-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cardBg = isDark ? 'bg-[#232347]' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-indigo-300' : 'text-gray-500';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const hoverRow = isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
            <Package className="w-5 h-5 text-amber-500" />
            Shipped Not Invoiced
          </h2>
          <p className={`text-sm ${textSecondary} mt-0.5`}>
            {isLoading ? 'Loading from cache...' : noCache
              ? 'No data yet — run a Full Sync from the Finance tab first'
              : lastSynced
                ? `Data from Finance sync: ${new Date(lastSynced).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : 'Jobs shipped with outstanding balance but no invoice sent'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadFromFinanceCache} disabled={isLoading} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} ${cardBg} text-xs font-medium ${textSecondary} ${isLoading ? 'opacity-50' : 'hover:bg-white/10'} transition-colors`} title="Reload from Finance cache">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Total Outstanding</span>
            <p className="text-lg font-bold text-amber-500">{fmt(totalOutstanding)}</p>
          </div>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Jobs</span>
            <p className={`text-lg font-bold ${textPrimary}`}>{filtered.length}</p>
          </div>
        </div>
      </div>

      {/* Search + toggles + Export */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondary}`} />
          <input
            type="text"
            placeholder="Search by job number, customer, PO..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-3 py-2 rounded-lg border ${borderColor} ${cardBg} ${textPrimary} text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none`}
          />
        </div>
        <button
          onClick={() => setShowSent(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} text-xs font-medium transition-colors ${showSent
            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
            : `${cardBg} ${textSecondary} hover:bg-white/10`}`}
          title={showSent ? 'Hide jobs where payment request has been sent' : 'Include jobs where payment request has been sent'}
        >
          {showSent ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showSent ? `Showing sent (${sentCount})` : `Hiding ${sentCount} sent`}
        </button>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Package className={`w-12 h-12 ${textSecondary} opacity-40 mb-3`} />
            <p className={`text-sm font-medium ${textSecondary}`}>
              {search
                ? 'No results matching your search'
                : noCache
                  ? 'Run a Full Sync from the Finance tab to populate this report'
                  : sentCount > 0 && !showSent
                    ? 'All caught up — all shipped jobs have had payment requests sent'
                    : 'No shipped jobs awaiting invoicing'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`border-b ${borderColor} ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  {([
                    ['jobNumber', 'Job #'],
                    ['customerName', 'Customer'],
                    ['', 'Job Name'],
                    ['outstandingBalance', 'Outstanding'],
                    ['dateShipped', 'Shipped'],
                    ['daysSinceShipped', 'Days Ago'],
                    ['paymentRequestSentAt', 'Payment Req.'],
                  ] as [SortKey | '', string][]).map(([key, label]) => (
                    <th
                      key={label}
                      onClick={key ? () => toggleSort(key as SortKey) : undefined}
                      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${textSecondary} ${key ? 'cursor-pointer select-none hover:text-indigo-400' : ''}`}
                    >
                      <span className="flex items-center gap-1">
                        {label}
                        {key && sortKey === key && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(j => {
                  const sent = !!j.paymentRequestSentAt;
                  const toggling = isTogglingId === j.jobNumber;
                  return (
                    <tr
                      key={j.jobNumber}
                      className={`border-b ${borderColor} ${hoverRow} transition-colors ${sent ? 'opacity-60' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <CopyableJobNum
                          jobNumber={j.jobNumber}
                          onNavigate={onNavigateToOrder ? () => onNavigateToOrder(j.poNumber || j.jobNumber) : undefined}
                        />
                      </td>
                      <td className={`px-4 py-3 font-medium ${textPrimary}`}>{j.customerName}</td>
                      <td className={`px-4 py-3 ${textSecondary} max-w-[200px] truncate`}>{j.jobName}</td>
                      <td className="px-4 py-3 font-bold text-amber-500">{fmt(j.outstandingBalance || 0)}</td>
                      <td className={`px-4 py-3 ${textSecondary}`}>{fmtDate(j.dateShipped)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          j.daysSinceShipped > 14
                            ? 'bg-red-500/20 text-red-400'
                            : j.daysSinceShipped > 7
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-green-500/20 text-green-400'
                        }`}>
                          {j.daysSinceShipped > 14 && <AlertTriangle className="w-3 h-3" />}
                          {j.daysSinceShipped}d
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {sent ? (
                          // When sent, show the timestamp + who, plus a small
                          // undo so accidental ticks can be reverted without
                          // a page round-trip.
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">
                              <Check className="w-3 h-3" />
                              Sent {fmtDateTime(j.paymentRequestSentAt)}
                            </span>
                            <button
                              onClick={() => unmarkSent(j.jobNumber)}
                              disabled={toggling}
                              title={`Undo — sent by ${j.paymentRequestSentBy || 'unknown'}`}
                              className="text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-40"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => markSent(j.jobNumber)}
                            disabled={toggling}
                            title="Mark payment request as sent"
                            className={`flex items-center gap-1.5 px-2 py-1 rounded border ${borderColor} text-xs font-medium ${textSecondary} hover:bg-indigo-500/20 hover:text-indigo-300 hover:border-indigo-500/40 transition-colors disabled:opacity-40`}
                          >
                            <div className="w-3.5 h-3.5 rounded-sm border border-current flex items-center justify-center">
                              {toggling && <Check className="w-2.5 h-2.5" />}
                            </div>
                            Mark sent
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShippedNotInvoiced;
