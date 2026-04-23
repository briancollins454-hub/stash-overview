import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  CircleDollarSign, Search, ArrowUpDown, AlertTriangle, ExternalLink, Download,
  RefreshCw, Check, Copy, ShieldAlert,
} from 'lucide-react';
import { DecoJob } from '../types';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';

interface Props {
  decoJobs: DecoJob[];
  isDark: boolean;
  onNavigateToOrder?: (orderNumber: string) => void;
}

type SortKey = 'jobNumber' | 'customerName' | 'orderTotal' | 'outstandingBalance' | 'dateShipped' | 'dateOrdered' | 'daysSince' | 'status';
type SortDir = 'asc' | 'desc';

// ─── Click-to-copy job number (same UX as Shipped Not Invoiced / Priority Board) ─
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
 * Unpaid Orders — catches orders that slipped through the pricing/invoicing
 * net. Rule set (agreed with Brian):
 *
 *   1. Show orders where Deco has recorded **zero payments** (payments.length === 0).
 *   2. Hide orders that are fully paid (implied — payments.length > 0 && balance 0
 *      wouldn't match rule 1 anyway, but we also guard against stale/partial
 *      refunds leaving 0 balance + payment records).
 *   3. Exclude internal "stash" customers when the balance is also £0 — these
 *      are zero-priced company/internal orders and aren't real AR leaks.
 *
 * Two visible sub-groups are highlighted in the table:
 *   - **Zero-priced & shipped** (orderTotal===0, dateShipped set) → the most
 *     dangerous bucket: job went out the door without ever being priced.
 *   - **Priced but unpaid** (orderTotal>0, no payment) → standard AR miss.
 */
