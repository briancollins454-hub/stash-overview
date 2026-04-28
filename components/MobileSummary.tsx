/**
 * Mobile Summary
 * --------------
 * Phone-first overview that's designed to look genuinely premium —
 * glassmorphism cards on a layered gradient backdrop, big tabular
 * numbers, restrained colour, and a sticky header with backdrop blur.
 *
 * Sections (all collapsible, expand-state persisted in localStorage):
 *   • Header        — sticky with sync status + live pulse + date strip
 *   • Search        — order #, customer, Deco job (always visible)
 *   • Shopify       — high-priority / active / done counts (open by default)
 *   • Priority Board — counts by stage with late-job warnings
 *   • Sales         — today / 7d / 30d revenue + pipeline value
 *   • Finance       — invoiced outstanding, WIP, total outstanding,
 *                     A/P total owed, Shopify unfulfilled value
 *   • Credit Block  — top overdue customers with avatar circles
 *
 * Heavy data (finance cache, QuickBooks A/P) lazy-loads on first
 * expand to keep the page snappy on a phone with poor signal.
 *
 * Visual language matches the dark-mode dashboard (slate-950 base,
 * indigo accent) but degrades gracefully to a clean light theme so
 * the page looks right whichever theme the user has set.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Search, AlertTriangle, ShoppingBag, Package, Truck,
  CheckCircle2, Boxes, Link2, Calendar, Loader2, ArrowRight, Clock, Zap,
  ChevronDown, ListChecks, BarChart3, Wallet, ShieldAlert, TrendingUp,
  TrendingDown, Activity,
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

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Deterministic gradient hue picker so the same customer always gets the
// same avatar colour across sessions. Uses a tiny djb2 hash so we don't
// drag in a crypto dependency for something purely cosmetic.
const hashHue = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return Math.abs(h) % 360;
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

type Tone = 'red' | 'amber' | 'blue' | 'green' | 'purple' | 'slate' | 'indigo';

/**
 * Tone palette — every accent colour on the page funnels through this
 * map so the gradient cards, rings, glows and icon chips stay in lockstep.
 * Numbers are always rendered against the tile gradient using the
 * provided text-tone class, so contrast is consistent in both themes.
 */
