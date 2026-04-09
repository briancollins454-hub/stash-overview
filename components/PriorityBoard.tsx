import React, { useState, useMemo, useEffect } from 'react';
import type { DecoJob } from '../types';
import { getItem } from '../services/localStore';
import {
  calculatePriority, PRIORITY_SECTIONS, URGENCY_STYLE,
  pd, daysBetween,
  type PriorityResult, type PrioritySection, type Urgency,
} from '../services/priorityEngine';

interface Props {
  decoJobs: DecoJob[];
  onNavigateToOrder: (orderNum: string) => void;
}

const isCancelled = (j: DecoJob) =>
  (j.status || '').toLowerCase() === 'cancelled' || j.paymentStatus === '7';

const fmt = (n: number) => '\u00a3' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n: number) => n >= 1000 ? '\u00a3' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmt(n);
const s = (n: number) => n !== 1 ? 's' : '';

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

// Time frame options
const TIME_FRAMES = [
  { id: 'all',   label: 'All Time',  days: null },
  { id: '90d',   label: '90 Days',   days: 90 },
  { id: '30d',   label: '30 Days',   days: 30 },
  { id: '14d',   label: '14 Days',   days: 14 },
  { id: '7d',    label: '7 Days',    days: 7 },
  { id: '3d',    label: '3 Days',    days: 3 },
  { id: 'today', label: 'Today',     days: 0 },
] as const;

type TimeFrameId = typeof TIME_FRAMES[number]['id'];

