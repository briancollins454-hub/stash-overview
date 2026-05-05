import React, { useState, useMemo, useEffect } from 'react';
import type { DecoJob } from '../types';
import { getItem, setItem } from '../services/localStore';
import {
  calculatePriority, PRIORITY_SECTIONS, URGENCY_STYLE,
  pd, daysBetween,
  type PriorityResult, type PrioritySection, type Urgency,
} from '../services/priorityEngine';
import { refreshReadyAtForJobs, type ReadyAtMap } from '../services/readyAtStore';
import { displayStaffName } from '../services/staffDisplay';
import { isDecoJobCancelled } from '../services/decoJobFilters';
import { mergeFinanceAndDecoJobs } from '../services/decoJobSources';

interface Props {
  decoJobs: DecoJob[];
  onNavigateToOrder: (orderNum: string) => void;
  // Optional sync hook. Runs the standard cross-app sync. The freshness
  // pill in the header reflects when this last completed.
  onRefresh?: () => Promise<void> | void;
  // The big one. Pulls fresh Deco status for the supplied job numbers,
  // updates local cache + AWAITS cloud save, and reports what's now
  // shipped or cancelled so the caller can show feedback. Awaiting the
  // cloud save is the critical bit — without it, a follow-up sync would
  // read stale cloud data and resurrect rows we just cleared.
  //
  // Optional progress callback fires after each chunk so the UI can show
  // "Checked 50 / 150" rather than a blind spinner that looks frozen on
  // long boards.
  onClearCompleted?: (
    jobs: { jobNumber: string; id?: string }[],
    onProgress?: (current: number, total: number) => void,
  ) => Promise<{
    checked: number;
    shipped: number;
    cancelled: number;
    failed: number;
  }>;
  lastSyncTime?: number | null;
  loading?: boolean;
}

interface PriorityLineNote {
  text: string;
  excludeFromPdf: boolean;
  updatedAt: string;
}

const fmtK = (n: number) => {
  if (n >= 1000) return '\u00a3' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return '\u00a3' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const s = (n: number) => (n !== 1 ? 's' : '');
const fmtDate = (d: string | undefined) => {
  if (!d) return '\u2014';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '\u2014' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
};

/**
 * Small click-to-copy badge for the job number. Stops the row click
 * from firing so we don't accidentally navigate instead of copying.
 * Shows a brief "Copied" flash (1.2s) for feedback.
 */
const CopyableJobNum: React.FC<{ jobNumber: string; className?: string }> = ({ jobNumber, className }) => {
  const [copied, setCopied] = useState(false);
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jobNumber);
      } else {
        // Legacy fallback for non-HTTPS / older browsers.
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
    } catch {
      // Silent — keep UI unchanged if the browser denies clipboard access.
    }
  };
  return (
    <span
      onClick={handleClick}
      title={copied ? 'Copied!' : 'Click to copy'}
      className={`cursor-copy select-none transition-colors ${copied ? 'text-emerald-400' : 'hover:text-indigo-300'} ${className || ''}`}
    >
      {copied ? '\u2713 Copied' : `#${jobNumber}`}
    </span>
  );
};

/**
 * Live data freshness pill + refresh button. Re-renders every 30s so the
 * "synced X ago" text doesn't go stale silently while the user is sat on
 * the page. Tone is colour-coded by age — green ≤5min, amber ≤30min,
 * rose otherwise — so a glance tells you whether the board is reflecting
 * what's happening on the production floor right now or yesterday's snapshot.
 */