const TONES: Record<Tone, {
  /** Tile gradient (light + dark variants share one string) */
  bg: string;
  /** Outer ring/border */
  ring: string;
  /** Heading + small-cap label colour */
  label: string;
  /** Big number colour */
  value: string;
  /** Icon chip background gradient */
  iconBg: string;
  /** Icon foreground colour */
  iconFg: string;
  /** Soft glow placed behind the icon chip */
  glow: string;
}> = {
  red: {
    bg:     'bg-gradient-to-br from-red-50 to-rose-50/60 dark:from-red-500/15 dark:to-rose-500/5',
    ring:   'ring-1 ring-red-200/70 dark:ring-red-500/20',
    label:  'text-red-700 dark:text-red-300',
    value:  'text-red-900 dark:text-red-50',
    iconBg: 'bg-gradient-to-br from-red-500 to-rose-600',
    iconFg: 'text-white',
    glow:   'bg-red-500/30 dark:bg-red-500/20',
  },
  amber: {
    bg:     'bg-gradient-to-br from-amber-50 to-orange-50/60 dark:from-amber-500/15 dark:to-orange-500/5',
    ring:   'ring-1 ring-amber-200/70 dark:ring-amber-500/20',
    label:  'text-amber-700 dark:text-amber-300',
    value:  'text-amber-900 dark:text-amber-50',
    iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
    iconFg: 'text-white',
    glow:   'bg-amber-500/30 dark:bg-amber-500/20',
  },
  blue: {
    bg:     'bg-gradient-to-br from-blue-50 to-sky-50/60 dark:from-blue-500/15 dark:to-sky-500/5',
    ring:   'ring-1 ring-blue-200/70 dark:ring-blue-500/20',
    label:  'text-blue-700 dark:text-blue-300',
    value:  'text-blue-900 dark:text-blue-50',
    iconBg: 'bg-gradient-to-br from-blue-500 to-sky-600',
    iconFg: 'text-white',
    glow:   'bg-blue-500/30 dark:bg-blue-500/20',
  },
  green: {
    bg:     'bg-gradient-to-br from-emerald-50 to-teal-50/60 dark:from-emerald-500/15 dark:to-teal-500/5',
    ring:   'ring-1 ring-emerald-200/70 dark:ring-emerald-500/20',
    label:  'text-emerald-700 dark:text-emerald-300',
    value:  'text-emerald-900 dark:text-emerald-50',
    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    iconFg: 'text-white',
    glow:   'bg-emerald-500/30 dark:bg-emerald-500/20',
  },
  purple: {
    bg:     'bg-gradient-to-br from-purple-50 to-fuchsia-50/60 dark:from-purple-500/15 dark:to-fuchsia-500/5',
    ring:   'ring-1 ring-purple-200/70 dark:ring-purple-500/20',
    label:  'text-purple-700 dark:text-purple-300',
    value:  'text-purple-900 dark:text-purple-50',
    iconBg: 'bg-gradient-to-br from-purple-500 to-fuchsia-600',
    iconFg: 'text-white',
    glow:   'bg-purple-500/30 dark:bg-purple-500/20',
  },
  slate: {
    bg:     'bg-gradient-to-br from-slate-50 to-slate-100/60 dark:from-slate-500/15 dark:to-slate-600/5',
    ring:   'ring-1 ring-slate-200/70 dark:ring-slate-500/20',
    label:  'text-slate-700 dark:text-slate-300',
    value:  'text-slate-900 dark:text-slate-50',
    iconBg: 'bg-gradient-to-br from-slate-500 to-slate-700',
    iconFg: 'text-white',
    glow:   'bg-slate-500/30 dark:bg-slate-500/20',
  },
  indigo: {
    bg:     'bg-gradient-to-br from-indigo-50 to-violet-50/60 dark:from-indigo-500/15 dark:to-violet-500/5',
    ring:   'ring-1 ring-indigo-200/70 dark:ring-indigo-500/20',
    label:  'text-indigo-700 dark:text-indigo-300',
    value:  'text-indigo-900 dark:text-indigo-50',
    iconBg: 'bg-gradient-to-br from-indigo-500 to-violet-600',
    iconFg: 'text-white',
    glow:   'bg-indigo-500/30 dark:bg-indigo-500/20',
  },
};

/**
 * StatTile — the dense, tappable card used everywhere we want a single
 * primary number on screen. The tile renders in three layers:
 *   1. Tone gradient + ring (the card itself)
 *   2. A soft radial glow blob behind the icon chip
 *   3. The icon chip and content sitting above the glow
 *
 * `pulse` adds a subtle red glow ring used for "things you should be
 * worried about" — late jobs, overdue customers — so the eye is drawn
 * to them when the page is scanned in five seconds.
 */
const StatTile: React.FC<{
  label: string;
  value: number | string;
  sub?: string;
  tone: Tone;
  icon: React.ReactElement;
  onClick?: () => void;
  pulse?: boolean;
}> = ({ label, value, sub, tone, icon, onClick, pulse }) => {
  const t = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`
        relative w-full text-left rounded-2xl overflow-hidden p-4
        ${t.bg} ${t.ring}
        transition-all duration-200
        active:scale-[0.97] active:shadow-inner
        disabled:opacity-60 disabled:active:scale-100
        ${onClick ? 'hover:shadow-lg hover:-translate-y-0.5' : ''}
        ${pulse ? 'animate-[pulse_3s_ease-in-out_infinite]' : ''}
      `}
    >
      {/* radial glow blob behind the icon */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl ${t.glow}`}
      />

      <div className="relative flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${t.label}`}>
            {label}
          </p>
          <p className={`text-[2rem] leading-none font-black mt-1.5 tabular-nums ${t.value}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {sub && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mt-2">
              {sub}
            </p>
          )}
        </div>
        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center shadow-lg ${t.iconBg}`}>
          {React.cloneElement(icon as React.ReactElement<any>, { className: `w-4 h-4 ${t.iconFg}` })}
        </div>
      </div>
    </button>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode; icon?: React.ReactElement }> = ({ children, icon }) => (
  <div className="flex items-center gap-2 mt-5 mb-2.5 px-0.5">
    {icon && React.cloneElement(icon as React.ReactElement<any>, {
      className: 'w-3 h-3 text-gray-400 dark:text-slate-500',
    })}
    <h3 className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-500 dark:text-slate-400">
      {children}
    </h3>
    <div className="flex-1 h-px bg-gradient-to-r from-gray-200 to-transparent dark:from-slate-700/60" />
  </div>
);

