/**
 * Mobile Summary
 * --------------
 * Single-column, phone-first overview of the metrics that matter when
 * you're on the move. Designed to be opened on a phone and scanned in
 * five seconds without zooming or scrolling sideways.
 *
 * Sections (all collapsible, expand-state persisted in localStorage):
 *   • Header — date strip + sync status + sync button
 *   • Search — order #, customer, Deco job (always visible)
 *   • Shopify       — high-priority / active / done counts (open by default)
 *   • Priority Board — counts by stage, late-job warnings
 *   • Sales         — today / 7d / 30d revenue + pipeline value
 *   • Finance       — invoiced outstanding, WIP, total outstanding,
 *                     A/P total owed, Shopify unfulfilled value
 *   • Credit Block  — top overdue customers
 *
 * Each card jumps you straight to the matching tab/filter on the full
 * dashboard so you can drill in if a number looks wrong.
 *
 * Heavy data (finance cache, QuickBooks A/P) lazy-loads on first
 * expand to keep the page snappy on a phone with poor signal.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Search, AlertTriangle, ShoppingBag, Package, Truck,
  CheckCircle2, Boxes, Link2, Calendar, Loader2, ArrowRight, Clock, Zap,
  ChevronDown, ListChecks, BarChart3, Wallet, ShieldAlert, TrendingUp,
} from 'lucide-react';
import { UnifiedOrder, DecoJob } from '../types';
import { addWorkingDays } from '../utils/workingDays';
import type { HolidayRange } from './SettingsModal';
import { isSupabaseReady, supabaseFetch } from '../services/supabase';

interface SummaryStats {
  notOnDeco: number;
  notOnDeco5Plus: number;
  notOnDeco10Plus: number;
  unfulfilled: number;
  late: number;
  dueSoon: number;
  readyForShipping: number;
  stockReady: number;
  mappingGap: number;
  fulfilled7d: number;
  partiallyFulfilled7d: number;
}

export type MobileFilterId =
  | 'late'
  | 'missing_po'
  | 'mapping_gap'
  | 'ready'
  | 'stock_ready'
  | 'unfulfilled'
  | 'fulfilled7d';

export type MobileJumpTab =
  | 'priority'
  | 'sales'
  | 'finance'
  | 'credit';

interface Props {
  stats: SummaryStats;
  unifiedOrders: UnifiedOrder[];
  decoJobs?: DecoJob[];
  holidayRanges?: HolidayRange[];
  lastSyncTime?: number | null;
  syncStatusMsg?: string;
  isSyncing?: boolean;
  onRefresh: () => void;
  onJumpToOrder: (orderNumber: string) => void;
  onJumpToFilter: (filter: MobileFilterId) => void;
  onJumpToTab: (tab: MobileJumpTab) => void;
}

// ─── Formatters ────────────────────────────────────────────────────────

const fmtDate = (d: Date): string =>
  d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const fmtAge = (ts?: number | null): string => {
  if (!ts) return 'never';
  const ms = Date.now() - ts;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
};

const fmtMoney = (n: number, opts: { decimals?: boolean; compact?: boolean } = {}) => {
  const { decimals = false, compact = false } = opts;
  if (compact && Math.abs(n) >= 10_000) {
    if (Math.abs(n) >= 1_000_000) return `\u00A3${(n / 1_000_000).toFixed(1)}M`;
    return `\u00A3${(n / 1_000).toFixed(1)}k`;
  }
  return `\u00A3${n.toLocaleString('en-GB', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })}`;
};

// ─── Status helpers (mirrored from CreditBlockList / FinancialDashboard) ────

const isCancelled = (j: DecoJob): boolean => {
  const status = (j.status || '').toLowerCase();
  return status === 'cancelled' || j.paymentStatus === '7';
};

const parseTermsDays = (terms: string | undefined | null, fallback = 30): number => {
  if (!terms) return fallback;
  const t = terms.toString().trim().toLowerCase();
  if (t === 'cod' || t.includes('receipt') || t.includes('pro forma') || t.includes('proforma')) return 0;
  const m = t.match(/(\d+)/);
  if (!m) return fallback;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

// ─── Sub-components ────────────────────────────────────────────────────

const StatTile: React.FC<{
  label: string;
  value: number | string;
  sub?: string;
  tone: 'red' | 'amber' | 'blue' | 'green' | 'purple' | 'slate';
  icon: React.ReactElement;
  onClick?: () => void;
}> = ({ label, value, sub, tone, icon, onClick }) => {
  const tones: Record<typeof tone, { bg: string; ring: string; text: string; iconBg: string }> = {
    red:    { bg: 'bg-red-50',     ring: 'border-red-200',     text: 'text-red-700',     iconBg: 'bg-red-500' },
    amber:  { bg: 'bg-amber-50',   ring: 'border-amber-200',   text: 'text-amber-700',   iconBg: 'bg-amber-500' },
    blue:   { bg: 'bg-blue-50',    ring: 'border-blue-200',    text: 'text-blue-700',    iconBg: 'bg-blue-500' },
    green:  { bg: 'bg-emerald-50', ring: 'border-emerald-200', text: 'text-emerald-700', iconBg: 'bg-emerald-500' },
    purple: { bg: 'bg-purple-50',  ring: 'border-purple-200',  text: 'text-purple-700',  iconBg: 'bg-purple-500' },
    slate:  { bg: 'bg-slate-50',   ring: 'border-slate-200',   text: 'text-slate-700',   iconBg: 'bg-slate-500' },
  } as any;
  const t = tones[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border ${t.ring} ${t.bg} p-4 transition-transform active:scale-[0.97] disabled:opacity-50`}
      disabled={!onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-black uppercase tracking-widest ${t.text}`}>{label}</p>
          <p className="text-3xl font-black text-gray-900 mt-1 leading-none">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {sub && <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-1.5">{sub}</p>}
        </div>
        <div className={`shrink-0 p-2 rounded-xl ${t.iconBg} bg-opacity-15`}>
          {React.cloneElement(icon as React.ReactElement<any>, { className: `w-4 h-4 ${t.iconBg.replace('bg-', 'text-')}` })}
        </div>
      </div>
    </button>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode; icon?: React.ReactElement }> = ({ children, icon }) => (
  <div className="flex items-center gap-2 mt-6 mb-2.5 px-1">
    {icon && React.cloneElement(icon as React.ReactElement<any>, { className: 'w-3.5 h-3.5 text-gray-400' })}
    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">{children}</h3>
    <div className="flex-1 h-px bg-gray-200" />
  </div>
);

/**
 * CollapsibleSection — accordion-style group.
 *
 * Expand state persisted in localStorage under `mobileSummary.expanded.<id>`
 * so the layout sticks across page loads. We expose `onFirstOpen` so heavy
 * sections (Finance, Credit Block) only kick off network calls when the
 * user actually unfolds them.
 */