export default function PriorityBoard({ decoJobs, onNavigateToOrder }: Props) {
  const [timeFrame, setTimeFrame] = useState<TimeFrameId>('all');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [financeJobs, setFinanceJobs] = useState<DecoJob[]>([]);

  // Load cached finance data
  useEffect(() => {
    getItem<DecoJob[]>('stash_finance_jobs').then(cached => {
      if (cached) setFinanceJobs(cached);
    });
  }, []);

  const now = useMemo(() => new Date(), []);

  // Merge prop data + cache (props override)
  const allJobs = useMemo(() => {
    const map = new Map<string, DecoJob>();
    financeJobs.forEach(j => map.set(j.id, j));
    decoJobs.forEach(j => map.set(j.id, j));
    return Array.from(map.values());
  }, [decoJobs, financeJobs]);

  // Active jobs (not cancelled, not shipped)
  const active = useMemo(() =>
    allJobs.filter(j => {
      if (isCancelled(j)) return false;
      const st = (j.status || '').toLowerCase();
      return st !== 'shipped';
    }),
  [allJobs]);

  // Filter by time frame (based on dateOrdered)
  const filtered = useMemo(() => {
    const frame = TIME_FRAMES.find(t => t.id === timeFrame);
    if (!frame || frame.days === null) return active;
    if (frame.days === 0) {
      const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
      return active.filter(j => {
        const o = pd(j.dateOrdered);
        return o && o >= t0;
      });
    }
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - frame.days);
    return active.filter(j => {
      const o = pd(j.dateOrdered);
      return o && o >= cutoff;
    });
  }, [active, timeFrame, now]);

  // Score all filtered jobs
  const scored = useMemo(() =>
    filtered.map(j => calculatePriority(j, now)).sort((a, b) => b.score - a.score),
  [filtered, now]);

  // Build sections
  const sections = useMemo(() => {
    return PRIORITY_SECTIONS.map(sec => {
      const items = scored.filter(r => sec.statuses.includes(r.job.status || ''));
      const totalValue = items.reduce((a, r) => a + (r.job.orderTotal || r.job.billableAmount || 0), 0);
      const criticalCount = items.filter(r => r.urgency === 'critical').length;
      const highCount = items.filter(r => r.urgency === 'high').length;
      return { ...sec, items, totalValue, criticalCount, highCount };
    });
  }, [scored]);

  // Uncategorised jobs (statuses not covered by sections)
  const coveredStatuses = new Set(PRIORITY_SECTIONS.flatMap(s => s.statuses));
  const uncategorised = useMemo(() =>
    scored.filter(r => !coveredStatuses.has(r.job.status || '') && r.score > 0),
  [scored]);

  // Summary stats
  const totalScored = scored.filter(r => r.score > 0).length;
  const totalCritical = scored.filter(r => r.urgency === 'critical').length;
  const totalHigh = scored.filter(r => r.urgency === 'high').length;
  const totalValue = scored.reduce((a, r) => a + (r.job.orderTotal || r.job.billableAmount || 0), 0);

  const toggleSection = (key: string) => setExpandedSection(prev => prev === key ? null : key);

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-12">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 px-6 py-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-black text-white tracking-tight">Priority Board</h1>
            <p className="text-xs text-white/40 mt-0.5">
              {totalScored} order{s(totalScored)} flagged &middot; {totalCritical} critical &middot; {totalHigh} high &middot; {fmtK(totalValue)} pipeline
            </p>
          </div>

          {/* Time frame buttons */}
          <div className="flex flex-wrap gap-1.5">
            {TIME_FRAMES.map(tf => (
              <button
                key={tf.id}
                onClick={() => setTimeFrame(tf.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase transition-all ${
                  timeFrame === tf.id
                    ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Urgency breakdown bar */}
        <div className="mt-4 flex gap-3">
          {(['critical', 'high', 'medium', 'low'] as Urgency[]).map(u => {
            const count = scored.filter(r => r.urgency === u).length;
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

      {/* ── Status Sections ────────────────────────────────────────────── */}
      {sections.map(sec => (
        <SectionCard
          key={sec.key}
          section={sec}
          items={sec.items}
          totalValue={sec.totalValue}
          criticalCount={sec.criticalCount}
          highCount={sec.highCount}
          expanded={expandedSection === sec.key}
          onToggle={() => toggleSection(sec.key)}
          onNavigate={onNavigateToOrder}
          now={now}
        />
      ))}

      {/* ── Other Flagged Orders ───────────────────────────────────────── */}
      {uncategorised.length > 0 && (
        <SectionCard
          section={{ key: 'other', title: 'Other Flagged', subtitle: 'Orders in other statuses with priority flags', icon: '🔍', color: 'indigo' }}
          items={uncategorised}
          totalValue={uncategorised.reduce((a, r) => a + (r.job.orderTotal || r.job.billableAmount || 0), 0)}
          criticalCount={uncategorised.filter(r => r.urgency === 'critical').length}
          highCount={uncategorised.filter(r => r.urgency === 'high').length}
          expanded={expandedSection === 'other'}
          onToggle={() => toggleSection('other')}
          onNavigate={onNavigateToOrder}
          now={now}
        />
      )}

      {/* ── Empty state ────────────────────────────────────────────────── */}
      {totalScored === 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 px-6 py-12 text-center">
          <p className="text-white/50 text-sm">No priority items found for this time frame.</p>
          <p className="text-white/25 text-xs mt-1">Try selecting a wider time range.</p>
        </div>
      )}
    </div>
  );
}

// ── Section Card Component ─────────────────────────────────────────────────
interface SectionCardProps {
  section: Pick<typeof PRIORITY_SECTIONS[number], 'key' | 'title' | 'subtitle' | 'icon' | 'color'>;
  items: PriorityResult[];
  totalValue: number;
  criticalCount: number;
  highCount: number;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (orderNum: string) => void;
  now: Date;
}

const COLOR_MAP: Record<string, { header: string; border: string; badge: string }> = {
  rose:   { header: 'text-rose-300',   border: 'border-rose-500/20',   badge: 'bg-rose-500/10 text-rose-400' },
  amber:  { header: 'text-amber-300',  border: 'border-amber-500/20',  badge: 'bg-amber-500/10 text-amber-400' },
  blue:   { header: 'text-blue-300',   border: 'border-blue-500/20',   badge: 'bg-blue-500/10 text-blue-400' },
  green:  { header: 'text-green-300',  border: 'border-green-500/20',  badge: 'bg-green-500/10 text-green-400' },
  indigo: { header: 'text-indigo-300', border: 'border-indigo-500/20', badge: 'bg-indigo-500/10 text-indigo-400' },
};

function SectionCard({ section, items, totalValue, criticalCount, highCount, expanded, onToggle, onNavigate, now }: SectionCardProps) {
  const cm = COLOR_MAP[section.color] || COLOR_MAP.indigo;

  return (
    <div className={`bg-[#1e1e3a] rounded-2xl border ${cm.border} overflow-hidden`}>
      {/* Header — always visible */}
      <button
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{section.icon}</span>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h2 className={`text-sm font-bold ${cm.header}`}>{section.title}</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${cm.badge}`}>{items.length}</span>
              {criticalCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-400 animate-pulse">{criticalCount} critical</span>
              )}
              {highCount > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-500/10 text-orange-400">{highCount} high</span>
              )}
            </div>
            <p className="text-[11px] text-white/40 mt-0.5">{section.subtitle} &middot; {fmtK(totalValue)}</p>
          </div>
        </div>
        <svg className={`w-4 h-4 text-white/30 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {/* Items table */}
      {expanded && (
        <div className="border-t border-white/5">
          {items.length === 0 ? (
            <div className="px-5 py-6 text-center text-white/30 text-xs">No orders in this category for the selected time frame.</div>
          ) : (
            <>
              {/* Column header */}
              <div className="grid grid-cols-[40px_70px_1fr_1fr_60px_100px_100px_80px_70px] gap-1 px-4 py-2 text-[9px] font-bold text-white/20 uppercase tracking-wider border-b border-white/5">
                <span>#</span><span>Order</span><span>Customer</span><span>Job Name</span><span>Score</span><span>Reason</span><span>Staff</span><span>Status</span><span className="text-right">Value</span>
              </div>
              {/* Rows */}
              <div className="divide-y divide-white/[0.03]">
                {items.map((item, i) => {
                  const us = URGENCY_STYLE[item.urgency];
                  const due = pd(item.job.dateDue) || pd(item.job.productionDueDate);
                  const dueStr = due ? `${daysBetween(due, now) > 0 ? daysBetween(due, now) + 'd ago' : due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : '—';
                  const staff = extractSP(item.job.salesPerson) || '—';
                  return (
                    <div
                      key={item.job.id}
                      className="grid grid-cols-[40px_70px_1fr_1fr_60px_100px_100px_80px_70px] gap-1 px-4 py-2.5 items-center hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => onNavigate(item.job.jobNumber)}
                    >
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${us.dot}${us.pulse}`}>{i + 1}</span>
                      <span className="text-[10px] font-mono text-indigo-400/70">#{item.job.jobNumber}</span>
                      <div className="min-w-0">
                        <span className="text-xs text-white/70 truncate block">{item.job.customerName}</span>
                        <span className="text-[9px] text-white/25 block">Due: {dueStr}</span>
                      </div>
                      <span className="text-[10px] text-white/50 truncate" title={item.job.jobName}>{item.job.jobName || '—'}</span>
                      <span className={`text-[11px] font-bold ${us.text}`}>{item.score}</span>
                      <div className="flex flex-wrap gap-0.5">
                        {item.matchedRules.slice(0, 2).map((r, ri) => (
                          <span key={ri} className={`text-[8px] px-1.5 py-0.5 rounded-full ${us.pill}`}>{r}</span>
                        ))}
                        {item.matchedRules.length > 2 && (
                          <span className="text-[8px] px-1 text-white/20">+{item.matchedRules.length - 2}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-white/40 truncate">{staff}</span>
                      <span className="text-[10px] text-white/50">{item.job.status}</span>
                      <span className="text-[10px] text-white/30 text-right">{fmtK(item.job.orderTotal || item.job.billableAmount || 0)}</span>
                    </div>
                  );
                })}
              </div>

              {/* Section footer summary */}
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
