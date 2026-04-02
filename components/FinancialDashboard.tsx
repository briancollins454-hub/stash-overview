import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  DollarSign, AlertTriangle, Clock, Download, ChevronDown, ChevronUp,
  Search, Filter, ArrowUpDown, Eye, FileText, CheckCircle2, XCircle,
  TrendingUp, Users, Calendar, CreditCard, Banknote, Receipt,
  ChevronRight, X, StickerIcon, SortAsc, SortDesc, Loader2, RefreshCw, DatabaseZap
} from 'lucide-react';
import { DecoJob } from '../types';
import { fetchDecoFinancials } from '../services/apiService';
import { getItem, setItem } from '../services/localStore';
import { ApiSettings } from './SettingsModal';

interface Props {
  decoJobs: DecoJob[]; // fallback / cached jobs from main sync
  isDark: boolean;
  settings: ApiSettings;
  onNavigateToOrder?: (orderNumber: string) => void;
}

type SortField = 'customer' | 'balance' | 'age' | 'terms' | 'billable' | 'invoiced' | 'jobCount';
type SortDir = 'asc' | 'desc';
type ViewMode = 'customers' | 'orders' | 'aging';
type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';
type PaymentFilter = 'all' | 'outstanding' | 'paid' | 'invoiced' | 'overdue';

interface CustomerAccount {
  name: string;
  customerId: string;
  jobs: DecoJob[];
  totalOutstanding: number;
  totalBillable: number;
  totalPaid: number;
  totalCreditUsed: number;
  accountTerms: string;
  oldestUnpaidDate: string | null;
  agingDays: number;
  agingBucket: AgingBucket;
  jobCount: number;
  outstandingJobCount: number;
  lastPaymentDate: string | null;
}

const formatCurrency = (v: number) => '£' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const formatDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const daysSince = (d: string | null | undefined): number => {
  if (!d) return 0;
  const date = new Date(d);
  if (isNaN(date.getTime())) return 0;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
};

const getAgingBucket = (days: number): AgingBucket => {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
};

const agingBucketLabel: Record<AgingBucket, string> = {
  '0-30': '0–30 Days',
  '31-60': '31–60 Days',
  '61-90': '61–90 Days',
  '90+': '90+ Days',
};

