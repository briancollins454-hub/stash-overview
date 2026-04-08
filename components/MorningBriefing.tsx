import React, { useState, useMemo } from 'react';
import type { DecoJob, UnifiedOrder } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// MORNING BRIEFING — Operations Intelligence Dashboard
//
// Built on proven operational excellence frameworks:
// - Toyota Production System: focus on abnormalities, not normalcy
// - Theory of Constraints (Goldratt): identify the bottleneck
// - Lean Flow Efficiency: value-adding vs waiting ratio
// - Military SITREP: situation, changes, decisions, actions
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  decoJobs: DecoJob[];
  orders: UnifiedOrder[];
  onNavigateToOrder: (orderNum: string) => void;
}

const isCancelled = (j: DecoJob) =>
  (j.status || '').toLowerCase() === 'cancelled' || j.paymentStatus === '7';

const parseDate = (d?: string) => (d ? new Date(d) : null);

const fmt = (n: number) =>
  '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtK = (n: number) =>
  n >= 1000 ? '£' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmt(n);

const pct = (a: number, b: number) =>
  b === 0 ? 0 : Math.round((a / b) * 100);

const dayLabel = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const daysBetween = (a: Date, b: Date) =>
  Math.ceil((b.getTime() - a.getTime()) / 86400000);

// Production stages in flow order (left = early, right = late)
const FLOW_ORDER = [
  'Not Ordered',
  'Awaiting Processing',
  'Awaiting Artwork',
  'Awaiting Review',
  'On Hold',
  'Awaiting Stock',
  'In Production',
  'Ready for Shipping',
  'Completed',
  'Shipped',
];

const WAITING_STAGES = new Set([
  'Not Ordered', 'Awaiting Processing', 'Awaiting Artwork',
  'Awaiting Review', 'On Hold', 'Awaiting Stock',
]);

const VALUE_ADDING_STAGES = new Set([
  'In Production', 'Ready for Shipping', 'Completed',
]);

