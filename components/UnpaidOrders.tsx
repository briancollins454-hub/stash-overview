import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CircleDollarSign, Search, ArrowUpDown, AlertTriangle, ExternalLink, Download,
  RefreshCw, Check, Copy, ShieldAlert, ChevronDown, ChevronRight, ShieldCheck, Undo2,
} from 'lucide-react';
import { DecoJob } from '../types';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';

interface Props {
  decoJobs: DecoJob[];
  isDark: boolean;
  onNavigateToOrder?: (orderNumber: string) => void;
  currentUserEmail?: string;
}

type SortKey = 'jobNumber' | 'customerName' | 'orderTotal' | 'outstandingBalance' | 'dateShipped' | 'dateOrdered' | 'daysSince' | 'status';
type SortDir = 'asc' | 'desc';
type SectionKey = 'zero' | 'priced' | 'authorised';

interface Row extends DecoJob {
  daysSince: number;
  isZeroPriced: boolean;
  hasShipped: boolean;
  authorisedAt?: string;
  authorisedBy?: string;
}

interface AuthorisedRow {
  job_number: string;
  authorised_at: string;
  authorised_by: string | null;
}

// ─── Click-to-copy job number ─────────────────────────────────────────────
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
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
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

/**
 * Unpaid Orders — three buckets:
 *   1. Zero priced (£0 total, no payment, not yet authorised)
 *   2. Priced but unpaid (real price, no payment)
 *   3. Authorised £0 invoice — previously in bucket 1, but a user has
 *      explicitly confirmed the £0 invoice is legitimate. Persisted in
 *      Supabase (stash_zero_invoice_authorised) so the decision is shared
 *      with the rest of the team and survives refreshes.
 *
 * All three buckets are individually collapsible. Zero + Priced open by
 * default (active work); Authorised starts collapsed (reference bucket).
 */