const agingBucketColor: Record<AgingBucket, string> = {
  '0-30': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  '31-60': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  '61-90': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  '90+': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

const paymentStatusLabel = (ps: string | undefined): string => {
  if (!ps) return 'Unknown';
  const n = parseInt(ps);
  if (n === 4) return 'Unpaid';
  if (n === 5) return 'Paid';
  if (n === 7) return 'Cancelled';
  if (n === 9) return 'Invoiced';
  if (ps.toLowerCase().includes('paid')) return 'Paid';
  if (ps.toLowerCase().includes('invoice')) return 'Invoiced';
  return ps;
};

const paymentStatusColor = (ps: string | undefined): string => {
  const label = paymentStatusLabel(ps);
  if (label === 'Paid') return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  if (label === 'Invoiced') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  if (label === 'Unpaid') return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  if (label === 'Cancelled') return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
};

const FinancialDashboard: React.FC<Props> = ({ decoJobs, isDark, settings, onNavigateToOrder }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('customers');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('balance');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('outstanding');
  const [agingFilter, setAgingFilter] = useState<AgingBucket | 'all'>('all');
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [priorityNotes, setPriorityNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('stash_finance_notes') || '{}'); } catch { return {}; }
  });
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');

  // Self-loading state for full financial data — cache-first with incremental sync
  const [financeJobs, setFinanceJobs] = useState<DecoJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 });
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<'cache' | 'incremental' | 'full'>('cache');
  const abortRef = useRef<AbortController | null>(null);

  const CACHE_KEY = 'stash_finance_jobs';
  const CACHE_TS_KEY = 'stash_finance_synced';

  // Load cached data on mount, then incremental sync in background
  useEffect(() => {
    if (hasLoaded || isLoading) return;
    loadCachedThenSync();
    return () => { abortRef.current?.abort(); };
  }, []);

  const loadCachedThenSync = useCallback(async () => {
    // Step 1: Load from IndexedDB cache instantly
    try {
      const [cached, cachedTs] = await Promise.all([
        getItem<DecoJob[]>(CACHE_KEY),
        getItem<string>(CACHE_TS_KEY),
      ]);
      if (cached && cached.length > 0) {
        setFinanceJobs(cached);
        setHasLoaded(true);
        setLastSynced(cachedTs || null);
        // Step 2: Incremental sync (last 60 days) in background to pick up changes
        if (settings.useLiveData) {
          incrementalSync(cached, cachedTs);
        }
        return;
      }
    } catch { /* cache miss, do full load */ }

    // No cache — do full load
    if (settings.useLiveData) {
      fullSync();
    }
  }, [settings]);

  const incrementalSync = useCallback(async (cachedJobs: DecoJob[], _cachedTs: string | null) => {
    if (isLoading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true); setSyncMode('incremental'); setLoadError(null);
    try {
      // Only fetch orders from the last 60 days
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 60);
      const sinceYear = sinceDate.getFullYear();
      const jobs = await fetchDecoFinancials(
        settings, sinceYear,
        (current, total) => setLoadProgress({ current, total }),
        controller.signal,
      );
      if (controller.signal.aborted) return;

      // Merge: recent data overwrites, older cached data stays
      const recentMap = new Map(jobs.map(j => [j.jobNumber, j]));
      const merged = cachedJobs.map(j => recentMap.get(j.jobNumber) || j);
      // Add any brand new orders not in cache
      jobs.forEach(j => {
        if (!cachedJobs.some(c => c.jobNumber === j.jobNumber)) merged.push(j);
      });

      setFinanceJobs(merged);
      setHasLoaded(true);
      const now = new Date().toISOString();
      setLastSynced(now);
      // Persist to IndexedDB
      await Promise.all([setItem(CACHE_KEY, merged), setItem(CACHE_TS_KEY, now)]);
    } catch (e: any) {
      if (!controller.signal.aborted) setLoadError(e.message || 'Incremental sync failed');
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [settings, isLoading]);

  const fullSync = useCallback(async () => {
    if (isLoading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true); setSyncMode('full'); setLoadError(null); setLoadProgress({ current: 0, total: 0 });
    try {
      const jobs = await fetchDecoFinancials(
        settings, 2020,
        (current, total) => setLoadProgress({ current, total }),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setFinanceJobs(jobs);
      setHasLoaded(true);
      const now = new Date().toISOString();
      setLastSynced(now);
      await Promise.all([setItem(CACHE_KEY, jobs), setItem(CACHE_TS_KEY, now)]);
    } catch (e: any) {
      if (!controller.signal.aborted) setLoadError(e.message || 'Failed to load financial data');
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [settings, isLoading]);

  // Use finance-fetched jobs if available, otherwise fall back to cached decoJobs
  const allJobs = hasLoaded ? financeJobs : decoJobs;

  // Build customer accounts from ALL Deco jobs
  const customerAccounts = useMemo<CustomerAccount[]>(() => {
    const map = new Map<string, DecoJob[]>();
    allJobs.forEach(j => {
      const key = j.customerName?.trim() || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(j);
    });

    return Array.from(map.entries()).map(([name, jobs]) => {
      const totalOutstanding = jobs.reduce((s, j) => s + (j.outstandingBalance || 0), 0);
      const totalBillable = jobs.reduce((s, j) => s + (j.billableAmount || 0), 0);
      const totalPaid = totalBillable - totalOutstanding;
      const totalCreditUsed = jobs.reduce((s, j) => s + (j.creditUsed || 0), 0);

      // Find the oldest unpaid invoice/order date
      const unpaidJobs = jobs.filter(j => (j.outstandingBalance || 0) > 0);
      const oldestDates = unpaidJobs
        .map(j => j.dateInvoiced || j.dateOrdered)
        .filter(Boolean)
        .sort();
      const oldestUnpaidDate = oldestDates[0] || null;
      const agingDays = oldestUnpaidDate ? daysSince(oldestUnpaidDate) : 0;

      // Get last payment across all jobs
      const allPayments = jobs.flatMap(j => j.payments || []);
      const sortedPayments = allPayments.filter(p => p.datePaid).sort((a, b) => new Date(b.datePaid).getTime() - new Date(a.datePaid).getTime());
      const lastPaymentDate = sortedPayments[0]?.datePaid || null;

      // Most common account terms
      const termsCount = new Map<string, number>();
      jobs.forEach(j => {
        if (j.accountTerms) termsCount.set(j.accountTerms, (termsCount.get(j.accountTerms) || 0) + 1);
      });
      const accountTerms = Array.from(termsCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

      return {
        name,
        customerId: name.toLowerCase().replace(/\s+/g, '_'),
        jobs,
        totalOutstanding,
        totalBillable,
        totalPaid: Math.max(0, totalPaid),
        totalCreditUsed,
        accountTerms,
        oldestUnpaidDate,
        agingDays,
        agingBucket: getAgingBucket(agingDays),
        jobCount: jobs.length,
        outstandingJobCount: unpaidJobs.length,
        lastPaymentDate,
      };
    });
  }, [allJobs]);

  // Global summary stats
  const summary = useMemo(() => {
    const total = customerAccounts.reduce((s, a) => s + a.totalOutstanding, 0);
    const totalBillable = customerAccounts.reduce((s, a) => s + a.totalBillable, 0);
    const totalPaid = customerAccounts.reduce((s, a) => s + a.totalPaid, 0);
    const customersWithBalance = customerAccounts.filter(a => a.totalOutstanding > 0);
    const overdue90 = customersWithBalance.filter(a => a.agingBucket === '90+');
    const overdue60 = customersWithBalance.filter(a => a.agingBucket === '61-90' || a.agingBucket === '90+');

    // Aging buckets
    const aging = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    customersWithBalance.forEach(a => { aging[a.agingBucket] += a.totalOutstanding; });

    return { total, totalBillable, totalPaid, customersWithBalance: customersWithBalance.length, overdue90: overdue90.length, overdue60: overdue60.length, aging, totalJobs: allJobs.length, totalCustomers: customerAccounts.length };
  }, [customerAccounts]);

  // Filtered & sorted data
  const filteredAccounts = useMemo(() => {
    let list = [...customerAccounts];

    // Search
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(s) ||
        a.jobs.some(j => j.jobNumber.includes(s) || j.poNumber?.toLowerCase().includes(s) || j.jobName?.toLowerCase().includes(s))
      );
    }

    // Payment filter
    if (paymentFilter === 'outstanding') list = list.filter(a => a.totalOutstanding > 0);
    else if (paymentFilter === 'paid') list = list.filter(a => a.totalOutstanding === 0 && a.totalBillable > 0);
    else if (paymentFilter === 'invoiced') list = list.filter(a => a.jobs.some(j => j.dateInvoiced));
    else if (paymentFilter === 'overdue') list = list.filter(a => a.totalOutstanding > 0 && a.agingDays > 30);

    // Aging filter
    if (agingFilter !== 'all') list = list.filter(a => a.agingBucket === agingFilter && a.totalOutstanding > 0);

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'customer': cmp = a.name.localeCompare(b.name); break;
        case 'balance': cmp = a.totalOutstanding - b.totalOutstanding; break;
        case 'age': cmp = a.agingDays - b.agingDays; break;
        case 'terms': cmp = a.accountTerms.localeCompare(b.accountTerms); break;
        case 'billable': cmp = a.totalBillable - b.totalBillable; break;
        case 'invoiced': cmp = (a.oldestUnpaidDate || '').localeCompare(b.oldestUnpaidDate || ''); break;
        case 'jobCount': cmp = a.jobCount - b.jobCount; break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [customerAccounts, searchTerm, paymentFilter, agingFilter, sortField, sortDir]);

  // All individual orders (for order view)
  const filteredOrders = useMemo(() => {
    let list = allJobs.filter(j => (j.billableAmount || 0) > 0 || (j.outstandingBalance || 0) > 0);

    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      list = list.filter(j =>
        j.customerName.toLowerCase().includes(s) ||
        j.jobNumber.includes(s) ||
        j.poNumber?.toLowerCase().includes(s) ||
        j.jobName?.toLowerCase().includes(s)
      );
    }

    if (paymentFilter === 'outstanding') list = list.filter(j => (j.outstandingBalance || 0) > 0);
    else if (paymentFilter === 'paid') list = list.filter(j => (j.outstandingBalance || 0) === 0);
    else if (paymentFilter === 'invoiced') list = list.filter(j => !!j.dateInvoiced);
    else if (paymentFilter === 'overdue') list = list.filter(j => (j.outstandingBalance || 0) > 0 && daysSince(j.dateInvoiced || j.dateOrdered) > 30);

    if (agingFilter !== 'all') {
      list = list.filter(j => {
        const days = daysSince(j.dateInvoiced || j.dateOrdered);
        return getAgingBucket(days) === agingFilter && (j.outstandingBalance || 0) > 0;
      });
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'customer': cmp = a.customerName.localeCompare(b.customerName); break;
        case 'balance': cmp = (a.outstandingBalance || 0) - (b.outstandingBalance || 0); break;
        case 'age': cmp = daysSince(a.dateInvoiced || a.dateOrdered) - daysSince(b.dateInvoiced || b.dateOrdered); break;
        case 'billable': cmp = (a.billableAmount || 0) - (b.billableAmount || 0); break;
        default: cmp = (a.outstandingBalance || 0) - (b.outstandingBalance || 0);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [allJobs, searchTerm, paymentFilter, agingFilter, sortField, sortDir]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }, [sortField]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedCustomers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selectedCustomers.size === filteredAccounts.length) setSelectedCustomers(new Set());
    else setSelectedCustomers(new Set(filteredAccounts.map(a => a.customerId)));
  }, [filteredAccounts, selectedCustomers.size]);

  const saveNote = useCallback((customerId: string, note: string) => {
    setPriorityNotes(prev => {
      const next = { ...prev, [customerId]: note };
      if (!note) delete next[customerId];
      localStorage.setItem('stash_finance_notes', JSON.stringify(next));
      return next;
    });
    setEditingNote(null);
  }, []);

  // Export functions
  const exportCSV = useCallback(() => {
    const headers = ['Customer', 'Outstanding Balance', 'Total Billed', 'Total Paid', 'Account Terms', 'Aging Days', 'Aging Bucket', 'Oldest Unpaid Date', 'Last Payment', 'Jobs', 'Outstanding Jobs', 'Notes'];
    const escapeCell = (v: any) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = (selectedCustomers.size > 0 ? filteredAccounts.filter(a => selectedCustomers.has(a.customerId)) : filteredAccounts).map(a => [
      a.name, a.totalOutstanding.toFixed(2), a.totalBillable.toFixed(2), a.totalPaid.toFixed(2),
      a.accountTerms, a.agingDays, agingBucketLabel[a.agingBucket],
      formatDate(a.oldestUnpaidDate), formatDate(a.lastPaymentDate),
      a.jobCount, a.outstandingJobCount, priorityNotes[a.customerId] || ''
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `outstanding-balances-${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [filteredAccounts, selectedCustomers, priorityNotes]);

  const exportDetailedCSV = useCallback(() => {
    const headers = ['Customer', 'Job Number', 'PO Number', 'Job Name', 'Order Date', 'Invoice Date', 'Billable', 'Outstanding', 'Payment Status', 'Account Terms', 'Aging Days', 'Payments Made', 'Payment Methods', 'Notes'];
    const escapeCell = (v: any) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const targetAccounts = selectedCustomers.size > 0 ? filteredAccounts.filter(a => selectedCustomers.has(a.customerId)) : filteredAccounts;
    const rows = targetAccounts.flatMap(a => a.jobs.filter(j => (j.billableAmount || 0) > 0 || (j.outstandingBalance || 0) > 0).map(j => [
      a.name, j.jobNumber, j.poNumber, j.jobName, formatDate(j.dateOrdered), formatDate(j.dateInvoiced),
      (j.billableAmount || 0).toFixed(2), (j.outstandingBalance || 0).toFixed(2),
      paymentStatusLabel(j.paymentStatus), j.accountTerms || a.accountTerms,
      daysSince(j.dateInvoiced || j.dateOrdered),
      (j.payments || []).map(p => `${formatCurrency(p.amount)} on ${formatDate(p.datePaid)}`).join('; '),
      (j.payments || []).map(p => p.method).join('; '),
      priorityNotes[a.customerId] || ''
    ]));
    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `financial-detail-${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [filteredAccounts, selectedCustomers, priorityNotes]);

  const SortButton: React.FC<{ field: SortField; label: string }> = ({ field, label }) => (
    <button onClick={() => handleSort(field)} className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${sortField === field ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
      {label}
      {sortField === field ? (sortDir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  );

  const card = `rounded-xl border shadow-sm ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`;
  const headerText = `text-[10px] font-black uppercase tracking-widest ${isDark ? 'text-gray-400' : 'text-gray-500'}`;

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
            <DollarSign className="w-6 h-6 inline-block mr-2 -mt-1 text-indigo-500" />
            Accounts & Finance
          </h1>
          <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Outstanding balances, aging analysis, and payment tracking from DecoNetwork
            {isLoading && syncMode === 'incremental' && <span className="ml-2 text-indigo-500 font-bold">Syncing recent changes...</span>}
            {isLoading && syncMode === 'full' && <span className="ml-2 text-indigo-500 font-bold">Full reload {loadProgress.current.toLocaleString()}/{loadProgress.total.toLocaleString() || '...'} orders</span>}
            {!isLoading && hasLoaded && <span className="ml-2 text-green-500">\u2713 {allJobs.length.toLocaleString()} orders{lastSynced ? ` \u2022 Synced ${new Date(lastSynced).toLocaleDateString('en-GB')} ${new Date(lastSynced).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => incrementalSync(financeJobs, lastSynced)} disabled={isLoading} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''} ${isDark ? 'bg-slate-700 text-gray-300 border-slate-600 hover:bg-slate-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {isLoading ? 'Syncing...' : 'Sync Recent'}
          </button>
          <button onClick={fullSync} disabled={isLoading} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''} ${isDark ? 'bg-slate-700 text-amber-300 border-slate-600 hover:bg-slate-600' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}>
            <DatabaseZap className="w-3.5 h-3.5" /> Full Reload
          </button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700 dark:hover:bg-indigo-900/50 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export Summary
          </button>
          <button onClick={exportDetailedCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700 dark:hover:bg-emerald-900/50 transition-colors">
            <FileText className="w-3.5 h-3.5" /> Export Detailed
          </button>
        </div>
      </div>

      {/* Loading progress bar */}
      {isLoading && syncMode === 'full' && (
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
            <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Full reload — fetching all orders from DecoNetwork...</span>
          </div>
          <div className={`h-3 rounded-full overflow-hidden ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${loadProgress.total > 0 ? (loadProgress.current / loadProgress.total) * 100 : 0}%` }} />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{loadProgress.current.toLocaleString()} of {loadProgress.total.toLocaleString()} orders</span>
            <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{loadProgress.total > 0 ? ((loadProgress.current / loadProgress.total) * 100).toFixed(0) : 0}%</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {loadError && (
        <div className={`${card} p-4 border-l-4 border-l-red-500`}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="text-sm font-bold text-red-600 dark:text-red-400">Failed to load financial data</span>
          </div>
          <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{loadError}</p>
          <button onClick={fullSync} className="mt-2 px-3 py-1.5 rounded text-[10px] font-bold bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300">Retry</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className={`${card} p-4`}>
          <div className={headerText}>Total Outstanding</div>
          <div className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1">{formatCurrency(summary.total)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{summary.customersWithBalance} account{summary.customersWithBalance !== 1 ? 's' : ''}</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={headerText}>Total Billed</div>
          <div className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white mt-1">{formatCurrency(summary.totalBillable)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">All orders</div>
        </div>
        <div className={`${card} p-4`}>
          <div className={headerText}>Total Paid</div>
          <div className="text-xl sm:text-2xl font-black text-green-600 dark:text-green-400 mt-1">{formatCurrency(summary.totalPaid)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{summary.totalBillable > 0 ? ((summary.totalPaid / summary.totalBillable) * 100).toFixed(0) : 0}% collected</div>
        </div>
        <div className={`${card} p-4 cursor-pointer hover:ring-2 ring-yellow-400 transition-all ${agingFilter === '31-60' ? 'ring-2' : ''}`} onClick={() => setAgingFilter(f => f === '31-60' ? 'all' : '31-60')}>
          <div className={headerText}>31–60 Days</div>
          <div className="text-xl sm:text-2xl font-black text-yellow-600 dark:text-yellow-400 mt-1">{formatCurrency(summary.aging['31-60'])}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">Aging</div>
        </div>
        <div className={`${card} p-4 cursor-pointer hover:ring-2 ring-orange-400 transition-all ${agingFilter === '61-90' ? 'ring-2' : ''}`} onClick={() => setAgingFilter(f => f === '61-90' ? 'all' : '61-90')}>
          <div className={headerText}>61–90 Days</div>
          <div className="text-xl sm:text-2xl font-black text-orange-600 dark:text-orange-400 mt-1">{formatCurrency(summary.aging['61-90'])}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{summary.overdue60} account{summary.overdue60 !== 1 ? 's' : ''}</div>
        </div>
        <div className={`${card} p-4 cursor-pointer hover:ring-2 ring-red-400 transition-all ${agingFilter === '90+' ? 'ring-2' : ''}`} onClick={() => setAgingFilter(f => f === '90+' ? 'all' : '90+')}>
          <div className={headerText}>90+ Days</div>
          <div className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-400 mt-1">{formatCurrency(summary.aging['90+'])}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{summary.overdue90} critical</div>
        </div>
      </div>

      {/* Aging Bar Visualization */}
      {summary.total > 0 && (
        <div className={`${card} p-4`}>
          <div className={`${headerText} mb-3`}>Outstanding Balance Aging Distribution</div>
          <div className="flex h-8 rounded-lg overflow-hidden">
            {(['0-30', '31-60', '61-90', '90+'] as AgingBucket[]).map(bucket => {
              const pct = summary.total > 0 ? (summary.aging[bucket] / summary.total) * 100 : 0;
              if (pct === 0) return null;
              const colors = { '0-30': 'bg-green-500', '31-60': 'bg-yellow-500', '61-90': 'bg-orange-500', '90+': 'bg-red-500' };
              return (
                <div key={bucket} className={`${colors[bucket]} flex items-center justify-center text-white text-[10px] font-bold transition-all cursor-pointer hover:opacity-80`}
                  style={{ width: `${Math.max(pct, 5)}%` }} onClick={() => setAgingFilter(f => f === bucket ? 'all' : bucket)}
                  title={`${agingBucketLabel[bucket]}: ${formatCurrency(summary.aging[bucket])} (${pct.toFixed(1)}%)`}>
                  {pct >= 10 && `${pct.toFixed(0)}%`}
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-2 flex-wrap">
            {(['0-30', '31-60', '61-90', '90+'] as AgingBucket[]).map(bucket => (
              <div key={bucket} className="flex items-center gap-1.5 text-[10px]">
                <div className={`w-2.5 h-2.5 rounded-sm ${{ '0-30': 'bg-green-500', '31-60': 'bg-yellow-500', '61-90': 'bg-orange-500', '90+': 'bg-red-500' }[bucket]}`} />
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{agingBucketLabel[bucket]}: {formatCurrency(summary.aging[bucket])}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className={`${card} p-3`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* View mode tabs */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-600">
            {([['customers', 'By Customer', Users], ['orders', 'By Order', Receipt], ['aging', 'Aging Report', Clock]] as const).map(([mode, label, Icon]) => (
              <button key={mode} onClick={() => setViewMode(mode)} className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${viewMode === mode ? 'bg-indigo-600 text-white' : `${isDark ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search customer, job, PO..."
              className={`w-full pl-9 pr-8 py-1.5 rounded-lg text-xs border ${isDark ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-500' : 'bg-gray-50 border-gray-200 placeholder-gray-400'} focus:outline-none focus:ring-2 focus:ring-indigo-500`} />
            {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-gray-400" /></button>}
          </div>

          {/* Payment filter */}
          <div className="flex gap-1 flex-wrap">
            {([['all', 'All'], ['outstanding', 'Outstanding'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['invoiced', 'Invoiced']] as [PaymentFilter, string][]).map(([val, label]) => (
              <button key={val} onClick={() => setPaymentFilter(val)} className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-colors ${paymentFilter === val ? 'bg-indigo-600 text-white' : `${isDark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100'}`}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Aging quick filter */}
          {agingFilter !== 'all' && (
            <button onClick={() => setAgingFilter('all')} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
              <X className="w-3 h-3" /> {agingBucketLabel[agingFilter]}
            </button>
          )}
        </div>
      </div>

      {/* Customer View */}
      {viewMode === 'customers' && (
        <div className={card}>
          {/* Table header */}
          <div className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-2 px-4 py-2.5 border-b ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
            <div className="flex items-center">
              <input type="checkbox" checked={selectedCustomers.size === filteredAccounts.length && filteredAccounts.length > 0} onChange={selectAll}
                className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
            </div>
            <SortButton field="customer" label="Customer" />
            <SortButton field="balance" label="Outstanding" />
            <SortButton field="billable" label="Billed" />
            <SortButton field="terms" label="Terms" />
            <SortButton field="age" label="Age" />
            <SortButton field="jobCount" label="Jobs" />
            <div className={headerText}>Actions</div>
          </div>

          {/* Rows */}
          {filteredAccounts.length === 0 && (
            <div className={`text-center py-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No accounts match your filters</p>
            </div>
          )}

          {filteredAccounts.map(account => (
            <div key={account.customerId}>
              {/* Customer row */}
              <div className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-2 px-4 py-3 border-b transition-colors cursor-pointer ${isDark ? 'border-slate-700/50 hover:bg-slate-700/30' : 'border-gray-50 hover:bg-gray-50'} ${expandedCustomer === account.customerId ? (isDark ? 'bg-slate-700/40' : 'bg-indigo-50/50') : ''}`}
                onClick={() => setExpandedCustomer(e => e === account.customerId ? null : account.customerId)}>
                <div className="flex items-center" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedCustomers.has(account.customerId)} onChange={() => toggleSelect(account.customerId)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${expandedCustomer === account.customerId ? 'rotate-90' : ''} ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                  <div className="min-w-0">
                    <div className={`text-sm font-bold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{account.name}</div>
                    {priorityNotes[account.customerId] && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 truncate mt-0.5">📝 {priorityNotes[account.customerId]}</div>
                    )}
                  </div>
                </div>
                <div className={`text-sm font-black text-right ${account.totalOutstanding > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  {account.totalOutstanding > 0 ? formatCurrency(account.totalOutstanding) : '✓ Clear'}
                </div>
                <div className={`text-xs text-right ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatCurrency(account.totalBillable)}</div>
                <div className={`text-[10px] font-medium px-2 py-0.5 rounded-full text-center ${isDark ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>{account.accountTerms}</div>
                <div>
                  {account.totalOutstanding > 0 ? (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agingBucketColor[account.agingBucket]}`}>
                      {account.agingDays}d
                    </span>
                  ) : <span className="text-[10px] text-gray-400">—</span>}
                </div>
                <div className={`text-xs text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {account.outstandingJobCount > 0 ? <span className="text-red-500 font-bold">{account.outstandingJobCount}</span> : ''}{account.outstandingJobCount > 0 ? '/' : ''}{account.jobCount}
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => { setEditingNote(account.customerId); setNoteInput(priorityNotes[account.customerId] || ''); }}
                    className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-slate-600 text-gray-400' : 'hover:bg-gray-200 text-gray-400'}`} title="Add/edit note">
                    <FileText className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Note editing inline */}
              {editingNote === account.customerId && (
                <div className={`px-4 py-2 border-b ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-amber-50 border-amber-100'}`} onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <input value={noteInput} onChange={e => setNoteInput(e.target.value)} placeholder="Add priority note (e.g. 'Chase payment', 'On payment plan')"
                      className={`flex-1 px-3 py-1.5 rounded text-xs border ${isDark ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-amber-200'} focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                      onKeyDown={e => { if (e.key === 'Enter') saveNote(account.customerId, noteInput); if (e.key === 'Escape') setEditingNote(null); }}
                      autoFocus />
                    <button onClick={() => saveNote(account.customerId, noteInput)} className="px-2 py-1 rounded text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
                    {noteInput && <button onClick={() => saveNote(account.customerId, '')} className="px-2 py-1 rounded text-[10px] font-bold bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300">Clear</button>}
                    <button onClick={() => setEditingNote(null)} className="p-1"><X className="w-3.5 h-3.5 text-gray-400" /></button>
                  </div>
                </div>
              )}

              {/* Expanded customer detail */}
              {expandedCustomer === account.customerId && (
                <div className={`px-4 py-3 border-b ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-gray-50/80 border-gray-100'}`}>
                  {/* Customer summary bar */}
                  <div className="flex flex-wrap gap-4 mb-3">
                    <div className="text-[10px]"><span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Total Billed:</span> <span className="font-bold">{formatCurrency(account.totalBillable)}</span></div>
                    <div className="text-[10px]"><span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Paid:</span> <span className="font-bold text-green-600">{formatCurrency(account.totalPaid)}</span></div>
                    <div className="text-[10px]"><span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Outstanding:</span> <span className="font-bold text-red-600">{formatCurrency(account.totalOutstanding)}</span></div>
                    {account.totalCreditUsed > 0 && <div className="text-[10px]"><span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Credits:</span> <span className="font-bold text-blue-600">{formatCurrency(account.totalCreditUsed)}</span></div>}
                    <div className="text-[10px]"><span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Last Payment:</span> <span className="font-bold">{formatDate(account.lastPaymentDate)}</span></div>
                  </div>

                  {/* Job list */}
                  <div className="space-y-1">
                    {account.jobs
                      .filter(j => (j.billableAmount || 0) > 0 || (j.outstandingBalance || 0) > 0)
                      .sort((a, b) => (b.outstandingBalance || 0) - (a.outstandingBalance || 0))
                      .map(job => {
                        const jobAge = daysSince(job.dateInvoiced || job.dateOrdered);
                        const bucket = getAgingBucket(jobAge);
                        const isExpanded = expandedJob === job.jobNumber;
                        return (
                          <div key={job.jobNumber}>
                            <div className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${isDark ? 'hover:bg-slate-700/50' : 'hover:bg-white'} ${isExpanded ? (isDark ? 'bg-slate-700/50' : 'bg-white shadow-sm') : ''}`}
                              onClick={() => setExpandedJob(e => e === job.jobNumber ? null : job.jobNumber)}>
                              <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''} text-gray-400`} />
                              <span className={`text-xs font-mono font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>#{job.jobNumber}</span>
                              <span className={`text-xs truncate flex-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{job.jobName}</span>
                              {job.poNumber && <span className="text-[10px] text-gray-400">PO: {job.poNumber}</span>}
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${paymentStatusColor(job.paymentStatus)}`}>
                                {paymentStatusLabel(job.paymentStatus)}
                              </span>
                              {(job.outstandingBalance || 0) > 0 && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agingBucketColor[bucket]}`}>{jobAge}d</span>
                              )}
                              <span className={`text-xs font-bold text-right min-w-[80px] ${(job.outstandingBalance || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                {(job.outstandingBalance || 0) > 0 ? formatCurrency(job.outstandingBalance || 0) : '✓ Paid'}
                              </span>
                            </div>

                            {/* Expanded job detail */}
                            {isExpanded && (
                              <div className={`ml-8 mr-2 mb-2 p-3 rounded-lg text-xs space-y-2 ${isDark ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200 shadow-sm'}`}>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div><span className="text-gray-400 text-[10px] uppercase">Billable</span><div className="font-bold">{formatCurrency(job.billableAmount || 0)}</div></div>
                                  <div><span className="text-gray-400 text-[10px] uppercase">Outstanding</span><div className={`font-bold ${(job.outstandingBalance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(job.outstandingBalance || 0)}</div></div>
                                  <div><span className="text-gray-400 text-[10px] uppercase">Subtotal</span><div className="font-bold">{formatCurrency(job.orderSubtotal || 0)}</div></div>
                                  <div><span className="text-gray-400 text-[10px] uppercase">Tax</span><div className="font-bold">{formatCurrency(job.orderTax || 0)}</div></div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div><span className="text-gray-400 text-[10px] uppercase">Order Date</span><div>{formatDate(job.dateOrdered)}</div></div>
                                  <div><span className="text-gray-400 text-[10px] uppercase">Invoice Date</span><div>{formatDate(job.dateInvoiced)}</div></div>
                                  <div><span className="text-gray-400 text-[10px] uppercase">Terms</span><div>{job.accountTerms || account.accountTerms}</div></div>
                                  <div><span className="text-gray-400 text-[10px] uppercase">Status</span><div>{job.status}</div></div>
                                </div>
                                {(job.discount || 0) > 0 && (
                                  <div><span className="text-gray-400 text-[10px] uppercase">Discount</span><span className="ml-2 font-bold text-green-600">{formatCurrency(job.discount || 0)}</span></div>
                                )}
                                {(job.creditUsed || 0) > 0 && (
                                  <div><span className="text-gray-400 text-[10px] uppercase">Credit Used</span><span className="ml-2 font-bold text-blue-600">{formatCurrency(job.creditUsed || 0)}</span></div>
                                )}
                                {/* Payments */}
                                {(job.payments || []).length > 0 && (
                                  <div>
                                    <div className="text-gray-400 text-[10px] uppercase mb-1 font-bold">Payments</div>
                                    {job.payments!.map((p, i) => (
                                      <div key={i} className={`flex items-center gap-3 py-1 ${i > 0 ? 'border-t border-gray-100 dark:border-slate-700' : ''}`}>
                                        <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                                        <span className="font-bold text-green-600">{formatCurrency(p.amount)}</span>
                                        <span className="text-gray-400">{formatDate(p.datePaid)}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-500'}`}>{p.method}</span>
                                        {p.refundedAmount > 0 && <span className="text-red-500 text-[10px] font-bold">Refunded: {formatCurrency(p.refundedAmount)}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {(job.payments || []).length === 0 && (job.outstandingBalance || 0) > 0 && (
                                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400"><AlertTriangle className="w-3.5 h-3.5" /><span className="text-[10px] font-bold uppercase">No payments recorded</span></div>
                                )}
                                {/* Items summary */}
                                <div className="text-[10px] text-gray-400">{job.totalItems} item{job.totalItems !== 1 ? 's' : ''} · {job.itemsProduced} produced · {job.items.reduce((s, it) => s + it.quantity, 0)} units</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    {account.jobs.filter(j => (j.billableAmount || 0) > 0 || (j.outstandingBalance || 0) > 0).length === 0 && (
                      <div className="text-xs text-gray-400 py-2 px-3">No billable orders found for this customer</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Selection toolbar */}
          {selectedCustomers.size > 0 && (
            <div className="sticky bottom-4 mx-4 mb-2">
              <div className="flex items-center justify-between gap-3 bg-indigo-600 text-white rounded-xl px-4 py-2.5 shadow-xl">
                <span className="text-xs font-bold">{selectedCustomers.size} selected</span>
                <div className="flex gap-2">
                  <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/20 hover:bg-white/30 transition-colors">
                    <Download className="w-3.5 h-3.5" /> Export Selected
                  </button>
                  <button onClick={exportDetailedCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/20 hover:bg-white/30 transition-colors">
                    <FileText className="w-3.5 h-3.5" /> Detail Export
                  </button>
                  <button onClick={() => setSelectedCustomers(new Set())} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white/10 hover:bg-white/20 transition-colors">
                    <X className="w-3.5 h-3.5" /> Clear
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order View */}
      {viewMode === 'orders' && (
        <div className={card}>
          <div className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-2 px-4 py-2.5 border-b ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
            <SortButton field="customer" label="Customer / Job" />
            <SortButton field="balance" label="Outstanding" />
            <SortButton field="billable" label="Billable" />
            <div className={headerText}>Status</div>
            <div className={headerText}>Terms</div>
            <SortButton field="age" label="Age" />
            <div className={headerText}>Invoice</div>
          </div>

          {filteredOrders.length === 0 && (
            <div className={`text-center py-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No orders match your filters</p>
            </div>
          )}

          {filteredOrders.map(job => {
            const jobAge = daysSince(job.dateInvoiced || job.dateOrdered);
            const bucket = getAgingBucket(jobAge);
            return (
              <div key={job.jobNumber} className={`grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-2 px-4 py-2.5 border-b transition-colors ${isDark ? 'border-slate-700/50 hover:bg-slate-700/30' : 'border-gray-50 hover:bg-gray-50'}`}>
                <div className="min-w-0">
                  <div className={`text-xs font-bold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    <span className={`font-mono ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>#{job.jobNumber}</span> · {job.customerName}
                  </div>
                  <div className={`text-[10px] truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{job.jobName}{job.poNumber ? ` · PO: ${job.poNumber}` : ''}</div>
                </div>
                <div className={`text-xs font-bold text-right self-center ${(job.outstandingBalance || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  {(job.outstandingBalance || 0) > 0 ? formatCurrency(job.outstandingBalance || 0) : '✓'}
                </div>
                <div className={`text-xs text-right self-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatCurrency(job.billableAmount || 0)}</div>
                <div className="self-center">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${paymentStatusColor(job.paymentStatus)}`}>{paymentStatusLabel(job.paymentStatus)}</span>
                </div>
                <div className={`text-[10px] self-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{job.accountTerms || '—'}</div>
                <div className="self-center">
                  {(job.outstandingBalance || 0) > 0 ? (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agingBucketColor[bucket]}`}>{jobAge}d</span>
                  ) : <span className="text-[10px] text-gray-400">—</span>}
                </div>
                <div className={`text-[10px] self-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatDate(job.dateInvoiced)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Aging Report View */}
      {viewMode === 'aging' && (
        <div className="space-y-4">
          {(['0-30', '31-60', '61-90', '90+'] as AgingBucket[]).map(bucket => {
            const bucketAccounts = customerAccounts.filter(a => a.totalOutstanding > 0 && a.agingBucket === bucket)
              .sort((a, b) => b.totalOutstanding - a.totalOutstanding);
            const bucketTotal = bucketAccounts.reduce((s, a) => s + a.totalOutstanding, 0);
            if (bucketAccounts.length === 0) return null;

            const borderColors = { '0-30': 'border-l-green-500', '31-60': 'border-l-yellow-500', '61-90': 'border-l-orange-500', '90+': 'border-l-red-500' };

            return (
              <div key={bucket} className={`${card} border-l-4 ${borderColors[bucket]} overflow-hidden`}>
                <div className={`px-4 py-3 flex items-center justify-between border-b ${isDark ? 'border-slate-700' : 'border-gray-100'}`}>
                  <div className="flex items-center gap-3">
                    <Clock className={`w-4 h-4 ${{ '0-30': 'text-green-500', '31-60': 'text-yellow-500', '61-90': 'text-orange-500', '90+': 'text-red-500' }[bucket]}`} />
                    <span className={`text-sm font-black uppercase tracking-widest ${isDark ? 'text-white' : 'text-gray-900'}`}>{agingBucketLabel[bucket]}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${agingBucketColor[bucket]}`}>{bucketAccounts.length} account{bucketAccounts.length !== 1 ? 's' : ''}</span>
                  </div>
                  <span className="text-lg font-black text-red-600 dark:text-red-400">{formatCurrency(bucketTotal)}</span>
                </div>

                {bucketAccounts.map((account, i) => (
                  <div key={account.customerId} className={`flex items-center gap-3 px-4 py-2 ${i < bucketAccounts.length - 1 ? `border-b ${isDark ? 'border-slate-700/50' : 'border-gray-50'}` : ''}`}>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>{account.name}</span>
                      <span className={`text-[10px] ml-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{account.outstandingJobCount} job{account.outstandingJobCount !== 1 ? 's' : ''} · {account.accountTerms}</span>
                      {priorityNotes[account.customerId] && <span className="text-[10px] text-amber-500 ml-2">📝 {priorityNotes[account.customerId]}</span>}
                    </div>
                    <span className="text-[10px] font-bold text-gray-400">{account.agingDays} days</span>
                    <span className="text-sm font-black text-red-600 dark:text-red-400 min-w-[90px] text-right">{formatCurrency(account.totalOutstanding)}</span>
                    {/* Proportion bar */}
                    <div className="w-20 hidden sm:block">
                      <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`}>
                        <div className={`h-full rounded-full ${{ '0-30': 'bg-green-500', '31-60': 'bg-yellow-500', '61-90': 'bg-orange-500', '90+': 'bg-red-500' }[bucket]}`}
                          style={{ width: `${bucketTotal > 0 ? Math.max((account.totalOutstanding / bucketTotal) * 100, 5) : 0}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {customerAccounts.filter(a => a.totalOutstanding > 0).length === 0 && (
            <div className={`${card} text-center py-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500 opacity-50" />
              <p className="text-sm font-medium">All accounts are clear — no outstanding balances</p>
            </div>
          )}
        </div>
      )}

      {/* Footer stats */}
      <div className={`text-center text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
        {allJobs.length.toLocaleString()} Deco orders loaded · {customerAccounts.length} unique customers · {hasLoaded ? 'Full history from 2020' : 'Showing cached data (loading full history...)'}
      </div>
    </div>
  );
};

export default FinancialDashboard;
