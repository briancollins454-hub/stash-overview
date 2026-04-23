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

// Row shape after post-processing in the jobs memo.
interface Row extends DecoJob {
  daysSince: number;
  isZeroPriced: boolean;
  hasShipped: boolean;
}

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
 *      wouldn't match rule 1 anyway).
 *   3. Exclude internal "stash" customers when the balance is also £0 — these
 *      are zero-priced company/internal orders and aren't real AR leaks.
 *
 * Results are segregated into two visually distinct sections:
 *   - **Zero priced & shipped** (urgent) — order went out the door with £0
 *     total, almost certainly unpriced. Amber card, shown first so it can't
 *     be missed.
 *   - **Priced but unpaid** — standard AR miss: price was set but no payment
 *     has landed. Shown in the normal card below.
 */
const UnpaidOrders: React.FC<Props> = ({ decoJobs, isDark, onNavigateToOrder }) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('dateShipped');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [noCache, setNoCache] = useState(false);

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

  const jobs: Row[] = useMemo(() => {
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

        // Rule 4 — exclude "expected £0 balance" order types. These
        // legitimately have a £0 invoice balance and no payment recorded,
        // so they'll otherwise match every other rule and pollute the list.
        //
        //   - GOK / "Gift of Kit" — promotional giveaways
        //   - "Stash Shop" — partner/internal stores where invoicing is
        //     handled outside Deco (e.g. "Devon Stash Shop 47925",
        //     "CHGS Staff Stash Shop 46313")
        //
        // Match across job name, customer name and notes so we catch the
        // tag wherever staff have attached it. GOK uses word boundaries
        // so we don't false-match tokens like "Bangok".
        const haystack = `${j.jobName || ''}\u0001${j.customerName || ''}\u0001${j.notes || ''}`.toLowerCase();
        if (/\bgok\b/.test(haystack)) return false;
        if (haystack.includes('gift of kit')) return false;
        if (haystack.includes('stash shop')) return false;

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

  // Apply search + sort once, then split into the two visible sections.
  // A row counts as "zero priced" for segregation purposes when orderTotal
  // is £0 — regardless of whether it's already shipped. Zero-and-shipped is
  // the most dangerous variant but zero-and-not-yet-shipped is still worth
  // surfacing separately from the straightforward "priced-but-unpaid" list.
  const { zeroPricedRows, pricedRows } = useMemo(() => {
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
    const sorter = (a: Row, b: Row) => {
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
    };
    const zeroPricedRows = list.filter(j => j.isZeroPriced).sort(sorter);
    const pricedRows = list.filter(j => !j.isZeroPriced).sort(sorter);
    return { zeroPricedRows, pricedRows };
  }, [jobs, search, sortKey, sortDir]);

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

  const exportCsv = () => {
    const header = ['Section', 'Job Number', 'PO Number', 'Customer', 'Job Name', 'Status', 'Order Total', 'Outstanding', 'Order Date', 'Shipped Date', 'Days Since', 'Shipped'];
    const toRow = (j: Row, section: string) => [
      section, j.jobNumber, j.poNumber || '', j.customerName, j.jobName, j.status,
      (j.orderTotal || 0).toFixed(2),
      (j.outstandingBalance || 0).toFixed(2),
      j.dateOrdered || '', j.dateShipped || '',
      j.daysSince.toString(),
      j.hasShipped ? 'YES' : 'no',
    ];
    const rows = [
      ...zeroPricedRows.map(r => toRow(r, 'Zero priced')),
      ...pricedRows.map(r => toRow(r, 'Priced but unpaid')),
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

  // ─── Shared table renderer ───────────────────────────────────────────────
  // Both sections use the same column set — extracted so sort state stays
  // consistent across them and we're not maintaining the layout in two
  // places. The row highlight on the "zero-priced" section is applied on
  // the wrapping card, not per-row, so the rows themselves stay clean.
  const renderTable = (rows: Row[], variant: 'zero' | 'priced') => {
    if (rows.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
          <p className={`text-sm font-medium ${textSecondary}`}>
            {search
              ? `No ${variant === 'zero' ? 'zero-priced' : 'priced'} orders match your search`
              : variant === 'zero'
                ? 'No zero-priced orders — every unpaid order has a price on it.'
                : 'No other unpaid orders.'}
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
            {rows.map(j => (
              <tr
                key={j.id || j.jobNumber}
                className={`border-b ${borderColor} ${hoverRow} transition-colors`}
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
                    {variant === 'zero' && !j.hasShipped && (
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const totalCount = zeroPricedRows.length + pricedRows.length;
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
            <span className={`text-xs ${textSecondary}`}>Orders</span>
            <p className={`text-lg font-bold ${textPrimary}`}>{totalCount}</p>
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

      {/* ─── SECTION 1: Zero priced (urgent) ─────────────────────────── */}
      <div className={`rounded-xl border overflow-hidden ${zeroPricedRows.length > 0
        ? 'border-amber-500/40 bg-amber-500/5'
        : `${borderColor} ${cardBg}`}`}
      >
        <div className={`flex items-center justify-between gap-3 px-5 py-4 border-b ${zeroPricedRows.length > 0 ? 'border-amber-500/30' : borderColor}`}>
          <div className="flex items-center gap-2">
            <ShieldAlert className={`w-5 h-5 ${zeroPricedRows.length > 0 ? 'text-amber-400' : textSecondary}`} />
            <div>
              <h3 className={`text-sm font-bold uppercase tracking-wider ${zeroPricedRows.length > 0 ? 'text-amber-400' : textSecondary}`}>
                Zero priced &mdash; shipped without a price
              </h3>
              <p className={`text-xs ${textSecondary} mt-0.5`}>
                Order total is &pound;0.00 and no payment has been recorded. Most dangerous bucket &mdash; likely never priced.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className={`rounded-lg px-3 py-1.5 border ${zeroPricedRows.length > 0 ? 'border-amber-500/30 bg-amber-500/10' : `${borderColor} ${cardBg}`}`}>
              <span className="text-[10px] uppercase text-amber-400 font-semibold block leading-none">Count</span>
              <span className={`text-base font-bold ${zeroPricedRows.length > 0 ? 'text-amber-400' : textSecondary}`}>{zeroPricedRows.length}</span>
            </div>
            <div className={`rounded-lg px-3 py-1.5 border ${borderColor} ${cardBg}`}>
              <span className={`text-[10px] uppercase ${textSecondary} font-semibold block leading-none`}>Outstanding</span>
              <span className={`text-base font-bold ${textPrimary}`}>{fmt(zeroPricedOutstanding)}</span>
            </div>
          </div>
        </div>
        {renderTable(zeroPricedRows, 'zero')}
      </div>

      {/* ─── SECTION 2: Priced but unpaid (standard AR miss) ──────────── */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        <div className={`flex items-center justify-between gap-3 px-5 py-4 border-b ${borderColor}`}>
          <div className="flex items-center gap-2">
            <CircleDollarSign className={`w-5 h-5 ${pricedRows.length > 0 ? 'text-rose-400' : textSecondary}`} />
            <div>
              <h3 className={`text-sm font-bold uppercase tracking-wider ${textPrimary}`}>
                Priced but unpaid
              </h3>
              <p className={`text-xs ${textSecondary} mt-0.5`}>
                A price is on the order but Deco has no payment recorded &mdash; invoice may have been missed.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className={`rounded-lg px-3 py-1.5 border ${borderColor} ${cardBg}`}>
              <span className={`text-[10px] uppercase ${textSecondary} font-semibold block leading-none`}>Count</span>
              <span className={`text-base font-bold ${textPrimary}`}>{pricedRows.length}</span>
            </div>
            <div className={`rounded-lg px-3 py-1.5 border ${borderColor} ${cardBg}`}>
              <span className={`text-[10px] uppercase ${textSecondary} font-semibold block leading-none`}>Outstanding</span>
              <span className="text-base font-bold text-rose-400">{fmt(pricedOutstanding)}</span>
            </div>
          </div>
        </div>
        {renderTable(pricedRows, 'priced')}
      </div>

      {/* Empty state when both sections are empty (e.g. before first sync) */}
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
        Shown when Deco has <span className="font-semibold">no payment records</span> against the order. Excludes cancelled, quotes, &pound;0-balance internal <span className="font-mono">stash</span> customers, <span className="font-mono">GOK</span> / Gift of Kit orders, and <span className="font-mono">Stash Shop</span> orders.
      </div>
    </div>
  );
};

export default UnpaidOrders;
