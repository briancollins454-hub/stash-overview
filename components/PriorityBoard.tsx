import React, { useState, useMemo, useEffect } from 'react';
import type { DecoJob } from '../types';
import { getItem } from '../services/localStore';
import {
  calculatePriority, PRIORITY_SECTIONS, URGENCY_STYLE,
  pd, daysBetween,
  type PriorityResult, type PrioritySection, type Urgency,
} from '../services/priorityEngine';
import { refreshReadyAtForJobs, type ReadyAtMap } from '../services/readyAtStore';

interface Props {
  decoJobs: DecoJob[];
  onNavigateToOrder: (orderNum: string) => void;
}

const isCancelled = (j: DecoJob) =>
  (j.status || '').toLowerCase() === 'cancelled' || j.paymentStatus === '7';

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

const extractSP = (sp: any): string | undefined => {
  if (!sp) return undefined;
  if (typeof sp === 'string') return sp;
  if (typeof sp === 'object') {
    if (sp.firstname || sp.lastname) return `${sp.firstname || ''} ${sp.lastname || ''}`.trim();
    if (sp.name) return sp.name;
    if (sp.login) return sp.login;
    return undefined;
  }
  return String(sp);
};

const TIME_FRAMES = [
  { id: 'all',    label: 'All',    min: null, max: null },
  { id: '3-5d',   label: '3-5D',   min: 3,    max: 5 },
  { id: '5-7d',   label: '5-7D',   min: 5,    max: 7 },
  { id: '7-14d',  label: '7-14D',  min: 7,    max: 14 },
  { id: '14-30d', label: '14-30D', min: 14,   max: 30 },
  { id: '30-90d', label: '30-90D', min: 30,   max: 90 },
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

/* ---------- Main component ---------- */

export default function PriorityBoard({ decoJobs, onNavigateToOrder }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [financeJobs, setFinanceJobs] = useState<DecoJob[]>([]);
  const [readyAtMap, setReadyAtMap] = useState<ReadyAtMap>({});

  useEffect(() => {
    getItem<DecoJob[]>('stash_finance_jobs').then(cached => {
      if (cached) setFinanceJobs(cached);
    });
  }, []);

  const now = useMemo(() => new Date(), []);

  const allJobs = useMemo(() => {
    const map = new Map<string, DecoJob>();
    financeJobs.forEach(j => map.set(j.id, j));
    decoJobs.forEach(j => map.set(j.id, j));
    return Array.from(map.values());
  }, [decoJobs, financeJobs]);

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
      if (isCancelled(j)) return false;
      const st = (j.status || '').toLowerCase();
      return st !== 'shipped';
    }),
  [allJobs]);

  const allScored = useMemo(() =>
    active.map(j => calculatePriority(j, now)),
  [active, now]);

  // Group ALL scored items by section (no time filtering here — each SectionCard filters independently)
  const sections = useMemo(() => {
    return PRIORITY_SECTIONS.map(sec => {
      const items = allScored.filter(r => sec.statuses.includes(r.job.status || ''));
      items.sort((a, b) => {
        if (a.score > 0 && b.score > 0) return b.score - a.score;
        if (a.score > 0) return -1;
        if (b.score > 0) return 1;
        const da = pd(a.job.dateOrdered)?.getTime() || 0;
        const db = pd(b.job.dateOrdered)?.getTime() || 0;
        return db - da;
      });
      return { ...sec, items };
    });
  }, [allScored, now]);

  const coveredStatuses = new Set(PRIORITY_SECTIONS.flatMap(s => s.statuses));
  const uncategorised = useMemo(() =>
    allScored.filter(r => !coveredStatuses.has(r.job.status || '') && r.score > 0)
      .sort((a, b) => b.score - a.score),
  [allScored]);

  const totalOrders = sections.reduce((a, s) => a + s.items.length, 0);
  const totalCritical = sections.reduce((a, s) => a + s.items.filter(r => r.urgency === 'critical').length, 0);
  const totalHigh = sections.reduce((a, s) => a + s.items.filter(r => r.urgency === 'high').length, 0);
  const totalValue = sections.reduce((a, s) => a + s.items.reduce((v, r) => v + (r.job.orderTotal || r.job.billableAmount || 0), 0), 0);

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
            </p>
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
                return (
                  <div key={item.job.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-white/5 cursor-pointer transition-colors" onClick={() => onNavigateToOrder(item.job.jobNumber)}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${us.dot}`}>{i + 1}</span>
                    <span className="text-[10px] font-mono text-indigo-400/70 shrink-0">#{item.job.jobNumber}</span>
                    <span className="text-xs text-white/70 truncate flex-1">{item.job.customerName}</span>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full ${us.pill}`}>{item.reason}</span>
                    <span className="text-[10px] text-white/50">{item.job.status}</span>
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
          <p className="text-white/25 text-xs mt-1">Try selecting &quot;All&quot; to see everything.</p>
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
}

const COLOR_MAP: Record<string, { header: string; border: string; badge: string }> = {
  rose:   { header: 'text-rose-300',   border: 'border-rose-500/20',   badge: 'bg-rose-500/10 text-rose-400' },
  amber:  { header: 'text-amber-300',  border: 'border-amber-500/20',  badge: 'bg-amber-500/10 text-amber-400' },
  blue:   { header: 'text-blue-300',   border: 'border-blue-500/20',   badge: 'bg-blue-500/10 text-blue-400' },
  green:  { header: 'text-green-300',  border: 'border-green-500/20',  badge: 'bg-green-500/10 text-green-400' },
  indigo: { header: 'text-indigo-300', border: 'border-indigo-500/20', badge: 'bg-indigo-500/10 text-indigo-400' },
};

const URGENCY_LABEL: Record<Urgency, string> = { critical: 'CRIT', high: 'HIGH', medium: 'MED', low: 'LOW' };

function SectionCard({ section, allItems, expanded, onToggle, onNavigate, now, readyAtMap }: SectionCardProps) {
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

  const filterHint = (filterMin === null && filterMax === null) ? '' : (
    section.filterMetric === 'days_since_ordered' ? `Orders waiting ${filterMin}–${filterMax} days` :
    section.filterMetric === 'days_until_due' ? `Due within ${filterMin}–${filterMax} days` :
    section.filterMetric === 'days_past_due' ? `Waiting ${filterMin}–${filterMax} days to ship` :
    section.filterMetric === 'days_since_ready' ? `Ready ${filterMin}–${filterMax} days awaiting dispatch` : ''
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
              <div className="grid grid-cols-[32px_1fr_1fr_70px_70px_90px_90px_70px] gap-1 px-4 py-2 text-[9px] font-bold text-white/20 uppercase tracking-wider border-b border-white/5">
                <span>#</span>
                <span>Order / Date</span>
                <span>Customer / Job</span>
                <span>{section.daysLabel}</span>
                <span>Urgency</span>
                <span>Reason</span>
                <span>Staff</span>
                <span className="text-right">Value</span>
              </div>
              <div className="divide-y divide-white/[0.03]">
                {items.map((item, i) => {
                  const us = URGENCY_STYLE[item.urgency];
                  const staff = extractSP(item.job.salesPerson) || '\u2014';
                  const metric = getMetricDays(item.job, section, now, readyAtMap);
                  const metricStr = formatMetric(metric, section);
                  const mStyle = metricColor(metric, section);
                  return (
                    <div
                      key={item.job.id}
                      className="grid grid-cols-[32px_1fr_1fr_70px_70px_90px_90px_70px] gap-1 px-4 py-2.5 items-center hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => onNavigate(item.job.jobNumber)}
                    >
                      <span className="text-[10px] text-white/20 font-mono">{i + 1}</span>
                      <div className="min-w-0">
                        <span className="text-[10px] font-mono text-indigo-400/70 block">#{item.job.jobNumber}</span>
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