const CollapsibleSection: React.FC<{
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactElement;
  iconTone: 'indigo' | 'rose' | 'emerald' | 'amber' | 'blue' | 'purple';
  defaultOpen?: boolean;
  badge?: string | number | null;
  onFirstOpen?: () => void;
  children: React.ReactNode;
}> = ({ id, title, subtitle, icon, iconTone, defaultOpen = false, badge, onFirstOpen, children }) => {
  const storageKey = `mobileSummary.expanded.${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen;
    const raw = window.localStorage.getItem(storageKey);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return defaultOpen;
  });
  const [hasOpened, setHasOpened] = useState<boolean>(open);

  useEffect(() => {
    if (open && !hasOpened) {
      setHasOpened(true);
      onFirstOpen?.();
    }
  }, [open, hasOpened, onFirstOpen]);

  const toggle = () => {
    setOpen(v => {
      const next = !v;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
      return next;
    });
  };

  const tones: Record<typeof iconTone, string> = {
    indigo:  'bg-indigo-100 text-indigo-700',
    rose:    'bg-rose-100 text-rose-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber:   'bg-amber-100 text-amber-700',
    blue:    'bg-blue-100 text-blue-700',
    purple:  'bg-purple-100 text-purple-700',
  };

  return (
    <section className="mt-3 rounded-2xl bg-white border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-3.5 py-3 active:bg-gray-50"
        aria-expanded={open}
      >
        <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${tones[iconTone]}`}>
          {React.cloneElement(icon as React.ReactElement<any>, { className: 'w-4 h-4' })}
        </span>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-black uppercase tracking-widest text-gray-900 truncate">{title}</p>
          {subtitle && <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {badge != null && badge !== '' && (
          <span className="shrink-0 px-2 py-1 rounded-lg bg-gray-100 text-gray-700 text-[10px] font-black uppercase tracking-wider">
            {badge}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3.5 pt-1 pb-4 border-t border-gray-100">
          {children}
        </div>
      )}
    </section>
  );
};

