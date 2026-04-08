import React, { useState, useMemo } from 'react';
import type { DecoJob, UnifiedOrder } from '../types';

interface Props {
  decoJobs: DecoJob[];
  orders: UnifiedOrder[];
  onNavigateToOrder: (orderNum: string) => void;
}

const cancelled = (j: DecoJob) =>
  (j.status || '').toLowerCase() === 'cancelled' || j.paymentStatus === '7';
const pd = (d?: string) => (d ? new Date(d) : null);
const fmt = (n: number) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n: number) => n >= 1000 ? '£' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmt(n);
const gap = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / 86400000);
const pl = (n: number) => n !== 1 ? 's' : '';

const BLOCKED = new Set(['Not Ordered', 'Awaiting Processing', 'Awaiting Artwork', 'Awaiting Review', 'On Hold', 'Awaiting Stock']);
const PRODUCING = new Set(['In Production', 'Ready for Shipping', 'Completed']);

const FLOW = ['Not Ordered', 'Awaiting Processing', 'Awaiting Artwork', 'Awaiting Review', 'On Hold', 'Awaiting Stock', 'In Production', 'Ready for Shipping', 'Completed'];
const DOT: Record<string, string> = {
  'Not Ordered': 'bg-rose-400', 'Awaiting Processing': 'bg-blue-400', 'Awaiting Artwork': 'bg-purple-400',
  'Awaiting Review': 'bg-cyan-400', 'On Hold': 'bg-gray-400', 'Awaiting Stock': 'bg-amber-400',
  'In Production': 'bg-emerald-400', 'Ready for Shipping': 'bg-green-400', 'Completed': 'bg-teal-400', 'Shipped': 'bg-sky-400',
};
const BAR: Record<string, string> = {
  'Not Ordered': 'bg-rose-500', 'Awaiting Processing': 'bg-blue-500', 'Awaiting Artwork': 'bg-purple-500',
  'Awaiting Review': 'bg-cyan-500', 'On Hold': 'bg-gray-500', 'Awaiting Stock': 'bg-amber-500',
  'In Production': 'bg-emerald-500', 'Ready for Shipping': 'bg-green-500', 'Completed': 'bg-teal-500',
};

