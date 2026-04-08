import React, { useState, useMemo } from 'react';
import type { DecoJob, UnifiedOrder } from '../types';

interface Props {
  decoJobs: DecoJob[];
  orders: UnifiedOrder[];
  onNavigateToOrder: (orderNum: string) => void;
}

const isCancelled = (j: DecoJob) =>
  (j.status || '').toLowerCase() === 'cancelled' || j.paymentStatus === '7';

const parseDate = (d?: string) => (d ? new Date(d) : null);

const formatCurrency = (n: number) =>
  '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dayLabel = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const STATUS_ORDER = [
  'Awaiting Processing',
  'Not Ordered',
  'Awaiting Stock',
  'Awaiting Artwork',
  'Awaiting Review',
  'On Hold',
  'In Production',
  'Ready for Shipping',
  'Completed',
];

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  'Awaiting Processing': { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400' },
  'Not Ordered':         { bg: 'bg-rose-500/15', text: 'text-rose-400', dot: 'bg-rose-400' },
  'Awaiting Stock':      { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
  'Awaiting Artwork':    { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-400' },
  'Awaiting Review':     { bg: 'bg-cyan-500/15', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  'On Hold':             { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-400' },
  'In Production':       { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  'Ready for Shipping':  { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400' },
  'Completed':           { bg: 'bg-teal-500/15', text: 'text-teal-400', dot: 'bg-teal-400' },
};

const defaultColor = { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-400' };

const daysOverdueFn = (j: DecoJob, now: Date) => {
  const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
  if (!due) return 0;
  return Math.ceil((now.getTime() - due.getTime()) / 86400000);
};

export default function MorningBriefing({ decoJobs, orders, onNavigateToOrder }: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    attention: true,
    pipeline: true,
    schedule: false,
    blockers: false,
    activity: false,
  });
  const [expandedStatus, setExpandedStatus] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const toggleSection = (key: string) =>
    setExpandedSections(s => ({ ...s, [key]: !s[key] }));

  const now = useMemo(() => new Date(), []);

  const data = useMemo(() => {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setHours(23, 59, 59, 999);

    // Week = Mon-Fri of this week
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() + mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 4); // Friday
    weekEnd.setHours(23, 59, 59, 999);

    const live = decoJobs.filter(j => !isCancelled(j));
    const shipped = live.filter(j => (j.status || '').toLowerCase() === 'shipped');
    const active = live.filter(j => {
      const s = (j.status || '').toLowerCase();
      return s !== 'shipped' && s !== 'completed';
    });

    // Pipeline by status
    const pipeline: Record<string, DecoJob[]> = {};
    active.forEach(j => {
      const s = j.status || 'Unknown';
      if (!pipeline[s]) pipeline[s] = [];
      pipeline[s].push(j);
    });

    // Overdue: active jobs with ship/due date in the past
    const overdue = active.filter(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      return due && due < todayStart;
    }).sort((a, b) => {
      const da = parseDate(a.dateDue) || parseDate(a.productionDueDate);
      const db = parseDate(b.dateDue) || parseDate(b.productionDueDate);
      return (da?.getTime() || 0) - (db?.getTime() || 0); // Oldest first
    });

    // At risk: ship date within next 48h but not in production/ready
    const in48h = new Date(todayStart);
    in48h.setDate(in48h.getDate() + 2);
    in48h.setHours(23, 59, 59, 999);
    const earlyStatuses = new Set([
      'awaiting processing', 'not ordered', 'awaiting stock',
      'awaiting artwork', 'awaiting review', 'on hold',
    ]);
    const atRisk = active.filter(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      if (!due || due < todayStart || due > in48h) return false;
      return earlyStatuses.has((j.status || '').toLowerCase());
    }).sort((a, b) => {
      const da = parseDate(a.dateDue) || parseDate(a.productionDueDate);
      const db = parseDate(b.dateDue) || parseDate(b.productionDueDate);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });

    // This week's schedule: active jobs with ship date Mon-Fri
    const weekDays: { date: Date; label: string; jobs: DecoJob[] }[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dEnd = new Date(d);
      dEnd.setHours(23, 59, 59, 999);
      const dayJobs = active.filter(j => {
        const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
        return due && due >= d && due <= dEnd;
      });
      weekDays.push({ date: d, label: dayLabel(d), jobs: dayJobs });
    }

    // Shipping today
    const shippingToday = active.filter(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      return due && due >= todayStart && due <= todayEnd;
    });

    // New orders (last 24h)
    const newOrders = live.filter(j => {
      const ordered = parseDate(j.dateOrdered);
      return ordered && ordered >= yesterdayStart;
    });

    // Shipped yesterday
    const shippedYesterday = shipped.filter(j => {
      const sd = parseDate(j.dateShipped);
      return sd && sd >= yesterdayStart && sd <= yesterdayEnd;
    });

    // Completed yesterday (status changed to Completed)
    const completedYesterday = live.filter(j => {
      const s = (j.status || '').toLowerCase();
      return s === 'completed';
    }).filter(j => {
      // Use dateShipped or production date as proxy
      const d = parseDate(j.dateShipped) || parseDate(j.productionDueDate);
      return d && d >= yesterdayStart && d <= yesterdayEnd;
    });

    // Pipeline value totals by status
    const pipelineValues: Record<string, { count: number; value: number }> = {};
    Object.entries(pipeline).forEach(([status, jobs]) => {
      pipelineValues[status] = {
        count: jobs.length,
        value: jobs.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0),
      };
    });

    // Blockers: Not Ordered + Awaiting Stock + Awaiting Artwork
    const blockerStatuses = ['Not Ordered', 'Awaiting Stock', 'Awaiting Artwork', 'On Hold'];
    const blockers: Record<string, DecoJob[]> = {};
    blockerStatuses.forEach(s => {
      if (pipeline[s]?.length) blockers[s] = pipeline[s];
    });

    // Total pipeline value
    const totalPipelineValue = active.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);

    // Outstanding balance
    const totalOutstanding = active.reduce((s, j) => s + (j.outstandingBalance || 0), 0);

    return {
      active,
      overdue,
      atRisk,
      pipeline,
      pipelineValues,
      weekDays,
      shippingToday,
      newOrders,
      shippedYesterday,
      completedYesterday,
      blockers,
      totalPipelineValue,
      totalOutstanding,
      totalActive: active.length,
    };
  }, [decoJobs, now]);

  // ─── AI NARRATIVE ENGINE ───
  const briefing = useMemo(() => {
    const d = data;
    const issues: { icon: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string }[] = [];
    const positives: { icon: string; title: string; detail: string }[] = [];
    const actions: { priority: 'high' | 'medium' | 'low'; action: string }[] = [];

    // ── ISSUES ──

    // Overdue analysis
    if (d.overdue.length > 0) {
      const worst = d.overdue[0];
      const worstDays = daysOverdueFn(worst, now);
      const overdueValue = d.overdue.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
      const uniqueCustomers = new Set(d.overdue.map(j => j.customerName)).size;
      issues.push({
        icon: '🚨',
        severity: d.overdue.length > 5 ? 'critical' : 'warning',
        title: `${d.overdue.length} order${d.overdue.length !== 1 ? 's are' : ' is'} past the scheduled ship date`,
        detail: `The most overdue is #${worst.jobNumber} for ${worst.customerName}, now ${worstDays} day${worstDays !== 1 ? 's' : ''} late. ` +
          `These overdue orders span ${uniqueCustomers} customer${uniqueCustomers !== 1 ? 's' : ''} and represent ${formatCurrency(overdueValue)} in pipeline value. ` +
          (d.overdue.length > 10 ? 'This is a significant backlog that needs urgent attention from the team.' :
           d.overdue.length > 3 ? 'Prioritise getting these cleared today where possible.' :
           'These should be manageable to resolve today.'),
      });
      actions.push({ priority: 'high', action: `Follow up on ${d.overdue.length} overdue order${d.overdue.length !== 1 ? 's' : ''}, starting with #${worst.jobNumber} (${worst.customerName})` });
    }

    // At risk analysis
    if (d.atRisk.length > 0) {
      const blockedRisk = d.atRisk.filter(j => {
        const s = (j.status || '').toLowerCase();
        return s === 'awaiting stock' || s === 'not ordered';
      });
      issues.push({
        icon: '⏰',
        severity: d.atRisk.length > 3 ? 'warning' : 'info',
        title: `${d.atRisk.length} order${d.atRisk.length !== 1 ? 's' : ''} due in the next 48 hours ${d.atRisk.length !== 1 ? 'are' : 'is'} not in production yet`,
        detail: (blockedRisk.length > 0
          ? `${blockedRisk.length} of these ${blockedRisk.length !== 1 ? 'are' : 'is'} waiting on stock or purchase orders, so ${blockedRisk.length !== 1 ? 'they' : 'it'} cannot progress until that is resolved. `
          : '') +
          `If these orders miss their ship date, they will become overdue. Check with production whether any can be fast-tracked.`,
      });
      if (blockedRisk.length > 0) {
        actions.push({ priority: 'high', action: `Chase stock/PO for ${blockedRisk.length} at-risk order${blockedRisk.length !== 1 ? 's' : ''} due within 48 hours` });
      }
    }

    // Blocker bottleneck analysis
    const blockerEntries = Object.entries(d.blockers);
    if (blockerEntries.length > 0) {
      const totalBlocked = blockerEntries.reduce((s, [, jobs]) => s + jobs.length, 0);
      const blockedValue = blockerEntries.reduce((s, [, jobs]) => s + jobs.reduce((t, j) => t + (j.orderTotal || j.billableAmount || 0), 0), 0);
      const biggest = blockerEntries.sort((a, b) => b[1].length - a[1].length)[0];
      issues.push({
        icon: '🔒',
        severity: totalBlocked > 30 ? 'critical' : totalBlocked > 10 ? 'warning' : 'info',
        title: `${totalBlocked} orders worth ${formatCurrency(blockedValue)} are currently blocked`,
        detail: `The biggest bottleneck is "${biggest[0]}" with ${biggest[1].length} order${biggest[1].length !== 1 ? 's' : ''}. ` +
          (biggest[0] === 'Awaiting Stock' ? 'Check supplier delivery dates and whether any alternative stock sources are available. ' :
           biggest[0] === 'Not Ordered' ? 'These need purchase orders raised. Check if any can be consolidated into bulk orders for better pricing. ' :
           biggest[0] === 'Awaiting Artwork' ? 'Chase artwork approvals from customers. Consider sending reminder emails today. ' :
           biggest[0] === 'On Hold' ? 'Review whether any held orders can now be released. ' : '') +
          `Until these are unblocked, they cannot enter production.`,
      });
      if (biggest[0] === 'Not Ordered') {
        actions.push({ priority: 'high', action: `Raise purchase orders for ${biggest[1].length} "Not Ordered" jobs` });
      }
      if (biggest[0] === 'Awaiting Stock') {
        actions.push({ priority: 'medium', action: `Check supplier ETAs for ${biggest[1].length} orders waiting on stock` });
      }
    }

    // Heavy shipping day warning
    if (d.shippingToday.length > 8) {
      issues.push({
        icon: '📦',
        severity: 'info',
        title: `Heavy shipping day: ${d.shippingToday.length} orders are due out today`,
        detail: `That is above a typical day. Make sure the shipping team is aware and has capacity. Prioritise orders with the earliest cut-off times.`,
      });
    }

    // Pipeline concentration risk
    const inProd = d.pipelineValues['In Production']?.count || 0;
    const readyToShip = d.pipelineValues['Ready for Shipping']?.count || 0;
    if (inProd === 0 && d.totalActive > 10) {
      issues.push({
        icon: '⚠️',
        severity: 'warning',
        title: 'Nothing is currently in production',
        detail: `There are ${d.totalActive} active orders but none are in the "In Production" stage. This may indicate a gap in the production schedule that could cause delays later in the week.`,
      });
    }

    // ── POSITIVES ──

    if (d.shippedYesterday.length > 0) {
      const shippedValue = d.shippedYesterday.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
      positives.push({
        icon: '🚚',
        title: `${d.shippedYesterday.length} order${d.shippedYesterday.length !== 1 ? 's' : ''} shipped yesterday`,
        detail: shippedValue > 0
          ? `Worth a combined ${formatCurrency(shippedValue)}. Great work getting those out the door.`
          : 'Good throughput from the shipping team.',
      });
    }

    if (d.newOrders.length > 0) {
      const newValue = d.newOrders.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
      positives.push({
        icon: '📈',
        title: `${d.newOrders.length} new order${d.newOrders.length !== 1 ? 's' : ''} received in the last 24 hours`,
        detail: newValue > 0
          ? `Bringing in ${formatCurrency(newValue)} of new business.${d.newOrders.length > 5 ? ' Strong day for incoming orders.' : ''}`
          : 'New business coming through the pipeline.',
      });
    }

    if (readyToShip > 0) {
      const readyValue = d.pipelineValues['Ready for Shipping']?.value || 0;
      positives.push({
        icon: '✅',
        title: `${readyToShip} order${readyToShip !== 1 ? 's are' : ' is'} ready to ship`,
        detail: `Worth ${formatCurrency(readyValue)}. These are complete and just need to go out.`,
      });
    }

    if (inProd > 0) {
      const prodValue = d.pipelineValues['In Production']?.value || 0;
      positives.push({
        icon: '⚙️',
        title: `${inProd} order${inProd !== 1 ? 's' : ''} currently in production`,
        detail: `${formatCurrency(prodValue)} worth of work actively being produced. These should move to shipping once complete.`,
      });
    }

    if (d.overdue.length === 0 && d.totalActive > 0) {
      positives.push({
        icon: '🎯',
        title: 'No overdue orders today',
        detail: 'Every order is currently on track. Great job keeping on schedule.',
      });
    }

    // Week distribution insight
    const busiestDay = d.weekDays.reduce((best, day) =>
      day.jobs.length > best.jobs.length ? day : best, d.weekDays[0]);
    if (busiestDay.jobs.length > 0) {
      positives.push({
        icon: '📅',
        title: `Busiest day this week: ${busiestDay.label} with ${busiestDay.jobs.length} order${busiestDay.jobs.length !== 1 ? 's' : ''}`,
        detail: `Plan production capacity around ${busiestDay.label} to avoid a last-minute rush.`,
      });
    }

    // ── ACTIONS ──
    if (d.shippingToday.length > 0) {
      const notReady = d.shippingToday.filter(j => {
        const s = (j.status || '').toLowerCase();
        return s !== 'ready for shipping' && s !== 'completed' && s !== 'shipped';
      });
      if (notReady.length > 0) {
        actions.push({ priority: 'high', action: `${notReady.length} of today's ${d.shippingToday.length} shipments are not yet ready. Check production status.` });
      }
    }

    const awaitingArt = d.pipeline['Awaiting Artwork']?.length || 0;
    if (awaitingArt > 0) {
      actions.push({ priority: 'medium', action: `Send artwork approval reminders for ${awaitingArt} order${awaitingArt !== 1 ? 's' : ''}` });
    }

    const awaitingReview = d.pipeline['Awaiting Review']?.length || 0;
    if (awaitingReview > 0) {
      actions.push({ priority: 'low', action: `Review ${awaitingReview} order${awaitingReview !== 1 ? 's' : ''} in the review queue` });
    }

    // Summary sentence
    const summaryParts: string[] = [];
    if (d.overdue.length > 0) summaryParts.push(`${d.overdue.length} overdue`);
    if (d.atRisk.length > 0) summaryParts.push(`${d.atRisk.length} at risk`);
    if (d.shippingToday.length > 0) summaryParts.push(`${d.shippingToday.length} shipping today`);

    const overallSentiment: 'good' | 'mixed' | 'needs-attention' =
      d.overdue.length > 5 || (d.overdue.length > 0 && d.atRisk.length > 3) ? 'needs-attention' :
      d.overdue.length > 0 || d.atRisk.length > 0 ? 'mixed' : 'good';

    const summary =
      overallSentiment === 'good'
        ? `Looking good today. ${d.totalActive} active orders are all on track with no overdue items. ` +
          (d.shippingToday.length > 0 ? `${d.shippingToday.length} order${d.shippingToday.length !== 1 ? 's' : ''} ${d.shippingToday.length !== 1 ? 'are' : 'is'} due to ship today.` : 'No shipments scheduled for today.')
        : overallSentiment === 'mixed'
        ? `A mixed picture this morning. We have ${d.totalActive} active orders, ` +
          summaryParts.join(', ') + '. ' +
          'Some areas need attention but the pipeline is moving.'
        : `A busy day ahead. We have ${summaryParts.join(', ')} across ${d.totalActive} active orders. ` +
          'The team should focus on clearing the overdue backlog and unblocking any held orders.';

    return { issues, positives, actions, summary, overallSentiment };
  }, [data, now]);

  const card = 'bg-[#1e1e3a] rounded-xl border border-white/5';
  const sectionHeader = 'flex items-center justify-between cursor-pointer select-none px-5 py-4';

  const daysOverdue = (j: DecoJob) => daysOverdueFn(j, now);

  const statusBadge = (status: string) => {
    const c = STATUS_COLORS[status] || defaultColor;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.bg} ${c.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
        {status}
      </span>
    );
  };

  const jobRow = (j: DecoJob, showDue = true) => {
    const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
    const value = j.orderTotal || j.billableAmount || 0;
    return (
      <div
        key={j.id}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
        onClick={() => onNavigateToOrder(j.jobNumber)}
      >
        <span className="text-xs font-mono text-indigo-400 group-hover:text-indigo-300 w-16 shrink-0">
          #{j.jobNumber}
        </span>
        <span className="text-sm text-white/90 truncate flex-1 min-w-0">
          {j.customerName}
        </span>
        <span className="text-xs text-white/50 truncate max-w-[200px] hidden sm:block">
          {j.jobName}
        </span>
        {statusBadge(j.status || 'Unknown')}
        {showDue && due && (
          <span className="text-[11px] text-white/40 w-20 text-right shrink-0">
            {due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
          </span>
        )}
        {value > 0 && (
          <span className="text-[11px] font-medium text-emerald-400/70 w-20 text-right shrink-0">
            {formatCurrency(value)}
          </span>
        )}
      </div>
    );
  };

  const greeting = () => {
    const h = now.getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            {greeting()} — Daily Briefing
          </h1>
          <p className="text-sm text-white/40 mt-1">
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="text-right text-xs text-white/30">
          {data.totalActive} active orders
        </div>
      </div>

      {/* ─── PULSE METRICS ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <PulseCard label="Active Orders" value={String(data.totalActive)} />
        <PulseCard
          label="Shipping Today"
          value={String(data.shippingToday.length)}
          accent={data.shippingToday.length > 0 ? 'blue' : undefined}
        />
        <PulseCard
          label="Overdue"
          value={String(data.overdue.length)}
          accent={data.overdue.length > 0 ? 'red' : undefined}
        />
        <PulseCard
          label="At Risk (48h)"
          value={String(data.atRisk.length)}
          accent={data.atRisk.length > 0 ? 'amber' : undefined}
        />
        <PulseCard label="Pipeline Value" value={formatCurrency(data.totalPipelineValue)} small />
        <PulseCard label="New Orders (24h)" value={String(data.newOrders.length)} accent="green" />
      </div>

      {/* ─── AI BRIEFING NARRATIVE ─── */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-6 py-5 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                briefing.overallSentiment === 'good' ? 'bg-emerald-500/20' :
                briefing.overallSentiment === 'mixed' ? 'bg-amber-500/20' : 'bg-red-500/20'
              }`}>
                {briefing.overallSentiment === 'good' ? '✨' : briefing.overallSentiment === 'mixed' ? '📋' : '🔥'}
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Today's Intelligence Brief</h2>
                <p className="text-[11px] text-white/30">Auto-generated analysis of current operations</p>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              briefing.overallSentiment === 'good' ? 'bg-emerald-500/15 text-emerald-400' :
              briefing.overallSentiment === 'mixed' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
            }`}>
              {briefing.overallSentiment === 'good' ? 'All Clear' : briefing.overallSentiment === 'mixed' ? 'Attention Needed' : 'Action Required'}
            </div>
          </div>
          <p className="text-sm text-white/70 mt-4 leading-relaxed">{briefing.summary}</p>
        </div>

        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/5">
          {/* Issues */}
          <div className="p-5">
            <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Issues &amp; Risks ({briefing.issues.length})
            </h3>
            {briefing.issues.length === 0 ? (
              <p className="text-sm text-white/30 italic">No issues identified. Everything is running smoothly.</p>
            ) : (
              <div className="space-y-3">
                {briefing.issues.map((issue, i) => (
                  <div key={i} className={`rounded-lg p-3 ${
                    issue.severity === 'critical' ? 'bg-red-500/10 border border-red-500/20' :
                    issue.severity === 'warning' ? 'bg-amber-500/8 border border-amber-500/15' :
                    'bg-white/[0.03] border border-white/5'
                  }`}>
                    <div className="flex items-start gap-2">
                      <span className="text-sm shrink-0 mt-0.5">{issue.icon}</span>
                      <div>
                        <p className={`text-xs font-semibold ${
                          issue.severity === 'critical' ? 'text-red-400' :
                          issue.severity === 'warning' ? 'text-amber-400' : 'text-white/70'
                        }`}>{issue.title}</p>
                        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">{issue.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Positives */}
          <div className="p-5">
            <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Positive Highlights ({briefing.positives.length})
            </h3>
            {briefing.positives.length === 0 ? (
              <p className="text-sm text-white/30 italic">Quiet period. No major highlights to report.</p>
            ) : (
              <div className="space-y-3">
                {briefing.positives.map((pos, i) => (
                  <div key={i} className="rounded-lg p-3 bg-emerald-500/5 border border-emerald-500/10">
                    <div className="flex items-start gap-2">
                      <span className="text-sm shrink-0 mt-0.5">{pos.icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-emerald-400">{pos.title}</p>
                        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">{pos.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action Items */}
        {briefing.actions.length > 0 && (
          <div className="border-t border-white/5 px-6 py-4">
            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Recommended Actions
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {briefing.actions.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-white/[0.02]">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    a.priority === 'high' ? 'bg-red-400' :
                    a.priority === 'medium' ? 'bg-amber-400' : 'bg-blue-400'
                  }`} />
                  <span className="text-[11px] text-white/60 leading-relaxed">{a.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── IMMEDIATE ATTENTION ─── */}
      {(data.overdue.length > 0 || data.atRisk.length > 0) && (
        <div className={card}>
          <div className={sectionHeader} onClick={() => toggleSection('attention')}>
            <div className="flex items-center gap-3">
              <span className="text-lg">🔴</span>
              <div>
                <h2 className="text-sm font-bold text-white">Needs Attention</h2>
                <p className="text-[11px] text-white/40">
                  {data.overdue.length} overdue · {data.atRisk.length} at risk
                </p>
              </div>
            </div>
            <ChevronIcon open={expandedSections.attention} />
          </div>
          {expandedSections.attention && (
            <div className="px-5 pb-4 space-y-4">
              {data.overdue.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    Overdue — Past Ship Date
                  </h3>
                  <div className="space-y-0.5">
                    {data.overdue.slice(0, 15).map(j => (
                      <div
                        key={j.id}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
                        onClick={() => onNavigateToOrder(j.jobNumber)}
                      >
                        <span className="text-xs font-mono text-indigo-400 w-16 shrink-0">
                          #{j.jobNumber}
                        </span>
                        <span className="text-sm text-white/90 truncate flex-1 min-w-0">
                          {j.customerName}
                        </span>
                        {statusBadge(j.status || 'Unknown')}
                        <span className="text-xs font-bold text-red-400 w-24 text-right">
                          {daysOverdue(j)} day{daysOverdue(j) !== 1 ? 's' : ''} late
                        </span>
                      </div>
                    ))}
                    {data.overdue.length > 15 && (
                      <p className="text-xs text-white/30 px-4 pt-2">
                        + {data.overdue.length - 15} more overdue orders
                      </p>
                    )}
                  </div>
                </div>
              )}
              {data.atRisk.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    At Risk — Ship Date Within 48 Hours
                  </h3>
                  <div className="space-y-0.5">
                    {data.atRisk.map(j => jobRow(j))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── PRODUCTION PIPELINE ─── */}
      <div className={card}>
        <div className={sectionHeader} onClick={() => toggleSection('pipeline')}>
          <div className="flex items-center gap-3">
            <span className="text-lg">📊</span>
            <div>
              <h2 className="text-sm font-bold text-white">Production Pipeline</h2>
              <p className="text-[11px] text-white/40">
                {data.totalActive} orders across {Object.keys(data.pipeline).length} stages
              </p>
            </div>
          </div>
          <ChevronIcon open={expandedSections.pipeline} />
        </div>
        {expandedSections.pipeline && (
          <div className="px-5 pb-5 space-y-2">
            {/* Visual pipeline bar */}
            <div className="flex rounded-lg overflow-hidden h-8 mb-4">
              {STATUS_ORDER.filter(s => data.pipelineValues[s]).map(status => {
                const pv = data.pipelineValues[status];
                const pct = (pv.count / data.totalActive) * 100;
                if (pct < 1) return null;
                const c = STATUS_COLORS[status] || defaultColor;
                return (
                  <div
                    key={status}
                    className={`${c.bg} flex items-center justify-center transition-all cursor-pointer hover:brightness-125 border-r border-black/20 last:border-0`}
                    style={{ width: `${Math.max(pct, 4)}%` }}
                    onClick={() => setExpandedStatus(expandedStatus === status ? null : status)}
                    title={`${status}: ${pv.count} orders (${formatCurrency(pv.value)})`}
                  >
                    {pct > 8 && (
                      <span className={`text-[10px] font-bold ${c.text} truncate px-1`}>
                        {pv.count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Status rows */}
            {STATUS_ORDER.filter(s => data.pipelineValues[s]).map(status => {
              const pv = data.pipelineValues[status];
              const c = STATUS_COLORS[status] || defaultColor;
              const isExpanded = expandedStatus === status;
              const jobs = data.pipeline[status] || [];
              return (
                <div key={status}>
                  <div
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors ${isExpanded ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                    onClick={() => setExpandedStatus(isExpanded ? null : status)}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                    <span className={`text-sm font-semibold ${c.text} flex-1`}>
                      {status}
                    </span>
                    <span className="text-sm font-bold text-white/80 w-12 text-right">
                      {pv.count}
                    </span>
                    <span className="text-xs text-white/40 w-28 text-right">
                      {formatCurrency(pv.value)}
                    </span>
                    <ChevronIcon open={isExpanded} />
                  </div>
                  {isExpanded && (
                    <div className="ml-6 mt-1 mb-2 space-y-0.5 border-l-2 border-white/5 pl-3">
                      {jobs
                        .sort((a, b) => {
                          const da = parseDate(a.dateDue) || parseDate(a.productionDueDate);
                          const db = parseDate(b.dateDue) || parseDate(b.productionDueDate);
                          return (da?.getTime() || 0) - (db?.getTime() || 0);
                        })
                        .slice(0, 20)
                        .map(j => jobRow(j, true))}
                      {jobs.length > 20 && (
                        <p className="text-xs text-white/30 px-4 pt-1">
                          + {jobs.length - 20} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── THIS WEEK'S SHIP SCHEDULE ─── */}
      <div className={card}>
        <div className={sectionHeader} onClick={() => toggleSection('schedule')}>
          <div className="flex items-center gap-3">
            <span className="text-lg">📅</span>
            <div>
              <h2 className="text-sm font-bold text-white">This Week's Ship Schedule</h2>
              <p className="text-[11px] text-white/40">
                {data.weekDays.reduce((s, d) => s + d.jobs.length, 0)} orders due this week
              </p>
            </div>
          </div>
          <ChevronIcon open={expandedSections.schedule} />
        </div>
        {expandedSections.schedule && (
          <div className="px-5 pb-5">
            <div className="grid grid-cols-5 gap-2">
              {data.weekDays.map(day => {
                const isToday =
                  day.date.toDateString() === now.toDateString();
                const isPast = day.date < now && !isToday;
                const hasOverdue = day.jobs.some(j => {
                  const s = (j.status || '').toLowerCase();
                  return s !== 'shipped' && s !== 'completed' && s !== 'ready for shipping' && s !== 'in production';
                });
                return (
                  <div
                    key={day.label}
                    className={`rounded-xl border transition-colors cursor-pointer ${
                      isToday
                        ? 'border-indigo-500/50 bg-indigo-500/10'
                        : isPast
                        ? 'border-white/5 bg-white/[0.02] opacity-60'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                    onClick={() => setExpandedDay(expandedDay === day.label ? null : day.label)}
                  >
                    <div className="px-3 py-2 border-b border-white/5">
                      <div className={`text-xs font-bold ${isToday ? 'text-indigo-400' : 'text-white/60'}`}>
                        {day.label}
                        {isToday && <span className="ml-1 text-[9px] text-indigo-300">(Today)</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-lg font-black ${day.jobs.length > 0 ? 'text-white' : 'text-white/20'}`}>
                          {day.jobs.length}
                        </span>
                        {hasOverdue && <span className="w-2 h-2 rounded-full bg-amber-500" title="Some orders at risk" />}
                      </div>
                    </div>
                    {expandedDay === day.label && day.jobs.length > 0 && (
                      <div className="p-2 space-y-1 max-h-60 overflow-y-auto">
                        {day.jobs
                          .sort((a, b) => {
                            // Ready/in production first, blocked last
                            const priority = (s: string) => {
                              const sl = s.toLowerCase();
                              if (sl === 'ready for shipping' || sl === 'shipped') return 0;
                              if (sl === 'in production' || sl === 'completed') return 1;
                              return 2;
                            };
                            return priority(a.status || '') - priority(b.status || '');
                          })
                          .map(j => (
                            <div
                              key={j.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer"
                              onClick={e => { e.stopPropagation(); onNavigateToOrder(j.jobNumber); }}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${(STATUS_COLORS[j.status || ''] || defaultColor).dot}`} />
                              <span className="text-[10px] text-white/70 truncate">{j.customerName}</span>
                            </div>
                          ))}
                      </div>
                    )}
                    {day.jobs.length === 0 && (
                      <div className="px-3 py-3 text-[10px] text-white/20 italic">No orders due</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ─── WHAT'S BLOCKING US ─── */}
      {Object.keys(data.blockers).length > 0 && (
        <div className={card}>
          <div className={sectionHeader} onClick={() => toggleSection('blockers')}>
            <div className="flex items-center gap-3">
              <span className="text-lg">⚠️</span>
              <div>
                <h2 className="text-sm font-bold text-white">What's Blocking Us</h2>
                <p className="text-[11px] text-white/40">
                  {Object.values(data.blockers).reduce((s, j) => s + j.length, 0)} orders waiting on action
                </p>
              </div>
            </div>
            <ChevronIcon open={expandedSections.blockers} />
          </div>
          {expandedSections.blockers && (
            <div className="px-5 pb-5 space-y-4">
              {Object.entries(data.blockers).map(([status, jobs]) => {
                const c = STATUS_COLORS[status] || defaultColor;
                // Sort by ship date (most urgent first)
                const sorted = [...jobs].sort((a, b) => {
                  const da = parseDate(a.dateDue) || parseDate(a.productionDueDate);
                  const db = parseDate(b.dateDue) || parseDate(b.productionDueDate);
                  return (da?.getTime() || Infinity) - (db?.getTime() || Infinity);
                });
                return (
                  <div key={status}>
                    <h3 className={`text-xs font-semibold ${c.text} uppercase tracking-wider mb-2 flex items-center gap-2`}>
                      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                      {status}
                      <span className="text-white/30 normal-case">({jobs.length} orders · {formatCurrency(jobs.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0))})</span>
                    </h3>
                    <div className="space-y-0.5">
                      {sorted.slice(0, 10).map(j => jobRow(j))}
                      {sorted.length > 10 && (
                        <p className="text-xs text-white/30 px-4 pt-1">
                          + {sorted.length - 10} more
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── YESTERDAY'S ACTIVITY ─── */}
      <div className={card}>
        <div className={sectionHeader} onClick={() => toggleSection('activity')}>
          <div className="flex items-center gap-3">
            <span className="text-lg">✅</span>
            <div>
              <h2 className="text-sm font-bold text-white">Yesterday's Activity</h2>
              <p className="text-[11px] text-white/40">
                {data.shippedYesterday.length} shipped · {data.newOrders.length} new orders received
              </p>
            </div>
          </div>
          <ChevronIcon open={expandedSections.activity} />
        </div>
        {expandedSections.activity && (
          <div className="px-5 pb-5 space-y-4">
            {data.shippedYesterday.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Shipped
                </h3>
                <div className="space-y-0.5">
                  {data.shippedYesterday.map(j => jobRow(j, false))}
                </div>
              </div>
            )}
            {data.newOrders.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  New Orders Received
                </h3>
                <div className="space-y-0.5">
                  {data.newOrders.slice(0, 15).map(j => jobRow(j))}
                  {data.newOrders.length > 15 && (
                    <p className="text-xs text-white/30 px-4 pt-1">
                      + {data.newOrders.length - 15} more
                    </p>
                  )}
                </div>
              </div>
            )}
            {data.shippedYesterday.length === 0 && data.newOrders.length === 0 && (
              <p className="text-sm text-white/30 italic px-4">No activity recorded yesterday</p>
            )}
          </div>
        )}
      </div>

      {/* ─── CUSTOMER SNAPSHOT ─── */}
      <CustomerSnapshot decoJobs={data.active} onNavigateToOrder={onNavigateToOrder} />
    </div>
  );
}

/* ─── Sub-components ─── */

function PulseCard({ label, value, accent, small }: { label: string; value: string; accent?: 'red' | 'amber' | 'green' | 'blue'; small?: boolean }) {
  const accentMap = {
    red: 'border-l-red-500 text-red-400',
    amber: 'border-l-amber-500 text-amber-400',
    green: 'border-l-green-500 text-green-400',
    blue: 'border-l-blue-500 text-blue-400',
  };
  const valColor = accent ? accentMap[accent].split(' ')[1] : 'text-white';
  const borderColor = accent ? accentMap[accent].split(' ')[0] : 'border-l-indigo-500/50';
  return (
    <div className={`bg-[#1e1e3a] rounded-xl border border-white/5 border-l-4 ${borderColor} p-4`}>
      <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">{label}</div>
      <div className={`${small ? 'text-lg' : 'text-2xl'} font-black mt-1 ${valColor}`}>{value}</div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CustomerSnapshot({ decoJobs, onNavigateToOrder }: { decoJobs: DecoJob[]; onNavigateToOrder: (n: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const topCustomers = useMemo(() => {
    const map: Record<string, { name: string; count: number; value: number; overdue: number; jobs: DecoJob[] }> = {};
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    decoJobs.forEach(j => {
      const name = j.customerName || 'Unknown';
      if (!map[name]) map[name] = { name, count: 0, value: 0, overdue: 0, jobs: [] };
      map[name].count++;
      map[name].value += j.orderTotal || j.billableAmount || 0;
      map[name].jobs.push(j);
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      if (due && due < now) map[name].overdue++;
    });
    return Object.values(map)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [decoJobs]);

  if (topCustomers.length === 0) return null;

  return (
    <div className="bg-[#1e1e3a] rounded-xl border border-white/5">
      <div
        className="flex items-center justify-between cursor-pointer select-none px-5 py-4"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">👥</span>
          <div>
            <h2 className="text-sm font-bold text-white">Top Customers by Active Pipeline</h2>
            <p className="text-[11px] text-white/40">Biggest active order values right now</p>
          </div>
        </div>
        <ChevronIcon open={expanded} />
      </div>
      {expanded && (
        <div className="px-5 pb-5">
          <div className="space-y-1">
            {topCustomers.map((c, i) => (
              <div key={c.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 rounded-lg transition-colors">
                <span className="text-xs font-bold text-white/20 w-5">{i + 1}</span>
                <span className="text-sm text-white/90 flex-1 truncate">{c.name}</span>
                <span className="text-xs text-white/40">{c.count} order{c.count !== 1 ? 's' : ''}</span>
                {c.overdue > 0 && (
                  <span className="text-[10px] font-bold text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded">
                    {c.overdue} overdue
                  </span>
                )}
                <span className="text-sm font-semibold text-emerald-400 w-24 text-right">
                  {formatCurrency(c.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
