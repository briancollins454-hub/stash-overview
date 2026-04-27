/**
 * Mobile Summary
 * --------------
 * Single-column, phone-first overview of the metrics that matter when
 * you're on the move. Designed to be opened on a phone and scanned in
 * five seconds without zooming or scrolling sideways.
 *
 * Contents
 *   • Today + 15-day / 20-day SLA target dates
 *   • Last sync timestamp + one-tap Refresh
 *   • Order search (Shopify number, customer, Deco job)
 *   • Tappable summary cards grouped by what you actually act on:
 *       HIGH PRIORITY (Late · Not on Deco · Mapping Gaps)
 *       ACTIVE        (Unfulfilled · Ready to Ship · Stock Ready)
 *       DONE          (Fulfilled 7D · Partially Fulfilled 7D)
 *
 * Each card jumps you straight to the matching filter on the
 * full Dashboard so you can drill in if the number looks wrong.
 */

import React, { useMemo, useState } from 'react';
import {
  RefreshCw, Search, AlertTriangle, ShoppingBag, Package, Truck,
  CheckCircle2, Boxes, Link2, Calendar, Loader2, ArrowRight, Clock, Zap,
} from 'lucide-react';
import { UnifiedOrder } from '../types';
import { addWorkingDays } from '../utils/workingDays';
import type { HolidayRange } from './SettingsModal';

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

interface Props {
  stats: SummaryStats;
  unifiedOrders: UnifiedOrder[];
  holidayRanges?: HolidayRange[];
  lastSyncTime?: number | null;
  syncStatusMsg?: string;
  isSyncing?: boolean;
  onRefresh: () => void;
  onJumpToOrder: (orderNumber: string) => void;
  onJumpToFilter: (filter: MobileFilterId) => void;
}

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

// ─── Sub-components ────────────────────────────────────────────────────

const StatTile: React.FC<{
  label: string;
  value: number;
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
          <p className="text-3xl font-black text-gray-900 mt-1 leading-none">{value.toLocaleString()}</p>
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

// ─── Main component ────────────────────────────────────────────────────

const MobileSummary: React.FC<Props> = ({
  stats, unifiedOrders, holidayRanges,
  lastSyncTime, syncStatusMsg, isSyncing,
  onRefresh, onJumpToOrder, onJumpToFilter,
}) => {
  const [search, setSearch] = useState('');
  const [_now, setNow] = useState(Date.now());

  // Tick the "last synced X min ago" label every 30s while the page is open.
  React.useEffect(() => {
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
        // Active orders first, then by daysRemaining (most urgent first).
        const af = a.shopify.fulfillmentStatus === 'fulfilled' ? 1 : 0;
        const bf = b.shopify.fulfillmentStatus === 'fulfilled' ? 1 : 0;
        if (af !== bf) return af - bf;
        return (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999);
      })
      .slice(0, 12);
  }, [search, unifiedOrders]);

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

      {/* ── HIGH PRIORITY ────────────────────────────────── */}
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

      {/* ── ACTIVE ───────────────────────────────────────── */}
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

      {/* ── DONE ──────────────────────────────────────────── */}
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

      {/* Footer breathing room for thumb-reach on iOS */}
      <div className="h-6" />
    </div>
  );
};

export default MobileSummary;