/** Two-column row used in the finance / sales sections. */
const KeyRow: React.FC<{
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'red' | 'amber' | 'green';
}> = ({ label, value, sub, tone = 'default' }) => {
  const valueClass = {
    default: 'text-gray-900',
    red:     'text-red-700',
    amber:   'text-amber-700',
    green:   'text-emerald-700',
  }[tone];
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{label}</p>
        {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
      <p className={`shrink-0 text-lg font-black ${valueClass}`}>{value}</p>
    </div>
  );
};

const ViewFullButton: React.FC<{ onClick: () => void; label?: string }> = ({ onClick, label = 'Open full view' }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-900 text-white text-[11px] font-black uppercase tracking-widest active:scale-[0.98] transition-transform"
  >
    {label}
    <ArrowRight className="w-3.5 h-3.5" />
  </button>
);

// ─── Main component ────────────────────────────────────────────────────

const MobileSummary: React.FC<Props> = ({
  stats, unifiedOrders, decoJobs, holidayRanges,
  lastSyncTime, syncStatusMsg, isSyncing,
  onRefresh, onJumpToOrder, onJumpToFilter, onJumpToTab,
}) => {
  const [search, setSearch] = useState('');
  const [_now, setNow] = useState(Date.now());

  // Tick the "last synced X min ago" label every 30s while the page is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const today = useMemo(() => new Date(), []);
  const target15 = useMemo(() => addWorkingDays(today, 15, holidayRanges), [today, holidayRanges]);
  const target20 = useMemo(() => addWorkingDays(today, 20, holidayRanges), [today, holidayRanges]);

  // ─── Search ───────────────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || q.length < 2) return [] as UnifiedOrder[];
    return unifiedOrders
      .filter(o => {
        if (o.shopify.fulfillmentStatus === 'fulfilled') {
          // Hide fulfilled unless the user explicitly searches the order #.
          if (!o.shopify.orderNumber.toLowerCase().includes(q)) return false;
        }
        return (
          o.shopify.orderNumber.toLowerCase().includes(q) ||
          o.shopify.customerName.toLowerCase().includes(q) ||
          (o.decoJobId ? o.decoJobId.toLowerCase().includes(q) : false)
        );
      })
      .sort((a, b) => {
        const af = a.shopify.fulfillmentStatus === 'fulfilled' ? 1 : 0;
        const bf = b.shopify.fulfillmentStatus === 'fulfilled' ? 1 : 0;
        if (af !== bf) return af - bf;
        return (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999);
      })
      .slice(0, 12);
  }, [search, unifiedOrders]);

  // ─── Priority Board summary ───────────────────────────────────────────
  // We don't run the full scoring engine here — for the mobile glance view
  // we just need counts per stage plus how many are visibly late. Tap any
  // row to drill into the full Priority Board.
  const priorityBoard = useMemo(() => {
    const jobs = decoJobs || [];
    const buckets = {
      po:         { count: 0, late: 0 },
      stock:      { count: 0, late: 0 },
      processing: { count: 0, late: 0 },
      shipping:   { count: 0, late: 0 },
    };
    const now = Date.now();
    for (const j of jobs) {
      if (isCancelled(j) || j.isQuote) continue;
      const status = j.status || '';
      // DecoJob exposes both productionDueDate (target on the floor) and
      // the optional account dateDue. Prefer productionDueDate which is
      // what the Priority Board scoring engine uses.
      const dueRaw = j.productionDueDate || j.dateDue;
      const dueMs = dueRaw ? new Date(dueRaw).getTime() : NaN;
      const isLate = Number.isFinite(dueMs) && dueMs < now;
      let bucket: keyof typeof buckets | null = null;
      if (status === 'Not Ordered') bucket = 'po';
      else if (status === 'Awaiting Stock') bucket = 'stock';
      else if (status === 'Awaiting Processing') bucket = 'processing';
      else if (status === 'Ready for Shipping' || status === 'Completed') bucket = 'shipping';
      if (bucket) {
        buckets[bucket].count += 1;
        if (isLate) buckets[bucket].late += 1;
      }
    }
    const total = buckets.po.count + buckets.stock.count + buckets.processing.count + buckets.shipping.count;
    const totalLate = buckets.po.late + buckets.stock.late + buckets.processing.late + buckets.shipping.late;
    return { ...buckets, total, totalLate };
  }, [decoJobs]);

  // ─── Sales / revenue summary (derived from unifiedOrders) ─────────────
  // We only count fulfilled orders here — that's the "revenue actually
  // shipped" definition CommandCenter uses.
  const sales = useMemo(() => {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const wkAgo = today0.getTime() - 6 * 86_400_000; // last 7 days incl. today
    const monAgo = today0.getTime() - 29 * 86_400_000; // last 30 days incl. today
    let todayRev = 0, weekRev = 0, monthRev = 0;
    let todayCt = 0, weekCt = 0, monthCt = 0;
    let pipelineRev = 0;
    for (const o of unifiedOrders) {
      const total = parseFloat(o.shopify.totalPrice) || 0;
      const isFul = o.shopify.fulfillmentStatus === 'fulfilled';
      if (!isFul) {
        pipelineRev += total;
        continue;
      }
      const ts = o.fulfillmentDate ? new Date(o.fulfillmentDate).getTime() : NaN;
      if (!Number.isFinite(ts)) continue;
      if (ts >= today0.getTime()) { todayRev += total; todayCt += 1; }
      if (ts >= wkAgo)            { weekRev  += total; weekCt  += 1; }
      if (ts >= monAgo)           { monthRev += total; monthCt += 1; }
    }
    return { todayRev, weekRev, monthRev, todayCt, weekCt, monthCt, pipelineRev };
  }, [unifiedOrders]);

  // Shopify unfulfilled value — the same number shown across the dashboard
  // header tile. We compute it locally so the finance section can show it
  // even when the finance cache hasn't loaded yet.
  const shopifyUnfulfilledValue = useMemo(() => {
    let total = 0;
    for (const o of unifiedOrders) {
      if (o.shopify.fulfillmentStatus === 'fulfilled') continue;
      total += parseFloat(o.shopify.totalPrice) || 0;
    }
    return total;
  }, [unifiedOrders]);

  // ─── Finance cache (lazy) ─────────────────────────────────────────────
  // Loaded when the Finance OR Credit Block section is first opened.
  // Both sections share the same cached data so we only fetch once.
  type FinanceJob = {
    customer?: string;
    isQuote?: boolean;
    status?: string;
    paymentStatus?: string;
    outstandingBalance?: number | string;
    dateInvoiced?: string;
    accountTerms?: string;
  };
  const [financeJobs, setFinanceJobs] = useState<FinanceJob[]>([]);
  const [financeLastSynced, setFinanceLastSynced] = useState<string | null>(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [financeLoaded, setFinanceLoaded] = useState(false);

  const loadFinance = useCallback(async () => {
    if (financeLoaded || financeLoading) return;
    if (!isSupabaseReady()) {
      setFinanceError('No finance cache configured');
      setFinanceLoaded(true);
      return;
    }
    setFinanceLoading(true);
    setFinanceError(null);
    try {
      const res = await supabaseFetch(
        'stash_finance_cache?id=eq.finance_jobs&select=data,last_synced',
        'GET'
      );
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && Array.isArray(rows[0].data)) {
        setFinanceJobs(rows[0].data);
        setFinanceLastSynced(rows[0].last_synced || null);
      } else {
        setFinanceError('Finance cache empty');
      }
    } catch (e: any) {
      setFinanceError(e?.message || 'Failed to load finance cache');
    } finally {
      setFinanceLoading(false);
      setFinanceLoaded(true);
    }
  }, [financeLoaded, financeLoading]);

  // Aggregate the finance cache into the five headline figures Brian wants
  // to see. Mirrors the maths used in FinancialDashboard so numbers match.
  const financeAgg = useMemo(() => {
    let totalOutstanding = 0;
    let invoicedOutstanding = 0;
    let workInProgress = 0;
    for (const j of financeJobs) {
      if (isCancelled(j as DecoJob) || j.isQuote) continue;
      const out = toNumber(j.outstandingBalance);
      if (out <= 0) continue;
      totalOutstanding += out;
      if (j.dateInvoiced) invoicedOutstanding += out;
      else workInProgress += out;
    }
    return { totalOutstanding, invoicedOutstanding, workInProgress };
  }, [financeJobs]);

  // ─── Credit block summary (top 5 overdue customers) ───────────────────
  const creditBlock = useMemo(() => {
    const byCustomer = new Map<string, { name: string; balance: number; oldestDays: number }>();
    const nowMs = Date.now();
    for (const j of financeJobs) {
      if (isCancelled(j as DecoJob) || j.isQuote) continue;
      const out = toNumber(j.outstandingBalance);
      if (out <= 0.009) continue;
      if (!j.dateInvoiced) continue;
      const termsDays = parseTermsDays(j.accountTerms);
      const dueMs = new Date(j.dateInvoiced).getTime() + termsDays * 86_400_000;
      if (!Number.isFinite(dueMs)) continue;
      const overdue = Math.floor((nowMs - dueMs) / 86_400_000);
      if (overdue <= 0) continue;
      const key = (j.customer || 'Unknown').trim() || 'Unknown';
      const prev = byCustomer.get(key);
      if (prev) {
        prev.balance += out;
        prev.oldestDays = Math.max(prev.oldestDays, overdue);
      } else {
        byCustomer.set(key, { name: key, balance: out, oldestDays: overdue });
      }
    }
    const all = Array.from(byCustomer.values()).sort((a, b) => b.balance - a.balance);
    const totalBalance = all.reduce((s, c) => s + c.balance, 0);
    return { all, top: all.slice(0, 5), totalBalance };
  }, [financeJobs]);

  // ─── A/P (QuickBooks bills) — lazy fetch on Finance expand ────────────
  const [apBillsTotal, setApBillsTotal] = useState<number | null>(null);
  const [apBillsCount, setApBillsCount] = useState<number>(0);
  const [apLoading, setApLoading] = useState(false);
  const [apError, setApError] = useState<string | null>(null);
  const [apLoaded, setApLoaded] = useState(false);

  // POST /api/quickbooks { action:'ap-aging' } — same shape FinancialDashboard
  // uses. The server falls back to env credentials when no body creds are
  // supplied, so mobile users never need QBO secrets in localStorage.
  const loadAp = useCallback(async () => {
    if (apLoaded || apLoading) return;
    setApLoading(true);
    setApError(null);
    try {
      const res = await fetch('/api/quickbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ap-aging' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.ok) {
        // QB not configured — treat as a soft "n/a" rather than an error.
        setApError(json?.error || 'A/P unavailable');
        setApBillsTotal(null);
        setApBillsCount(0);
      } else {
        const bills: Array<{ balance?: number }> = Array.isArray(json.bills) ? json.bills : [];
        setApBillsTotal(bills.reduce((s, b) => s + (Number(b.balance) || 0), 0));
        setApBillsCount(bills.length);
      }
    } catch (e: any) {
      setApError(e?.message || 'A/P fetch failed');
      setApBillsTotal(null);
    } finally {
      setApLoading(false);
      setApLoaded(true);
    }
  }, [apLoaded, apLoading]);

  return (
    <div className="max-w-xl mx-auto px-3 sm:px-4 pb-24">

      {/* ── Header ────────────────────────────────────────── */}
      <div className="pt-3 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-black uppercase tracking-widest text-gray-900">Stash Summary</h1>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-0.5 truncate">
              {isSyncing
                ? (syncStatusMsg || 'Syncing…')
                : <>Last sync <span className="text-gray-700">{fmtAge(lastSyncTime)}</span></>}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isSyncing}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest shadow-sm active:scale-95 transition-transform disabled:opacity-60"
          >
            {isSyncing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            Sync
          </button>
        </div>
      </div>

      {/* ── Date strip ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-gray-900 text-white p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Today</p>
          <p className="text-sm font-black mt-0.5">{fmtDate(today)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700">15 Working</p>
          <p className="text-sm font-black mt-0.5 text-emerald-900">{fmtDate(target15)}</p>
        </div>
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-rose-700">20 Working</p>
          <p className="text-sm font-black mt-0.5 text-rose-900">{fmtDate(target20)}</p>
        </div>
      </div>

      {/* ── Search ───────────────────────────────────────── */}
      <SectionLabel icon={<Search />}>Search Orders</SectionLabel>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Order #, customer, or Deco job…"
          className="w-full pl-10 pr-10 py-3 rounded-xl bg-white border border-gray-200 text-sm font-medium placeholder:text-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600"
          >Clear</button>
        )}
      </div>

      {search.trim().length >= 2 && (
        <div className="mt-2 rounded-xl bg-white border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {searchResults.length === 0 ? (
            <div className="p-4 text-center text-xs font-bold uppercase tracking-widest text-gray-400">
              No matches
            </div>
          ) : (
            searchResults.map(o => {
              const isFulfilled = o.shopify.fulfillmentStatus === 'fulfilled';
              const isPartial = o.shopify.fulfillmentStatus === 'partial';
              const overdue = (o.daysRemaining ?? 0) < 0 && !isFulfilled;
              return (
                <button
                  key={o.shopify.id}
                  type="button"
                  onClick={() => onJumpToOrder(o.shopify.orderNumber)}
                  className="w-full text-left p-3 hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-gray-900">#{o.shopify.orderNumber}</span>
                      {isFulfilled && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[9px] font-black uppercase tracking-wider">Shipped</span>}
                      {isPartial && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 text-[9px] font-black uppercase tracking-wider">Partial</span>}
                      {overdue && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-black uppercase tracking-wider">Late</span>}
                      {!o.decoJobId && !isFulfilled && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-wider">No Deco</span>}
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 truncate">{o.shopify.customerName}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 font-bold uppercase tracking-wider">
                      {o.decoJobId ? `Deco ${o.decoJobId}` : 'Unlinked'}
                      {!isFulfilled && (
                        <> · {o.daysRemaining >= 0 ? `${o.daysRemaining}d left` : `${Math.abs(o.daysRemaining)}d late`}</>
                      )}
                      {' · '}
                      {Math.round(o.completionPercentage)}%
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
                </button>
              );
            })
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────── */}
      {/*  ACCORDION SECTIONS                                  */}
      {/* ─────────────────────────────────────────────────── */}

      {/* ── Shopify (existing tiles, default open) ────────── */}
      <CollapsibleSection
        id="shopify"
        title="Shopify"
        subtitle="Orders by stage"
        icon={<ShoppingBag />}
        iconTone="indigo"
        defaultOpen={true}
        badge={`${stats.unfulfilled} active`}
      >
        <SectionLabel icon={<AlertTriangle />}>High Priority</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile
            label="Late"
            value={stats.late}
            sub="Past SLA"
            tone="red"
            icon={<Clock />}
            onClick={() => onJumpToFilter('late')}
          />
          <StatTile
            label="Not on Deco"
            value={stats.notOnDeco}
            sub={`${stats.notOnDeco5Plus} ≥ 5d · ${stats.notOnDeco10Plus} ≥ 10d`}
            tone="red"
            icon={<AlertTriangle />}
            onClick={() => onJumpToFilter('missing_po')}
          />
          <StatTile
            label="Mapping Gaps"
            value={stats.mappingGap}
            sub="Linked but unmapped"
            tone="amber"
            icon={<Link2 />}
            onClick={() => onJumpToFilter('mapping_gap')}
          />
          <StatTile
            label="Due Soon"
            value={stats.dueSoon}
            sub="Within 5 days"
            tone="amber"
            icon={<Calendar />}
          />
        </div>

        <SectionLabel icon={<Zap />}>Active</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile
            label="Unfulfilled"
            value={stats.unfulfilled}
            sub="In production"
            tone="blue"
            icon={<ShoppingBag />}
            onClick={() => onJumpToFilter('unfulfilled')}
          />
          <StatTile
            label="Ready to Ship"
            value={stats.readyForShipping}
            sub="100% complete"
            tone="green"
            icon={<Truck />}
            onClick={() => onJumpToFilter('ready')}
          />
          <StatTile
            label="Stock Ready"
            value={stats.stockReady}
            sub="Stock items dispatchable"
            tone="green"
            icon={<Boxes />}
            onClick={() => onJumpToFilter('stock_ready')}
          />
          <StatTile
            label="Partial (7D)"
            value={stats.partiallyFulfilled7d}
            sub="Half-shipped recently"
            tone="purple"
            icon={<Package />}
          />
        </div>

        <SectionLabel icon={<CheckCircle2 />}>Done (7 Days)</SectionLabel>
        <div className="grid grid-cols-1">
          <StatTile
            label="Fulfilled"
            value={stats.fulfilled7d}
            sub="Orders shipped in the last 7 days"
            tone="green"
            icon={<CheckCircle2 />}
            onClick={() => onJumpToFilter('fulfilled7d')}
          />
        </div>
      </CollapsibleSection>

      {/* ── Priority Board ────────────────────────────────── */}
      <CollapsibleSection
        id="priority"
        title="Priority Board"
        subtitle={priorityBoard.totalLate > 0
          ? `${priorityBoard.total} jobs · ${priorityBoard.totalLate} late`
          : `${priorityBoard.total} jobs in flight`}
        icon={<ListChecks />}
        iconTone="rose"
        badge={priorityBoard.totalLate > 0 ? `${priorityBoard.totalLate} late` : null}
      >
        {!decoJobs || decoJobs.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No Deco jobs loaded yet — pull to sync.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 mt-1">
              <StatTile
                label="Awaiting PO"
                value={priorityBoard.po.count}
                sub={priorityBoard.po.late > 0 ? `${priorityBoard.po.late} past due` : 'POs to raise'}
                tone={priorityBoard.po.late > 0 ? 'red' : 'amber'}
                icon={<AlertTriangle />}
                onClick={() => onJumpToTab('priority')}
              />
              <StatTile
                label="Awaiting Stock"
                value={priorityBoard.stock.count}
                sub={priorityBoard.stock.late > 0 ? `${priorityBoard.stock.late} past due` : 'Materials inbound'}
                tone={priorityBoard.stock.late > 0 ? 'red' : 'amber'}
                icon={<Package />}
                onClick={() => onJumpToTab('priority')}
              />
              <StatTile
                label="Awaiting Processing"
                value={priorityBoard.processing.count}
                sub={priorityBoard.processing.late > 0 ? `${priorityBoard.processing.late} past due` : 'Ready for production'}
                tone={priorityBoard.processing.late > 0 ? 'red' : 'blue'}
                icon={<Zap />}
                onClick={() => onJumpToTab('priority')}
              />
              <StatTile
                label="Awaiting Shipping"
                value={priorityBoard.shipping.count}
                sub={priorityBoard.shipping.late > 0 ? `${priorityBoard.shipping.late} past due` : 'Ready to dispatch'}
                tone={priorityBoard.shipping.late > 0 ? 'red' : 'green'}
                icon={<Truck />}
                onClick={() => onJumpToTab('priority')}
              />
            </div>
            <ViewFullButton onClick={() => onJumpToTab('priority')} label="Open priority board" />
          </>
        )}
      </CollapsibleSection>

      {/* ── Sales Analytics ───────────────────────────────── */}
      <CollapsibleSection
        id="sales"
        title="Sales"
        subtitle={`${fmtMoney(sales.todayRev, { compact: true })} today · ${fmtMoney(sales.weekRev, { compact: true })} this week`}
        icon={<BarChart3 />}
        iconTone="emerald"
        badge={`${sales.weekCt} / 7d`}
      >
        <div className="rounded-xl bg-gray-50 px-3 py-1">
          <KeyRow
            label="Today (Shipped)"
            value={fmtMoney(sales.todayRev)}
            sub={`${sales.todayCt} order${sales.todayCt === 1 ? '' : 's'}`}
            tone="green"
          />
          <KeyRow
            label="Last 7 Days"
            value={fmtMoney(sales.weekRev)}
            sub={`${sales.weekCt} order${sales.weekCt === 1 ? '' : 's'}`}
          />
          <KeyRow
            label="Last 30 Days"
            value={fmtMoney(sales.monthRev)}
            sub={`${sales.monthCt} order${sales.monthCt === 1 ? '' : 's'}`}
          />
          <KeyRow
            label="Pipeline (Unfulfilled)"
            value={fmtMoney(sales.pipelineRev)}
            sub={`${stats.unfulfilled} order${stats.unfulfilled === 1 ? '' : 's'} in flight`}
            tone="amber"
          />
        </div>
        <ViewFullButton onClick={() => onJumpToTab('sales')} label="Open sales analytics" />
      </CollapsibleSection>

      {/* ── Finance ───────────────────────────────────────── */}
      <CollapsibleSection
        id="finance"
        title="Finance"
        subtitle="Outstanding · WIP · A/P · Shopify pipeline"
        icon={<Wallet />}
        iconTone="amber"
        onFirstOpen={() => { loadFinance(); loadAp(); }}
      >
        {/* Inline status when the cache hasn't loaded yet */}
        {financeLoading && (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading finance cache…
          </div>
        )}
        {financeError && !financeLoading && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {financeError}
          </p>
        )}

        <div className="rounded-xl bg-gray-50 px-3 py-1">
          <KeyRow
            label="Invoiced Outstanding"
            value={financeLoaded ? fmtMoney(financeAgg.invoicedOutstanding) : '—'}
            sub="Invoices not yet paid"
            tone={financeAgg.invoicedOutstanding > 0 ? 'amber' : 'default'}
          />
          <KeyRow
            label="Work In Progress"
            value={financeLoaded ? fmtMoney(financeAgg.workInProgress) : '—'}
            sub="Jobs not yet invoiced"
          />
          <KeyRow
            label="Total Outstanding"
            value={financeLoaded ? fmtMoney(financeAgg.totalOutstanding) : '—'}
            sub="Invoiced + WIP combined"
            tone={financeAgg.totalOutstanding > 0 ? 'red' : 'default'}
          />
          <KeyRow
            label="A/P Total Owed"
            value={
              apLoading ? '…'
              : apBillsTotal != null ? fmtMoney(apBillsTotal)
              : '—'
            }
            sub={
              apLoading ? 'QuickBooks syncing…'
              : apError ? apError
              : apBillsCount > 0 ? `${apBillsCount} open supplier bill${apBillsCount === 1 ? '' : 's'}`
              : 'QuickBooks A/P'
            }
            tone={apBillsTotal != null && apBillsTotal > 0 ? 'red' : 'default'}
          />
          <KeyRow
            label="Shopify Unfulfilled"
            value={fmtMoney(shopifyUnfulfilledValue)}
            sub={`${stats.unfulfilled} order${stats.unfulfilled === 1 ? '' : 's'} owed to customers`}
            tone="amber"
          />
        </div>

        {financeLastSynced && (
          <p className="text-[10px] text-gray-400 mt-2 px-1">
            Finance cache: {fmtAge(new Date(financeLastSynced).getTime())}
          </p>
        )}

        <ViewFullButton onClick={() => onJumpToTab('finance')} label="Open finance dashboard" />
      </CollapsibleSection>

      {/* ── Credit Block List ─────────────────────────────── */}
      <CollapsibleSection
        id="credit"
        title="Credit Block"
        subtitle={creditBlock.all.length > 0
          ? `${creditBlock.all.length} customer${creditBlock.all.length === 1 ? '' : 's'} overdue · ${fmtMoney(creditBlock.totalBalance, { compact: true })}`
          : 'Outstanding invoices past terms'}
        icon={<ShieldAlert />}
        iconTone="rose"
        badge={creditBlock.all.length > 0 ? creditBlock.all.length : null}
        onFirstOpen={() => { loadFinance(); }}
      >
        {financeLoading && (
          <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading finance cache…
          </div>
        )}
        {!financeLoading && financeLoaded && creditBlock.all.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5" /> No customers past credit terms.
          </div>
        )}
        {creditBlock.top.length > 0 && (
          <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
            {creditBlock.top.map(c => (
              <div key={c.name} className="flex items-center gap-3 p-3">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-gray-900 truncate">{c.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-0.5">
                    {c.oldestDays}d overdue
                  </p>
                </div>
                <p className="shrink-0 text-base font-black text-rose-700">{fmtMoney(c.balance)}</p>
              </div>
            ))}
          </div>
        )}
        {creditBlock.all.length > creditBlock.top.length && (
          <p className="text-[10px] text-gray-400 mt-2 px-1">
            +{creditBlock.all.length - creditBlock.top.length} more customers — open the full list to see them all.
          </p>
        )}
        <ViewFullButton onClick={() => onJumpToTab('credit')} label="Open credit block list" />
      </CollapsibleSection>

      {/* Footer breathing room for thumb-reach on iOS */}
      <div className="h-6" />
    </div>
  );
};

export default MobileSummary;