const FreshnessControl: React.FC<{
  lastSyncTime: number | null;
  loading: boolean;
  onRefresh: () => void;
}> = ({ lastSyncTime, loading, onRefresh }) => {
  // Force re-render every 30s so "synced 3m ago" advances without manual nudge.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const ageMs = lastSyncTime ? Date.now() - lastSyncTime : null;
  let tone = 'bg-rose-500/20 border-rose-400/40 text-rose-200';
  let label = 'Never synced';
  if (ageMs != null && ageMs >= 0) {
    const mins = Math.floor(ageMs / 60_000);
    if (mins < 1) label = 'Synced just now';
    else if (mins < 60) label = `Synced ${mins}m ago`;
    else if (mins < 60 * 24) label = `Synced ${Math.floor(mins / 60)}h ago`;
    else label = `Synced ${Math.floor(mins / (60 * 24))}d ago`;
    if (ageMs <= 5 * 60_000) tone = 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200';
    else if (ageMs <= 30 * 60_000) tone = 'bg-amber-500/20 border-amber-400/40 text-amber-200';
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-widest ${tone}`}
        title={lastSyncTime ? new Date(lastSyncTime).toLocaleString('en-GB') : 'Never synced'}
      >
        {label}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/40 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 transition-colors"
        title="Pull the latest jobs from Deco"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
        >
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
        {loading ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  );
};

const TIME_FRAMES = [
  { id: 'all',    label: 'All',    min: null, max: null  },
  { id: '3-5d',   label: '3-5D',   min: 3,    max: 5     },
  { id: '5-7d',   label: '5-7D',   min: 5,    max: 7     },
  { id: '7-14d',  label: '7-14D',  min: 7,    max: 14    },
  { id: '14-30d', label: '14-30D', min: 14,   max: 30    },
  { id: '30-90d', label: '30-90D', min: 30,   max: 90    },
  // "Shouldn't ever exist in theory, but if any do we want to spot them
  // immediately." Open-ended (max=null becomes Infinity in passesFilter).
  { id: '90d+',   label: '90D+',   min: 90,   max: null  },
] as const;

type TimeFrameId = typeof TIME_FRAMES[number]['id'];

/* ---------- Per-section metric helpers ---------- */

function getMetricDays(job: DecoJob, section: PrioritySection, now: Date, readyAtMap?: ReadyAtMap): number | null {
  const due = pd(job.dateDue) || pd(job.productionDueDate);
  const ordered = pd(job.dateOrdered);
  switch (section.filterMetric) {
    case 'days_since_ordered':
      return ordered ? daysBetween(ordered, now) : null;
    case 'days_until_due':
      return due ? daysBetween(now, due) : null;
    case 'days_past_due':
      return due ? daysBetween(due, now) : null;
    case 'days_since_ready': {
      const iso = readyAtMap?.[job.id];
      if (!iso) return null; // not yet stamped on this client
      const readyAt = new Date(iso);
      if (Number.isNaN(readyAt.getTime())) return null;
      return Math.max(0, daysBetween(readyAt, now));
    }
    default:
      return null;
  }
}

function formatMetric(days: number | null, section: PrioritySection): string {
  if (days === null) return section.filterMetric === 'days_since_ready' ? 'New' : '\u2014';
  switch (section.filterMetric) {
    case 'days_since_ordered':
      return `${days}d`;
    case 'days_until_due':
      if (days < 0) return `${Math.abs(days)}d over`;
      if (days === 0) return 'Today';
      return `${days}d left`;
    case 'days_past_due':
      if (days <= 0) return 'Due today';
      return `${days}d`;
    case 'days_since_ready':
      return days === 0 ? 'Today' : `${days}d`;
    default:
      return `${days}d`;
  }
}

function metricColor(days: number | null, section: PrioritySection): string {
  if (days === null) return 'text-white/20';
  switch (section.filterMetric) {
    case 'days_since_ordered':
      return days >= 10 ? 'text-red-400 font-bold' : days >= 5 ? 'text-orange-400 font-bold' : days >= 3 ? 'text-amber-400' : 'text-white/50';
    case 'days_until_due':
      if (days < 0) return Math.abs(days) >= 5 ? 'text-red-400 font-bold' : 'text-orange-400 font-bold';
      return days <= 3 ? 'text-amber-400 font-bold' : 'text-white/50';
    case 'days_past_due':
    case 'days_since_ready':
      return days >= 10 ? 'text-red-400 font-bold' : days >= 5 ? 'text-orange-400 font-bold' : days >= 3 ? 'text-amber-400' : 'text-white/50';
    default:
      return 'text-white/50';
  }
}

function passesFilter(job: DecoJob, section: PrioritySection, filterMin: number | null, filterMax: number | null, now: Date, readyAtMap?: ReadyAtMap): boolean {
  if (filterMin === null && filterMax === null) return true;
  const metric = getMetricDays(job, section, now, readyAtMap);
  if (metric === null) return true;
  const lo = filterMin ?? 0;
  const hi = filterMax ?? Infinity;
  switch (section.filterMetric) {
    case 'days_since_ordered':
    case 'days_past_due':
    case 'days_since_ready':
      return metric >= lo && metric <= hi;
    case 'days_until_due':
      return metric >= -hi && metric <= lo;
    default:
      return true;
  }
}

/**
 * Default row order: longest waiting at the top, per the section's metric.
 * - PO: most days since ordered first
 * - Stock / Processing: most overdue first (most negative days-until-due),
 *   then due-sooner before due-later among jobs not yet overdue
 * - Shipping: most days since ready first; "New" (no stamp yet) at the bottom
 * Tie-breakers: higher priority score, then oldest order date (FIFO).
 */
function compareLongestWaitingFirst(
  a: PriorityResult,
  b: PriorityResult,
  sec: PrioritySection,
  now: Date,
  readyAtMap?: ReadyAtMap,
): number {
  const ma = getMetricDays(a.job, sec, now, readyAtMap);
  const mb = getMetricDays(b.job, sec, now, readyAtMap);

  switch (sec.filterMetric) {
    case 'days_since_ordered':
    case 'days_past_due': {
      const sa = ma ?? -1;
      const sb = mb ?? -1;
      if (sb !== sa) return sb - sa;
      break;
    }
    case 'days_until_due': {
      // More negative = more overdue = longer waiting on ship-by
      const sa = ma ?? 999_999;
      const sb = mb ?? 999_999;
      if (sa !== sb) return sa - sb;
      break;
    }
    case 'days_since_ready': {
      const na = ma == null ? -1 : ma;
      const nb = mb == null ? -1 : mb;
      if (nb !== na) return nb - na;
      break;
    }
    default:
      break;
  }

  if (a.score !== b.score) {
    if (a.score > 0 && b.score > 0) return b.score - a.score;
    if (a.score > 0) return -1;
    if (b.score > 0) return 1;
  }

  const da = pd(a.job.dateOrdered)?.getTime() || 0;
  const db = pd(b.job.dateOrdered)?.getTime() || 0;
  return da - db;
}

/* ---------- Staff filter (Deco responsible / sales) ---------- */

const STAFF_ALL = 'all';
const STAFF_UNASSIGNED = '__unassigned__';

function priorityStaffBucket(job: DecoJob): string {
  return displayStaffName(job.salesPerson) || STAFF_UNASSIGNED;
}

/* ---------- Print handoff PDF ---------- */

function escHandoffHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const URGENCY_PRINT_CLASS: Record<Urgency, string> = {
  critical: 'u-crit',
  high: 'u-high',
  medium: 'u-med',
  low: 'u-low',
};

const PRIORITY_NOTES_KEY = 'stash_priority_line_notes';

function aggregatePriorityPrintTotals(
  sections: Array<PrioritySection & { items: PriorityResult[] }>,
  uncategorised: PriorityResult[],
  includeKeys: Set<string>,
): { orders: number; critical: number; high: number; value: number; titles: string[] } {
  let orders = 0;
  let critical = 0;
  let high = 0;
  let value = 0;
  const titles: string[] = [];
  for (const sec of sections) {
    if (!includeKeys.has(sec.key) || sec.items.length === 0) continue;
    titles.push(sec.title);
    orders += sec.items.length;
    critical += sec.items.filter(r => r.urgency === 'critical').length;
    high += sec.items.filter(r => r.urgency === 'high').length;
    value += sec.items.reduce((v, r) => v + (r.job.orderTotal || r.job.billableAmount || 0), 0);
  }
  if (includeKeys.has('other') && uncategorised.length > 0) {
    titles.push('Other flagged');
    orders += uncategorised.length;
    critical += uncategorised.filter(r => r.urgency === 'critical').length;
    high += uncategorised.filter(r => r.urgency === 'high').length;
    value += uncategorised.reduce((v, r) => v + (r.job.orderTotal || r.job.billableAmount || 0), 0);
  }
  return { orders, critical, high, value, titles };
}

function openPriorityHandoffPrint(opts: {
  sections: Array<PrioritySection & { items: PriorityResult[] }>;
  uncategorised: PriorityResult[];
  readyAtMap: ReadyAtMap;
  now: Date;
  audienceLine: string;
  /** Which board columns to include (`other` = Other flagged). */
  includeKeys: Set<string>;
  totalOrders: number;
  totalCritical: number;
  totalHigh: number;
  totalValue: number;
  /** Human-readable list for the PDF banner, e.g. "Awaiting PO, Awaiting Stock". */
  sectionsIncludedLine: string;
  notesByJobNumber: Record<string, PriorityLineNote>;
}): void {
  const { sections, uncategorised, readyAtMap, now, audienceLine, includeKeys, totalOrders, totalCritical, totalHigh, totalValue, sectionsIncludedLine, notesByJobNumber } = opts;
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const renderRow = (item: PriorityResult, i: number, sec: PrioritySection, metricCol: 'metric' | 'status') => {
    const staff = displayStaffName(item.job.salesPerson) || '—';
    const rules = item.matchedRules.length ? item.matchedRules.join(' · ') : '—';
    const val = item.job.orderTotal || item.job.billableAmount || 0;
    const u = URGENCY_PRINT_CLASS[item.urgency];
    const metric =
      metricCol === 'status'
        ? (item.job.status || '—')
        : formatMetric(getMetricDays(item.job, sec, now, readyAtMap), sec);
    const note = (notesByJobNumber[item.job.jobNumber]?.text || '').trim() || '—';
    return `<tr>
      <td class="c-num">${i + 1}</td>
      <td class="mono">#${escHandoffHtml(item.job.jobNumber)}</td>
      <td>${escHandoffHtml(item.job.customerName || '')}</td>
      <td class="muted">${escHandoffHtml((item.job.jobName || '').slice(0, 96))}</td>
      <td class="small">${escHandoffHtml(metric)}</td>
      <td><span class="badge ${u}">${escHandoffHtml(item.urgency)}</span></td>
      <td class="small">${escHandoffHtml(rules)}</td>
      <td>${escHandoffHtml(staff)}</td>
      <td class="small">${escHandoffHtml(note)}</td>
      <td class="num">${fmtK(val)}</td>
    </tr>`;
  };

  let body = '';
  for (const sec of sections) {
    if (!includeKeys.has(sec.key)) continue;
    if (sec.items.length === 0) continue;
    const rows = sec.items.map((it, i) => renderRow(it, i, sec, 'metric')).join('');
    body += `
      <section class="block">
        <div class="block-h">
          <span class="emoji">${sec.icon}</span>
          <div>
            <h2>${escHandoffHtml(sec.title)}</h2>
            <p class="sub">${escHandoffHtml(sec.subtitle)}</p>
          </div>
          <span class="count">${sec.items.length}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Order</th><th>Customer</th><th>Job</th>
              <th>${escHandoffHtml(sec.daysLabel)}</th><th>Urgency</th><th>Signals</th><th>Staff</th><th>Note</th><th>Value</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  if (includeKeys.has('other') && uncategorised.length > 0) {
    const fakeSec: PrioritySection = {
      key: 'other',
      title: 'Other flagged',
      subtitle: '',
      statuses: [],
      icon: '🔎',
      color: 'indigo',
      filterMetric: 'days_until_due',
      daysLabel: 'Status',
    };
    const rowsOther = uncategorised.map((it, i) => renderRow(it, i, fakeSec, 'status')).join('');
    body += `
      <section class="block">
        <div class="block-h">
          <span class="emoji">🔎</span>
          <div>
            <h2>Other flagged</h2>
            <p class="sub">Orders in other statuses with priority flags</p>
          </div>
          <span class="count">${uncategorised.length}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Order</th><th>Customer</th><th>Job</th>
              <th>Status</th><th>Urgency</th><th>Signals</th><th>Staff</th><th>Note</th><th>Value</th>
            </tr>
          </thead>
          <tbody>${rowsOther}</tbody>
        </table>
      </section>`;
  }

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=DM+Serif+Display&display=swap');
    * { box-sizing: border-box; }
    body { font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif; color: #1e1b4b; background: #fafafa; margin: 0; padding: 28px 32px 40px; font-size: 11px; line-height: 1.45; }
    .sheet { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(30,27,75,0.08); border: 1px solid #e9e7ef; overflow: hidden; }
    .hero { background: linear-gradient(135deg, #312e81 0%, #4c1d95 48%, #5b21b6 100%); color: #fff; padding: 28px 32px 32px; }
    .brand { font-family: 'DM Serif Display', Georgia, serif; font-size: 22px; letter-spacing: 0.02em; opacity: 0.95; }
    h1 { font-size: 20px; font-weight: 800; margin: 10px 0 0; letter-spacing: -0.02em; }
    .meta { margin-top: 14px; font-size: 11px; opacity: 0.85; line-height: 1.6; }
    .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
    .kpi { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 10px; padding: 10px 14px; min-width: 120px; }
    .kpi b { display: block; font-size: 18px; font-weight: 800; }
    .kpi span { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.75; }
    .note { padding: 14px 32px; background: #f5f3ff; border-bottom: 1px solid #e9e7ef; font-size: 10px; color: #5b21b6; }
    .blocks { padding: 20px 28px 32px; }
    .block { margin-bottom: 28px; page-break-inside: avoid; }
    .block:last-child { margin-bottom: 0; }
    .block-h { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #ede9fe; }
    .emoji { font-size: 22px; line-height: 1; }
    .block-h h2 { margin: 0; font-size: 13px; font-weight: 800; color: #3730a3; letter-spacing: -0.01em; }
    .block-h .sub { margin: 4px 0 0; font-size: 9px; color: #6b7280; max-width: 520px; }
    .count { margin-left: auto; font-size: 11px; font-weight: 800; background: #ede9fe; color: #5b21b6; padding: 4px 10px; border-radius: 999px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { text-align: left; padding: 8px 10px; background: #faf5ff; color: #6b21a8; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #e9e7ef; }
    td { padding: 8px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    tr:nth-child(even) td { background: #fcfcfd; }
    .c-num { color: #9ca3af; font-weight: 700; width: 28px; }
    .mono { font-family: ui-monospace, monospace; font-weight: 600; color: #5b21b6; }
    .muted { color: #6b7280; font-size: 9px; }
    .small { font-size: 9px; color: #4b5563; }
    .num { text-align: right; font-weight: 700; white-space: nowrap; color: #374151; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
    .u-crit { background: #fee2e2; color: #991b1b; }
    .u-high { background: #ffedd5; color: #9a3412; }
    .u-med { background: #fef3c7; color: #92400e; }
    .u-low { background: #dbeafe; color: #1e40af; }
    .foot { padding: 16px 32px 24px; text-align: center; font-size: 9px; color: #9ca3af; border-top: 1px solid #f3f4f6; }
    @media print {
      body { background: #fff; padding: 0; }
      .sheet { box-shadow: none; border: none; border-radius: 0; max-width: none; }
      .no-print { display: none !important; }
    }
  `;

  const bodyHtml = `
    <div class="no-print" style="margin-bottom:12px;text-align:center;">
      <button type="button" onclick="window.print()" style="padding:10px 20px;border-radius:8px;border:none;background:#4f46e5;color:#fff;font-weight:800;cursor:pointer;font-size:12px;">Print / Save as PDF</button>
    </div>
    <div class="sheet">
      <div class="hero">
        <div class="brand">Stash Shop Overview</div>
        <h1>Priority board handoff</h1>
        <div class="meta">${escHandoffHtml(dateStr)} · ${escHandoffHtml(timeStr)}<br>${escHandoffHtml(audienceLine)}</div>
        <div class="kpis">
          <div class="kpi"><span>Orders</span><b>${totalOrders}</b></div>
          <div class="kpi"><span>Critical</span><b>${totalCritical}</b></div>
          <div class="kpi"><span>High</span><b>${totalHigh}</b></div>
          <div class="kpi"><span>Pipeline</span><b>${fmtK(totalValue)}</b></div>
        </div>
      </div>
      <div class="note">Sections: ${escHandoffHtml(sectionsIncludedLine)}. Same ordering as the live board (longest-waiting first within each column).</div>
      <div class="blocks">${body || '<p style="padding:24px;color:#9ca3af;">No jobs in scope for this export.</p>'}</div>
      <div class="foot">Generated from Stash · Priority rules match in-app scoring</div>
    </div>
  `;

  const title = `Priority handoff — ${dateStr}`;
  const win = window.open('', '_blank');
  if (!win) {
    window.alert('Please allow pop-ups for this site to open the handoff document.');
    return;
  }
  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHandoffHtml(title)}</title><style>${styles}</style></head><body>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();
  window.setTimeout(() => {
    try { win.print(); } catch { /* user can use the button */ }
  }, 280);
}

/* ---------- Main component ---------- */

export default function PriorityBoard({ decoJobs, onNavigateToOrder, onRefresh, onClearCompleted, lastSyncTime, loading }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [staffFilter, setStaffFilter] = useState<string>(STAFF_ALL);
  const [financeJobs, setFinanceJobs] = useState<DecoJob[]>([]);
  const [readyAtMap, setReadyAtMap] = useState<ReadyAtMap>({});
  const [notesByJobNumber, setNotesByJobNumber] = useState<Record<string, PriorityLineNote>>({});

  useEffect(() => {
    getItem<DecoJob[]>('stash_finance_jobs').then(cached => {
      if (cached) setFinanceJobs(cached);
    });
  }, [lastSyncTime]);

  useEffect(() => {
    getItem<Record<string, PriorityLineNote>>(PRIORITY_NOTES_KEY).then(cached => {
      if (cached) setNotesByJobNumber(cached);
    }).catch(() => { /* non-fatal */ });
  }, []);

  const updateLineNote = (jobNumber: string, patch: Partial<PriorityLineNote>) => {
    setNotesByJobNumber(prev => {
      const current = prev[jobNumber] || { text: '', excludeFromPdf: false, updatedAt: new Date().toISOString() };
      const next: PriorityLineNote = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const out = { ...prev, [jobNumber]: next };
      setItem(PRIORITY_NOTES_KEY, out).catch(console.error);
      return out;
    });
  };

  const now = useMemo(() => new Date(), []);

  const allJobs = useMemo(
    () => mergeFinanceAndDecoJobs(financeJobs, decoJobs),
    [decoJobs, financeJobs],
  );

  // Reconcile per-job "became ready" timestamps whenever the job set changes.
  // First observation anchors to date_completed (when present) or now,
  // future syncs leave the stamp alone until the job leaves ready status.
  useEffect(() => {
    let cancelled = false;
    if (allJobs.length === 0) return;
    refreshReadyAtForJobs(allJobs).then(map => {
      if (!cancelled) setReadyAtMap(map);
    }).catch(() => { /* non-fatal — section just falls back to 'New' */ });
    return () => { cancelled = true; };
  }, [allJobs]);

  const active = useMemo(() =>
    allJobs.filter(j => {
      if (isDecoJobCancelled(j)) return false;
      const st = (j.status || '').toLowerCase();
      return st !== 'shipped';
    }),
  [allJobs]);

  const staffNamesOnBoard = useMemo(() => {
    const s = new Set<string>();
    for (const j of active) {
      const n = displayStaffName(j.salesPerson);
      if (n) s.add(n);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [active]);

  const filteredActive = useMemo(() => {
    if (staffFilter === STAFF_ALL) return active;
    return active.filter(j => priorityStaffBucket(j) === staffFilter);
  }, [active, staffFilter]);

  // Local working state — separates "general sync" from "clear completed"
  // so each button shows its own spinner + status without confusion.
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Live progress while clearing — { current, total } where current is
  // the number of IDs Deco has answered for so far. Lets the button show
  // "Clearing 50 / 150" rather than a blind spinner.
  const [clearProgress, setClearProgress] = useState<{ current: number; total: number } | null>(null);
  // Banner shown briefly after a clear-completed run so the user can see
  // exactly what happened (X checked, Y removed). Auto-dismisses.
  const [clearResult, setClearResult] = useState<{
    checked: number; shipped: number; cancelled: number; failed: number;
  } | null>(null);

  // Plain sync — same as the dashboard's quick sync. Useful for picking
  // up brand-new orders or recent status changes. Doesn't touch old jobs
  // outside the 120-day window.
  const handleSyncNow = async () => {
    if (!onRefresh) return;
    setBulkRefreshing(true);
    try { await onRefresh(); }
    finally { setBulkRefreshing(false); }
  };

  // The button users actually want for the "stuck old jobs" problem.
  //
  // Walks every job currently rendered on the board, asks Deco for the
  // CURRENT status of each (via direct ID lookup — no date gate, so even
  // year-old orders are reachable), updates local state, and AWAITS the
  // cloud save so a follow-up sync from this or any other device can't
  // resurrect cleared rows by reading stale cloud data on its way in.
  //
  // We pass visible job numbers; `fetchBulkDecoJobs` bulk-loads then
  // direct-fetches any IDs Deco did not return in the bulk batch.
  const handleClearCompleted = async () => {
    if (!onClearCompleted || clearing) return;
    const visibleJobs = filteredActive
      .map(j => ({ jobNumber: j.jobNumber || j.id, id: j.id }))
      .filter(j => !!j.jobNumber);
    if (visibleJobs.length === 0) return;
    // Cap the burst — protects the Deco API on dashboards with very long
    // historical tails. 250 is enough for any realistic Priority Board.
    const capped = visibleJobs.slice(0, 250);
    setClearing(true);
    setClearResult(null);
    setClearProgress({ current: 0, total: capped.length });
    try {
      const result = await onClearCompleted(capped, (current, total) => {
        setClearProgress({ current, total });
      });
      setClearResult(result);
      // Auto-dismiss banner after 8s — long enough to read, short enough
      // to clear out before the next user action.
      window.setTimeout(() => setClearResult(null), 8000);
    } catch (e) {
      console.error('[PriorityBoard] Clear completed failed:', e);
      setClearResult({ checked: 0, shipped: 0, cancelled: 0, failed: capped.length });
      window.setTimeout(() => setClearResult(null), 8000);
    } finally {
      setClearing(false);
      setClearProgress(null);
    }
  };

  const allScored = useMemo(() =>
    filteredActive.map(j => calculatePriority(j, now)),
  [filteredActive, now]);

  // Group ALL scored items by section (no time filtering here — each SectionCard filters independently)
  const sections = useMemo(() => {
    return PRIORITY_SECTIONS.map(sec => {
      const items = allScored.filter(r => sec.statuses.includes(r.job.status || ''));
      items.sort((a, b) => compareLongestWaitingFirst(a, b, sec, now, readyAtMap));
      return { ...sec, items };
    });
  }, [allScored, now, readyAtMap]);

  const coveredStatuses = new Set(PRIORITY_SECTIONS.flatMap(s => s.statuses));
  const uncategorised = useMemo(() =>
    allScored.filter(r => !coveredStatuses.has(r.job.status || '') && r.score > 0)
      .sort((a, b) => b.score - a.score),
  [allScored]);

  const totalOrders = sections.reduce((a, s) => a + s.items.length, 0);
  const totalCritical = sections.reduce((a, s) => a + s.items.filter(r => r.urgency === 'critical').length, 0);
  const totalHigh = sections.reduce((a, s) => a + s.items.filter(r => r.urgency === 'high').length, 0);
  const totalValue = sections.reduce((a, s) => a + s.items.reduce((v, r) => v + (r.job.orderTotal || r.job.billableAmount || 0), 0), 0);

  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printSelection, setPrintSelection] = useState<Record<string, boolean>>({});

  const printAudienceLine =
    staffFilter === STAFF_ALL
      ? 'All staff (full board)'
      : staffFilter === STAFF_UNASSIGNED
        ? 'Unassigned in Deco (no sales / responsible name on file)'
        : `Prepared for: ${staffFilter}`;

  const openPrintModal = () => {
    const init: Record<string, boolean> = {};
    for (const sec of sections) init[sec.key] = sec.items.length > 0;
    init.other = uncategorised.length > 0;
    setPrintSelection(init);
    setPrintModalOpen(true);
  };

  const setPrintAllSections = (on: boolean) => {
    const next: Record<string, boolean> = {};
    for (const sec of sections) {
      next[sec.key] = on && sec.items.length > 0;
    }
    next.other = on && uncategorised.length > 0;
    setPrintSelection(next);
  };

  const confirmPrintHandoff = () => {
    const includeKeys = new Set(Object.entries(printSelection).filter(([, v]) => v).map(([k]) => k));
    if (includeKeys.size === 0) {
      window.alert('Select at least one section to include.');
      return;
    }
    const pdfSections = sections.map(sec => ({
      ...sec,
      items: sec.items.filter(r => !notesByJobNumber[r.job.jobNumber]?.excludeFromPdf),
    }));
    const pdfUncategorised = uncategorised.filter(r => !notesByJobNumber[r.job.jobNumber]?.excludeFromPdf);
    const agg = aggregatePriorityPrintTotals(pdfSections, pdfUncategorised, includeKeys);
    if (agg.orders === 0) {
      window.alert('No jobs left for PDF after your "Done / exclude from PDF" marks in the selected sections.');
      return;
    }
    openPriorityHandoffPrint({
      sections: pdfSections,
      uncategorised: pdfUncategorised,
      readyAtMap,
      now,
      audienceLine: printAudienceLine,
      includeKeys,
      totalOrders: agg.orders,
      totalCritical: agg.critical,
      totalHigh: agg.high,
      totalValue: agg.value,
      sectionsIncludedLine: agg.titles.join(', '),
      notesByJobNumber,
    });
    setPrintModalOpen(false);
  };

  const toggleSection = (key: string) => setExpandedSection(prev => (prev === key ? null : key));

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-12">
      {/* Header */}
      <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 px-6 py-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-black text-white tracking-tight">Priority Board</h1>
            <p className="text-xs text-white/40 mt-0.5">
              {totalOrders} order{s(totalOrders)} &middot; {totalCritical} critical &middot; {totalHigh} high &middot; {fmtK(totalValue)} pipeline
              {uncategorised.length > 0 && (
                <span> &middot; +{uncategorised.length} other flagged</span>
              )}
            </p>
            {staffFilter !== STAFF_ALL && (
              <p className="text-[11px] text-indigo-300/90 mt-1.5 font-semibold">
                View: {staffFilter === STAFF_UNASSIGNED ? 'Unassigned' : staffFilter} ({filteredActive.length} of {active.length} jobs)
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <label className="flex items-center gap-2 text-[10px] font-bold text-white/70 uppercase tracking-wider">
              Staff
              <select
                value={staffFilter}
                onChange={e => setStaffFilter(e.target.value)}
                className="max-w-[10.5rem] sm:max-w-[13rem] px-2 py-1.5 rounded-lg border border-white/15 bg-white/10 text-white text-xs font-semibold normal-case tracking-normal cursor-pointer hover:bg-white/15"
                title="Filter the board and PDF export by Deco sales / responsible person"
              >
                <option value={STAFF_ALL}>All staff</option>
                <option value={STAFF_UNASSIGNED}>Unassigned</option>
                {staffNamesOnBoard.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={openPrintModal}
              disabled={totalOrders === 0 && uncategorised.length === 0}
              title="Choose which board columns to include, then print or save as PDF"
              className="px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 disabled:bg-violet-500/30 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M6 9V2h12v7" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" rx="1" />
              </svg>
              PDF
            </button>
            {onClearCompleted && (
              <button
                type="button"
                onClick={handleClearCompleted}
                disabled={clearing || bulkRefreshing || loading}
                title="Re-check every visible job's status against Deco. Anything now shipped or cancelled is removed and the change is saved to the cloud so it doesn't come back on the next sync."
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/40 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`w-3.5 h-3.5 ${clearing ? 'animate-spin' : ''}`}
                >
                  {clearing ? (
                    <>
                      <path d="M3 12a9 9 0 1 0 3-6.7" />
                      <path d="M3 4v5h5" />
                    </>
                  ) : (
                    <>
                      <polyline points="20 6 9 17 4 12" />
                    </>
                  )}
                </svg>
                {clearing
                  ? clearProgress
                    ? `Clearing ${clearProgress.current}/${clearProgress.total}…`
                    : 'Clearing…'
                  : 'Remove Completed'}
              </button>
            )}
            {onRefresh && (
              <FreshnessControl
                lastSyncTime={lastSyncTime ?? null}
                loading={!!loading || bulkRefreshing}
                onRefresh={handleSyncNow}
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex gap-3 flex-wrap">
          {(['critical', 'high', 'medium', 'low'] as Urgency[]).map(u => {
            const count = allScored.filter(r => r.urgency === u && coveredStatuses.has(r.job.status || '')).length;
            if (count === 0) return null;
            const us = URGENCY_STYLE[u];
            return (
              <div key={u} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${us.bg} ${us.border} border`}>
                <span className={`w-2 h-2 rounded-full ${us.dot.split(' ')[0]}${us.pulse}`} />
                <span className={`text-[10px] font-bold ${us.text}`}>{count}</span>
                <span className="text-[10px] text-white/30 uppercase">{u}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Clear-completed result banner. Auto-dismisses after 8s. */}
      {clearResult && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          clearResult.failed > 0
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
            : (clearResult.shipped + clearResult.cancelled) > 0
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200'
        }`}>
          {clearResult.failed > 0 ? (
            <>Couldn&apos;t reach Deco for {clearResult.failed} job{clearResult.failed === 1 ? '' : 's'}. Try again in a moment.</>
          ) : (clearResult.shipped + clearResult.cancelled) > 0 ? (
            <>
              Cleared <span className="font-bold">{clearResult.shipped + clearResult.cancelled}</span>{' '}
              completed job{(clearResult.shipped + clearResult.cancelled) === 1 ? '' : 's'} from {clearResult.checked} checked
              {' — '}
              {clearResult.shipped > 0 && <>{clearResult.shipped} shipped</>}
              {clearResult.shipped > 0 && clearResult.cancelled > 0 && ', '}
              {clearResult.cancelled > 0 && <>{clearResult.cancelled} cancelled</>}.
              <span className="text-white/50"> Saved to cloud — won&apos;t come back on next sync.</span>
            </>
          ) : (
            <>Re-checked {clearResult.checked} job{clearResult.checked === 1 ? '' : 's'}. Nothing&apos;s flipped to shipped or cancelled in Deco yet.</>
          )}
        </div>
      )}

      {/* Status sections */}
      {sections.map(sec => (
        <SectionCard
          key={sec.key}
          section={sec}
          allItems={sec.items}
          expanded={expandedSection === sec.key}
          onToggle={() => toggleSection(sec.key)}
          onNavigate={onNavigateToOrder}
          now={now}
          readyAtMap={readyAtMap}
          notesByJobNumber={notesByJobNumber}
          onUpdateLineNote={updateLineNote}
        />
      ))}

      {/* Uncategorised flagged */}
      {uncategorised.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 overflow-hidden">
          <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors" onClick={() => toggleSection('other')}>
            <div className="flex items-center gap-3">
              <span className="text-xl">&#128269;</span>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-indigo-300">Other Flagged</h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-400">{uncategorised.length}</span>
                </div>
                <p className="text-[11px] text-white/40 mt-0.5">Orders in other statuses with priority flags</p>
              </div>
            </div>
            <svg className={`w-4 h-4 text-white/30 transition-transform ${expandedSection === 'other' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {expandedSection === 'other' && (
            <div className="border-t border-white/5 divide-y divide-white/[0.03]">
              {uncategorised.map((item, i) => {
                const us = URGENCY_STYLE[item.urgency];
                const lineNote = notesByJobNumber[item.job.jobNumber];
                const noteText = lineNote?.text || '';
                const excluded = !!lineNote?.excludeFromPdf;
                return (
                  <div key={item.job.id} className={`flex items-center gap-2 px-4 py-2.5 hover:bg-white/5 cursor-pointer transition-colors ${excluded ? 'opacity-70' : ''}`} onClick={() => onNavigateToOrder(item.job.jobNumber)}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${us.dot}`}>{i + 1}</span>
                    <CopyableJobNum jobNumber={item.job.jobNumber} className="text-[10px] font-mono text-indigo-400/70 shrink-0" />
                    <span className="text-xs text-white/70 truncate flex-1">{item.job.customerName}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full ${us.pill}`}>{item.reason}</span>
                    <span className="text-[10px] text-white/50">{item.job.status}</span>
                    <div className="flex items-center gap-1.5 min-w-[260px]" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={excluded}
                        onChange={(e) => updateLineNote(item.job.jobNumber, { excludeFromPdf: e.target.checked })}
                        title="Done: exclude this row from PDF exports"
                        className="rounded border-white/20 bg-[#2a2a55] text-emerald-500 focus:ring-emerald-500/40"
                      />
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => updateLineNote(item.job.jobNumber, { text: e.target.value })}
                        placeholder={excluded ? 'Excluded from PDF' : 'Follow-up note'}
                        className={`w-full px-2 py-1 rounded border text-[10px] ${
                          excluded
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                            : 'border-white/10 bg-white/5 text-white/80'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Empty */}
      {totalOrders === 0 && uncategorised.length === 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 px-6 py-12 text-center">
          <p className="text-white/50 text-sm">No orders found for this filter.</p>
          <p className="text-white/25 text-xs mt-1">Try &quot;All staff&quot; or another staff filter, or sync Deco.</p>
        </div>
      )}

      {printModalOpen && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-modal-title"
          onClick={() => setPrintModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-indigo-500/30 bg-[#16162a] shadow-2xl p-5 text-left"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="print-modal-title" className="text-base font-black text-white tracking-tight">PDF — choose sections</h2>
            <p className="text-[11px] text-white/45 mt-1 mb-4">
              Tick only the columns you want in this handoff. KPIs on the PDF reflect your selection (respects the staff filter above).
            </p>
            <div className="space-y-2 max-h-[min(48vh,360px)] overflow-y-auto pr-1">
              {sections.map(sec => {
                const n = sec.items.length;
                const disabled = n === 0;
                const checked = !!printSelection[sec.key];
                return (
                  <label
                    key={sec.key}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                      disabled ? 'border-white/5 opacity-45 cursor-not-allowed' : 'border-white/10 hover:bg-white/5 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-white/20 bg-[#2a2a55] text-violet-500 focus:ring-violet-500/50"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => {
                        if (!disabled) setPrintSelection(p => ({ ...p, [sec.key]: !p[sec.key] }));
                      }}
                    />
                    <span className="text-xl shrink-0 leading-none">{sec.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-white">{sec.title}</span>
                      <span className="text-[10px] text-white/35">{n === 0 ? 'No jobs in this column' : `${n} job${s(n)}`}</span>
                    </span>
                  </label>
                );
              })}
              <label
                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  uncategorised.length === 0 ? 'border-white/5 opacity-45 cursor-not-allowed' : 'border-white/10 hover:bg-white/5 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-white/20 bg-[#2a2a55] text-violet-500 focus:ring-violet-500/50"
                  checked={!!printSelection.other}
                  disabled={uncategorised.length === 0}
                  onChange={() => {
                    if (uncategorised.length > 0) setPrintSelection(p => ({ ...p, other: !p.other }));
                  }}
                />
                <span className="text-xl shrink-0 leading-none">🔎</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-indigo-300">Other flagged</span>
                  <span className="text-[10px] text-white/35">
                    {uncategorised.length === 0 ? 'None' : `${uncategorised.length} job${s(uncategorised.length)}`}
                  </span>
                </span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-4 text-[10px] font-bold uppercase tracking-wide">
              <button type="button" className="text-violet-300 hover:text-violet-200" onClick={() => setPrintAllSections(true)}>Select all</button>
              <span className="text-white/20">·</span>
              <button type="button" className="text-white/40 hover:text-white/70" onClick={() => setPrintAllSections(false)}>Clear</button>
            </div>
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-white/10">
              <button
                type="button"
                className="px-3 py-2 rounded-lg text-xs font-bold text-white/60 hover:bg-white/5"
                onClick={() => setPrintModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-black uppercase tracking-wider"
                onClick={confirmPrintHandoff}
              >
                Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Section Card ---------- */

interface SectionCardProps {
  section: PrioritySection;
  allItems: PriorityResult[];
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (orderNum: string) => void;
  now: Date;
  readyAtMap: ReadyAtMap;
  notesByJobNumber: Record<string, PriorityLineNote>;
  onUpdateLineNote: (jobNumber: string, patch: Partial<PriorityLineNote>) => void;
}

const COLOR_MAP: Record<string, { header: string; border: string; badge: string }> = {
  rose:   { header: 'text-rose-300',   border: 'border-rose-500/20',   badge: 'bg-rose-500/10 text-rose-400' },
  amber:  { header: 'text-amber-300',  border: 'border-amber-500/20',  badge: 'bg-amber-500/10 text-amber-400' },
  blue:   { header: 'text-blue-300',   border: 'border-blue-500/20',   badge: 'bg-blue-500/10 text-blue-400' },
  green:  { header: 'text-green-300',  border: 'border-green-500/20',  badge: 'bg-green-500/10 text-green-400' },
  indigo: { header: 'text-indigo-300', border: 'border-indigo-500/20', badge: 'bg-indigo-500/10 text-indigo-400' },
};

const URGENCY_LABEL: Record<Urgency, string> = { critical: 'CRIT', high: 'HIGH', medium: 'MED', low: 'LOW' };

function SectionCard({ section, allItems, expanded, onToggle, onNavigate, now, readyAtMap, notesByJobNumber, onUpdateLineNote }: SectionCardProps) {
  const [localFilter, setLocalFilter] = useState<TimeFrameId>('all');
  const cm = COLOR_MAP[section.color] || COLOR_MAP.indigo;

  const tf = TIME_FRAMES.find(t => t.id === localFilter);
  const filterMin = tf?.min ?? null;
  const filterMax = tf?.max ?? null;
  const items = useMemo(() =>
    allItems.filter(r => passesFilter(r.job, section, filterMin, filterMax, now, readyAtMap)),
  [allItems, filterMin, filterMax, section, now, readyAtMap]);

  const totalValue = items.reduce((a, r) => a + (r.job.orderTotal || r.job.billableAmount || 0), 0);
  const criticalCount = items.filter(r => r.urgency === 'critical').length;
  const highCount = items.filter(r => r.urgency === 'high').length;
  const totalInStatus = allItems.length;

  // Open-ended buckets (e.g. 90+) have a null max; render as "90+" rather than "90–null".
  const rangeLabel = filterMax === null ? `${filterMin}+` : `${filterMin}–${filterMax}`;
  const filterHint = (filterMin === null && filterMax === null) ? '' : (
    section.filterMetric === 'days_since_ordered' ? `Orders waiting ${rangeLabel} days` :
    section.filterMetric === 'days_until_due' ? `Due within ${rangeLabel} days` :
    section.filterMetric === 'days_past_due' ? `Waiting ${rangeLabel} days to ship` :
    section.filterMetric === 'days_since_ready' ? `Ready ${rangeLabel} days awaiting dispatch` : ''
  );

  return (
    <div className={`bg-[#1e1e3a] rounded-2xl border ${cm.border} overflow-hidden`}>
      {/* Header */}
      <div className="px-5 py-4">
        <button className="w-full flex items-center justify-between hover:bg-white/[0.02] transition-colors" onClick={onToggle}>
          <div className="flex items-center gap-3">
            <span className="text-xl">{section.icon}</span>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <h2 className={`text-sm font-bold ${cm.header}`}>{section.title}</h2>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${cm.badge}`}>
                  {items.length}{items.length !== totalInStatus ? ` / ${totalInStatus}` : ''}
                </span>
                {criticalCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 animate-pulse">{criticalCount} critical</span>
                )}
                {highCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-500/10 text-orange-400">{highCount} high</span>
                )}
              </div>
              <p className="text-[11px] text-white/40 mt-0.5">
                {section.subtitle} &middot; {fmtK(totalValue)}
                {filterHint && <span className="text-white/25"> &middot; {filterHint}</span>}
              </p>
            </div>
          </div>
          <svg className={`w-4 h-4 text-white/30 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {/* Per-section time filter */}
        <div className="flex flex-wrap gap-1 mt-2 ml-9">
          {TIME_FRAMES.map(tf => (
            <button
              key={tf.id}
              onClick={(e) => { e.stopPropagation(); setLocalFilter(tf.id); }}
              className={`px-2 py-1 rounded text-[9px] font-bold tracking-wider uppercase transition-all ${
                localFilter === tf.id
                  ? `${cm.badge} ring-1 ring-${section.color}-500/40`
                  : 'text-white/30 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {expanded && (
        <div className="border-t border-white/5">
          {items.length === 0 ? (
            <div className="px-5 py-6 text-center text-white/30 text-xs">No orders in this category{filterHint ? ' for this filter' : ''}.</div>
          ) : (
            <>
              <div className="grid grid-cols-[32px_1fr_1fr_70px_70px_90px_90px_1.2fr_70px] gap-1 px-4 py-2 text-[9px] font-bold text-white/20 uppercase tracking-wider border-b border-white/5">
                <span>#</span>
                <span>Order / Date</span>
                <span>Customer / Job</span>
                <span>{section.daysLabel}</span>
                <span>Urgency</span>
                <span>Reason</span>
                <span>Staff</span>
                <span>Follow-up note</span>
                <span className="text-right">Value</span>
              </div>
              <div className="divide-y divide-white/[0.03]">
                {items.map((item, i) => {
                  const us = URGENCY_STYLE[item.urgency];
                  const staff = displayStaffName(item.job.salesPerson) || '\u2014';
                  const metric = getMetricDays(item.job, section, now, readyAtMap);
                  const metricStr = formatMetric(metric, section);
                  const mStyle = metricColor(metric, section);
                  const lineNote = notesByJobNumber[item.job.jobNumber];
                  const noteText = lineNote?.text || '';
                  const excluded = !!lineNote?.excludeFromPdf;
                  return (
                    <div
                      key={item.job.id}
                      className={`grid grid-cols-[32px_1fr_1fr_70px_70px_90px_90px_1.2fr_70px] gap-1 px-4 py-2.5 items-center hover:bg-white/5 cursor-pointer transition-colors ${excluded ? 'opacity-70' : ''}`}
                      onClick={() => onNavigate(item.job.jobNumber)}
                    >
                      <span className="text-[10px] text-white/20 font-mono">{i + 1}</span>
                      <div className="min-w-0">
                        <CopyableJobNum jobNumber={item.job.jobNumber} className="text-[10px] font-mono text-indigo-400/70 block" />
                        <span className="text-[9px] text-white/25 block">{fmtDate(item.job.dateOrdered)}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs text-white/70 truncate block">{item.job.customerName}</span>
                        <span className="text-[9px] text-white/30 truncate block" title={item.job.jobName}>{item.job.jobName || ''}</span>
                      </div>
                      <span className={`text-[10px] ${mStyle}`}>{metricStr}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold w-fit ${us.pill}${us.pulse}`}>{URGENCY_LABEL[item.urgency]}</span>
                      <div className="flex flex-wrap gap-0.5">
                        {item.matchedRules.length > 0 ? item.matchedRules.slice(0, 2).map((r, ri) => (
                          <span key={ri} className={`text-[8px] px-1.5 py-0.5 rounded-full ${us.pill}`}>{r}</span>
                        )) : <span className="text-[8px] text-white/15">{'\u2014'}</span>}
                      </div>
                      <span className="text-[10px] text-white/40 truncate">{staff}</span>
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={excluded}
                          onChange={(e) => onUpdateLineNote(item.job.jobNumber, { excludeFromPdf: e.target.checked })}
                          title="Done: exclude this row from PDF exports"
                          className="rounded border-white/20 bg-[#2a2a55] text-emerald-500 focus:ring-emerald-500/40"
                        />
                        <input
                          type="text"
                          value={noteText}
                          onChange={(e) => onUpdateLineNote(item.job.jobNumber, { text: e.target.value })}
                          placeholder={excluded ? 'Excluded from PDF' : 'Why still here / who is chasing'}
                          className={`w-full min-w-0 px-2 py-1 rounded border text-[10px] ${
                            excluded
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-white/10 bg-white/5 text-white/80'
                          }`}
                        />
                      </div>
                      <span className="text-[10px] text-white/30 text-right">{fmtK(item.job.orderTotal || item.job.billableAmount || 0)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-white/25">{items.length} order{s(items.length)} &middot; {fmtK(totalValue)} total</span>
                <div className="flex gap-2">
                  {(['critical', 'high', 'medium', 'low'] as Urgency[]).map(u => {
                    const c = items.filter(r => r.urgency === u).length;
                    if (c === 0) return null;
                    const ust = URGENCY_STYLE[u];
                    return <span key={u} className={`text-[9px] px-1.5 py-0.5 rounded ${ust.pill}`}>{c} {u}</span>;
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