const STAGE_COLORS: Record<string, { bg: string; text: string; dot: string; bar: string }> = {
  'Not Ordered':         { bg: 'bg-rose-500/15', text: 'text-rose-400', dot: 'bg-rose-400', bar: 'bg-rose-500' },
  'Awaiting Processing': { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: 'bg-blue-400', bar: 'bg-blue-500' },
  'Awaiting Artwork':    { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-400', bar: 'bg-purple-500' },
  'Awaiting Review':     { bg: 'bg-cyan-500/15', text: 'text-cyan-400', dot: 'bg-cyan-400', bar: 'bg-cyan-500' },
  'On Hold':             { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-400', bar: 'bg-gray-500' },
  'Awaiting Stock':      { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400', bar: 'bg-amber-500' },
  'In Production':       { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400', bar: 'bg-emerald-500' },
  'Ready for Shipping':  { bg: 'bg-green-500/15', text: 'text-green-400', dot: 'bg-green-400', bar: 'bg-green-500' },
  'Completed':           { bg: 'bg-teal-500/15', text: 'text-teal-400', dot: 'bg-teal-400', bar: 'bg-teal-500' },
  'Shipped':             { bg: 'bg-sky-500/15', text: 'text-sky-400', dot: 'bg-sky-400', bar: 'bg-sky-500' },
};

const defColor = { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-400', bar: 'bg-gray-500' };

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function MorningBriefing({ decoJobs, orders, onNavigateToOrder }: Props) {
  const [openSections, setOpen] = useState<Record<string, boolean>>({ intel: true });
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [expandedCust, setExpandedCust] = useState<string | null>(null);

  const toggle = (k: string) => setOpen(s => ({ ...s, [k]: !s[k] }));
  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, [now]);

  // ─── CORE DATA ANALYSIS ───────────────────────────────────────────────────
  const analysis = useMemo(() => {
    const t0 = new Date(todayStart);
    const yesterdayStart = new Date(t0); yesterdayStart.setDate(t0.getDate() - 1);
    const yesterdayEnd = new Date(yesterdayStart); yesterdayEnd.setHours(23, 59, 59, 999);
    const in48h = new Date(t0); in48h.setDate(t0.getDate() + 2); in48h.setHours(23, 59, 59, 999);

    // Active Deco jobs (not cancelled, not shipped)
    const live = decoJobs.filter(j => !isCancelled(j));
    const active = live.filter(j => {
      const s = (j.status || '').toLowerCase();
      return s !== 'shipped' && s !== 'completed';
    });
    const shipped = live.filter(j => (j.status || '').toLowerCase() === 'shipped');

    // ── PIPELINE DISTRIBUTION ──
    const pipeline: Record<string, DecoJob[]> = {};
    active.forEach(j => {
      const s = j.status || 'Unknown';
      if (!pipeline[s]) pipeline[s] = [];
      pipeline[s].push(j);
    });

    // ── FLOW EFFICIENCY (Toyota/Lean) ──
    const inWaiting = active.filter(j => WAITING_STAGES.has(j.status || ''));
    const inValueAdding = active.filter(j => VALUE_ADDING_STAGES.has(j.status || ''));
    const flowEfficiency = active.length > 0
      ? Math.round((inValueAdding.length / active.length) * 100) : 0;

    // ── BOTTLENECK (Theory of Constraints / Goldratt) ──
    let bottleneck = { stage: '', count: 0, value: 0, avgDaysStuck: 0 };
    Object.entries(pipeline).forEach(([stage, jobs]) => {
      if (jobs.length > bottleneck.count) {
        const totalDays = jobs.reduce((s, j) => {
          const ordered = parseDate(j.dateOrdered);
          return s + (ordered ? daysBetween(ordered, now) : 0);
        }, 0);
        bottleneck = {
          stage,
          count: jobs.length,
          value: jobs.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0),
          avgDaysStuck: jobs.length > 0 ? Math.round(totalDays / jobs.length) : 0,
        };
      }
    });

    // ── TIME-BASED ANALYSIS ──
    const overdue = active.filter(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      return due && due < t0;
    }).sort((a, b) => {
      const da = parseDate(a.dateDue) || parseDate(a.productionDueDate);
      const db = parseDate(b.dateDue) || parseDate(b.productionDueDate);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });

    const atRisk = active.filter(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      if (!due || due < t0 || due > in48h) return false;
      return WAITING_STAGES.has(j.status || '');
    });

    const shippingToday = active.filter(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      return due && due >= t0 && due < new Date(t0.getTime() + 86400000);
    });

    const newOrders = live.filter(j => {
      const ordered = parseDate(j.dateOrdered);
      return ordered && ordered >= yesterdayStart;
    });

    const shippedYesterday = shipped.filter(j => {
      const sd = parseDate(j.dateShipped);
      return sd && sd >= yesterdayStart && sd <= yesterdayEnd;
    });

    // ── THROUGHPUT VELOCITY ──
    const sevenDaysAgo = new Date(t0); sevenDaysAgo.setDate(t0.getDate() - 7);
    const shippedLast7d = shipped.filter(j => {
      const sd = parseDate(j.dateShipped);
      return sd && sd >= sevenDaysAgo;
    });
    const weeklyThroughput = shippedLast7d.length;
    const dailyThroughput = weeklyThroughput > 0 ? (weeklyThroughput / 7).toFixed(1) : '0';

    // ── CYCLE TIME ANALYSIS ──
    const cycleTimes = shippedLast7d
      .map(j => {
        const ordered = parseDate(j.dateOrdered);
        const sh = parseDate(j.dateShipped);
        return ordered && sh ? daysBetween(ordered, sh) : null;
      })
      .filter((d): d is number => d !== null && d >= 0);
    const avgCycleTime = cycleTimes.length > 0
      ? (cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length).toFixed(1) : null;

    // ── OVERDUE AGING DISTRIBUTION ──
    const overdueAging = { under7: 0, under14: 0, under30: 0, over30: 0 };
    overdue.forEach(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      if (!due) return;
      const days = daysBetween(due, now);
      if (days <= 7) overdueAging.under7++;
      else if (days <= 14) overdueAging.under14++;
      else if (days <= 30) overdueAging.under30++;
      else overdueAging.over30++;
    });

    // ── CUSTOMER RISK ANALYSIS ──
    const custMap: Record<string, {
      name: string; count: number; value: number; overdue: number;
      overdueValue: number; atRisk: number; avgAge: number; statuses: Record<string, number>;
      jobs: DecoJob[];
    }> = {};
    active.forEach(j => {
      const name = j.customerName || 'Unknown';
      if (!custMap[name]) custMap[name] = {
        name, count: 0, value: 0, overdue: 0, overdueValue: 0,
        atRisk: 0, avgAge: 0, statuses: {}, jobs: [],
      };
      const c = custMap[name];
      c.count++;
      c.value += j.orderTotal || j.billableAmount || 0;
      c.jobs.push(j);
      const st = j.status || 'Unknown';
      c.statuses[st] = (c.statuses[st] || 0) + 1;
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      if (due && due < t0) {
        c.overdue++;
        c.overdueValue += j.orderTotal || j.billableAmount || 0;
      }
      if (due && due >= t0 && due <= in48h && WAITING_STAGES.has(st)) {
        c.atRisk++;
      }
      const ordered = parseDate(j.dateOrdered);
      if (ordered) c.avgAge += daysBetween(ordered, now);
    });
    Object.values(custMap).forEach(c => {
      if (c.count > 0) c.avgAge = Math.round(c.avgAge / c.count);
    });

    const customersByRisk = Object.values(custMap)
      .filter(c => c.overdue > 0 || c.atRisk > 0)
      .sort((a, b) => (b.overdueValue + b.value * 0.1) - (a.overdueValue + a.value * 0.1));

    const customersByValue = Object.values(custMap)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // ── PATTERN DETECTION ──
    const stuckCustomers = Object.values(custMap).filter(c => {
      if (c.count < 2) return false;
      const stages = Object.keys(c.statuses);
      return stages.length === 1 && WAITING_STAGES.has(stages[0]);
    });

    const longRunning = active.filter(j => {
      const ordered = parseDate(j.dateOrdered);
      return ordered && daysBetween(ordered, now) > 21;
    }).sort((a, b) => {
      const da = parseDate(a.dateOrdered) || now;
      const db = parseDate(b.dateOrdered) || now;
      return da.getTime() - db.getTime();
    });

    // ── FINANCIAL SIGNALS ──
    const totalPipelineValue = active.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
    const totalOutstanding = active.reduce((s, j) => s + (j.outstandingBalance || 0), 0);
    const overdueValue = overdue.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);
    const atRiskValue = atRisk.reduce((s, j) => s + (j.orderTotal || j.billableAmount || 0), 0);

    const top3Value = customersByValue.slice(0, 3).reduce((s, c) => s + c.value, 0);
    const concentrationPct = totalPipelineValue > 0 ? pct(top3Value, totalPipelineValue) : 0;

    // ── SHOPIFY-SIDE INTELLIGENCE ──
    const unlinkedOld = orders.filter(o =>
      o.shopify.fulfillmentStatus !== 'fulfilled' && !o.decoJobId && o.daysInProduction >= 5
    );
    const stockDispatchReady = orders.filter(o =>
      o.shopify.fulfillmentStatus !== 'fulfilled' && o.isStockDispatchReady
    );

    // ── WEEK SCHEDULE ──
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(t0);
    weekStart.setDate(weekStart.getDate() + mondayOffset);
    const weekDays: { date: Date; label: string; isToday: boolean; isPast: boolean; jobs: DecoJob[] }[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart); d.setDate(d.getDate() + i);
      const dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
      weekDays.push({
        date: d,
        label: dayLabel(d),
        isToday: d.toDateString() === now.toDateString(),
        isPast: d < t0 && d.toDateString() !== now.toDateString(),
        jobs: active.filter(j => {
          const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
          return due && due >= d && due <= dEnd;
        }),
      });
    }

    // ── NEXT WEEK PREVIEW ──
    const nextWeekStart = new Date(weekStart); nextWeekStart.setDate(nextWeekStart.getDate() + 7);
    const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekEnd.getDate() + 4);
    nextWeekEnd.setHours(23, 59, 59, 999);
    const nextWeekOrders = active.filter(j => {
      const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
      return due && due >= nextWeekStart && due <= nextWeekEnd;
    });

    return {
      active, shipped, pipeline, overdue, atRisk, shippingToday,
      newOrders, shippedYesterday, weekDays, nextWeekOrders,
      flowEfficiency, inWaiting, inValueAdding, bottleneck,
      weeklyThroughput, dailyThroughput, avgCycleTime, cycleTimes,
      overdueAging, overdueValue, atRiskValue,
      customersByRisk, customersByValue, stuckCustomers, longRunning,
      totalPipelineValue, totalOutstanding, concentrationPct,
      unlinkedOld, stockDispatchReady,
    };
  }, [decoJobs, orders, now, todayStart]);

  // ─── INTELLIGENCE ENGINE ─────────────────────────────────────────────────
  const insights = useMemo(() => {
    const a = analysis;
    const items: Insight[] = [];

    // ─── CRITICAL ALERTS ───

    if (a.overdue.length > 0) {
      const worst = a.overdue[0];
      const worstDays = daysOverdue(worst);
      const custGroups = groupBy(a.overdue, j => j.customerName);
      const topCust = Object.entries(custGroups).sort((x, y) => y[1].length - x[1].length)[0];

      items.push({
        type: 'critical',
        icon: '🚨',
        headline: `${a.overdue.length} order${s(a.overdue.length)} past ship date — ${fmt(a.overdueValue)} at risk`,
        detail: buildOverdueNarrative(a.overdue, worstDays, worst, topCust, a.overdueAging),
        metric: { label: 'Most Overdue', value: `${worstDays}d late`, sub: `#${worst.jobNumber} · ${worst.customerName}` },
        jobs: a.overdue.slice(0, 8),
      });
    }

    if (a.atRisk.length > 0) {
      const blockedTypes = groupBy(a.atRisk, j => j.status || 'Unknown');
      items.push({
        type: 'critical',
        icon: '⏰',
        headline: `${a.atRisk.length} order${s(a.atRisk.length)} due within 48 hours still in early stages`,
        detail: buildAtRiskNarrative(a.atRisk, blockedTypes),
        metric: { label: 'Revenue at Risk', value: fmtK(a.atRiskValue), sub: 'within 48 hours' },
        jobs: a.atRisk,
      });
    }

    // ─── BOTTLENECK ANALYSIS (Theory of Constraints) ───

    if (a.bottleneck.count > 0 && a.active.length > 0) {
      const pctOfPipeline = pct(a.bottleneck.count, a.active.length);
      if (pctOfPipeline >= 20) {
        items.push({
          type: 'warning',
          icon: '🔒',
          headline: `Bottleneck: "${a.bottleneck.stage}" holds ${pctOfPipeline}% of the pipeline (${a.bottleneck.count} orders)`,
          detail: buildBottleneckNarrative(a.bottleneck, a.active.length, a.pipeline),
          metric: { label: 'Bottleneck Value', value: fmtK(a.bottleneck.value), sub: a.bottleneck.stage },
        });
      }
    }

    // ─── FLOW EFFICIENCY (Lean) ───

    if (a.active.length >= 5) {
      const flowLevel = a.flowEfficiency < 15 ? 'critical' as const :
                         a.flowEfficiency < 30 ? 'warning' as const : 'positive' as const;
      items.push({
        type: flowLevel === 'positive' ? 'positive' : flowLevel,
        icon: flowLevel === 'positive' ? '✅' : '📊',
        headline: `Flow Efficiency: ${a.flowEfficiency}% — ${a.inValueAdding.length} producing, ${a.inWaiting.length} waiting`,
        detail: buildFlowNarrative(a.flowEfficiency, a.inWaiting.length, a.inValueAdding.length, a.active.length),
        metric: { label: 'Flow Efficiency', value: `${a.flowEfficiency}%`, sub: `${a.inValueAdding.length} producing / ${a.active.length} total` },
      });
    }

    // ─── PATTERN DETECTION ───

    if (a.stuckCustomers.length > 0) {
      const examples = a.stuckCustomers.slice(0, 3);
      items.push({
        type: 'warning',
        icon: '🔍',
        headline: `${a.stuckCustomers.length} customer${s(a.stuckCustomers.length)} with ALL orders stuck at one stage`,
        detail: examples.map(c => {
          const stage = Object.keys(c.statuses)[0];
          return `${c.name} has ${c.count} order${s(c.count)} all at "${stage}" (${fmt(c.value)}).`;
        }).join(' ') + (a.stuckCustomers.length > 3
          ? ` Plus ${a.stuckCustomers.length - 3} more. This pattern often indicates a single root cause like a supplier delay or missing artwork.`
          : ' This could indicate a shared blocker like a supplier issue or a pending approval.'),
      });
    }

    if (a.longRunning.length > 0) {
      const oldest = a.longRunning[0];
      const oldestDays = daysBetween(parseDate(oldest.dateOrdered)!, now);
      items.push({
        type: a.longRunning.length > 10 ? 'warning' : 'info',
        icon: '🐌',
        headline: `${a.longRunning.length} order${s(a.longRunning.length)} active for more than 3 weeks`,
        detail: `The oldest is #${oldest.jobNumber} for ${oldest.customerName}, now ${oldestDays} days old and still at "${oldest.status}". ` +
          (a.longRunning.length > 5
            ? `Long-running orders tie up resources and often indicate process gaps. Consider a focused review of the top ${Math.min(a.longRunning.length, 10)}.`
            : 'Worth checking whether these are genuinely active or should be closed/escalated.'),
        metric: { label: 'Oldest Active', value: `${oldestDays} days`, sub: `#${oldest.jobNumber}` },
        jobs: a.longRunning.slice(0, 5),
      });
    }

    // ─── UNLINKED ORDERS ───

    if (a.unlinkedOld.length > 0) {
      items.push({
        type: 'warning',
        icon: '🔗',
        headline: `${a.unlinkedOld.length} Shopify order${s(a.unlinkedOld.length)} not linked to Deco after 5+ days`,
        detail: `These orders have been in the system for at least 5 days but have no Deco job linked. ` +
          `This means they may not be in production yet. ` +
          (a.unlinkedOld.length > 5 ? 'This is a significant gap that could lead to missed deadlines.' : 'Check whether Deco jobs need to be created for these.'),
      });
    }

    // ─── FINANCIAL INTELLIGENCE ───

    if (a.concentrationPct >= 40) {
      const top3 = a.customersByValue.slice(0, 3);
      items.push({
        type: 'info',
        icon: '💰',
        headline: `Revenue concentration: Top 3 customers hold ${a.concentrationPct}% of pipeline value`,
        detail: `${top3.map(c => `${c.name} (${fmt(c.value)})`).join(', ')}. ` +
          (a.concentrationPct >= 60
            ? 'High concentration means a delay or cancellation from one of these could significantly impact the business.'
            : 'Moderate concentration — worth being aware of.'),
      });
    }

    // ─── CAPACITY SIGNALS ───

    if (a.shippingToday.length > 8) {
      items.push({
        type: 'info',
        icon: '📦',
        headline: `Heavy day: ${a.shippingToday.length} orders due to ship today`,
        detail: `This is above a typical workload. Make sure dispatch has the capacity to process these. Prioritise any orders with carrier cut-off times.`,
      });
    }

    if (a.nextWeekOrders.length > 0 && a.active.length > 0) {
      const nextWeekBlocked = a.nextWeekOrders.filter(j => WAITING_STAGES.has(j.status || ''));
      if (nextWeekBlocked.length > a.nextWeekOrders.length * 0.5 && nextWeekBlocked.length >= 3) {
        items.push({
          type: 'warning',
          icon: '📅',
          headline: `Next week risk: ${nextWeekBlocked.length} of ${a.nextWeekOrders.length} orders due next week are still waiting`,
          detail: `These orders are scheduled for next week but haven't entered production yet. ` +
            `If these aren't unblocked soon, they will become overdue. This is your early warning.`,
        });
      }
    }

    // ─── POSITIVE SIGNALS ───

    if (a.overdue.length === 0 && a.active.length > 0) {
      items.push({
        type: 'positive',
        icon: '🎯',
        headline: 'No overdue orders — every active order is on schedule',
        detail: `All ${a.active.length} active orders are currently on track. This is exactly where you want to be.`,
      });
    }

    if (a.shippedYesterday.length > 0) {
      const val = a.shippedYesterday.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
      items.push({
        type: 'positive',
        icon: '🚚',
        headline: `${a.shippedYesterday.length} order${s(a.shippedYesterday.length)} shipped yesterday (${fmt(val)})`,
        detail: a.shippedYesterday.length > 5 ? 'Strong shipping day. Good throughput from dispatch.' : 'Solid output from the team.',
      });
    }

    if (a.newOrders.length > 0) {
      const val = a.newOrders.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
      items.push({
        type: 'positive',
        icon: '📈',
        headline: `${a.newOrders.length} new order${s(a.newOrders.length)} received (${fmt(val)})`,
        detail: 'New business coming into the pipeline.',
      });
    }

    if (a.stockDispatchReady.length > 0) {
      items.push({
        type: 'positive',
        icon: '✅',
        headline: `${a.stockDispatchReady.length} order${s(a.stockDispatchReady.length)} have stock items ready to dispatch`,
        detail: 'These Shopify orders have stock items produced in Deco and awaiting fulfilment. Consider dispatching these today.',
      });
    }

    if (a.avgCycleTime !== null) {
      items.push({
        type: 'info',
        icon: '⏱️',
        headline: `Avg cycle time (last 7 days): ${a.avgCycleTime} days from order to ship`,
        detail: `Based on ${a.cycleTimes.length} orders shipped this week. ` +
          (parseFloat(a.avgCycleTime) <= 7
            ? 'This is a healthy turnaround.'
            : parseFloat(a.avgCycleTime) <= 14
            ? 'Room for improvement, but within a reasonable range.'
            : 'This is quite long. Look for process bottlenecks.'),
        metric: { label: 'Avg Cycle Time', value: `${a.avgCycleTime}d`, sub: `${a.cycleTimes.length} orders measured` },
      });
    }

    // Sort: critical first, then warning, info, positive
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
    items.sort((x, y) => order[x.type] - order[y.type]);

    return items;
  }, [analysis, now]);

  // ─── EXECUTIVE SUMMARY ────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const a = analysis;
    const criticalCount = insights.filter(i => i.type === 'critical').length;
    const warningCount = insights.filter(i => i.type === 'warning').length;
    const positiveCount = insights.filter(i => i.type === 'positive').length;

    const sentiment: 'green' | 'amber' | 'red' =
      criticalCount >= 2 || a.overdue.length > 10 ? 'red' :
      criticalCount > 0 || warningCount >= 3 ? 'amber' : 'green';

    const parts: string[] = [];

    if (sentiment === 'green') {
      parts.push('Operations are in good shape this morning.');
      parts.push(`${a.active.length} active orders are moving through the pipeline with no critical issues.`);
    } else if (sentiment === 'amber') {
      parts.push('A few areas need attention today.');
      if (a.overdue.length > 0) parts.push(`${a.overdue.length} order${s(a.overdue.length)} ${a.overdue.length === 1 ? 'is' : 'are'} overdue, representing ${fmt(a.overdueValue)} in pipeline value.`);
      if (a.atRisk.length > 0) parts.push(`${a.atRisk.length} more ${a.atRisk.length === 1 ? 'is' : 'are'} at risk of missing ${a.atRisk.length === 1 ? 'its' : 'their'} ship date within 48 hours.`);
    } else {
      parts.push('Significant issues require immediate attention.');
      parts.push(`${a.overdue.length} overdue order${s(a.overdue.length)} worth ${fmt(a.overdueValue)} need to be addressed as a priority.`);
      if (a.atRisk.length > 0) parts.push(`A further ${a.atRisk.length} order${s(a.atRisk.length)} ${a.atRisk.length === 1 ? 'is' : 'are'} at risk.`);
    }

    if (a.flowEfficiency > 0) {
      parts.push(`Flow efficiency is at ${a.flowEfficiency}% — ${a.inValueAdding.length} order${s(a.inValueAdding.length)} actively being worked on, ${a.inWaiting.length} waiting.`);
    }

    if (a.shippingToday.length > 0) {
      parts.push(`${a.shippingToday.length} order${s(a.shippingToday.length)} ${a.shippingToday.length === 1 ? 'is' : 'are'} scheduled to ship today.`);
    }

    if (a.bottleneck.count > 0 && pct(a.bottleneck.count, a.active.length) >= 20) {
      parts.push(`The main bottleneck is "${a.bottleneck.stage}" with ${a.bottleneck.count} orders.`);
    }

    return { text: parts.join(' '), sentiment, criticalCount, warningCount, positiveCount };
  }, [analysis, insights]);

  // ─── RECOMMENDED ACTIONS ──────────────────────────────────────────────────
  const actions = useMemo(() => {
    const a = analysis;
    const items: { priority: 'high' | 'medium' | 'low'; text: string; impact: string }[] = [];

    if (a.overdue.length > 0) {
      const worst = a.overdue[0];
      items.push({
        priority: 'high',
        text: `Follow up on ${a.overdue.length} overdue order${s(a.overdue.length)}, starting with #${worst.jobNumber} (${worst.customerName})`,
        impact: `${fmt(a.overdueValue)} at risk`,
      });
    }

    if (a.atRisk.length > 0) {
      const stockRisk = a.atRisk.filter(j => (j.status || '').toLowerCase() === 'awaiting stock');
      if (stockRisk.length > 0) {
        items.push({
          priority: 'high',
          text: `Chase stock delivery for ${stockRisk.length} at-risk order${s(stockRisk.length)} due in 48 hours`,
          impact: 'Prevent these becoming overdue',
        });
      }
    }

    const notOrdered = a.pipeline['Not Ordered'];
    if (notOrdered?.length) {
      items.push({
        priority: 'high',
        text: `Raise purchase orders for ${notOrdered.length} "Not Ordered" job${s(notOrdered.length)}`,
        impact: fmt(notOrdered.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0)) + ' blocked',
      });
    }

    if (a.shippingToday.length > 0) {
      const notReady = a.shippingToday.filter(j => {
        const sl = (j.status || '').toLowerCase();
        return sl !== 'ready for shipping' && sl !== 'completed' && sl !== 'shipped';
      });
      if (notReady.length > 0) {
        items.push({
          priority: 'high',
          text: `${notReady.length} of today's ${a.shippingToday.length} shipments are not ready — check production status`,
          impact: 'Due today',
        });
      }
    }

    if (a.stockDispatchReady.length > 0) {
      items.push({
        priority: 'medium',
        text: `Fulfil ${a.stockDispatchReady.length} Shopify order${s(a.stockDispatchReady.length)} with stock items ready for dispatch`,
        impact: 'Quick wins for fulfilment',
      });
    }

    const artworkWait = a.pipeline['Awaiting Artwork'];
    if (artworkWait?.length) {
      items.push({
        priority: 'medium',
        text: `Send artwork approval reminders for ${artworkWait.length} order${s(artworkWait.length)}`,
        impact: fmt(artworkWait.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0)) + ' waiting',
      });
    }

    if (a.unlinkedOld.length > 0) {
      items.push({
        priority: 'medium',
        text: `Link ${a.unlinkedOld.length} Shopify order${s(a.unlinkedOld.length)} to Deco jobs (5+ days unlinked)`,
        impact: 'May not be in production',
      });
    }

    const reviewQueue = a.pipeline['Awaiting Review'];
    if (reviewQueue?.length) {
      items.push({
        priority: 'low',
        text: `Process ${reviewQueue.length} order${s(reviewQueue.length)} in the review queue`,
        impact: 'Clear the backlog',
      });
    }

    return items;
  }, [analysis]);

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const card = 'bg-[#1e1e3a] rounded-xl border border-white/5';
  const sHead = 'flex items-center justify-between cursor-pointer select-none px-5 py-4';

  const daysOverdueVal = (j: DecoJob) => {
    const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
    return due ? daysBetween(due, now) : 0;
  };

  const statusBadge = (status: string) => {
    const c = STAGE_COLORS[status] || defColor;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.bg} ${c.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
        {status}
      </span>
    );
  };

  const jobRow = (j: DecoJob, extra?: React.ReactNode) => (
    <div
      key={j.id}
      className="flex items-center gap-3 px-4 py-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group"
      onClick={() => onNavigateToOrder(j.jobNumber)}
    >
      <span className="text-xs font-mono text-indigo-400 group-hover:text-indigo-300 w-16 shrink-0">#{j.jobNumber}</span>
      <span className="text-sm text-white/90 truncate flex-1 min-w-0">{j.customerName}</span>
      <span className="text-xs text-white/50 truncate max-w-[180px] hidden sm:block">{j.jobName}</span>
      {statusBadge(j.status || 'Unknown')}
      {extra}
    </div>
  );

  const h = now.getHours();
  const greeting = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">

      {/* ═══ HEADER ═══ */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">{greeting} — Daily Briefing</h1>
          <p className="text-sm text-white/40 mt-1">
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="text-right text-xs text-white/30">{analysis.active.length} active orders</div>
      </div>

      {/* ═══ OPERATIONAL SCORECARD ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <ScoreCard label="Active Orders" value={analysis.active.length} />
        <ScoreCard label="Overdue" value={analysis.overdue.length} status={analysis.overdue.length > 0 ? 'red' : 'green'} />
        <ScoreCard label="At Risk (48h)" value={analysis.atRisk.length} status={analysis.atRisk.length > 0 ? 'amber' : 'green'} />
        <ScoreCard label="Shipping Today" value={analysis.shippingToday.length} status={analysis.shippingToday.length > 0 ? 'blue' : undefined} />
        <ScoreCard label="Flow Efficiency" value={`${analysis.flowEfficiency}%`} status={analysis.flowEfficiency < 15 ? 'red' : analysis.flowEfficiency < 30 ? 'amber' : 'green'} />
        <ScoreCard label="7-Day Throughput" value={analysis.weeklyThroughput} sub={`${analysis.dailyThroughput}/day avg`} />
      </div>

      {/* ═══ EXECUTIVE SUMMARY + INTELLIGENCE ═══ */}
      <div className={`${card} overflow-hidden`}>
        <div className={sHead} onClick={() => toggle('intel')}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
              summary.sentiment === 'green' ? 'bg-emerald-500/20' :
              summary.sentiment === 'amber' ? 'bg-amber-500/20' : 'bg-red-500/20'
            }`}>
              {summary.sentiment === 'green' ? '✅' : summary.sentiment === 'amber' ? '📋' : '🔥'}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Operations Intelligence</h2>
              <p className="text-[11px] text-white/30">
                {summary.criticalCount > 0 ? `${summary.criticalCount} critical · ` : ''}{summary.warningCount > 0 ? `${summary.warningCount} warning${s(summary.warningCount)} · ` : ''}{summary.positiveCount} positive
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              summary.sentiment === 'green' ? 'bg-emerald-500/15 text-emerald-400' :
              summary.sentiment === 'amber' ? 'bg-amber-500/15 text-amber-400' :
              'bg-red-500/15 text-red-400'
            }`}>{summary.sentiment === 'green' ? 'All Clear' : summary.sentiment === 'amber' ? 'Attention Needed' : 'Action Required'}</span>
            <Chevron open={openSections.intel} />
          </div>
        </div>

        {openSections.intel && (
          <>
            {/* Executive Summary */}
            <div className="px-6 pb-4">
              <div className={`rounded-xl p-4 border ${
                summary.sentiment === 'green' ? 'bg-emerald-500/5 border-emerald-500/15' :
                summary.sentiment === 'amber' ? 'bg-amber-500/5 border-amber-500/15' :
                'bg-red-500/5 border-red-500/15'
              }`}>
                <p className="text-sm text-white/80 leading-relaxed">{summary.text}</p>
              </div>
            </div>

            {/* Insights */}
            <div className="px-6 pb-5 space-y-2">
              {insights.map((insight, i) => {
                const isOpen = expandedInsight === i;
                return (
                  <div key={i} className={`rounded-xl border transition-all ${
                    insight.type === 'critical' ? 'border-red-500/20 bg-red-500/5' :
                    insight.type === 'warning' ? 'border-amber-500/15 bg-amber-500/[0.03]' :
                    insight.type === 'positive' ? 'border-emerald-500/15 bg-emerald-500/[0.03]' :
                    'border-white/5 bg-white/[0.02]'
                  }`}>
                    <div
                      className="flex items-start gap-3 px-4 py-3 cursor-pointer"
                      onClick={() => setExpandedInsight(isOpen ? null : i)}
                    >
                      <span className="text-base shrink-0 mt-0.5">{insight.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold leading-snug ${
                          insight.type === 'critical' ? 'text-red-400' :
                          insight.type === 'warning' ? 'text-amber-400' :
                          insight.type === 'positive' ? 'text-emerald-400' :
                          'text-white/70'
                        }`}>{insight.headline}</p>
                        {isOpen && (
                          <p className="text-[11px] text-white/50 mt-2 leading-relaxed">{insight.detail}</p>
                        )}
                      </div>
                      {insight.metric && (
                        <div className="text-right shrink-0 hidden sm:block">
                          <div className="text-xs font-bold text-white/80">{insight.metric.value}</div>
                          <div className="text-[9px] text-white/30">{insight.metric.sub || insight.metric.label}</div>
                        </div>
                      )}
                      <Chevron open={isOpen} />
                    </div>
                    {isOpen && insight.jobs && insight.jobs.length > 0 && (
                      <div className="border-t border-white/5 px-2 py-2">
                        {insight.jobs.map(j => jobRow(j,
                          <span className="text-[10px] text-white/30 w-16 text-right shrink-0">
                            {(() => {
                              const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
                              return due ? due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';
                            })()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Recommended Actions */}
            {actions.length > 0 && (
              <div className="border-t border-white/5 px-6 py-5">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  Recommended Actions ({actions.length})
                </h3>
                <div className="space-y-1.5">
                  {actions.map((act, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        act.priority === 'high' ? 'bg-red-400' : act.priority === 'medium' ? 'bg-amber-400' : 'bg-blue-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-white/70 leading-relaxed">{act.text}</p>
                      </div>
                      <span className="text-[9px] text-white/30 shrink-0 mt-0.5">{act.impact}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ PIPELINE FLOW ═══ */}
      <div className={card}>
        <div className={sHead} onClick={() => toggle('pipeline')}>
          <div className="flex items-center gap-3">
            <span className="text-lg">📊</span>
            <div>
              <h2 className="text-sm font-bold text-white">Production Pipeline</h2>
              <p className="text-[11px] text-white/40">{analysis.active.length} orders · {fmt(analysis.totalPipelineValue)}</p>
            </div>
          </div>
          <Chevron open={openSections.pipeline} />
        </div>
        {openSections.pipeline && (
          <div className="px-5 pb-5">
            {/* Flow bar */}
            <div className="flex rounded-lg overflow-hidden h-7 mb-4">
              {FLOW_ORDER.filter(st => analysis.pipeline[st]?.length).map(stage => {
                const count = analysis.pipeline[stage]!.length;
                const p = pct(count, analysis.active.length);
                const c = STAGE_COLORS[stage] || defColor;
                return (
                  <div
                    key={stage}
                    className={`${c.bar}/30 flex items-center justify-center cursor-pointer hover:brightness-125 border-r border-black/20 last:border-0 transition-all`}
                    style={{ width: `${Math.max(p, 3)}%` }}
                    onClick={() => setExpandedStage(expandedStage === stage ? null : stage)}
                    title={`${stage}: ${count}`}
                  >
                    {p > 8 && <span className="text-[10px] font-bold text-white/80 truncate px-1">{count}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1 flex-wrap mb-4">
              {FLOW_ORDER.filter(st => analysis.pipeline[st]?.length).map(stage => {
                const c = STAGE_COLORS[stage] || defColor;
                return (
                  <span key={stage} className="flex items-center gap-1 text-[9px] text-white/40">
                    <span className={`w-2 h-2 rounded-full ${c.dot}`} />{stage}
                  </span>
                );
              })}
            </div>

            {/* Stage rows */}
            {FLOW_ORDER.filter(st => analysis.pipeline[st]?.length).map(stage => {
              const jobs = analysis.pipeline[stage]!;
              const value = jobs.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
              const c = STAGE_COLORS[stage] || defColor;
              const isOpen = expandedStage === stage;
              const isWaiting = WAITING_STAGES.has(stage);
              return (
                <div key={stage}>
                  <div
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-colors ${isOpen ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                    onClick={() => setExpandedStage(isOpen ? null : stage)}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                    <span className={`text-sm font-semibold ${c.text} flex-1`}>{stage}</span>
                    {isWaiting && <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/25">WAITING</span>}
                    <span className="text-sm font-bold text-white/80 w-10 text-right">{jobs.length}</span>
                    <span className="text-xs text-white/40 w-24 text-right">{fmtK(value)}</span>
                    <Chevron open={isOpen} />
                  </div>
                  {isOpen && (
                    <div className="ml-6 mt-1 mb-2 space-y-0.5 border-l-2 border-white/5 pl-3">
                      {jobs.sort((a, b) => {
                        const da = parseDate(a.dateDue) || parseDate(a.productionDueDate);
                        const db = parseDate(b.dateDue) || parseDate(b.productionDueDate);
                        return (da?.getTime() || 0) - (db?.getTime() || 0);
                      }).slice(0, 20).map(j => jobRow(j,
                        <span className="text-[10px] text-white/30 w-20 text-right shrink-0">
                          {(() => { const d = parseDate(j.dateDue) || parseDate(j.productionDueDate); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''; })()}
                        </span>
                      ))}
                      {jobs.length > 20 && <p className="text-xs text-white/30 px-4 pt-1">+ {jobs.length - 20} more</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══ SHIPPING FORECAST ═══ */}
      <div className={card}>
        <div className={sHead} onClick={() => toggle('forecast')}>
          <div className="flex items-center gap-3">
            <span className="text-lg">📅</span>
            <div>
              <h2 className="text-sm font-bold text-white">5-Day Shipping Forecast</h2>
              <p className="text-[11px] text-white/40">
                {analysis.weekDays.reduce((acc, d) => acc + d.jobs.length, 0)} this week
                {analysis.nextWeekOrders.length > 0 && ` · ${analysis.nextWeekOrders.length} next week`}
              </p>
            </div>
          </div>
          <Chevron open={openSections.forecast} />
        </div>
        {openSections.forecast && (
          <div className="px-5 pb-5">
            <div className="grid grid-cols-5 gap-2">
              {analysis.weekDays.map(day => {
                const notReady = day.jobs.filter(j => WAITING_STAGES.has(j.status || ''));
                const ready = day.jobs.filter(j => !WAITING_STAGES.has(j.status || ''));
                return (
                  <div
                    key={day.label}
                    className={`rounded-xl border transition-colors cursor-pointer ${
                      day.isToday ? 'border-indigo-500/50 bg-indigo-500/10' :
                      day.isPast ? 'border-white/5 bg-white/[0.02] opacity-50' :
                      'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                    onClick={() => setExpandedDay(expandedDay === day.label ? null : day.label)}
                  >
                    <div className="px-3 py-2 border-b border-white/5">
                      <div className={`text-xs font-bold ${day.isToday ? 'text-indigo-400' : 'text-white/60'}`}>
                        {day.label}
                        {day.isToday && <span className="ml-1 text-[9px] text-indigo-300">(Today)</span>}
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className={`text-lg font-black ${day.jobs.length > 0 ? 'text-white' : 'text-white/20'}`}>
                          {day.jobs.length}
                        </span>
                        {notReady.length > 0 && (
                          <span className="text-[9px] text-amber-400 font-semibold">{notReady.length} not ready</span>
                        )}
                      </div>
                      {day.jobs.length > 0 && (
                        <div className="flex gap-0.5 mt-1.5 h-1.5 rounded-full overflow-hidden">
                          {ready.length > 0 && (
                            <div className="bg-emerald-500/60 rounded-full" style={{ width: `${pct(ready.length, day.jobs.length)}%` }} />
                          )}
                          {notReady.length > 0 && (
                            <div className="bg-amber-500/60 rounded-full" style={{ width: `${pct(notReady.length, day.jobs.length)}%` }} />
                          )}
                        </div>
                      )}
                    </div>
                    {expandedDay === day.label && day.jobs.length > 0 && (
                      <div className="p-2 space-y-0.5 max-h-60 overflow-y-auto">
                        {day.jobs.sort((a, b) => {
                          const pa = WAITING_STAGES.has(a.status || '') ? 1 : 0;
                          const pb = WAITING_STAGES.has(b.status || '') ? 1 : 0;
                          return pa - pb;
                        }).map(j => (
                          <div
                            key={j.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer"
                            onClick={e => { e.stopPropagation(); onNavigateToOrder(j.jobNumber); }}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${(STAGE_COLORS[j.status || ''] || defColor).dot}`} />
                            <span className="text-[10px] text-white/70 truncate flex-1">{j.customerName}</span>
                            <span className="text-[9px] text-white/30">#{j.jobNumber}</span>
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

      {/* ═══ CUSTOMER RISK MAP ═══ */}
      {analysis.customersByRisk.length > 0 && (
        <div className={card}>
          <div className={sHead} onClick={() => toggle('customers')}>
            <div className="flex items-center gap-3">
              <span className="text-lg">👥</span>
              <div>
                <h2 className="text-sm font-bold text-white">Customer Risk Map</h2>
                <p className="text-[11px] text-white/40">{analysis.customersByRisk.length} customer{s(analysis.customersByRisk.length)} with overdue or at-risk orders</p>
              </div>
            </div>
            <Chevron open={openSections.customers} />
          </div>
          {openSections.customers && (
            <div className="px-5 pb-5 space-y-1">
              {analysis.customersByRisk.slice(0, 10).map(c => {
                const isOpen = expandedCust === c.name;
                return (
                  <div key={c.name}>
                    <div
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-colors ${isOpen ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                      onClick={() => setExpandedCust(isOpen ? null : c.name)}
                    >
                      <span className="text-sm text-white/90 flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-white/40">{c.count} order{s(c.count)}</span>
                      {c.overdue > 0 && (
                        <span className="text-[10px] font-bold text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded">{c.overdue} overdue</span>
                      )}
                      {c.atRisk > 0 && (
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded">{c.atRisk} at risk</span>
                      )}
                      <span className="text-sm font-semibold text-emerald-400 w-24 text-right">{fmtK(c.value)}</span>
                      <Chevron open={isOpen} />
                    </div>
                    {isOpen && (
                      <div className="ml-6 mt-1 mb-2 border-l-2 border-white/5 pl-3">
                        <div className="flex gap-2 flex-wrap mb-2 px-2">
                          {Object.entries(c.statuses).map(([st, cnt]) => (
                            <span key={st} className="text-[9px] text-white/40">{st}: {cnt}</span>
                          ))}
                          <span className="text-[9px] text-white/25">· avg age: {c.avgAge}d</span>
                        </div>
                        {c.jobs.sort((a, b) => {
                          const da = parseDate(a.dateDue) || parseDate(a.productionDueDate);
                          const db = parseDate(b.dateDue) || parseDate(b.productionDueDate);
                          return (da?.getTime() || 0) - (db?.getTime() || 0);
                        }).slice(0, 8).map(j => jobRow(j,
                          daysOverdueVal(j) > 0
                            ? <span className="text-[10px] font-bold text-red-400 w-16 text-right shrink-0">{daysOverdueVal(j)}d late</span>
                            : <span className="text-[10px] text-white/30 w-16 text-right shrink-0">
                                {(() => { const d = parseDate(j.dateDue) || parseDate(j.productionDueDate); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''; })()}
                              </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ RECENT ACTIVITY ═══ */}
      <div className={card}>
        <div className={sHead} onClick={() => toggle('activity')}>
          <div className="flex items-center gap-3">
            <span className="text-lg">📋</span>
            <div>
              <h2 className="text-sm font-bold text-white">Recent Activity</h2>
              <p className="text-[11px] text-white/40">
                {analysis.shippedYesterday.length} shipped · {analysis.newOrders.length} new
                {analysis.avgCycleTime ? ` · ${analysis.avgCycleTime}d avg cycle time` : ''}
              </p>
            </div>
          </div>
          <Chevron open={openSections.activity} />
        </div>
        {openSections.activity && (
          <div className="px-5 pb-5 space-y-4">
            {analysis.shippedYesterday.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />Shipped Yesterday
                </h3>
                {analysis.shippedYesterday.map(j => jobRow(j))}
              </div>
            )}
            {analysis.newOrders.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />New Orders (24h)
                </h3>
                {analysis.newOrders.slice(0, 12).map(j => jobRow(j))}
                {analysis.newOrders.length > 12 && <p className="text-xs text-white/30 px-4 pt-1">+ {analysis.newOrders.length - 12} more</p>}
              </div>
            )}
            {analysis.shippedYesterday.length === 0 && analysis.newOrders.length === 0 && (
              <p className="text-sm text-white/30 italic px-4">No activity recorded</p>
            )}
          </div>
        )}
      </div>

      {/* ═══ TOP CUSTOMERS BY VALUE ═══ */}
      <div className={card}>
        <div className={sHead} onClick={() => toggle('topCust')}>
          <div className="flex items-center gap-3">
            <span className="text-lg">💰</span>
            <div>
              <h2 className="text-sm font-bold text-white">Top 10 Customers by Pipeline Value</h2>
              <p className="text-[11px] text-white/40">
                {analysis.concentrationPct > 0 && `Top 3 hold ${analysis.concentrationPct}% of total value`}
              </p>
            </div>
          </div>
          <Chevron open={openSections.topCust} />
        </div>
        {openSections.topCust && (
          <div className="px-5 pb-5 space-y-0.5">
            {analysis.customersByValue.map((c, i) => (
              <div key={c.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 rounded-lg transition-colors">
                <span className="text-xs font-bold text-white/20 w-5">{i + 1}</span>
                <span className="text-sm text-white/90 flex-1 truncate">{c.name}</span>
                <span className="text-xs text-white/40">{c.count} order{s(c.count)}</span>
                {c.overdue > 0 && (
                  <span className="text-[10px] font-bold text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded">{c.overdue} overdue</span>
                )}
                <span className="text-sm font-semibold text-emerald-400 w-24 text-right">{fmtK(c.value)}</span>
                <div className="w-20 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500/40 rounded-full" style={{ width: `${pct(c.value, analysis.totalPipelineValue)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface Insight {
  type: 'critical' | 'warning' | 'info' | 'positive';
  icon: string;
  headline: string;
  detail: string;
  metric?: { label: string; value: string; sub?: string };
  jobs?: DecoJob[];
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

const s = (n: number) => n !== 1 ? 's' : '';

const groupBy = <T,>(arr: T[], fn: (item: T) => string): Record<string, T[]> => {
  const out: Record<string, T[]> = {};
  arr.forEach(item => {
    const key = fn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  });
  return out;
};

const daysOverdue = (j: DecoJob) => {
  const due = parseDate(j.dateDue) || parseDate(j.productionDueDate);
  return due ? daysBetween(due, new Date()) : 0;
};

// ─── NARRATIVE BUILDERS ─────────────────────────────────────────────────────

function buildOverdueNarrative(
  overdue: DecoJob[], worstDays: number, worst: DecoJob,
  topCust: [string, DecoJob[]], aging: { under7: number; under14: number; under30: number; over30: number }
): string {
  const parts: string[] = [];

  parts.push(`The longest overdue order is #${worst.jobNumber} for ${worst.customerName}, currently ${worstDays} day${s(worstDays)} past its due date and still at "${worst.status}".`);

  const agingParts: string[] = [];
  if (aging.under7 > 0) agingParts.push(`${aging.under7} less than a week late`);
  if (aging.under14 > 0) agingParts.push(`${aging.under14} between 1-2 weeks late`);
  if (aging.under30 > 0) agingParts.push(`${aging.under30} between 2-4 weeks late`);
  if (aging.over30 > 0) agingParts.push(`${aging.over30} more than a month late`);
  if (agingParts.length > 1) {
    parts.push(`Breaking down the overdue aging: ${agingParts.join(', ')}.`);
  }

  if (topCust[1].length >= 2) {
    parts.push(`${topCust[0]} is the most affected customer with ${topCust[1].length} overdue order${s(topCust[1].length)}. This may warrant a proactive update call to maintain the relationship.`);
  }

  if (overdue.length > 10) {
    parts.push('This level of overdue orders suggests a systemic issue, not individual delays. Consider whether a process change is needed.');
  } else if (aging.over30 > 0) {
    parts.push(`The ${aging.over30} order${s(aging.over30)} over 30 days late should be investigated. These may need to be escalated, cancelled, or renegotiated with the customer.`);
  }

  return parts.join(' ');
}

function buildAtRiskNarrative(
  atRisk: DecoJob[], blockedTypes: Record<string, DecoJob[]>
): string {
  const parts: string[] = [];
  const typeEntries = Object.entries(blockedTypes).sort((a, b) => b[1].length - a[1].length);

  parts.push('These orders are due for shipment within the next 48 hours but haven\'t reached production yet.');

  typeEntries.forEach(([stage, jobs]) => {
    if (stage === 'Awaiting Stock') {
      parts.push(`${jobs.length} ${jobs.length === 1 ? 'is' : 'are'} stuck at "Awaiting Stock". Unless stock arrives today, ${jobs.length === 1 ? 'this order' : 'these orders'} will miss ${jobs.length === 1 ? 'its' : 'their'} ship date.`);
    } else if (stage === 'Not Ordered') {
      parts.push(`${jobs.length} ${jobs.length === 1 ? 'hasn\'t' : 'haven\'t'} even had a purchase order raised yet. ${jobs.length === 1 ? 'This needs' : 'These need'} immediate attention.`);
    } else if (stage === 'Awaiting Artwork') {
      parts.push(`${jobs.length} ${jobs.length === 1 ? 'is' : 'are'} waiting on artwork approval from the customer.`);
    } else {
      parts.push(`${jobs.length} at "${stage}".`);
    }
  });

  if (atRisk.length > 3) {
    parts.push('With this many at-risk orders, consider whether any can realistically be fast-tracked or whether customers need to be informed of delays.');
  }

  return parts.join(' ');
}

function buildBottleneckNarrative(
  bottleneck: { stage: string; count: number; value: number; avgDaysStuck: number },
  totalActive: number, pipeline: Record<string, DecoJob[]>
): string {
  const parts: string[] = [];

  parts.push(`"${bottleneck.stage}" currently holds ${bottleneck.count} of ${totalActive} active orders (${pct(bottleneck.count, totalActive)}%), making it the primary constraint in your pipeline.`);

  parts.push('According to the Theory of Constraints, your entire pipeline can only move as fast as this stage. Improving throughput here will improve overall performance.');

  if (bottleneck.stage === 'Awaiting Stock') {
    parts.push('This suggests supplier delivery is the constraint. Consider consolidating orders for supplier priority, sourcing alternative stock, or negotiating faster lead times.');
  } else if (bottleneck.stage === 'Awaiting Processing') {
    parts.push('Orders are entering the system faster than they can be processed. Consider whether the processing team needs more capacity or the workflow can be streamlined.');
  } else if (bottleneck.stage === 'Not Ordered') {
    parts.push('This number of unordered jobs suggests the purchasing process may need review. Are POs being raised promptly? Is there a batch ordering schedule causing build-up?');
  } else if (bottleneck.stage === 'Awaiting Artwork') {
    parts.push('Customer-side delays on artwork are the constraint. Consider implementing automated approval reminders or setting clearer deadlines for artwork submission.');
  } else if (bottleneck.stage === 'In Production') {
    parts.push('Production capacity may be the constraint. Check whether production bottlenecks like machine time or staffing could be improved.');
  }

  const inProd = (pipeline['In Production']?.length || 0) + (pipeline['Ready for Shipping']?.length || 0);
  if (inProd < bottleneck.count) {
    parts.push(`For context, only ${inProd} order${s(inProd)} ${inProd === 1 ? 'is' : 'are'} currently in value-adding stages, compared to ${bottleneck.count} at the bottleneck.`);
  }

  return parts.join(' ');
}

function buildFlowNarrative(efficiency: number, waiting: number, valueAdding: number, total: number): string {
  const parts: string[] = [];

  if (efficiency >= 30) {
    parts.push(`Flow efficiency of ${efficiency}% is strong — nearly a third of your pipeline is in value-adding stages rather than waiting.`);
    parts.push('In Lean manufacturing terms, anything above 25% is considered good performance.');
  } else if (efficiency >= 15) {
    parts.push(`Flow efficiency at ${efficiency}% is acceptable but there is room for improvement.`);
    parts.push(`${waiting} order${s(waiting)} ${waiting === 1 ? 'is' : 'are'} in waiting stages where no value is being added. The goal is to reduce this ratio by unblocking orders faster.`);
  } else {
    parts.push(`Flow efficiency of ${efficiency}% is low. The vast majority of orders (${waiting} of ${total}) are in waiting stages.`);
    parts.push('In Lean terms, this means too many orders are queued up without progressing. Focus on unblocking the biggest waiting stage first.');
  }

  return parts.join(' ');
}

// ─── SUB-COMPONENTS ─────────────────────────────────────────────────────────

function ScoreCard({ label, value, status, sub }: {
  label: string; value: number | string; status?: 'red' | 'amber' | 'green' | 'blue'; sub?: string;
}) {
  const colors: Record<string, string> = {
    red: 'border-l-red-500 text-red-400',
    amber: 'border-l-amber-500 text-amber-400',
    green: 'border-l-emerald-500 text-emerald-400',
    blue: 'border-l-blue-500 text-blue-400',
  };
  const colorClass = status ? colors[status] : 'border-l-indigo-500/50 text-white';
  const borderClass = colorClass.split(' ')[0];
  const textClass = colorClass.split(' ')[1];
  return (
    <div className={`bg-[#1e1e3a] rounded-xl border border-white/5 border-l-4 ${borderClass} p-4`}>
      <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-black mt-1 ${textClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