export default function MorningBriefing({ decoJobs, orders, onNavigateToOrder }: Props) {
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [showAllToday, setShowAllToday] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const t0 = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, [now]);

  // ── DATA ──────────────────────────────────────────────────────────────────
  const d = useMemo(() => {
    const yesterday = new Date(t0); yesterday.setDate(t0.getDate() - 1);
    const yesterdayEnd = new Date(yesterday); yesterdayEnd.setHours(23, 59, 59, 999);
    const tomorrow = new Date(t0); tomorrow.setDate(t0.getDate() + 1);
    const in48h = new Date(t0); in48h.setDate(t0.getDate() + 2); in48h.setHours(23, 59, 59, 999);
    const sevenAgo = new Date(t0); sevenAgo.setDate(t0.getDate() - 7);
    const todayEnd = new Date(t0); todayEnd.setHours(23, 59, 59, 999);

    const live = decoJobs.filter(j => !cancelled(j));
    const active = live.filter(j => {
      const st = (j.status || '').toLowerCase();
      return st !== 'shipped' && st !== 'completed';
    });
    const shipped = live.filter(j => (j.status || '').toLowerCase() === 'shipped');

    // Pipeline
    const stages: Record<string, DecoJob[]> = {};
    active.forEach(j => { const st = j.status || 'Unknown'; (stages[st] ??= []).push(j); });

    // Time analysis
    const overdue = active.filter(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      return due && due < t0;
    }).sort((a, b) => {
      const da = pd(a.dateDue) || pd(a.productionDueDate);
      const db = pd(b.dateDue) || pd(b.productionDueDate);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });

    const atRisk = active.filter(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      return due && due >= t0 && due <= in48h && BLOCKED.has(j.status || '');
    });

    const todayShip = active.filter(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      return due && due >= t0 && due <= todayEnd;
    }).sort((a, b) => {
      const ra = BLOCKED.has(a.status || '') ? 1 : 0;
      const rb = BLOCKED.has(b.status || '') ? 1 : 0;
      return ra - rb;
    });
    const todayReady = todayShip.filter(j => !BLOCKED.has(j.status || ''));
    const todayNotReady = todayShip.filter(j => BLOCKED.has(j.status || ''));

    const newOrders = live.filter(j => {
      const ord = pd(j.dateOrdered);
      return ord && ord >= yesterday;
    });
    const shippedYesterday = shipped.filter(j => {
      const sd = pd(j.dateShipped);
      return sd && sd >= yesterday && sd <= yesterdayEnd;
    });

    // Throughput
    const shipped7d = shipped.filter(j => {
      const sd = pd(j.dateShipped);
      return sd && sd >= sevenAgo;
    });
    const cycleTimes = shipped7d.map(j => {
      const o = pd(j.dateOrdered), s = pd(j.dateShipped);
      return o && s ? gap(o, s) : null;
    }).filter((v): v is number => v !== null && v >= 0);
    const avgCycle = cycleTimes.length > 0
      ? (cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length).toFixed(1) : null;

    // Week schedule
    const dow = now.getDay();
    const monOff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(t0); mon.setDate(mon.getDate() + monOff);
    const weekDays = Array.from({ length: 5 }, (_, i) => {
      const day = new Date(mon); day.setDate(day.getDate() + i);
      const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
      const jobs = active.filter(j => {
        const due = pd(j.dateDue) || pd(j.productionDueDate);
        return due && due >= day && due <= dayEnd;
      });
      return {
        date: day,
        label: day.toLocaleDateString('en-GB', { weekday: 'short' }),
        num: day.getDate(),
        isToday: day.toDateString() === now.toDateString(),
        isPast: day < t0 && day.toDateString() !== now.toDateString(),
        total: jobs.length,
        ready: jobs.filter(j => !BLOCKED.has(j.status || '')).length,
        notReady: jobs.filter(j => BLOCKED.has(j.status || '')).length,
        jobs,
      };
    });

    // Key values
    const pipelineVal = active.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
    const overdueVal = overdue.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
    const shippedYestVal = shippedYesterday.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
    const newVal = newOrders.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
    const producing = active.filter(j => PRODUCING.has(j.status || '')).length;
    const waiting = active.filter(j => BLOCKED.has(j.status || '')).length;

    // Blockers grouped by stage
    const blockers = ['Not Ordered', 'Awaiting Artwork', 'Awaiting Stock', 'On Hold'].map(st => ({
      stage: st,
      jobs: stages[st] || [],
      value: (stages[st] || []).reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0),
    })).filter(b => b.jobs.length > 0);

    // Stock dispatch ready from Shopify
    const stockReady = orders.filter(o =>
      o.shopify.fulfillmentStatus !== 'fulfilled' && o.isStockDispatchReady
    );

    return {
      active, stages, overdue, atRisk, todayShip, todayReady, todayNotReady,
      newOrders, shippedYesterday, shipped7d, avgCycle, weekDays,
      pipelineVal, overdueVal, shippedYestVal, newVal,
      producing, waiting, blockers, stockReady,
    };
  }, [decoJobs, orders, now, t0]);

  // ── Build action items (the "do this first" list) ─────────────────────────
  const doFirst = useMemo(() => {
    const items: { urgency: 'red' | 'amber' | 'green'; text: string; sub: string; jobNum?: string }[] = [];

    // Overdue: list each one (max 5, then summarise)
    d.overdue.slice(0, 3).forEach(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      const daysLate = due ? gap(due, now) : 0;
      items.push({
        urgency: 'red',
        text: `#${j.jobNumber} ${j.customerName}`,
        sub: `${daysLate}d overdue · ${j.status} · ${fmtK(j.orderTotal || j.billableAmount || 0)}`,
        jobNum: j.jobNumber,
      });
    });
    if (d.overdue.length > 3) {
      items.push({
        urgency: 'red',
        text: `+ ${d.overdue.length - 3} more overdue order${pl(d.overdue.length - 3)}`,
        sub: `${fmtK(d.overdueVal)} total overdue value`,
      });
    }

    // At-risk (due in 48h, still blocked)
    d.atRisk.slice(0, 3).forEach(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      const dueStr = due ? due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      items.push({
        urgency: 'amber',
        text: `#${j.jobNumber} ${j.customerName}`,
        sub: `Due ${dueStr} · Still at ${j.status}`,
        jobNum: j.jobNumber,
      });
    });
    if (d.atRisk.length > 3) {
      items.push({ urgency: 'amber', text: `+ ${d.atRisk.length - 3} more at-risk`, sub: 'Due within 48 hours, not ready' });
    }

    // Not ready for today's shipments
    if (d.todayNotReady.length > 0) {
      items.push({
        urgency: 'amber',
        text: `${d.todayNotReady.length} of today's ${d.todayShip.length} shipments not ready`,
        sub: d.todayNotReady.map(j => `#${j.jobNumber} (${j.status})`).slice(0, 3).join(', '),
      });
    }

    // Not Ordered (POs needed)
    const notOrd = d.stages['Not Ordered'];
    if (notOrd?.length) {
      items.push({
        urgency: 'amber',
        text: `${notOrd.length} job${pl(notOrd.length)} still Not Ordered`,
        sub: `Purchase orders needed · ${fmtK(notOrd.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0))}`,
      });
    }

    // Stock ready to dispatch
    if (d.stockReady.length > 0) {
      items.push({
        urgency: 'green',
        text: `${d.stockReady.length} order${pl(d.stockReady.length)} ready to dispatch`,
        sub: 'Stock items produced — fulfil in Shopify',
      });
    }

    return items;
  }, [d, now]);

  // ── Sentiment ─────────────────────────────────────────────────────────────
  const sentiment: 'green' | 'amber' | 'red' =
    d.overdue.length > 10 || (d.overdue.length > 0 && d.atRisk.length > 3) ? 'red' :
    d.overdue.length > 0 || d.atRisk.length > 0 || d.todayNotReady.length > 0 ? 'amber' : 'green';

  const sentimentLine = sentiment === 'green'
    ? `All ${d.active.length} active orders on track. Nothing overdue.`
    : sentiment === 'amber'
    ? [
        d.overdue.length > 0 && `${d.overdue.length} overdue (${fmtK(d.overdueVal)})`,
        d.atRisk.length > 0 && `${d.atRisk.length} at risk`,
        d.todayNotReady.length > 0 && `${d.todayNotReady.length} not ready for today`,
      ].filter(Boolean).join(' · ')
    : `${d.overdue.length} orders overdue worth ${fmtK(d.overdueVal)} — needs immediate attention`;

  // ── RENDER ────────────────────────────────────────────────────────────────
  const hr = now.getHours();
  const greet = hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-12">

      {/* ═══ STATUS HERO ═══ */}
      <div className={`relative rounded-2xl overflow-hidden border ${
        sentiment === 'green' ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-600/5 to-transparent' :
        sentiment === 'amber' ? 'border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-orange-600/5 to-transparent' :
        'border-red-500/30 bg-gradient-to-br from-red-500/15 via-rose-600/5 to-transparent'
      }`}>
        <div className="px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">{greet}</h1>
              <p className="text-xs text-white/35 mt-0.5">
                {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
              sentiment === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
              sentiment === 'amber' ? 'bg-amber-500/20 text-amber-400' :
              'bg-red-500/20 text-red-400'
            }`}>
              {sentiment === 'green' ? 'All Clear' : sentiment === 'amber' ? 'Needs Attention' : 'Action Required'}
            </div>
          </div>

          <p className={`text-base font-semibold mb-5 ${
            sentiment === 'green' ? 'text-emerald-300' : sentiment === 'amber' ? 'text-amber-300' : 'text-red-300'
          }`}>
            {sentimentLine}
          </p>

          {/* Key numbers — compact row, not 6 separate cards */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Stat label="Active" value={d.active.length} />
            <Stat label="Shipping today" value={d.todayShip.length} warn={d.todayNotReady.length > 0} />
            <Stat label="In production" value={d.producing} good />
            <Stat label="Blocked" value={d.waiting} warn={d.waiting > d.producing} />
            {d.shippedYesterday.length > 0 && <Stat label="Shipped yesterday" value={d.shippedYesterday.length} />}
            {d.newOrders.length > 0 && <Stat label="New orders" value={d.newOrders.length} good />}
            {d.avgCycle && <Stat label="Avg turnaround" value={`${d.avgCycle}d`} />}
          </div>
        </div>
      </div>

      {/* ═══ DO FIRST ═══ */}
      {doFirst.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5">
            <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Do First</h2>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {doFirst.map((item, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-5 py-3 ${item.jobNum ? 'cursor-pointer hover:bg-white/[0.04]' : ''} transition-colors`}
                onClick={item.jobNum ? () => onNavigateToOrder(item.jobNum!) : undefined}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  item.urgency === 'red' ? 'bg-red-400' : item.urgency === 'amber' ? 'bg-amber-400' : 'bg-emerald-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/90 font-medium truncate">{item.text}</p>
                  <p className="text-[11px] text-white/40 truncate">{item.sub}</p>
                </div>
                {item.jobNum && (
                  <svg className="w-4 h-4 text-white/20 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ TWO-COLUMN: WEEK + PIPELINE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* LEFT: This Week + Today's Shipments */}
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">This Week</h2>
            <span className="text-[10px] text-white/25">{d.weekDays.reduce((s, w) => s + w.total, 0)} due this week</span>
          </div>

          {/* Week strip — always visible, no chevron */}
          <div className="grid grid-cols-5 gap-0 border-b border-white/5">
            {d.weekDays.map(day => (
              <div
                key={day.label}
                className={`text-center py-3 cursor-pointer transition-colors ${
                  day.isToday ? 'bg-indigo-500/10' :
                  day.isPast ? 'opacity-40' : 'hover:bg-white/[0.03]'
                }`}
                onClick={() => setExpandedDay(expandedDay === day.label ? null : day.label)}
              >
                <div className={`text-[10px] font-bold uppercase ${day.isToday ? 'text-indigo-400' : 'text-white/40'}`}>
                  {day.label}
                </div>
                <div className={`text-lg font-black mt-0.5 ${
                  day.total === 0 ? 'text-white/15' :
                  day.notReady > 0 ? 'text-white' : 'text-white/80'
                }`}>
                  {day.total}
                </div>
                {day.total > 0 && (
                  <div className="flex gap-0.5 justify-center mt-1.5 px-3">
                    <div className="h-1 rounded-full bg-emerald-500/50 flex-1" style={{ maxWidth: `${day.ready / day.total * 100}%` }} />
                    {day.notReady > 0 && (
                      <div className="h-1 rounded-full bg-amber-500/50 flex-1" style={{ maxWidth: `${day.notReady / day.total * 100}%` }} />
                    )}
                  </div>
                )}
                {day.notReady > 0 && (
                  <div className="text-[9px] text-amber-400 mt-1">{day.notReady} not ready</div>
                )}
              </div>
            ))}
          </div>

          {/* Expanded day */}
          {expandedDay && (() => {
            const day = d.weekDays.find(w => w.label === expandedDay);
            if (!day || day.jobs.length === 0) return null;
            return (
              <div className="border-b border-white/5 px-3 py-2 max-h-48 overflow-y-auto">
                {day.jobs.sort((a, b) => {
                  const ba = BLOCKED.has(a.status || '') ? 1 : 0;
                  const bb = BLOCKED.has(b.status || '') ? 1 : 0;
                  return ba - bb;
                }).map(j => (
                  <JobRow key={j.id} j={j} now={now} onClick={() => onNavigateToOrder(j.jobNumber)} />
                ))}
              </div>
            );
          })()}

          {/* Today's shipments — always visible */}
          {d.todayShip.length > 0 && (
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold text-white/40 uppercase tracking-wider">
                  Today's Shipments
                  {d.todayNotReady.length > 0 && (
                    <span className="text-amber-400 ml-2 normal-case">({d.todayNotReady.length} not ready)</span>
                  )}
                </h3>
                {d.todayShip.length > 5 && (
                  <button className="text-[10px] text-indigo-400 hover:text-indigo-300" onClick={() => setShowAllToday(!showAllToday)}>
                    {showAllToday ? 'Show less' : `Show all ${d.todayShip.length}`}
                  </button>
                )}
              </div>
              {(showAllToday ? d.todayShip : d.todayShip.slice(0, 5)).map(j => (
                <JobRow key={j.id} j={j} now={now} onClick={() => onNavigateToOrder(j.jobNumber)} compact />
              ))}
            </div>
          )}
          {d.todayShip.length === 0 && (
            <div className="px-5 py-4 text-sm text-white/20 italic">Nothing due today</div>
          )}
        </div>

        {/* RIGHT: Pipeline + Blockers */}
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Pipeline</h2>
            <span className="text-[10px] text-white/25">{d.active.length} active · {fmtK(d.pipelineVal)}</span>
          </div>

          {/* Flow bar — always visible */}
          <div className="px-5 pt-4 pb-2">
            <div className="flex rounded-lg overflow-hidden h-5">
              {FLOW.filter(st => d.stages[st]?.length).map(st => {
                const n = d.stages[st]!.length;
                const pct = Math.max((n / d.active.length) * 100, 2.5);
                return (
                  <div
                    key={st}
                    className={`${BAR[st] || 'bg-gray-500'}/40 flex items-center justify-center cursor-pointer hover:brightness-125 border-r border-black/20 last:border-0 transition-all`}
                    style={{ width: `${pct}%` }}
                    onClick={() => setExpandedStage(expandedStage === st ? null : st)}
                    title={`${st}: ${n}`}
                  >
                    {pct > 9 && <span className="text-[9px] font-bold text-white/70">{n}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stage list — compact, always visible */}
          <div className="px-4 pb-2">
            {FLOW.filter(st => d.stages[st]?.length).map(st => {
              const jobs = d.stages[st]!;
              const val = jobs.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
              const isBlocked = BLOCKED.has(st);
              const isOpen = expandedStage === st;
              return (
                <div key={st}>
                  <div
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${isOpen ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                    onClick={() => setExpandedStage(isOpen ? null : st)}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[st] || 'bg-gray-400'}`} />
                    <span className={`text-xs flex-1 ${isBlocked ? 'text-white/50' : 'text-white/70'} font-medium`}>{st}</span>
                    {isBlocked && <span className="text-[8px] text-white/20 uppercase">blocked</span>}
                    <span className="text-xs font-bold text-white/60 w-7 text-right">{jobs.length}</span>
                    <span className="text-[10px] text-white/25 w-14 text-right">{fmtK(val)}</span>
                    <svg className={`w-3 h-3 text-white/20 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  {isOpen && (
                    <div className="ml-5 mb-1 border-l border-white/5 pl-2 max-h-48 overflow-y-auto">
                      {jobs.sort((a, b) => {
                        const da = pd(a.dateDue) || pd(a.productionDueDate);
                        const db = pd(b.dateDue) || pd(b.productionDueDate);
                        return (da?.getTime() || 0) - (db?.getTime() || 0);
                      }).slice(0, 15).map(j => (
                        <JobRow key={j.id} j={j} now={now} onClick={() => onNavigateToOrder(j.jobNumber)} compact />
                      ))}
                      {jobs.length > 15 && <p className="text-[10px] text-white/20 py-1 pl-2">+ {jobs.length - 15} more</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Blockers summary */}
          {d.blockers.length > 0 && (
            <div className="px-5 py-3 border-t border-white/5">
              <h3 className="text-[10px] font-bold text-amber-400/60 uppercase tracking-wider mb-2">Blockers</h3>
              <div className="flex flex-wrap gap-2">
                {d.blockers.map(b => (
                  <span key={b.stage} className="text-[11px] text-white/50 bg-white/[0.04] px-2.5 py-1 rounded-lg">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${DOT[b.stage] || 'bg-gray-400'}`} />
                    {b.stage}: <span className="font-semibold text-white/70">{b.jobs.length}</span>
                    <span className="text-white/25 ml-1">({fmtK(b.value)})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ OVERDUE ═══ */}
      {d.overdue.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-red-500/15 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-xs font-bold text-red-400/80 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              Overdue ({d.overdue.length}) · {fmtK(d.overdueVal)}
            </h2>
            {d.overdue.length > 5 && (
              <button className="text-[10px] text-indigo-400 hover:text-indigo-300" onClick={() => setShowAllOverdue(!showAllOverdue)}>
                {showAllOverdue ? 'Show less' : `Show all ${d.overdue.length}`}
              </button>
            )}
          </div>
          <div className="divide-y divide-white/[0.03]">
            {(showAllOverdue ? d.overdue : d.overdue.slice(0, 5)).map(j => {
              const due = pd(j.dateDue) || pd(j.productionDueDate);
              const daysLate = due ? gap(due, now) : 0;
              return (
                <div
                  key={j.id}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/[0.04] cursor-pointer transition-colors"
                  onClick={() => onNavigateToOrder(j.jobNumber)}
                >
                  <span className={`text-xs font-bold shrink-0 w-14 text-right ${
                    daysLate > 14 ? 'text-red-400' : daysLate > 7 ? 'text-orange-400' : 'text-amber-400'
                  }`}>
                    {daysLate}d late
                  </span>
                  <span className="text-xs font-mono text-indigo-400/80 w-14 shrink-0">#{j.jobNumber}</span>
                  <span className="text-sm text-white/80 truncate flex-1 min-w-0">{j.customerName}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    BLOCKED.has(j.status || '') ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                  }`}>{j.status}</span>
                  <span className="text-xs text-white/30 w-16 text-right shrink-0">{fmtK(j.orderTotal || j.billableAmount || 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ YESTERDAY ═══ */}
      {(d.shippedYesterday.length > 0 || d.newOrders.length > 0) && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5">
            <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Yesterday</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/5">
            {d.shippedYesterday.length > 0 && (
              <div className="px-5 py-4">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-2xl font-black text-emerald-400">{d.shippedYesterday.length}</span>
                  <span className="text-xs text-white/40">shipped</span>
                  <span className="text-xs text-emerald-400/60 ml-auto">{fmtK(d.shippedYestVal)}</span>
                </div>
                <div className="space-y-0.5 mt-2">
                  {d.shippedYesterday.slice(0, 4).map(j => (
                    <div key={j.id} className="flex items-center gap-2 text-[11px] text-white/40">
                      <span className="w-1 h-1 rounded-full bg-emerald-500" />
                      <span className="truncate flex-1">{j.customerName}</span>
                      <span className="text-white/20">#{j.jobNumber}</span>
                    </div>
                  ))}
                  {d.shippedYesterday.length > 4 && (
                    <p className="text-[10px] text-white/20 pl-3">+ {d.shippedYesterday.length - 4} more</p>
                  )}
                </div>
              </div>
            )}
            {d.newOrders.length > 0 && (
              <div className="px-5 py-4">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-2xl font-black text-blue-400">{d.newOrders.length}</span>
                  <span className="text-xs text-white/40">new orders</span>
                  <span className="text-xs text-blue-400/60 ml-auto">{fmtK(d.newVal)}</span>
                </div>
                <div className="space-y-0.5 mt-2">
                  {d.newOrders.slice(0, 4).map(j => (
                    <div key={j.id} className="flex items-center gap-2 text-[11px] text-white/40">
                      <span className="w-1 h-1 rounded-full bg-blue-500" />
                      <span className="truncate flex-1">{j.customerName}</span>
                      <span className="text-white/20">{fmtK(j.orderTotal || j.billableAmount || 0)}</span>
                    </div>
                  ))}
                  {d.newOrders.length > 4 && (
                    <p className="text-[10px] text-white/20 pl-3">+ {d.newOrders.length - 4} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compact inline stat ─────────────────────────────────────────────────────
function Stat({ label, value, warn, good }: { label: string; value: number | string; warn?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-lg font-black ${warn ? 'text-amber-400' : good ? 'text-emerald-400' : 'text-white/90'}`}>
        {value}
      </span>
      <span className="text-xs text-white/35">{label}</span>
    </div>
  );
}

// ── Job row ─────────────────────────────────────────────────────────────────
function JobRow({ j, now, onClick, compact }: { j: DecoJob; now: Date; onClick: () => void; compact?: boolean }) {
  const due = pd(j.dateDue) || pd(j.productionDueDate);
  const late = due && due < now;
  const daysLate = due ? gap(due, now) : 0;
  const isBlocked = BLOCKED.has(j.status || '');

  return (
    <div
      className={`flex items-center gap-2 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} rounded hover:bg-white/5 cursor-pointer transition-colors group`}
      onClick={onClick}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[j.status || ''] || 'bg-gray-400'}`} />
      <span className="text-[10px] font-mono text-indigo-400/70 w-12 shrink-0 group-hover:text-indigo-300">#{j.jobNumber}</span>
      <span className={`text-[11px] truncate flex-1 min-w-0 ${late ? 'text-white/70' : 'text-white/55'}`}>{j.customerName}</span>
      {!compact && isBlocked && (
        <span className="text-[9px] text-amber-400/60 shrink-0">{j.status}</span>
      )}
      {late && (
        <span className={`text-[9px] font-bold shrink-0 ${daysLate > 7 ? 'text-red-400' : 'text-amber-400'}`}>{daysLate}d late</span>
      )}
      {!late && due && (
        <span className="text-[9px] text-white/20 shrink-0">{due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
      )}
    </div>
  );
}
