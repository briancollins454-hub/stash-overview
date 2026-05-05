/**
 * Credit Block List
 * -----------------
 * Credit-control triage view. Lists only customers who have at least one
 * invoice that is PAST their agreed payment terms — i.e. legitimately
 * overdue. Each customer row aggregates their overdue total and can be
 * expanded to show the individual overdue invoices (job name, job number,
 * invoice date, due date, outstanding balance, days overdue).
 *
 * Data source: the same Supabase finance cache populated by
 * FinancialDashboard (stash_finance_cache / id=finance_jobs). Falls back
 * to the decoJobs prop if the cache is unavailable.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  Download,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CloudDownload,
} from 'lucide-react';

import { DecoJob } from '../types';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';
import { fetchDecoFinancials } from '../services/apiService';
import { isDecoJobCancelled } from '../services/decoJobFilters';
import { mergeFinanceAndDecoJobs } from '../services/decoJobSources';
import { ApiSettings } from './SettingsModal';

interface Props {
  decoJobs: DecoJob[];
  isDark: boolean;
  settings: ApiSettings;
  onNavigateToOrder?: (jobNumber: string) => void;
}

type SortKey = 'customer' | 'overdueTotal' | 'oldestDays' | 'invoiceCount' | 'terms';
type SortDir = 'asc' | 'desc';

interface OverdueInvoice {
  job: DecoJob;
  invoiceDate: string;          // ISO
  dueDate: string;              // ISO
  termsDays: number;
  daysOverdue: number;
  outstanding: number;
}

interface CreditBlockedCustomer {
  name: string;
  accountTerms: string;
  invoices: OverdueInvoice[];
  overdueTotal: number;
  oldestDaysOverdue: number;
  newestDaysOverdue: number;
}

const formatCurrency = (v: number): string =>
  '£' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const parseTermsDays = (terms: string | undefined | null, fallback = 30): number => {
  if (!terms) return fallback;
  // Typical values: "30", "Net 30", "14 days", "COD", "On receipt"
  const t = terms.toString().trim().toLowerCase();
  if (t === 'cod' || t.includes('receipt') || t.includes('pro forma') || t.includes('proforma')) return 0;
  const m = t.match(/(\d+)/);
  if (!m) return fallback;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const daysBetween = (fromIso: string, toMs = Date.now()): number => {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.floor((toMs - from) / 86_400_000);
};

const bucketColor = (days: number, isDark: boolean): string => {
  if (days >= 90) return isDark ? 'bg-rose-900/40 text-rose-300 border-rose-500/40' : 'bg-rose-100 text-rose-700 border-rose-300';
  if (days >= 60) return isDark ? 'bg-orange-900/40 text-orange-300 border-orange-500/40' : 'bg-orange-100 text-orange-700 border-orange-300';
  if (days >= 30) return isDark ? 'bg-amber-900/40 text-amber-300 border-amber-500/40' : 'bg-amber-100 text-amber-700 border-amber-300';
  return isDark ? 'bg-yellow-900/40 text-yellow-300 border-yellow-500/40' : 'bg-yellow-100 text-yellow-700 border-yellow-300';
};

const CreditBlockList: React.FC<Props> = ({ decoJobs, isDark, settings, onNavigateToOrder }) => {
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  // See ShippedNotInvoiced / UnpaidOrders for the rationale — `isPulling`
  // covers the heavier "ask Deco for the last 60 days" path so the new
  // Pull-from-Deco button can show its own state and we can guard against
  // double-clicks while a sync is in flight.
  const [isPulling, setIsPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('overdueTotal');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const jobsBase = useMemo(() => mergeFinanceAndDecoJobs(allJobs, decoJobs), [allJobs, decoJobs]);

  /* ---------- Load from finance cache ---------- */
  const loadFromCache = useCallback(async () => {
    if (!isSupabaseReady()) { setNoCache(true); return; }
    setIsLoading(true);
    try {
      const res = await supabaseFetch(
        'stash_finance_cache?id=eq.finance_jobs&select=data,last_synced',
        'GET'
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

  useEffect(() => { loadFromCache(); }, [loadFromCache]);

  // "Pull from Deco" — fetches the last 60 days fresh, merges into the
  // shared finance cache, and reloads. Same merge semantics as the nightly
  // cron / FinancialDashboard incrementalSync, so credit-control staff
  // can confirm that an invoice paid an hour ago has actually fallen off
  // the list without having to bounce off to the Finance tab.
  const pullFreshFromDeco = useCallback(async () => {
    if (isPulling || isLoading) return;
    if (!settings.useLiveData) {
      setPullError('Live data is disabled in Settings — can\'t reach Deco');
      return;
    }
    if (!isSupabaseReady()) {
      setPullError('Supabase not configured — data can\'t be cached');
      return;
    }
    setIsPulling(true);
    setPullError(null);
    setPullProgress({ current: 0, total: 0 });
    try {
      const sinceYear = new Date().getFullYear();
      const fresh = await fetchDecoFinancials(
        settings,
        sinceYear,
        (current, total) => setPullProgress({ current, total }),
      );

      let existing: DecoJob[] = [];
      try {
        const res = await supabaseFetch(
          'stash_finance_cache?id=eq.finance_jobs&select=data', 'GET'
        );
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0].data)) {
          existing = rows[0].data;
        }
      } catch { /* first-run / cache empty */ }

      const recentByNumber = new Map(fresh.map(j => [j.jobNumber, j]));
      const seen = new Set<string>();
      const merged: DecoJob[] = existing.map(j => {
        seen.add(j.jobNumber);
        return recentByNumber.get(j.jobNumber) || j;
      });
      for (const j of fresh) {
        if (!seen.has(j.jobNumber)) merged.push(j);
      }

      const lean = merged.map(j => ({
        ...j,
        items: (j.items || []).map(item => ({
          name: item.name,
          productCode: item.productCode,
          vendorSku: item.vendorSku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          isReceived: item.isReceived,
          isProduced: item.isProduced,
          isShipped: item.isShipped,
        })),
      }));
      const syncedAt = new Date().toISOString();
      await supabaseFetch(
        'stash_finance_cache',
        'POST',
        { id: 'finance_jobs', data: lean, last_synced: syncedAt, updated_at: syncedAt },
        'resolution=merge-duplicates'
      );

      setAllJobs(merged);
      setLastSynced(syncedAt);
      setNoCache(false);
    } catch (e: any) {
      setPullError(e?.message || 'Failed to pull from Deco');
    } finally {
      setIsPulling(false);
      setPullProgress(null);
    }
  }, [isPulling, isLoading, settings]);

  /* ---------- Build overdue customer list ---------- */
  const customers = useMemo<CreditBlockedCustomer[]>(() => {
    const byCustomer = new Map<string, OverdueInvoice[]>();

    for (const j of jobsBase) {
      if (isDecoJobCancelled(j) || j.isQuote) continue;
      const outstanding = typeof j.outstandingBalance === 'string'
        ? parseFloat(j.outstandingBalance as any)
        : (j.outstandingBalance || 0);
      if (!(outstanding > 0.009)) continue;          // nothing to chase
      if (!j.dateInvoiced) continue;                  // not invoiced yet

      const termsDays = parseTermsDays(j.accountTerms);
      const dueDateMs = new Date(j.dateInvoiced).getTime() + termsDays * 86_400_000;
      if (!Number.isFinite(dueDateMs)) continue;
      const daysOverdue = Math.floor((Date.now() - dueDateMs) / 86_400_000);
      if (daysOverdue <= 0) continue;                 // still within terms

      const inv: OverdueInvoice = {
        job: j,
        invoiceDate: j.dateInvoiced,
        dueDate: new Date(dueDateMs).toISOString(),
        termsDays,
        daysOverdue,
        outstanding,
      };

      const key = j.customerName?.trim() || 'Unknown';
      if (!byCustomer.has(key)) byCustomer.set(key, []);
      byCustomer.get(key)!.push(inv);
    }

    const out: CreditBlockedCustomer[] = [];
    for (const [name, invoices] of byCustomer.entries()) {
      invoices.sort((a, b) => b.daysOverdue - a.daysOverdue);
      const overdueTotal = invoices.reduce((s, i) => s + i.outstanding, 0);
      // Most common account terms across these invoices
      const termsCount = new Map<string, number>();
      invoices.forEach(i => {
        const t = i.job.accountTerms || `${i.termsDays}`;
        termsCount.set(t, (termsCount.get(t) || 0) + 1);
      });
      const accountTerms = Array.from(termsCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
      out.push({
        name,
        accountTerms,
        invoices,
        overdueTotal,
        oldestDaysOverdue: invoices[0].daysOverdue,
        newestDaysOverdue: invoices[invoices.length - 1].daysOverdue,
      });
    }
    return out;
  }, [jobsBase]);

  /* ---------- Search + sort ---------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = customers;
    if (q) {
      list = customers.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.invoices.some(i =>
          i.job.jobNumber.toLowerCase().includes(q) ||
          (i.job.jobName || '').toLowerCase().includes(q) ||
          (i.job.poNumber || '').toLowerCase().includes(q)
        )
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'customer':     cmp = a.name.localeCompare(b.name); break;
        case 'overdueTotal': cmp = a.overdueTotal - b.overdueTotal; break;
        case 'oldestDays':   cmp = a.oldestDaysOverdue - b.oldestDaysOverdue; break;
        case 'invoiceCount': cmp = a.invoices.length - b.invoices.length; break;
        case 'terms':        cmp = a.accountTerms.localeCompare(b.accountTerms); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [customers, search, sortKey, sortDir]);

  /* ---------- Totals for header ---------- */
  const totals = useMemo(() => {
    const totalOverdue = customers.reduce((s, c) => s + c.overdueTotal, 0);
    const totalInvoices = customers.reduce((s, c) => s + c.invoices.length, 0);
    let bucket30 = 0, bucket60 = 0, bucket90 = 0, bucket90plus = 0;
    customers.forEach(c => c.invoices.forEach(i => {
      if (i.daysOverdue >= 90) bucket90plus += i.outstanding;
      else if (i.daysOverdue >= 60) bucket90 += i.outstanding;
      else if (i.daysOverdue >= 30) bucket60 += i.outstanding;
      else bucket30 += i.outstanding;
    }));
    return { totalOverdue, totalInvoices, bucket30, bucket60, bucket90, bucket90plus };
  }, [customers]);

  /* ---------- Actions ---------- */
  const toggleExpanded = useCallback((name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const exportCSV = useCallback(() => {
    const rows: string[][] = [];
    rows.push([
      'Customer', 'Account Terms', 'Job Number', 'Job Name', 'PO Number',
      'Invoice Date', 'Due Date', 'Days Overdue', 'Outstanding (£)',
    ]);
    filtered.forEach(c => {
      c.invoices.forEach(i => {
        rows.push([
          c.name,
          c.accountTerms,
          i.job.jobNumber,
          i.job.jobName || '',
          i.job.poNumber || '',
          formatDate(i.invoiceDate),
          formatDate(i.dueDate),
          String(i.daysOverdue),
          i.outstanding.toFixed(2),
        ]);
      });
    });
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credit-block-list-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  /* ---------- Rendering ---------- */
  const card = isDark ? 'bg-[#1a1a3a] border border-indigo-500/20' : 'bg-white border border-gray-200 shadow-sm';
  const headerText = isDark ? 'text-[10px] font-black uppercase tracking-widest text-indigo-300/70' : 'text-[10px] font-black uppercase tracking-widest text-gray-400';
  const sortHeaderBtn = 'flex items-center gap-1 hover:text-indigo-400 transition-colors';

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className={`w-5 h-5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
          <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Credit Block List</h2>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
            isDark ? 'bg-rose-500/10 text-rose-300 border-rose-500/20' : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}>
            Credit Control
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastSynced && (() => {
            const ageMs = Date.now() - Date.parse(lastSynced);
            const ageMins = Math.max(0, Math.round(ageMs / 60000));
            const ageLabel = ageMins < 60
              ? `${ageMins}m ago`
              : ageMins < 60 * 24
                ? `${Math.round(ageMins / 60)}h ago`
                : `${Math.round(ageMins / 60 / 24)}d ago`;
            const stale = ageMs > 4 * 60 * 60 * 1000;
            const veryStale = ageMs > 24 * 60 * 60 * 1000;
            const toneClasses = veryStale
              ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
              : stale
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
            return (
              <>
                <span className={`text-[10px] ${isDark ? 'text-indigo-400/70' : 'text-gray-500'}`}>
                  Cached {new Date(lastSynced).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-widest ${toneClasses}`}>
                  {ageLabel}
                </span>
              </>
            );
          })()}
          <button
            onClick={pullFreshFromDeco}
            disabled={isPulling || isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors border border-indigo-500/30 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Fetch the last 60 days fresh from Deco and update the shared cache"
          >
            <CloudDownload className={`w-3 h-3 ${isPulling ? 'animate-pulse' : ''}`} />
            {isPulling
              ? (pullProgress && pullProgress.total > 0 ? `Pulling ${pullProgress.current}/${pullProgress.total}` : 'Pulling…')
              : 'Pull from Deco'}
          </button>
          <button
            onClick={loadFromCache}
            disabled={isLoading || isPulling}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors border ${
              isDark
                ? 'bg-[#232354] text-indigo-200 hover:text-white border-indigo-500/20 hover:border-indigo-500/40'
                : 'bg-white text-gray-700 hover:text-gray-900 border-gray-200 hover:border-gray-400'
            } disabled:opacity-50`}
            title="Re-read from the shared finance cache (fast, doesn't talk to Deco)"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-indigo-500 hover:bg-indigo-600 text-white transition-colors disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Explainer */}
      <p className={`text-xs ${isDark ? 'text-indigo-300/80' : 'text-gray-600'}`}>
        Customers below have one or more invoices that are past their agreed payment terms. Click a row
        to see the specific overdue invoices. Invoice Date + Terms = Due Date; anything older than that
        appears here.
      </p>

      {pullError && (
        <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200' : 'bg-rose-50 border border-rose-200 text-rose-800'}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" /> {pullError}
        </div>
      )}

      {noCache && (
        <div className={`rounded-lg p-4 text-sm ${isDark ? 'bg-amber-500/10 border border-amber-500/30 text-amber-200' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
          No cached finance data found. Click "Pull from Deco" above, or run a sync from the Finance tab.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className={`${card} p-4`}>
          <div className={headerText}>Customers on Block</div>
          <div className={`text-2xl font-black mt-1 ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>{customers.length.toLocaleString()}</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-indigo-400/70' : 'text-gray-400'}`}>
            {totals.totalInvoices} overdue invoice{totals.totalInvoices === 1 ? '' : 's'}
          </div>
        </div>
        <div className={`${card} p-4`}>
          <div className={headerText}>Total Overdue</div>
          <div className={`text-2xl font-black mt-1 ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>{formatCurrency(totals.totalOverdue)}</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-indigo-400/70' : 'text-gray-400'}`}>past payment terms</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={headerText}>1–30 Days Over</div>
          <div className={`text-xl font-black mt-1 ${isDark ? 'text-yellow-300' : 'text-yellow-600'}`}>{formatCurrency(totals.bucket30)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={headerText}>30–60 Days Over</div>
          <div className={`text-xl font-black mt-1 ${isDark ? 'text-amber-300' : 'text-amber-600'}`}>{formatCurrency(totals.bucket60)}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={headerText}>60+ Days Over</div>
          <div className={`text-xl font-black mt-1 ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>{formatCurrency(totals.bucket90 + totals.bucket90plus)}</div>
          <div className={`text-[10px] mt-0.5 ${isDark ? 'text-indigo-400/70' : 'text-gray-400'}`}>
            {formatCurrency(totals.bucket90plus)} at 90+
          </div>
        </div>
      </div>

      {/* Search */}
      <div className={`${card} p-3`}>
        <div className="relative">
          <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-indigo-400/60' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search customer, job number, PO..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`w-full pl-9 pr-3 py-2 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-500 ${
              isDark
                ? 'bg-slate-700 border border-slate-600 text-white placeholder-gray-500'
                : 'bg-gray-50 border border-gray-200 text-gray-800 placeholder-gray-400'
            }`}
          />
        </div>
      </div>

      {/* Table */}
      <div className={`${card} overflow-hidden`}>
        {filtered.length === 0 ? (
          <div className={`p-10 text-center text-sm ${isDark ? 'text-indigo-300/70' : 'text-gray-500'}`}>
            {customers.length === 0
              ? 'No customers are currently overdue. '
              : 'No matches for your search.'}
            {customers.length === 0 && <AlertTriangle className="w-4 h-4 inline-block ml-1 -mt-0.5 text-emerald-400" />}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={`${isDark ? 'bg-[#232354] text-indigo-300' : 'bg-gray-50 text-gray-600'} uppercase tracking-wider text-[10px]`}>
                <tr>
                  <th className="w-8 px-3 py-3"></th>
                  <th className="text-left px-3 py-3 font-bold">
                    <button onClick={() => toggleSort('customer')} className={sortHeaderBtn}>
                      Customer
                      {sortKey === 'customer' && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                  <th className="text-right px-3 py-3 font-bold">
                    <button onClick={() => toggleSort('overdueTotal')} className={`${sortHeaderBtn} ml-auto`}>
                      Overdue Total
                      {sortKey === 'overdueTotal' && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 font-bold">
                    <button onClick={() => toggleSort('invoiceCount')} className={`${sortHeaderBtn} mx-auto`}>
                      Invoices
                      {sortKey === 'invoiceCount' && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 font-bold">
                    <button onClick={() => toggleSort('oldestDays')} className={`${sortHeaderBtn} mx-auto`}>
                      Oldest
                      {sortKey === 'oldestDays' && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 font-bold">
                    <button onClick={() => toggleSort('terms')} className={`${sortHeaderBtn} mx-auto`}>
                      Terms
                      {sortKey === 'terms' && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, ci) => {
                  const isOpen = expanded.has(c.name);
                  const rowBase = isDark
                    ? ci % 2 === 0 ? 'bg-[#1a1a3a]' : 'bg-[#1e1e42]'
                    : ci % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                  return (
                    <React.Fragment key={c.name}>
                      <tr
                        className={`${rowBase} border-t ${isDark ? 'border-indigo-500/10 hover:bg-indigo-500/5' : 'border-gray-100 hover:bg-indigo-50/40'} cursor-pointer transition-colors`}
                        onClick={() => toggleExpanded(c.name)}
                      >
                        <td className="px-3 py-3 text-center">
                          {isOpen
                            ? <ChevronDown className={`w-4 h-4 ${isDark ? 'text-indigo-300' : 'text-gray-500'}`} />
                            : <ChevronRight className={`w-4 h-4 ${isDark ? 'text-indigo-400/60' : 'text-gray-400'}`} />
                          }
                        </td>
                        <td className={`px-3 py-3 font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {c.name}
                        </td>
                        <td className={`px-3 py-3 text-right font-black ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                          {formatCurrency(c.overdueTotal)}
                        </td>
                        <td className={`px-3 py-3 text-center ${isDark ? 'text-indigo-200' : 'text-gray-700'}`}>
                          {c.invoices.length}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${bucketColor(c.oldestDaysOverdue, isDark)}`}>
                            {c.oldestDaysOverdue}d
                          </span>
                        </td>
                        <td className={`px-3 py-3 text-center text-[11px] font-medium ${isDark ? 'text-indigo-300' : 'text-gray-600'}`}>
                          {c.accountTerms}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className={isDark ? 'bg-[#12122a]' : 'bg-indigo-50/30'}>
                          <td colSpan={6} className="px-3 pt-1 pb-4">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className={`${isDark ? 'text-indigo-300/80' : 'text-gray-500'} uppercase tracking-wider text-[10px]`}>
                                  <tr>
                                    <th className="text-left px-2 py-2 font-bold">Job #</th>
                                    <th className="text-left px-2 py-2 font-bold">Job Name</th>
                                    <th className="text-left px-2 py-2 font-bold">Invoice Date</th>
                                    <th className="text-left px-2 py-2 font-bold">Due Date</th>
                                    <th className="text-right px-2 py-2 font-bold">Outstanding</th>
                                    <th className="text-center px-2 py-2 font-bold">Days Overdue</th>
                                    <th className="text-right px-2 py-2 font-bold w-10"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.invoices.map(i => (
                                    <tr
                                      key={i.job.jobNumber}
                                      className={`${isDark ? 'border-t border-indigo-500/10' : 'border-t border-gray-200'}`}
                                    >
                                      <td className={`px-2 py-2 font-mono font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                        {i.job.jobNumber}
                                      </td>
                                      <td className={`px-2 py-2 ${isDark ? 'text-indigo-200' : 'text-gray-700'} max-w-xs truncate`} title={i.job.jobName}>
                                        {i.job.jobName || <span className={isDark ? 'text-indigo-400/50' : 'text-gray-400'}>—</span>}
                                        {i.job.poNumber && (
                                          <span className={`ml-2 text-[10px] ${isDark ? 'text-indigo-400/60' : 'text-gray-400'}`}>
                                            PO {i.job.poNumber}
                                          </span>
                                        )}
                                      </td>
                                      <td className={`px-2 py-2 ${isDark ? 'text-indigo-200' : 'text-gray-700'}`}>
                                        {formatDate(i.invoiceDate)}
                                      </td>
                                      <td className={`px-2 py-2 ${isDark ? 'text-indigo-200' : 'text-gray-700'}`}>
                                        {formatDate(i.dueDate)}
                                        <span className={`ml-1 text-[10px] ${isDark ? 'text-indigo-400/60' : 'text-gray-400'}`}>
                                          · {i.termsDays}d terms
                                        </span>
                                      </td>
                                      <td className={`px-2 py-2 text-right font-bold ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                                        {formatCurrency(i.outstanding)}
                                      </td>
                                      <td className="px-2 py-2 text-center">
                                        <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${bucketColor(i.daysOverdue, isDark)}`}>
                                          {i.daysOverdue}d
                                        </span>
                                      </td>
                                      <td className="px-2 py-2 text-right">
                                        {onNavigateToOrder && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); onNavigateToOrder(i.job.jobNumber); }}
                                            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-indigo-300 hover:text-white' : 'text-indigo-600 hover:text-indigo-800'}`}
                                            title="Open job"
                                          >
                                            Open <ExternalLink className="w-3 h-3" />
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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

export default CreditBlockList;