const UnpaidOrders: React.FC<Props> = ({ decoJobs, isDark, onNavigateToOrder, currentUserEmail }) => {
  const [search, setSearch] = useState('');
  // Default sort — newest shipped first. Empty dateShipped values fall to
  // the bottom in descending order, which is what we want (unshipped rows
  // shouldn't push shipped ones off-screen).
  const [sortKey, setSortKey] = useState<SortKey>('dateShipped');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);

  const [authorised, setAuthorised] = useState<Record<string, AuthorisedRow>>({});
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    zero: false,
    priced: false,
    authorised: true, // reference bucket — start closed to keep the page tidy
  });
  const toggleSection = (key: SectionKey) => setCollapsed(c => ({ ...c, [key]: !c[key] }));

  // ─── Data loading ────────────────────────────────────────────────────
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

  const loadAuthorised = useCallback(async () => {
    if (!isSupabaseReady()) return;
    try {
      const res = await supabaseFetch(
        'stash_zero_invoice_authorised?select=job_number,authorised_at,authorised_by', 'GET'
      );
      const rows: AuthorisedRow[] = await res.json();
      if (!Array.isArray(rows)) return;
      const map: Record<string, AuthorisedRow> = {};
      for (const r of rows) map[r.job_number] = r;
      setAuthorised(map);
    } catch {
      // Non-fatal — button just won't persist.
    }
  }, []);

  useEffect(() => {
    loadFromFinanceCache();
    loadAuthorised();
  }, [loadFromFinanceCache, loadAuthorised]);

  // ─── Authorise / un-authorise ────────────────────────────────────────
  const markAuthorised = useCallback(async (jobNumber: string, customerName: string) => {
    if (!isSupabaseReady() || isTogglingId) return;

    // Confirmation — this is a financial decision with shared visibility,
    // so staff should acknowledge before the row disappears.
    const ok = window.confirm(
      `Authorise £0 invoice for job #${jobNumber} (${customerName})?\n\n` +
      `This confirms the order is legitimately a £0 invoice (sample / promo / ` +
      `internal). It will move to the "Authorised £0 invoice" section and be ` +
      `visible to the rest of the team. You can undo this later.`
    );
    if (!ok) return;

    setIsTogglingId(jobNumber);
    const now = new Date().toISOString();
    const optimistic: AuthorisedRow = { job_number: jobNumber, authorised_at: now, authorised_by: currentUserEmail || null };
    setAuthorised(prev => ({ ...prev, [jobNumber]: optimistic }));

    try {
      await supabaseFetch(
        'stash_zero_invoice_authorised',
        'POST',
        { job_number: jobNumber, authorised_at: now, authorised_by: currentUserEmail || null, updated_at: now },
        'resolution=merge-duplicates'
      );
    } catch (e) {
      setAuthorised(prev => {
        const next = { ...prev };
        delete next[jobNumber];
        return next;
      });
      console.error('Failed to authorise £0 invoice', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [currentUserEmail, isTogglingId]);

  const unmarkAuthorised = useCallback(async (jobNumber: string) => {
    if (!isSupabaseReady() || isTogglingId) return;
    setIsTogglingId(jobNumber);

    const prevRow = authorised[jobNumber];
    setAuthorised(prev => {
      const next = { ...prev };
      delete next[jobNumber];
      return next;
    });

    try {
      await supabaseFetch(
        `stash_zero_invoice_authorised?job_number=eq.${encodeURIComponent(jobNumber)}`,
        'DELETE'
      );
    } catch (e) {
      if (prevRow) setAuthorised(prev => ({ ...prev, [jobNumber]: prevRow }));
      console.error('Failed to un-authorise £0 invoice', e);
    } finally {
      setIsTogglingId(null);
    }
  }, [authorised, isTogglingId]);

  // ─── Filter + transform ──────────────────────────────────────────────
  const jobs: Row[] = useMemo(() => {
    return allJobs
      .filter(j => {
        const paymentCount = Array.isArray(j.payments) ? j.payments.length : 0;
        if (paymentCount > 0) return false;

        if (j.status === 'Cancelled') return false;
        if (j.isQuote) return false;

        const balance = typeof j.outstandingBalance === 'string'
          ? parseFloat(j.outstandingBalance)
          : (j.outstandingBalance || 0);
        const total = j.orderTotal || 0;

        const customer = (j.customerName || '').toLowerCase();
        if (balance === 0 && customer.includes('stash')) return false;

        // Expected-£0 keyword exclusions — GOK, Stash Shop, Sample.
        const haystack = `${j.jobName || ''}\u0001${j.customerName || ''}\u0001${j.notes || ''}`.toLowerCase();
        if (/\bgok\b/.test(haystack)) return false;
        if (haystack.includes('gift of kit')) return false;
        if (haystack.includes('stash shop')) return false;
        if (/\bsamples?\b/.test(haystack)) return false;

        if (balance === 0 && total === 0 && !j.dateShipped) return false;

        return true;
      })
      .map(j => {
        const balance = typeof j.outstandingBalance === 'string'
          ? parseFloat(j.outstandingBalance)
          : (j.outstandingBalance || 0);
        const total = j.orderTotal || 0;
        const anchor = j.dateShipped || j.dateOrdered;
        const daysSince = anchor
          ? Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000)
          : 0;
        const auth = authorised[j.jobNumber];
        return {
          ...j,
          outstandingBalance: balance,
          orderTotal: total,
          daysSince,
          isZeroPriced: total === 0,
          hasShipped: !!j.dateShipped,
          authorisedAt: auth?.authorised_at,
          authorisedBy: auth?.authorised_by || undefined,
        };
      });
  }, [allJobs, authorised]);

  const sorter = useCallback((a: Row, b: Row) => {
    let av: any, bv: any;
    switch (sortKey) {
      case 'jobNumber': av = a.jobNumber; bv = b.jobNumber; break;
      case 'customerName': av = a.customerName; bv = b.customerName; break;
      case 'orderTotal': av = a.orderTotal || 0; bv = b.orderTotal || 0; break;
      case 'outstandingBalance': av = a.outstandingBalance || 0; bv = b.outstandingBalance || 0; break;
      case 'dateShipped': av = a.dateShipped || ''; bv = b.dateShipped || ''; break;
      case 'dateOrdered': av = a.dateOrdered || ''; bv = b.dateOrdered || ''; break;
      case 'daysSince': av = a.daysSince; bv = b.daysSince; break;
      case 'status': av = a.status; bv = b.status; break;
      default: av = 0; bv = 0;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  }, [sortKey, sortDir]);

  const { zeroPricedRows, pricedRows, authorisedRows } = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = jobs;
    if (q) {
      list = list.filter(j =>
        j.jobNumber.toLowerCase().includes(q) ||
        j.poNumber?.toLowerCase().includes(q) ||
        j.customerName.toLowerCase().includes(q) ||
        j.jobName.toLowerCase().includes(q)
      );
    }
    // Authorisation only has semantic meaning for zero-priced rows. If the
    // order later gets a real price, it drifts into priced-but-unpaid and
    // the authorisation is implicitly ignored (but not deleted).
    const authorisedRows = list.filter(j => j.isZeroPriced && !!j.authorisedAt).sort(sorter);
    const zeroPricedRows = list.filter(j => j.isZeroPriced && !j.authorisedAt).sort(sorter);
    const pricedRows = list.filter(j => !j.isZeroPriced).sort(sorter);
    return { zeroPricedRows, pricedRows, authorisedRows };
  }, [jobs, search, sorter]);

  const zeroPricedOutstanding = useMemo(
    () => zeroPricedRows.reduce((s, j) => s + (j.outstandingBalance || 0), 0),
    [zeroPricedRows]
  );
  const pricedOutstanding = useMemo(
    () => pricedRows.reduce((s, j) => s + (j.outstandingBalance || 0), 0),
    [pricedRows]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const fmt = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d?: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (d?: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const exportCsv = () => {
    const header = ['Section', 'Job Number', 'PO Number', 'Customer', 'Job Name', 'Status', 'Order Total', 'Outstanding', 'Order Date', 'Shipped Date', 'Days Since', 'Shipped', 'Authorised At', 'Authorised By'];
    const toRow = (j: Row, section: string) => [
      section, j.jobNumber, j.poNumber || '', j.customerName, j.jobName, j.status,
      (j.orderTotal || 0).toFixed(2),
      (j.outstandingBalance || 0).toFixed(2),
      j.dateOrdered || '', j.dateShipped || '',
      j.daysSince.toString(),
      j.hasShipped ? 'YES' : 'no',
      j.authorisedAt || '',
      j.authorisedBy || '',
    ];
    const rows = [
      ...zeroPricedRows.map(r => toRow(r, 'Zero priced')),
      ...pricedRows.map(r => toRow(r, 'Priced but unpaid')),
      ...authorisedRows.map(r => toRow(r, 'Authorised £0 invoice')),
    ];
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unpaid-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cardBg = isDark ? 'bg-[#232347]' : 'bg-white';
  const textPrimary = isDark ? 'text-white' : 'text-gray-900';
  const textSecondary = isDark ? 'text-indigo-300' : 'text-gray-500';
  const borderColor = isDark ? 'border-white/10' : 'border-gray-200';
  const hoverRow = isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50';

  // ─── Shared table renderer ───────────────────────────────────────────
  const renderTable = (rows: Row[], variant: SectionKey) => {
    if (rows.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <p className={`text-sm font-medium ${textSecondary}`}>
            {search
              ? `No ${variant === 'zero' ? 'zero-priced' : variant === 'priced' ? 'priced' : 'authorised'} orders match your search`
              : variant === 'zero'
                ? 'No zero-priced orders — every unpaid order has a price on it.'
                : variant === 'priced'
                  ? 'No other unpaid orders.'
                  : 'Nothing has been authorised as a £0 invoice yet.'}
          </p>
        </div>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={`border-b ${borderColor} ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              {([
                ['jobNumber', 'Job #'],
                ['customerName', 'Customer'],
                ['', 'Job Name'],
                ['status', 'Status'],
                ['orderTotal', 'Order Total'],
                ['outstandingBalance', 'Outstanding'],
                ['dateOrdered', 'Ordered'],
                ['dateShipped', 'Shipped'],
                ['daysSince', 'Days'],
                ['', ''],
              ] as [SortKey | '', string][]).map(([key, label], idx) => (
                <th
                  key={`${label}-${idx}`}
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
            {rows.map(j => {
              const toggling = isTogglingId === j.jobNumber;
              return (
                <tr
                  key={j.id || j.jobNumber}
                  className={`border-b ${borderColor} ${hoverRow} transition-colors ${variant === 'authorised' ? 'opacity-75' : ''}`}
                >
                  <td className="px-4 py-3">
                    <CopyableJobNum
                      jobNumber={j.jobNumber}
                      onNavigate={onNavigateToOrder ? () => onNavigateToOrder(j.poNumber || j.jobNumber) : undefined}
                    />
                  </td>
                  <td className={`px-4 py-3 font-medium ${textPrimary}`}>{j.customerName}</td>
                  <td className={`px-4 py-3 ${textSecondary} max-w-[200px] truncate`}>{j.jobName}</td>
                  <td className={`px-4 py-3 ${textSecondary}`}>
                    <span className="flex items-center gap-1.5">
                      {j.status}
                      {(variant === 'zero' || variant === 'authorised') && !j.hasShipped && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-700'}`} title="No ship date yet">
                          not shipped
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-semibold ${j.isZeroPriced ? 'text-amber-400' : textPrimary}`}>
                    {fmt(j.orderTotal || 0)}
                  </td>
                  <td className={`px-4 py-3 font-bold ${(j.outstandingBalance || 0) > 0 ? 'text-rose-400' : textSecondary}`}>
                    {fmt(j.outstandingBalance || 0)}
                  </td>
                  <td className={`px-4 py-3 ${textSecondary}`}>{fmtDate(j.dateOrdered)}</td>
                  <td className={`px-4 py-3 ${textSecondary}`}>{fmtDate(j.dateShipped)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      j.daysSince > 30
                        ? 'bg-red-500/20 text-red-400'
                        : j.daysSince > 14
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-500/20 text-slate-300'
                    }`}>
                      {j.daysSince > 30 && <AlertTriangle className="w-3 h-3" />}
                      {j.daysSince}d
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {variant === 'zero' && (
                      <button
                        onClick={() => markAuthorised(j.jobNumber, j.customerName)}
                        disabled={toggling}
                        title="Authorise this £0 invoice (moves row to Authorised section)"
                        className={`flex items-center gap-1.5 px-2 py-1 rounded border ${borderColor} text-xs font-medium ${textSecondary} hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors disabled:opacity-40`}
                      >
                        <div className="w-3.5 h-3.5 rounded-sm border border-current flex items-center justify-center">
                          {toggling && <Check className="w-2.5 h-2.5" />}
                        </div>
                        Authorise £0
                      </button>
                    )}
                    {variant === 'authorised' && (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400" title={`Authorised by ${j.authorisedBy || 'unknown'}`}>
                          <ShieldCheck className="w-3 h-3" />
                          Authorised {fmtDateTime(j.authorisedAt)}
                        </span>
                        <button
                          onClick={() => unmarkAuthorised(j.jobNumber)}
                          disabled={toggling}
                          title={`Undo authorisation (authorised by ${j.authorisedBy || 'unknown'})`}
                          className="text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-40"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ─── Section header renderer (collapsible) ───────────────────────────
  interface HeaderProps {
    sectionKey: SectionKey;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    count: number;
    outstanding?: number;
    accentClasses?: { header: string; title: string; count: string };
  }
  const SectionHeader: React.FC<HeaderProps> = ({ sectionKey, icon, title, subtitle, count, outstanding, accentClasses }) => {
    const isCollapsed = collapsed[sectionKey];
    return (
      <div
        onClick={() => toggleSection(sectionKey)}
        className={`flex items-center justify-between gap-3 px-5 py-4 cursor-pointer select-none transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-black/5'} ${accentClasses?.header || ''}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
            className={`shrink-0 ${textSecondary} hover:text-white transition-colors`}
            onClick={(e) => { e.stopPropagation(); toggleSection(sectionKey); }}
          >
            {isCollapsed
              ? <ChevronRight className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="shrink-0">{icon}</div>
          <div className="min-w-0">
            <h3 className={`text-sm font-bold uppercase tracking-wider ${accentClasses?.title || textPrimary}`}>
              {title}
            </h3>
            <p className={`text-xs ${textSecondary} mt-0.5 truncate`}>{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className={`rounded-lg px-3 py-1.5 border ${accentClasses?.count || `${borderColor} ${cardBg}`}`}>
            <span className={`text-[10px] uppercase font-semibold block leading-none ${accentClasses?.title || textSecondary}`}>Count</span>
            <span className={`text-base font-bold ${accentClasses?.title || textPrimary}`}>{count}</span>
          </div>
          {outstanding !== undefined && (
            <div className={`rounded-lg px-3 py-1.5 border ${borderColor} ${cardBg}`}>
              <span className={`text-[10px] uppercase ${textSecondary} font-semibold block leading-none`}>Outstanding</span>
              <span className={`text-base font-bold ${textPrimary}`}>{fmt(outstanding)}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const totalCount = zeroPricedRows.length + pricedRows.length + authorisedRows.length;
  const combinedOutstanding = zeroPricedOutstanding + pricedOutstanding;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
            <CircleDollarSign className="w-5 h-5 text-rose-500" />
            Unpaid Orders
          </h2>
          <p className={`text-sm ${textSecondary} mt-0.5`}>
            {isLoading ? 'Loading from cache...' : noCache
              ? 'No data yet — run a Full Sync from the Finance tab first'
              : lastSynced
                ? `Data from Finance sync: ${new Date(lastSynced).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : 'Orders with no payment recorded in Deco — catches pricing / invoicing slips'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadFromFinanceCache} disabled={isLoading} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} ${cardBg} text-xs font-medium ${textSecondary} ${isLoading ? 'opacity-50' : 'hover:bg-white/10'} transition-colors`} title="Reload from Finance cache">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Total Outstanding</span>
            <p className="text-lg font-bold text-rose-500">{fmt(combinedOutstanding)}</p>
          </div>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Open orders</span>
            <p className={`text-lg font-bold ${textPrimary}`}>{zeroPricedRows.length + pricedRows.length}</p>
          </div>
        </div>
      </div>

      {/* Search + Export */}
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
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* ─── SECTION 1: Zero priced ─────────────────────────────────── */}
      <div className={`rounded-xl border overflow-hidden ${zeroPricedRows.length > 0
        ? 'border-amber-500/40 bg-amber-500/5'
        : `${borderColor} ${cardBg}`}`}
      >
        <SectionHeader
          sectionKey="zero"
          icon={<ShieldAlert className={`w-5 h-5 ${zeroPricedRows.length > 0 ? 'text-amber-400' : textSecondary}`} />}
          title="Zero priced — shipped without a price"
          subtitle="Order total is £0.00 and no payment has been recorded. Most dangerous bucket — likely never priced."
          count={zeroPricedRows.length}
          outstanding={zeroPricedOutstanding}
          accentClasses={zeroPricedRows.length > 0 ? {
            header: '',
            title: 'text-amber-400',
            count: 'border-amber-500/30 bg-amber-500/10',
          } : undefined}
        />
        {!collapsed.zero && (
          <div className={`border-t ${zeroPricedRows.length > 0 ? 'border-amber-500/30' : borderColor}`}>
            {renderTable(zeroPricedRows, 'zero')}
          </div>
        )}
      </div>

      {/* ─── SECTION 2: Priced but unpaid ───────────────────────────── */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        <SectionHeader
          sectionKey="priced"
          icon={<CircleDollarSign className={`w-5 h-5 ${pricedRows.length > 0 ? 'text-rose-400' : textSecondary}`} />}
          title="Priced but unpaid"
          subtitle="A price is on the order but Deco has no payment recorded — invoice may have been missed."
          count={pricedRows.length}
          outstanding={pricedOutstanding}
        />
        {!collapsed.priced && (
          <div className={`border-t ${borderColor}`}>
            {renderTable(pricedRows, 'priced')}
          </div>
        )}
      </div>

      {/* ─── SECTION 3: Authorised £0 invoice (reference) ───────────── */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        <SectionHeader
          sectionKey="authorised"
          icon={<ShieldCheck className={`w-5 h-5 ${authorisedRows.length > 0 ? 'text-emerald-400' : textSecondary}`} />}
          title="Authorised £0 invoice"
          subtitle="Zero-priced orders that have been explicitly approved as legitimate £0 invoices."
          count={authorisedRows.length}
        />
        {!collapsed.authorised && (
          <div className={`border-t ${borderColor}`}>
            {renderTable(authorisedRows, 'authorised')}
          </div>
        )}
      </div>

      {/* Empty state */}
      {totalCount === 0 && !isLoading && (
        <div className={`${cardBg} rounded-xl border ${borderColor} flex flex-col items-center justify-center py-10`}>
          <CircleDollarSign className={`w-10 h-10 ${textSecondary} opacity-40 mb-3`} />
          <p className={`text-sm font-medium ${textSecondary}`}>
            {noCache
              ? 'Run a Full Sync from the Finance tab to populate this report'
              : 'All good — every active order has at least one payment recorded'}
          </p>
        </div>
      )}

      {/* Explanatory footer */}
      <div className={`text-xs ${textSecondary} px-1`}>
        Shown when Deco has <span className="font-semibold">no payment records</span> against the order. Excludes cancelled, quotes, &pound;0-balance internal <span className="font-mono">stash</span> customers, <span className="font-mono">GOK</span> / Gift of Kit orders, <span className="font-mono">Stash Shop</span> orders, and <span className="font-mono">Sample</span> orders. Sort defaults to newest shipped first.
      </div>
    </div>
  );
};

export default UnpaidOrders;