/**
 * CollapsibleSection — accordion-style group with a glass card surface.
 *
 * Expand state persisted in localStorage under `mobileSummary.expanded.<id>`
 * so the layout sticks across page loads. We expose `onFirstOpen` so heavy
 * sections (Finance, Credit Block) only kick off network calls when the
 * user actually unfolds them.
 *
 * The collapsed body uses a plain conditional render — animating
 * height with CSS transitions on dynamic content is fragile and the
 * tap-feedback alone is enough on a phone.
 */
const CollapsibleSection: React.FC<{
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactElement;
  iconTone: Tone;
  defaultOpen?: boolean;
  badge?: string | number | null;
  badgeTone?: 'default' | 'red' | 'amber' | 'green';
  onFirstOpen?: () => void;
  children: React.ReactNode;
}> = ({ id, title, subtitle, icon, iconTone, defaultOpen = false, badge, badgeTone = 'default', onFirstOpen, children }) => {
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

  const t = TONES[iconTone];
  const badgeClasses = {
    default: 'bg-gray-100 text-gray-700 dark:bg-slate-700/60 dark:text-slate-200',
    red:     'bg-red-500/15 text-red-700 dark:text-red-300 ring-1 ring-red-500/30',
    amber:   'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30',
    green:   'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30',
  }[badgeTone];

  return (
    <section
      className={`
        mt-3 rounded-2xl overflow-hidden
        bg-white/80 dark:bg-slate-900/40
        backdrop-blur-xl
        ring-1 ring-gray-200 dark:ring-white/10
        shadow-lg shadow-slate-900/5 dark:shadow-black/40
      `}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`
          relative w-full flex items-center gap-3 px-4 py-3.5
          text-left transition-colors
          active:bg-gray-50 dark:active:bg-white/5
        `}
      >
        {/* small accent stripe on the left edge */}
        <span aria-hidden className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${t.iconBg}`} />

        <span className={`shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center shadow-md ${t.iconBg}`}>
          {React.cloneElement(icon as React.ReactElement<any>, { className: `w-4 h-4 ${t.iconFg}` })}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-black uppercase tracking-[0.16em] text-gray-900 dark:text-white truncate">
            {title}
          </p>
          {subtitle && (
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
        {badge != null && badge !== '' && (
          <span className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${badgeClasses}`}>
            {badge}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 dark:text-slate-500 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          className="px-4 pt-2 pb-4 border-t border-gray-100 dark:border-white/5
                     animate-in fade-in slide-in-from-top-1 duration-300"
        >
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
  trend?: 'up' | 'down' | null;
}> = ({ label, value, sub, tone = 'default', trend = null }) => {
  const valueClass = {
    default: 'text-gray-900 dark:text-white',
    red:     'text-red-700 dark:text-red-300',
    amber:   'text-amber-700 dark:text-amber-300',
    green:   'text-emerald-700 dark:text-emerald-300',
  }[tone];
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100 dark:border-white/5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">
          {label}
        </p>
        {sub && <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 truncate">{sub}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {trend === 'up' && <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
        {trend === 'down' && <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
        <p className={`text-xl font-black tabular-nums tracking-tight ${valueClass}`}>{value}</p>
      </div>
    </div>
  );
};

const ViewFullButton: React.FC<{ onClick: () => void; label?: string }> = ({ onClick, label = 'Open full view' }) => (
  <button
    type="button"
    onClick={onClick}
    className="
      relative mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl overflow-hidden
      bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600
      text-white text-[11px] font-black uppercase tracking-[0.2em]
      shadow-lg shadow-indigo-500/30
      active:scale-[0.98] transition-transform
    "
  >
    {/* subtle highlight shine */}
    <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/30" />
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

  // Data is "fresh" if synced in the last 5 minutes — drives the live
  // dot in the header so the user can see at a glance if they're
  // looking at stale numbers.
  const isFresh = !!lastSyncTime && (Date.now() - lastSyncTime) < 5 * 60_000;

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
      // Prefer productionDueDate (the production-floor target) over
      // dateDue (account-side); matches PriorityBoard scoring.
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
  const sales = useMemo(() => {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const wkAgo = today0.getTime() - 6 * 86_400_000;
    const monAgo = today0.getTime() - 29 * 86_400_000;
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

  // Shopify unfulfilled value — same number shown on the dashboard
  // header tile. Computed locally so the finance section can show it
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

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div
      className="
        relative min-h-screen
        bg-gradient-to-b from-slate-50 via-white to-slate-100
        dark:from-slate-950 dark:via-slate-900 dark:to-slate-950
        -mx-3 sm:-mx-4 -mt-2 px-3 sm:px-4
      "
    >
      {/* Decorative gradient orbs — pure eye-candy, sit behind everything */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-indigo-500/10 dark:bg-indigo-500/15 blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-72 h-72 rounded-full bg-violet-500/10 dark:bg-violet-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-72 h-72 rounded-full bg-emerald-500/5 dark:bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="relative max-w-xl mx-auto pb-24">

        {/* ── Sticky header ─────────────────────────────────── */}
        <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 px-3 sm:px-4 pt-3 pb-4
                        bg-gradient-to-b from-slate-50 via-slate-50/95 to-transparent
                        dark:from-slate-950 dark:via-slate-950/95 dark:to-transparent
                        backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight bg-gradient-to-br from-gray-900 to-gray-700
                                dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                  Stash Summary
                </h1>
                {/* Live pulse — green when sync is recent, amber when stale */}
                <span className="relative inline-flex w-2 h-2" aria-label={isFresh ? 'Live' : 'Stale'}>
                  <span className={`absolute inset-0 rounded-full ${isFresh ? 'bg-emerald-400' : 'bg-amber-400'} opacity-70 animate-ping`} />
                  <span className={`relative rounded-full w-2 h-2 ${isFresh ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                </span>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 dark:text-slate-400 mt-1 truncate">
                {isSyncing
                  ? (syncStatusMsg || 'Syncing live data…')
                  : <>Last sync · <span className="text-gray-700 dark:text-slate-200">{fmtAge(lastSyncTime)}</span></>}
              </p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isSyncing}
              className="
                relative shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl overflow-hidden
                bg-gradient-to-br from-indigo-500 to-violet-600
                text-white text-[11px] font-black uppercase tracking-[0.18em]
                shadow-lg shadow-indigo-500/40
                active:scale-95 transition-transform disabled:opacity-60
              "
            >
              <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/30" />
              {isSyncing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              Sync
            </button>
          </div>
        </div>

        {/* ── Date strip ───────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2 mt-1">
          <div className="
            relative rounded-2xl p-3 overflow-hidden
            bg-gradient-to-br from-gray-900 to-slate-800
            dark:from-white dark:to-slate-200
            shadow-lg shadow-black/10 dark:shadow-white/5
          ">
            <span aria-hidden className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-indigo-500/30 blur-2xl" />
            <p className="relative text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-slate-600">Today</p>
            <p className="relative text-sm font-black mt-1 text-white dark:text-slate-900">{fmtDate(today)}</p>
          </div>
          <div className="
            relative rounded-2xl p-3 overflow-hidden
            bg-gradient-to-br from-emerald-50 to-teal-50/60
            dark:from-emerald-500/15 dark:to-teal-500/5
            ring-1 ring-emerald-200/70 dark:ring-emerald-500/20
          ">
            <span aria-hidden className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-emerald-500/20 dark:bg-emerald-500/30 blur-2xl" />
            <p className="relative text-[9px] font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">15 Working</p>
            <p className="relative text-sm font-black mt-1 text-emerald-900 dark:text-emerald-50">{fmtDate(target15)}</p>
          </div>
          <div className="
            relative rounded-2xl p-3 overflow-hidden
            bg-gradient-to-br from-rose-50 to-red-50/60
            dark:from-rose-500/15 dark:to-red-500/5
            ring-1 ring-rose-200/70 dark:ring-rose-500/20
          ">
            <span aria-hidden className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-rose-500/20 dark:bg-rose-500/30 blur-2xl" />
            <p className="relative text-[9px] font-black uppercase tracking-[0.2em] text-rose-700 dark:text-rose-300">20 Working</p>
            <p className="relative text-sm font-black mt-1 text-rose-900 dark:text-rose-50">{fmtDate(target20)}</p>
          </div>
        </div>

        {/* ── Search ───────────────────────────────────────── */}
        <SectionLabel icon={<Search />}>Search Orders</SectionLabel>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Order #, customer, or Deco job…"
            className="
              w-full pl-11 pr-12 py-3.5 rounded-2xl
              bg-white/80 dark:bg-slate-900/40 backdrop-blur-xl
              ring-1 ring-gray-200 dark:ring-white/10
              text-sm font-medium text-gray-900 dark:text-white
              placeholder:text-gray-400 dark:placeholder:text-slate-500
              focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-indigo-500
              transition-all
            "
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-700 dark:hover:text-slate-200"
            >Clear</button>
          )}
        </div>

        {search.trim().length >= 2 && (
          <div className="
            mt-2 rounded-2xl overflow-hidden
            bg-white/80 dark:bg-slate-900/40 backdrop-blur-xl
            ring-1 ring-gray-200 dark:ring-white/10
            divide-y divide-gray-100 dark:divide-white/5
            animate-in fade-in slide-in-from-top-1 duration-200
          ">
            {searchResults.length === 0 ? (
              <div className="p-4 text-center text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
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
                    className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-white/5 active:bg-gray-100 dark:active:bg-white/10 transition-colors flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-black text-gray-900 dark:text-white">#{o.shopify.orderNumber}</span>
                        {isFulfilled && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30 text-[9px] font-black uppercase tracking-wider">Shipped</span>}
                        {isPartial && <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/30 text-[9px] font-black uppercase tracking-wider">Partial</span>}
                        {overdue && <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-700 dark:text-red-300 ring-1 ring-red-500/30 text-[9px] font-black uppercase tracking-wider">Late</span>}
                        {!o.decoJobId && !isFulfilled && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30 text-[9px] font-black uppercase tracking-wider">No Deco</span>}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-slate-300 mt-0.5 truncate">{o.shopify.customerName}</p>
                      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 font-bold uppercase tracking-wider">
                        {o.decoJobId ? `Deco ${o.decoJobId}` : 'Unlinked'}
                        {!isFulfilled && (
                          <> · {o.daysRemaining >= 0 ? `${o.daysRemaining}d left` : `${Math.abs(o.daysRemaining)}d late`}</>
                        )}
                        {' · '}
                        {Math.round(o.completionPercentage)}%
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 dark:text-slate-600 shrink-0" />
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
              pulse={stats.late > 0}
            />
            <StatTile
              label="Not on Deco"
              value={stats.notOnDeco}
              sub={`${stats.notOnDeco5Plus} \u2265 5d \u00B7 ${stats.notOnDeco10Plus} \u2265 10d`}
              tone="red"
              icon={<AlertTriangle />}
              onClick={() => onJumpToFilter('missing_po')}
              pulse={stats.notOnDeco10Plus > 0}
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
            ? `${priorityBoard.total} jobs \u00B7 ${priorityBoard.totalLate} late`
            : `${priorityBoard.total} jobs in flight`}
          icon={<ListChecks />}
          iconTone="red"
          badge={priorityBoard.totalLate > 0 ? `${priorityBoard.totalLate} late` : null}
          badgeTone={priorityBoard.totalLate > 0 ? 'red' : 'default'}
        >
          {!decoJobs || decoJobs.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-slate-500 py-2">
              No Deco jobs loaded yet — pull to sync.
            </p>
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
                  pulse={priorityBoard.po.late > 0}
                />
                <StatTile
                  label="Awaiting Stock"
                  value={priorityBoard.stock.count}
                  sub={priorityBoard.stock.late > 0 ? `${priorityBoard.stock.late} past due` : 'Materials inbound'}
                  tone={priorityBoard.stock.late > 0 ? 'red' : 'amber'}
                  icon={<Package />}
                  onClick={() => onJumpToTab('priority')}
                  pulse={priorityBoard.stock.late > 0}
                />
                <StatTile
                  label="Awaiting Processing"
                  value={priorityBoard.processing.count}
                  sub={priorityBoard.processing.late > 0 ? `${priorityBoard.processing.late} past due` : 'Ready for production'}
                  tone={priorityBoard.processing.late > 0 ? 'red' : 'blue'}
                  icon={<Zap />}
                  onClick={() => onJumpToTab('priority')}
                  pulse={priorityBoard.processing.late > 0}
                />
                <StatTile
                  label="Awaiting Shipping"
                  value={priorityBoard.shipping.count}
                  sub={priorityBoard.shipping.late > 0 ? `${priorityBoard.shipping.late} past due` : 'Ready to dispatch'}
                  tone={priorityBoard.shipping.late > 0 ? 'red' : 'green'}
                  icon={<Truck />}
                  onClick={() => onJumpToTab('priority')}
                  pulse={priorityBoard.shipping.late > 0}
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
          subtitle={`${fmtMoney(sales.todayRev, { compact: true })} today \u00B7 ${fmtMoney(sales.weekRev, { compact: true })} this week`}
          icon={<BarChart3 />}
          iconTone="green"
          badge={`${sales.weekCt} / 7d`}
          badgeTone="green"
        >
          {/* Hero today's revenue tile */}
          <div className="
            relative rounded-2xl p-4 overflow-hidden
            bg-gradient-to-br from-emerald-500 to-teal-600
            shadow-lg shadow-emerald-500/30
            mt-1
          ">
            <span aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <span aria-hidden className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-white/5 blur-3xl" />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-50/80">Today (Shipped)</p>
                <p className="text-3xl font-black tracking-tight text-white tabular-nums mt-1">
                  {fmtMoney(sales.todayRev)}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-50/70 mt-1.5">
                  {sales.todayCt} order{sales.todayCt === 1 ? '' : 's'} fulfilled
                </p>
              </div>
              <div className="shrink-0 w-10 h-10 rounded-2xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                <Activity className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-gray-50/80 dark:bg-white/5 ring-1 ring-gray-200/60 dark:ring-white/5 px-4 py-1 mt-2.5">
            <KeyRow
              label="Last 7 Days"
              value={fmtMoney(sales.weekRev)}
              sub={`${sales.weekCt} order${sales.weekCt === 1 ? '' : 's'}`}
              trend={sales.weekRev > 0 ? 'up' : null}
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
          {/* Hero total-outstanding tile */}
          <div className="
            relative rounded-2xl p-4 overflow-hidden
            bg-gradient-to-br from-amber-500 to-orange-600
            shadow-lg shadow-amber-500/30
            mt-1
          ">
            <span aria-hidden className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-50/80">Total Outstanding</p>
                <p className="text-3xl font-black tracking-tight text-white tabular-nums mt-1">
                  {financeLoaded ? fmtMoney(financeAgg.totalOutstanding) : (financeLoading ? '\u2026' : '\u2014')}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-50/70 mt-1.5">
                  Invoiced + WIP combined
                </p>
              </div>
              <div className="shrink-0 w-10 h-10 rounded-2xl bg-white/15 ring-1 ring-white/20 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>

          {financeError && !financeLoading && (
            <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-500/15 ring-1 ring-amber-500/30 rounded-xl px-3 py-2">
              {financeError}
            </p>
          )}

          <div className="rounded-2xl bg-gray-50/80 dark:bg-white/5 ring-1 ring-gray-200/60 dark:ring-white/5 px-4 py-1 mt-2.5">
            <KeyRow
              label="Invoiced Outstanding"
              value={financeLoaded ? fmtMoney(financeAgg.invoicedOutstanding) : '\u2014'}
              sub="Invoices not yet paid"
              tone={financeAgg.invoicedOutstanding > 0 ? 'amber' : 'default'}
            />
            <KeyRow
              label="Work In Progress"
              value={financeLoaded ? fmtMoney(financeAgg.workInProgress) : '\u2014'}
              sub="Jobs not yet invoiced"
            />
            <KeyRow
              label="A/P Total Owed"
              value={
                apLoading ? '\u2026'
                : apBillsTotal != null ? fmtMoney(apBillsTotal)
                : '\u2014'
              }
              sub={
                apLoading ? 'QuickBooks syncing\u2026'
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
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mt-2 px-1">
              Finance cache · {fmtAge(new Date(financeLastSynced).getTime())}
            </p>
          )}

          <ViewFullButton onClick={() => onJumpToTab('finance')} label="Open finance dashboard" />
        </CollapsibleSection>

        {/* ── Credit Block List ─────────────────────────────── */}
        <CollapsibleSection
          id="credit"
          title="Credit Block"
          subtitle={creditBlock.all.length > 0
            ? `${creditBlock.all.length} customer${creditBlock.all.length === 1 ? '' : 's'} overdue \u00B7 ${fmtMoney(creditBlock.totalBalance, { compact: true })}`
            : 'Outstanding invoices past terms'}
          icon={<ShieldAlert />}
          iconTone="red"
          badge={creditBlock.all.length > 0 ? creditBlock.all.length : null}
          badgeTone={creditBlock.all.length > 0 ? 'red' : 'default'}
          onFirstOpen={() => { loadFinance(); }}
        >
          {financeLoading && (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading finance cache…
            </div>
          )}
          {!financeLoading && financeLoaded && creditBlock.all.length === 0 && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 ring-1 ring-emerald-500/30 rounded-xl px-3 py-2.5 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> No customers past credit terms.
            </div>
          )}
          {creditBlock.top.length > 0 && (
            <div className="rounded-2xl overflow-hidden ring-1 ring-gray-200/60 dark:ring-white/10 divide-y divide-gray-100 dark:divide-white/5 mt-1">
              {creditBlock.top.map((c, idx) => {
                const hue = hashHue(c.name);
                return (
                  <div
                    key={c.name}
                    className="flex items-center gap-3 p-3 bg-white/60 dark:bg-white/5"
                  >
                    {/* Avatar circle — gradient picked from a hash of the
                        customer name so the same customer always looks the
                        same across sessions. */}
                    <div
                      className="shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center text-white text-[11px] font-black tracking-wider shadow-md"
                      style={{
                        background: `linear-gradient(135deg, hsl(${hue} 80% 55%), hsl(${(hue + 40) % 360} 75% 45%))`,
                      }}
                    >
                      {initialsOf(c.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-gray-900 dark:text-white truncate">
                        {idx === 0 && <span className="mr-1.5 text-amber-500">★</span>}
                        {c.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`
                          inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider
                          ${c.oldestDays >= 60
                            ? 'bg-red-500/15 text-red-700 dark:text-red-300 ring-1 ring-red-500/30'
                            : c.oldestDays >= 30
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30'
                            : 'bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-1 ring-slate-500/30'}
                        `}>
                          {c.oldestDays}d overdue
                        </span>
                      </div>
                    </div>
                    <p className="shrink-0 text-base font-black tabular-nums text-rose-700 dark:text-rose-300">
                      {fmtMoney(c.balance)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {creditBlock.all.length > creditBlock.top.length && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mt-2 px-1">
              +{creditBlock.all.length - creditBlock.top.length} more customers — open the full list to see them all.
            </p>
          )}
          <ViewFullButton onClick={() => onJumpToTab('credit')} label="Open credit block list" />
        </CollapsibleSection>

        {/* Footer breathing room for thumb-reach on iOS */}
        <div className="h-6" />
      </div>
    </div>
  );
};

export default MobileSummary;