const UnpaidOrders: React.FC<Props> = ({ decoJobs, isDark, onNavigateToOrder }) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('dateShipped');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);
  const [onlyZeroPriced, setOnlyZeroPriced] = useState(false);

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

  useEffect(() => {
    loadFromFinanceCache();
  }, [loadFromFinanceCache]);

  const jobs = useMemo(() => {
    return allJobs
      .filter(j => {
        // Rule 1 — no payment logged in Deco.
        const paymentCount = Array.isArray(j.payments) ? j.payments.length : 0;
        if (paymentCount > 0) return false;

        // Hide cancelled/quote rows — neither is an AR concern.
        if (j.status === 'Cancelled') return false;
        if (j.isQuote) return false;

        const balance = typeof j.outstandingBalance === 'string'
          ? parseFloat(j.outstandingBalance)
          : (j.outstandingBalance || 0);
        const total = j.orderTotal || 0;

        // Rule 3 — exclude zero-balance internal "stash" customers.
        const customer = (j.customerName || '').toLowerCase();
        if (balance === 0 && customer.includes('stash')) return false;

        // If both balance and total are zero AND there's no ship date, this
        // is almost certainly an empty/draft order, not an AR leak.
        if (balance === 0 && total === 0 && !j.dateShipped) return false;

        return true;
      })
      .map(j => {
        const balance = typeof j.outstandingBalance === 'string'
          ? parseFloat(j.outstandingBalance)
          : (j.outstandingBalance || 0);
        const total = j.orderTotal || 0;
        // "daysSince" prefers dateShipped (the real AR clock) but falls back
        // to dateOrdered so orders that were never shipped still show an age.
        const anchor = j.dateShipped || j.dateOrdered;
        const daysSince = anchor
          ? Math.floor((Date.now() - new Date(anchor).getTime()) / 86400000)
          : 0;
        return {
          ...j,
          outstandingBalance: balance,
          orderTotal: total,
          daysSince,
          isZeroPriced: total === 0,
          hasShipped: !!j.dateShipped,
        };
      });
  }, [allJobs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = jobs;
    if (onlyZeroPriced) list = list.filter(j => j.isZeroPriced);
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
    });
    return list;
  }, [jobs, search, sortKey, sortDir, onlyZeroPriced]);

  const totalOutstanding = useMemo(() => filtered.reduce((s, j) => s + (j.outstandingBalance || 0), 0), [filtered]);
  const zeroPricedShippedCount = useMemo(
    () => jobs.filter(j => j.isZeroPriced && j.hasShipped).length,
    [jobs]
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

  const exportCsv = () => {
    const header = ['Job Number', 'PO Number', 'Customer', 'Job Name', 'Status', 'Order Total', 'Outstanding', 'Order Date', 'Shipped Date', 'Days Since', 'Zero Priced', 'Shipped'];
    const rows = filtered.map(j => [
      j.jobNumber, j.poNumber || '', j.customerName, j.jobName, j.status,
      (j.orderTotal || 0).toFixed(2),
      (j.outstandingBalance || 0).toFixed(2),
      j.dateOrdered || '', j.dateShipped || '',
      j.daysSince.toString(),
      j.isZeroPriced ? 'YES' : 'no',
      j.hasShipped ? 'YES' : 'no',
    ]);
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
            <p className="text-lg font-bold text-rose-500">{fmt(totalOutstanding)}</p>
          </div>
          <div className={`${cardBg} rounded-lg px-4 py-2 border ${borderColor}`}>
            <span className={`text-xs ${textSecondary}`}>Orders</span>
            <p className={`text-lg font-bold ${textPrimary}`}>{filtered.length}</p>
          </div>
          {zeroPricedShippedCount > 0 && (
            <div className={`rounded-lg px-4 py-2 border border-amber-500/40 bg-amber-500/10`}>
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" />
                Zero-priced &amp; shipped
              </span>
              <p className="text-lg font-bold text-amber-400">{zeroPricedShippedCount}</p>
            </div>
          )}
        </div>
      </div>

      {/* Search + filters + Export */}
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
          onClick={() => setOnlyZeroPriced(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${onlyZeroPriced
            ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
            : `${cardBg} ${borderColor} ${textSecondary} hover:bg-white/10`}`}
          title="Show only orders where the total is £0.00 (most dangerous — probably never priced)"
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          {onlyZeroPriced ? 'Showing zero-priced only' : 'Filter to zero-priced'}
        </button>
        <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <CircleDollarSign className={`w-12 h-12 ${textSecondary} opacity-40 mb-3`} />
            <p className={`text-sm font-medium ${textSecondary}`}>
              {search
                ? 'No results matching your search'
                : noCache
                  ? 'Run a Full Sync from the Finance tab to populate this report'
                  : 'All good — every active order has at least one payment recorded'}
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
                    ['status', 'Status'],
                    ['orderTotal', 'Order Total'],
                    ['outstandingBalance', 'Outstanding'],
                    ['dateOrdered', 'Ordered'],
                    ['dateShipped', 'Shipped'],
                    ['daysSince', 'Days'],
                    ['', 'Flags'],
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
                  const zeroPricedShipped = j.isZeroPriced && j.hasShipped;
                  return (
                    <tr
                      key={j.id || j.jobNumber}
                      className={`border-b ${borderColor} ${hoverRow} transition-colors ${zeroPricedShipped ? (isDark ? 'bg-amber-500/5' : 'bg-amber-50/60') : ''}`}
                    >
                      <td className="px-4 py-3">
                        <CopyableJobNum
                          jobNumber={j.jobNumber}
                          onNavigate={onNavigateToOrder ? () => onNavigateToOrder(j.poNumber || j.jobNumber) : undefined}
                        />
                      </td>
                      <td className={`px-4 py-3 font-medium ${textPrimary}`}>{j.customerName}</td>
                      <td className={`px-4 py-3 ${textSecondary} max-w-[200px] truncate`}>{j.jobName}</td>
                      <td className={`px-4 py-3 ${textSecondary}`}>{j.status}</td>
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
                        <div className="flex flex-col gap-1">
                          {zeroPricedShipped && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400" title="Order shipped but total is £0 — probably never priced">
                              <ShieldAlert className="w-3 h-3" />
                              Zero priced
                            </span>
                          )}
                          {!j.hasShipped && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-700'}`} title="No ship date — order may still be active">
                              Not shipped
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Explanatory footer */}
      <div className={`text-xs ${textSecondary} px-1`}>
        Shown when Deco has <span className="font-semibold">no payment records</span> against the order. Excludes cancelled, quotes, and £0-balance internal <span className="font-mono">stash</span> customers.
      </div>
    </div>
  );
};

export default UnpaidOrders;
