import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Package, Search, ArrowUpDown, AlertTriangle, ExternalLink, Download, Loader2, RefreshCw } from 'lucide-react';
import { DecoJob } from '../types';
import { fetchDecoFinancials } from '../services/apiService';
import { supabaseFetch, isSupabaseReady } from '../services/supabase';
import { ApiSettings } from './SettingsModal';

interface Props {
  decoJobs: DecoJob[];
  isDark: boolean;
  settings: ApiSettings;
  onNavigateToOrder?: (orderNumber: string) => void;
}

type SortKey = 'jobNumber' | 'customerName' | 'outstandingBalance' | 'dateShipped' | 'orderTotal' | 'daysSinceShipped';
type SortDir = 'asc' | 'desc';

const CACHE_ID = 'shipped_not_invoiced';

const ShippedNotInvoiced: React.FC<Props> = ({ decoJobs, isDark, settings, onNavigateToOrder }) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('daysSinceShipped');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [allJobs, setAllJobs] = useState<DecoJob[]>(decoJobs);
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState('');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const hasFetched = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Save filtered results to Supabase so team sees them instantly
  const saveCache = useCallback(async (filteredJobs: DecoJob[]) => {
    if (!isSupabaseReady()) return;
    try {
      const lean = filteredJobs.map(j => ({
        jobNumber: j.jobNumber, poNumber: j.poNumber, jobName: j.jobName,
        customerName: j.customerName, status: j.status,
        dateShipped: j.dateShipped, dateInvoiced: j.dateInvoiced,
        orderTotal: j.orderTotal, outstandingBalance: j.outstandingBalance,
        paymentStatus: j.paymentStatus, salesPerson: j.salesPerson,
      }));
      const ts = new Date().toISOString();
      await supabaseFetch('stash_finance_cache', 'POST', {
        id: CACHE_ID, data: lean, last_synced: ts, updated_at: ts,
      }, 'resolution=merge-duplicates');
      setLastSynced(ts);
    } catch { /* non-critical */ }
  }, []);

  // Load cached results from Supabase (instant for team)
  const loadCache = useCallback(async (): Promise<DecoJob[] | null> => {
    if (!isSupabaseReady()) return null;
    try {
      const res = await supabaseFetch(
        `stash_finance_cache?id=eq.${CACHE_ID}&select=data,last_synced`, 'GET'
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0].data) && rows[0].data.length > 0) {
        setLastSynced(rows[0].last_synced);
        return rows[0].data;
      }
    } catch {}
    return null;
  }, []);

  const loadFullData = useCallback(async () => {
    if (!settings.useLiveData) return;
    setIsLoading(true);
    setLoadProgress('Fetching all orders...');
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const jobs = await fetchDecoFinancials(settings, 2020, (cur, total) => {
        setLoadProgress(`Loading ${cur} / ${total || '?'} orders...`);
      }, ac.signal);
      if (!ac.signal.aborted) {
        setAllJobs(jobs);
        // Filter and save to Supabase for team access
        const filtered = jobs.filter(j =>
          !!j.dateShipped && !j.dateInvoiced &&
          (j.outstandingBalance || 0) > 0 && j.status !== 'Cancelled'
        );
        saveCache(filtered);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error('ShippedNotInvoiced fetch error:', e);
    } finally {
      if (!ac.signal.aborted) { setIsLoading(false); setLoadProgress(''); }
    }
  }, [settings, saveCache]);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    // Try cached data first (instant), then optionally refresh
    (async () => {
      const cached = await loadCache();
      if (cached && cached.length > 0) {
        // Use cached data immediately — team members see this instantly
        setAllJobs(cached as DecoJob[]);
      } else {
        // No cache — do a full fetch (admin first load)
        loadFullData();
      }
    })();

    return () => { abortRef.current?.abort(); };
  }, [loadCache, loadFullData]);

  const jobs = useMemo(() => {
    return allJobs.filter(j =>
      !!j.dateShipped &&
      !j.dateInvoiced &&
      (j.outstandingBalance || 0) > 0 &&
      j.status !== 'Cancelled'
    ).map(j => ({
      ...j,
      daysSinceShipped: j.dateShipped
        ? Math.floor((Date.now() - new Date(j.dateShipped).getTime()) / 86400000)
        : 0,
    }));
  }, [allJobs]);

  const filtered = useMemo(() => {
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
    list.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'jobNumber': av = a.jobNumber; bv = b.jobNumber; break;
        case 'customerName': av = a.customerName; bv = b.customerName; break;
        case 'outstandingBalance': av = a.outstandingBalance || 0; bv = b.outstandingBalance || 0; break;
        case 'orderTotal': av = a.orderTotal || 0; bv = b.orderTotal || 0; break;
        case 'dateShipped': av = a.dateShipped || ''; bv = b.dateShipped || ''; break;
        case 'daysSinceShipped': av = a.daysSinceShipped; bv = b.daysSinceShipped; break;
        default: av = 0; bv = 0;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [jobs, search, sortKey, sortDir]);

  const totalOutstanding = useMemo(() => filtered.reduce((s, j) => s + (j.outstandingBalance || 0), 0), [filtered]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const fmt = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d?: string) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const exportCsv = () => {
    const header = ['Job Number', 'PO Number', 'Customer', 'Job Name', 'Order Total', 'Outstanding', 'Date Shipped', 'Days Since Shipped'];
    const rows = filtered.map(j => [
      j.jobNumber, j.poNumber || '', j.customerName, j.jobName,
      (j.orderTotal || 0).toFixed(2), (j.outstandingBalance || 0).toFixed(2),
      j.dateShipped || '', j.daysSinceShipped.toString()
    ]);
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `shipped-not-invoiced-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
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
            {isLoading ? loadProgress : lastSynced
              ? `Last updated: ${new Date(lastSynced).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : 'Jobs shipped with outstanding balance but no invoice sent'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadFullData} disabled={isLoading} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${borderColor} ${cardBg} text-xs font-medium ${textSecondary} ${isLoading ? 'opacity-50' : 'hover:bg-white/10'} transition-colors`} title="Refresh from Deco (fetches all orders)">
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

      {/* Search + Export */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
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

      {/* Table */}
      <div className={`${cardBg} rounded-xl border ${borderColor} overflow-hidden`}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Package className={`w-12 h-12 ${textSecondary} opacity-40 mb-3`} />
            <p className={`text-sm font-medium ${textSecondary}`}>
              {search ? 'No results matching your search' : 'No shipped jobs awaiting invoicing'}
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
                    ['orderTotal', 'Order Total'],
                    ['outstandingBalance', 'Outstanding'],
                    ['dateShipped', 'Shipped'],
                    ['daysSinceShipped', 'Days Ago'],
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
                {filtered.map(j => (
                  <tr key={j.jobNumber} className={`border-b ${borderColor} ${hoverRow} transition-colors`}>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onNavigateToOrder?.(j.poNumber || j.jobNumber)}
                        className="text-indigo-400 hover:text-indigo-300 font-mono font-medium text-xs flex items-center gap-1"
                      >
                        {j.jobNumber} <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                    <td className={`px-4 py-3 font-medium ${textPrimary}`}>{j.customerName}</td>
                    <td className={`px-4 py-3 ${textSecondary} max-w-[200px] truncate`}>{j.jobName}</td>
                    <td className={`px-4 py-3 ${textPrimary} font-medium`}>{fmt(j.orderTotal || 0)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShippedNotInvoiced;
