import React, { useState, useMemo } from 'react';
import type { DecoJob, UnifiedOrder } from '../types';

interface Props {
  decoJobs: DecoJob[];
  orders: UnifiedOrder[];
  onNavigateToOrder: (orderNum: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const isCancelled = (j: DecoJob) =>
  (j.status || '').toLowerCase() === 'cancelled' || j.paymentStatus === '7';
const pd = (d?: string) => (d ? new Date(d) : null);
const fmt = (n: number) => '\u00a3' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n: number) => n >= 1000 ? '\u00a3' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmt(n);
const daysBetween = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / 86400000);
const s = (n: number) => n !== 1 ? 's' : '';
const pct = (a: number, b: number) => b === 0 ? 0 : Math.round((a / b) * 100);

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

// Status explanations for root cause
const STATUS_EXPLAIN: Record<string, string> = {
  'Not Ordered': 'Purchase order has not been raised with the supplier. This blocks the entire order from entering production.',
  'Awaiting Processing': 'Order received but not yet picked up by the production team. Needs to be reviewed and moved forward.',
  'Awaiting Artwork': 'Waiting for artwork from the customer or design team. Cannot proceed to production until artwork is approved.',
  'Awaiting Review': 'Artwork or proof sent to customer, waiting for their approval before production can begin.',
  'On Hold': 'Deliberately paused \u2014 could be a customer request, payment issue, or internal decision. Needs manual review.',
  'Awaiting Stock': 'Blank garments or materials not yet available. Either on order from the supplier or out of stock.',
  'In Production': 'Currently being decorated \u2014 embroidery, print, or other production work is underway.',
  'Ready for Shipping': 'Production complete, ready to be packed and dispatched to the customer.',
  'Completed': 'All production work finished. Should be shipped or is awaiting collection.',
};

export default function MorningBriefing({ decoJobs, orders, onNavigateToOrder }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>('issues');
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(0);

  const now = useMemo(() => new Date(), []);
  const t0 = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, [now]);

  // ══════════════════════════════════════════════════════════════════════════
  // DATA ANALYSIS
  // ══════════════════════════════════════════════════════════════════════════
  const data = useMemo(() => {
    const yesterday = new Date(t0); yesterday.setDate(t0.getDate() - 1);
    const yesterdayEnd = new Date(yesterday); yesterdayEnd.setHours(23, 59, 59, 999);
    const in48h = new Date(t0); in48h.setDate(t0.getDate() + 2); in48h.setHours(23, 59, 59, 999);
    const sevenAgo = new Date(t0); sevenAgo.setDate(t0.getDate() - 7);
    const fourteenAgo = new Date(t0); fourteenAgo.setDate(t0.getDate() - 14);
    const todayEnd = new Date(t0); todayEnd.setHours(23, 59, 59, 999);

    const live = decoJobs.filter(j => !isCancelled(j));
    const active = live.filter(j => {
      const st = (j.status || '').toLowerCase();
      return st !== 'shipped' && st !== 'completed';
    });
    const shipped = live.filter(j => (j.status || '').toLowerCase() === 'shipped');

    // Pipeline by stage
    const stages: Record<string, DecoJob[]> = {};
    active.forEach(j => { const st = j.status || 'Unknown'; (stages[st] ??= []).push(j); });

    // Overdue orders
    const overdue = active.filter(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      return due && due < t0;
    }).sort((a, b) => {
      const da = pd(a.dateDue) || pd(a.productionDueDate);
      const db = pd(b.dateDue) || pd(b.productionDueDate);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });

    // Overdue aging brackets
    const overdueAging = {
      critical: overdue.filter(j => { const d = pd(j.dateDue) || pd(j.productionDueDate); return d && daysBetween(d, now) > 30; }),
      severe: overdue.filter(j => { const d = pd(j.dateDue) || pd(j.productionDueDate); return d && daysBetween(d, now) > 14 && daysBetween(d, now) <= 30; }),
      moderate: overdue.filter(j => { const d = pd(j.dateDue) || pd(j.productionDueDate); return d && daysBetween(d, now) > 7 && daysBetween(d, now) <= 14; }),
      recent: overdue.filter(j => { const d = pd(j.dateDue) || pd(j.productionDueDate); return d && daysBetween(d, now) <= 7; }),
    };

    // Overdue grouped by current status (root cause)
    const overdueByStatus: Record<string, DecoJob[]> = {};
    overdue.forEach(j => { const st = j.status || 'Unknown'; (overdueByStatus[st] ??= []).push(j); });

    // Overdue by customer (repeat issues)
    const overdueByCustomer: Record<string, DecoJob[]> = {};
    overdue.forEach(j => { const c = j.customerName || 'Unknown'; (overdueByCustomer[c] ??= []).push(j); });
    const repeatOverdueCustomers = Object.entries(overdueByCustomer)
      .filter(([, jobs]) => jobs.length >= 2)
      .sort((a, b) => b[1].length - a[1].length);

    // At-risk (due in 48h, still blocked)
    const atRisk = active.filter(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      return due && due >= t0 && due <= in48h && BLOCKED.has(j.status || '');
    });

    // Today's shipments
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

    // New & shipped
    const newOrders = live.filter(j => { const ord = pd(j.dateOrdered); return ord && ord >= yesterday; });
    const shippedYesterday = shipped.filter(j => { const sd = pd(j.dateShipped); return sd && sd >= yesterday && sd <= yesterdayEnd; });

    // Throughput & cycle times
    const shipped7d = shipped.filter(j => { const sd = pd(j.dateShipped); return sd && sd >= sevenAgo; });
    const shipped14d = shipped.filter(j => { const sd = pd(j.dateShipped); return sd && sd >= fourteenAgo; });
    const cycleTimes7d = shipped7d.map(j => {
      const o = pd(j.dateOrdered), sh = pd(j.dateShipped);
      return o && sh ? daysBetween(o, sh) : null;
    }).filter((v): v is number => v !== null && v >= 0);
    const avgCycle = cycleTimes7d.length > 0
      ? +(cycleTimes7d.reduce((a, b) => a + b, 0) / cycleTimes7d.length).toFixed(1) : null;
    const fastestCycle = cycleTimes7d.length > 0 ? Math.min(...cycleTimes7d) : null;
    const slowestCycle = cycleTimes7d.length > 0 ? Math.max(...cycleTimes7d) : null;

    // Previous week throughput for comparison
    const shippedPrev7d = shipped.filter(j => { const sd = pd(j.dateShipped); return sd && sd >= fourteenAgo && sd < sevenAgo; });

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
        dateStr: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        isToday: day.toDateString() === now.toDateString(),
        isPast: day < t0 && day.toDateString() !== now.toDateString(),
        total: jobs.length,
        ready: jobs.filter(j => !BLOCKED.has(j.status || '')).length,
        notReady: jobs.filter(j => BLOCKED.has(j.status || '')).length,
        value: jobs.reduce((sum, j) => sum + (j.orderTotal || j.billableAmount || 0), 0),
        jobs,
      };
    });

    // Key values
    const pipelineVal = active.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const overdueVal = overdue.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const shippedYestVal = shippedYesterday.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const newVal = newOrders.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const producingCount = active.filter(j => PRODUCING.has(j.status || '')).length;
    const blockedCount = active.filter(j => BLOCKED.has(j.status || '')).length;

    // Bottleneck: which single stage holds the most orders
    const bottleneck = FLOW.reduce((top, st) => {
      const n = (stages[st] || []).length;
      return n > top.count ? { stage: st, count: n } : top;
    }, { stage: '', count: 0 });

    // Blocked stages breakdown
    const blockedStages = ['Not Ordered', 'Awaiting Processing', 'Awaiting Artwork', 'Awaiting Review', 'On Hold', 'Awaiting Stock']
      .map(st => ({
        stage: st,
        jobs: stages[st] || [],
        count: (stages[st] || []).length,
        value: (stages[st] || []).reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0),
        overdueCount: (stages[st] || []).filter(j => { const d = pd(j.dateDue) || pd(j.productionDueDate); return d && d < t0; }).length,
      }))
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count);

    // Stock dispatch ready
    const stockReady = orders.filter(o =>
      o.shopify.fulfillmentStatus !== 'fulfilled' && o.isStockDispatchReady
    );

    // Orders with no due date
    const noDueDate = active.filter(j => !pd(j.dateDue) && !pd(j.productionDueDate));

    // On-time performance (shipped in last 14d)
    const onTimeCount = shipped14d.filter(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      const sh = pd(j.dateShipped);
      return due && sh && sh <= due;
    }).length;
    const onTimeRate = shipped14d.length > 0 ? pct(onTimeCount, shipped14d.length) : null;

    // Customer diversity
    const uniqueCustomers = new Set(active.map(j => j.customerName)).size;

    // Stale orders (30+ days, still blocked)
    const staleOrders = active.filter(j => {
      const ord = pd(j.dateOrdered);
      return ord && daysBetween(ord, now) > 30 && BLOCKED.has(j.status || '');
    });

    return {
      active, shipped, stages, overdue, overdueAging, overdueByStatus,
      overdueByCustomer, repeatOverdueCustomers, atRisk, todayShip, todayReady,
      todayNotReady, newOrders, shippedYesterday, shipped7d, shipped14d, shippedPrev7d,
      avgCycle, fastestCycle, slowestCycle, weekDays,
      pipelineVal, overdueVal, shippedYestVal, newVal,
      producingCount, blockedCount, bottleneck, blockedStages, stockReady,
      noDueDate, onTimeRate, onTimeCount, uniqueCustomers, staleOrders,
    };
  }, [decoJobs, orders, now, t0]);

  // ══════════════════════════════════════════════════════════════════════════
  // INTELLIGENCE ENGINE
  // ══════════════════════════════════════════════════════════════════════════
  const intelligence = useMemo(() => {
    // ── ISSUES ─────────────────────────────────────────────────────────────
    const issues: { severity: 'critical' | 'warning' | 'info'; title: string; brief: string; detail: string; jobs?: DecoJob[]; action: string }[] = [];

    // 1. Production stall / blocked pipeline
    if (data.producingCount === 0 && data.blockedCount > 0) {
      issues.push({
        severity: 'critical',
        title: 'Production has completely stalled',
        brief: `All ${data.active.length} active orders are blocked. Zero orders are currently in production, ready for shipping, or completed. Nothing is being worked on.`,
        detail: `This is a critical operational failure. The entire pipeline worth ${fmtK(data.pipelineVal)} is stuck in pre-production stages with no work moving forward.\n\n`
          + `The primary bottleneck is "${data.bottleneck.stage}" with ${data.bottleneck.count} order${s(data.bottleneck.count)} (${pct(data.bottleneck.count, data.active.length)}% of all active work).\n\n`
          + `Breakdown by blocked stage:\n\n`
          + data.blockedStages.map(b =>
            `\u2022 ${b.stage}: ${b.count} order${s(b.count)} worth ${fmtK(b.value)}${b.overdueCount > 0 ? ` (${b.overdueCount} already overdue)` : ''}\n  ${STATUS_EXPLAIN[b.stage] || ''}`
          ).join('\n\n'),
        action: `Immediate priority: unblock the ${data.bottleneck.stage} queue. ${
          data.bottleneck.stage === 'Awaiting Stock' ? 'Chase suppliers on outstanding stock orders today. Check if alternative suppliers can fulfil faster. Consider partial shipments for orders where some items are available.' :
          data.bottleneck.stage === 'Not Ordered' ? 'Raise purchase orders for all jobs immediately. Every day without a PO is a day of delay added to the customer wait.' :
          data.bottleneck.stage === 'Awaiting Processing' ? 'Production team needs to pick up these orders today. Prioritise by due date and customer urgency.' :
          data.bottleneck.stage === 'Awaiting Artwork' ? 'Chase customers for artwork. Send reminders with specific deadline dates. Escalate any that have been waiting more than 7 days.' :
          'Review each blocked order individually and determine what action is needed to move it forward.'
        }`,
      });
    } else if (data.blockedCount > data.producingCount * 3) {
      issues.push({
        severity: 'critical',
        title: `${pct(data.blockedCount, data.active.length)}% of orders are blocked`,
        brief: `${data.blockedCount} of ${data.active.length} active orders are stuck in pre-production stages. Only ${data.producingCount} are actually being worked on. The pipeline is severely congested.`,
        detail: `For healthy flow, the majority of orders should be in production, not waiting. Currently the ratio of blocked to producing is ${data.blockedCount}:${data.producingCount}.\n\n`
          + data.blockedStages.map(b =>
            `\u2022 ${b.stage}: ${b.count} order${s(b.count)} (${fmtK(b.value)})${b.overdueCount > 0 ? ` \u2014 ${b.overdueCount} already overdue` : ''}\n  ${STATUS_EXPLAIN[b.stage] || ''}`
          ).join('\n\n'),
        action: `Focus on the biggest blocker: ${data.bottleneck.stage} (${data.bottleneck.count} orders). Clear this queue to get work flowing into production.`,
      });
    } else if (data.blockedCount > data.producingCount) {
      issues.push({
        severity: 'warning',
        title: `More orders blocked than producing`,
        brief: `${data.blockedCount} blocked vs ${data.producingCount} in production. Work is backing up faster than it's being processed.`,
        detail: data.blockedStages.map(b => `\u2022 ${b.stage}: ${b.count} order${s(b.count)} (${fmtK(b.value)})\n  ${STATUS_EXPLAIN[b.stage] || ''}`).join('\n\n'),
        action: `Reduce the ${data.bottleneck.stage} queue to restore healthy flow.`,
      });
    }

    // 2. Overdue orders with full root cause
    if (data.overdue.length > 0) {
      const oldestDue = pd(data.overdue[0].dateDue) || pd(data.overdue[0].productionDueDate);
      const oldestDays = oldestDue ? daysBetween(oldestDue, now) : 0;

      const rootCauses = Object.entries(data.overdueByStatus)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([status, jobs]) => {
          const statusVal = jobs.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
          return `\u2022 ${jobs.length} overdue at "${status}" (${fmtK(statusVal)}):\n  ${STATUS_EXPLAIN[status] || 'Status unclear.'}`;
        });

      issues.push({
        severity: data.overdue.length > 10 ? 'critical' : 'warning',
        title: `${data.overdue.length} orders are overdue (${fmtK(data.overdueVal)})`,
        brief: `Orders ranging from ${data.overdueAging.recent.length > 0 ? '1' : data.overdueAging.moderate.length > 0 ? '8' : '15'} to ${oldestDays} days late. `
          + (data.overdueAging.critical.length > 0 ? `${data.overdueAging.critical.length} are over 30 days late \u2014 these are severely impacting customer relationships. ` : '')
          + (data.overdueAging.severe.length > 0 ? `${data.overdueAging.severe.length} are 15-30 days late. ` : '')
          + (data.overdueAging.moderate.length > 0 ? `${data.overdueAging.moderate.length} are 7-14 days late. ` : '')
          + (data.overdueAging.recent.length > 0 ? `${data.overdueAging.recent.length} are under 7 days late.` : ''),
        detail: `Root Cause Analysis \u2014 Why are these orders late?\n\n${rootCauses.join('\n\n')}`
          + (data.repeatOverdueCustomers.length > 0
            ? `\n\nRepeat affected customers (multiple overdue orders):\n${data.repeatOverdueCustomers.slice(0, 5).map(([name, jobs]) => `\u2022 ${name}: ${jobs.length} overdue orders worth ${fmtK(jobs.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0))}`).join('\n')}`
            : ''),
        jobs: data.overdue,
        action: data.overdueAging.critical.length > 0
          ? `Priority 1: Contact the ${data.overdueAging.critical.length} customer${s(data.overdueAging.critical.length)} with 30+ day overdue orders immediately. Provide honest ETAs and apologise for the delay. Priority 2: Work backwards through the aging brackets, focusing on unblocking the root cause status for each order.`
          : `Prioritise the oldest overdue orders first. The most common reason orders are overdue is "${Object.entries(data.overdueByStatus).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || 'unknown'}" \u2014 fixing this root cause will clear the most orders.`,
      });
    }

    // 3. At-risk orders
    if (data.atRisk.length > 0) {
      issues.push({
        severity: 'warning',
        title: `${data.atRisk.length} order${s(data.atRisk.length)} about to go overdue`,
        brief: `These orders are due within 48 hours but are still blocked in pre-production stages. Without intervention today, they will become overdue tomorrow.`,
        detail: data.atRisk.map(j => {
          const due = pd(j.dateDue) || pd(j.productionDueDate);
          const dueStr = due?.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) || '';
          return `\u2022 #${j.jobNumber} ${j.customerName} \u2014 due ${dueStr}, stuck at "${j.status}"\n  ${STATUS_EXPLAIN[j.status || ''] || ''}\n  Value: ${fmtK(j.orderTotal || j.billableAmount || 0)}`;
        }).join('\n\n'),
        jobs: data.atRisk,
        action: `These need to jump the queue today. Each one needs its blocker resolved immediately to have any chance of hitting the deadline.`,
      });
    }

    // 4. Stale orders
    if (data.staleOrders.length > 0) {
      const staleVal = data.staleOrders.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
      issues.push({
        severity: 'warning',
        title: `${data.staleOrders.length} order${s(data.staleOrders.length)} sitting for 30+ days without progress`,
        brief: `These orders were placed over a month ago and are still stuck in pre-production stages. Total value: ${fmtK(staleVal)}. These have likely been forgotten or have unresolved issues that nobody has followed up on.`,
        detail: data.staleOrders.slice(0, 10).map(j => {
          const ord = pd(j.dateOrdered);
          const age = ord ? daysBetween(ord, now) : 0;
          return `\u2022 #${j.jobNumber} ${j.customerName} \u2014 ordered ${age} days ago, still at "${j.status}" (${fmtK(j.orderTotal || j.billableAmount || 0)})`;
        }).join('\n') + (data.staleOrders.length > 10 ? `\n\u2022 ...and ${data.staleOrders.length - 10} more` : ''),
        jobs: data.staleOrders,
        action: `Review each stale order: Is it still valid? Does the customer still want it? If yes, unblock it urgently. If no, cancel or archive with a reason documented.`,
      });
    }

    // 5. No due dates
    if (data.noDueDate.length > 0) {
      issues.push({
        severity: 'info',
        title: `${data.noDueDate.length} order${s(data.noDueDate.length)} with no due date set`,
        brief: `These orders have no production or delivery due date. They can't be tracked for on-time delivery, won't show up in overdue reports, and risk being forgotten entirely.`,
        detail: data.noDueDate.slice(0, 10).map(j =>
          `\u2022 #${j.jobNumber} ${j.customerName} \u2014 ${j.status} (${fmtK(j.orderTotal || j.billableAmount || 0)})`
        ).join('\n') + (data.noDueDate.length > 10 ? `\n\u2022 ...and ${data.noDueDate.length - 10} more` : ''),
        action: `Add due dates to all orders. Without them, priorities cannot be set properly and orders will silently become late.`,
      });
    }

    // 6. Stock dispatch ready (quick win)
    if (data.stockReady.length > 0) {
      issues.push({
        severity: 'info',
        title: `${data.stockReady.length} order${s(data.stockReady.length)} ready to dispatch now`,
        brief: `Stock items have been produced and are sitting ready to ship. These are quick wins \u2014 fulfil them in Shopify to get revenue out the door and improve delivery metrics.`,
        detail: `These orders have completed stock items that haven't been marked as fulfilled in Shopify yet. They just need shipping labels and dispatch.`,
        action: `Fulfil these in Shopify today. They're already done \u2014 just need packing and shipping labels.`,
      });
    }

    // ── POSITIVES ──────────────────────────────────────────────────────────
    const positives: { title: string; detail: string }[] = [];

    if (data.shippedYesterday.length > 0) {
      positives.push({
        title: `${data.shippedYesterday.length} order${s(data.shippedYesterday.length)} shipped yesterday (${fmtK(data.shippedYestVal)})`,
        detail: data.shippedYesterday.map(j => `${j.customerName} \u2014 #${j.jobNumber} (${fmtK(j.orderTotal || j.billableAmount || 0)})`).join(', '),
      });
    }

    if (data.shipped7d.length > 0) {
      const weekVal = data.shipped7d.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
      const prevVal = data.shippedPrev7d.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
      const trend = data.shippedPrev7d.length > 0
        ? data.shipped7d.length > data.shippedPrev7d.length ? 'up' : data.shipped7d.length < data.shippedPrev7d.length ? 'down' : 'flat'
        : null;
      positives.push({
        title: `${data.shipped7d.length} shipped in the last 7 days (${fmtK(weekVal)})`,
        detail: trend
          ? `${trend === 'up' ? 'Up' : trend === 'down' ? 'Down' : 'Same'} from ${data.shippedPrev7d.length} shipped the previous week (${fmtK(prevVal)}).${trend === 'up' ? ' Good improvement in throughput.' : ''}`
          : `First week of tracking \u2014 no previous comparison available.`,
      });
    }

    if (data.avgCycle !== null) {
      positives.push({
        title: `Average turnaround: ${data.avgCycle} days`,
        detail: `Based on ${data.shipped7d.length} orders shipped recently. Fastest delivery: ${data.fastestCycle} day${s(data.fastestCycle || 0)}. Slowest: ${data.slowestCycle} day${s(data.slowestCycle || 0)}.`,
      });
    }

    if (data.onTimeRate !== null && data.onTimeRate > 0) {
      positives.push({
        title: `On-time delivery rate: ${data.onTimeRate}%`,
        detail: `${data.onTimeCount} of ${data.shipped14d.length} orders shipped in the last 14 days were on or before their due date.${data.onTimeRate >= 90 ? ' Excellent performance \u2014 keep it up.' : data.onTimeRate >= 70 ? ' Decent, but room for improvement.' : ' This needs serious attention \u2014 most orders are shipping late.'}`,
      });
    }

    if (data.newOrders.length > 0) {
      positives.push({
        title: `${data.newOrders.length} new order${s(data.newOrders.length)} received (${fmtK(data.newVal)})`,
        detail: data.newOrders.map(j => `${j.customerName} \u2014 ${fmtK(j.orderTotal || j.billableAmount || 0)}`).join(', '),
      });
    }

    if (data.uniqueCustomers > 10) {
      positives.push({
        title: `Serving ${data.uniqueCustomers} different customers`,
        detail: `Good customer diversity in the active pipeline. Revenue isn't over-concentrated on any single account.`,
      });
    }

    if (positives.length === 0) {
      positives.push({
        title: 'Pipeline is active',
        detail: `${data.active.length} orders in the system worth ${fmtK(data.pipelineVal)}.`,
      });
    }

    // ── EXECUTIVE SUMMARY ──────────────────────────────────────────────────
    const summaryParts: string[] = [];

    if (data.producingCount === 0 && data.blockedCount > 0) {
      summaryParts.push(
        `Production is at a standstill. All ${data.active.length} active orders worth ${fmtK(data.pipelineVal)} are blocked in pre-production stages with nothing currently being worked on. `
        + `The biggest bottleneck is "${data.bottleneck.stage}" holding ${data.bottleneck.count} orders (${pct(data.bottleneck.count, data.active.length)}% of the pipeline). `
        + `This needs to be addressed immediately \u2014 every day the pipeline is stalled adds another day of delay to every customer order.`
      );
    } else if (data.blockedCount > data.producingCount) {
      summaryParts.push(
        `The pipeline is congested. ${data.blockedCount} orders are blocked vs only ${data.producingCount} in production. `
        + `Work is entering faster than it's being processed, creating a growing backlog. Bottleneck: "${data.bottleneck.stage}" with ${data.bottleneck.count} orders.`
      );
    } else {
      summaryParts.push(
        `Pipeline is flowing reasonably with ${data.producingCount} orders in production and ${data.blockedCount} waiting. ${data.active.length} active orders worth ${fmtK(data.pipelineVal)}.`
      );
    }

    if (data.overdue.length > 0) {
      const topReason = Object.entries(data.overdueByStatus).sort((a, b) => b[1].length - a[1].length)[0];
      summaryParts.push(
        `${data.overdue.length} orders are overdue totalling ${fmtK(data.overdueVal)}. `
        + (topReason ? `The primary root cause is "${topReason[0]}" \u2014 ${topReason[1].length} of the ${data.overdue.length} overdue orders are stuck at this stage because: ${STATUS_EXPLAIN[topReason[0]] || 'unknown reason'} ` : '')
        + (data.overdueAging.critical.length > 0
          ? `${data.overdueAging.critical.length} order${s(data.overdueAging.critical.length)} are critically late (30+ days). These customers are likely frustrated and need direct communication today.`
          : '')
      );
    }

    if (data.todayShip.length > 0) {
      summaryParts.push(
        `${data.todayShip.length} order${s(data.todayShip.length)} due today: ${data.todayReady.length} ready to ship, ${data.todayNotReady.length} not ready.`
        + (data.todayNotReady.length > 0 ? ` The ${data.todayNotReady.length} unready order${s(data.todayNotReady.length)} need urgent attention to avoid going overdue tonight.` : '')
      );
    } else {
      summaryParts.push(`No orders due for shipment today.`);
    }

    if (data.shipped7d.length > 0) {
      summaryParts.push(
        `Throughput: ${data.shipped7d.length} order${s(data.shipped7d.length)} shipped in the last 7 days`
        + (data.avgCycle ? ` with an average turnaround of ${data.avgCycle} days` : '')
        + '.'
        + (data.shippedPrev7d.length > 0
          ? ` ${data.shipped7d.length > data.shippedPrev7d.length ? 'Up' : data.shipped7d.length < data.shippedPrev7d.length ? 'Down' : 'Flat'} from ${data.shippedPrev7d.length} the previous week.`
          : '')
      );
    }

    return { issues, positives, summary: summaryParts.join('\n\n') };
  }, [data, now]);

  // ── Sentiment ─────────────────────────────────────────────────────────────
  const sentiment: 'green' | 'amber' | 'red' =
    (data.producingCount === 0 && data.blockedCount > 0) || data.overdue.length > 10 ? 'red' :
    data.overdue.length > 0 || data.atRisk.length > 0 || data.todayNotReady.length > 0 ? 'amber' : 'green';

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  const hr = now.getHours();
  const greet = hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';
  const toggleSection = (id: string) => setExpandedSection(expandedSection === id ? null : id);

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

          {/* Key metrics */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-5">
            <HeroStat label="Active Orders" value={data.active.length} />
            <HeroStat label="In Production" value={data.producingCount} good={data.producingCount > 0} warn={data.producingCount === 0} />
            <HeroStat label="Blocked" value={data.blockedCount} warn={data.blockedCount > data.producingCount} />
            <HeroStat label="Overdue" value={data.overdue.length} warn={data.overdue.length > 0} />
            <HeroStat label="Shipping Today" value={data.todayShip.length} warn={data.todayNotReady.length > 0} />
            <HeroStat label="Pipeline Value" value={fmtK(data.pipelineVal)} />
            {data.avgCycle && <HeroStat label="Avg Turnaround" value={`${data.avgCycle}d`} />}
          </div>

          {/* Situation brief */}
          <div className="bg-black/20 rounded-xl px-5 py-4 border border-white/5">
            <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Situation Brief</h3>
            <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{intelligence.summary}</p>
          </div>
        </div>
      </div>

      {/* ═══ ISSUES & ROOT CAUSES ═══ */}
      {intelligence.issues.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <button
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
            onClick={() => toggleSection('issues')}
          >
            <div className="flex items-center gap-3">
              <div className="text-left">
                <h2 className="text-sm font-bold text-white/90">Issues & Root Causes</h2>
                <p className="text-[11px] text-white/40">
                  {intelligence.issues.filter(i => i.severity === 'critical').length > 0 && `${intelligence.issues.filter(i => i.severity === 'critical').length} critical`}
                  {intelligence.issues.filter(i => i.severity === 'warning').length > 0 && ` \u00b7 ${intelligence.issues.filter(i => i.severity === 'warning').length} warning${s(intelligence.issues.filter(i => i.severity === 'warning').length)}`}
                  {intelligence.issues.filter(i => i.severity === 'info').length > 0 && ` \u00b7 ${intelligence.issues.filter(i => i.severity === 'info').length} info`}
                </p>
              </div>
            </div>
            <Chevron open={expandedSection === 'issues'} />
          </button>
          {expandedSection === 'issues' && (
            <div className="divide-y divide-white/[0.04] border-t border-white/5">
              {intelligence.issues.map((issue, i) => (
                <div key={i}>
                  <button
                    className="w-full px-5 py-3.5 flex items-start gap-3 hover:bg-white/[0.02] transition-colors text-left"
                    onClick={() => setExpandedIssue(expandedIssue === i ? null : i)}
                  >
                    <span className={`mt-0.5 w-3 h-3 rounded-full shrink-0 ${
                      issue.severity === 'critical' ? 'bg-red-400 animate-pulse' :
                      issue.severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${
                        issue.severity === 'critical' ? 'text-red-300' :
                        issue.severity === 'warning' ? 'text-amber-300' : 'text-blue-300'
                      }`}>{issue.title}</p>
                      <p className="text-xs text-white/50 mt-1 leading-relaxed">{issue.brief}</p>
                    </div>
                    <Chevron open={expandedIssue === i} />
                  </button>
                  {expandedIssue === i && (
                    <div className="px-5 pb-4 ml-8 space-y-3">
                      <div className="bg-black/20 rounded-lg px-4 py-3 border border-white/5">
                        <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Detailed Analysis</h4>
                        <p className="text-xs text-white/60 leading-relaxed whitespace-pre-line">{issue.detail}</p>
                      </div>
                      <div className={`rounded-lg px-4 py-3 border ${
                        issue.severity === 'critical' ? 'bg-red-500/5 border-red-500/15' :
                        issue.severity === 'warning' ? 'bg-amber-500/5 border-amber-500/15' :
                        'bg-blue-500/5 border-blue-500/15'
                      }`}>
                        <h4 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1">Recommended Action</h4>
                        <p className={`text-xs leading-relaxed ${
                          issue.severity === 'critical' ? 'text-red-300' :
                          issue.severity === 'warning' ? 'text-amber-300' : 'text-blue-300'
                        }`}>{issue.action}</p>
                      </div>
                      {issue.jobs && issue.jobs.length > 0 && (
                        <div>
                          <h4 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-1.5">
                            Affected Orders ({issue.jobs.length})
                          </h4>
                          <div className="max-h-60 overflow-y-auto space-y-0.5">
                            {issue.jobs.slice(0, 15).map(j => (
                              <JobRow key={j.id} j={j} now={now} onClick={() => onNavigateToOrder(j.jobNumber)} />
                            ))}
                            {issue.jobs.length > 15 && (
                              <p className="text-[10px] text-white/20 py-1 pl-2">+ {issue.jobs.length - 15} more orders</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ WHAT'S GOING WELL ═══ */}
      {intelligence.positives.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-emerald-500/10 overflow-hidden">
          <button
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
            onClick={() => toggleSection('positives')}
          >
            <div className="text-left">
              <h2 className="text-sm font-bold text-emerald-300">What's Going Well</h2>
              <p className="text-[11px] text-white/40">{intelligence.positives.length} positive${s(intelligence.positives.length)}</p>
            </div>
            <Chevron open={expandedSection === 'positives'} />
          </button>
          {expandedSection === 'positives' && (
            <div className="divide-y divide-white/[0.04] border-t border-white/5">
              {intelligence.positives.map((pos, i) => (
                <div key={i} className="px-5 py-3 flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-sm text-emerald-300 font-medium">{pos.title}</p>
                    <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{pos.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ OVERDUE DEEP DIVE ═══ */}
      {data.overdue.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-red-500/15 overflow-hidden">
          <button
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
            onClick={() => toggleSection('overdue')}
          >
            <div className="flex items-center gap-3 text-left">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-red-300">Overdue Deep Dive ({data.overdue.length})</h2>
                <p className="text-[11px] text-white/40">
                  {fmtK(data.overdueVal)} total value
                  {data.overdueAging.critical.length > 0 && ` \u00b7 ${data.overdueAging.critical.length} over 30 days late`}
                </p>
              </div>
            </div>
            <Chevron open={expandedSection === 'overdue'} />
          </button>
          {expandedSection === 'overdue' && (
            <div className="border-t border-white/5">
              {/* Aging breakdown */}
              <div className="px-5 py-3 border-b border-white/5">
                <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Aging Breakdown</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: '30+ days (critical)', count: data.overdueAging.critical.length, color: 'text-red-400', bg: 'bg-red-500/10' },
                    { label: '15-30 days (severe)', count: data.overdueAging.severe.length, color: 'text-orange-400', bg: 'bg-orange-500/10' },
                    { label: '7-14 days', count: data.overdueAging.moderate.length, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                    { label: '0-7 days', count: data.overdueAging.recent.length, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
                  ].map(a => (
                    <div key={a.label} className={`${a.bg} rounded-lg px-3 py-2.5 text-center`}>
                      <div className={`text-xl font-black ${a.color}`}>{a.count}</div>
                      <div className="text-[10px] text-white/40 mt-0.5">{a.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Root cause by status */}
              <div className="px-5 py-3 border-b border-white/5">
                <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Why They're Late (by current status)</h3>
                <div className="space-y-2">
                  {Object.entries(data.overdueByStatus)
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([status, jobs]) => {
                      const statusVal = jobs.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
                      return (
                        <div key={status} className="bg-black/20 rounded-lg px-4 py-2.5 border border-white/5">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${DOT[status] || 'bg-gray-400'}`} />
                              <span className="text-xs font-semibold text-white/70">{status}</span>
                              <span className="text-xs font-bold text-white/50">{jobs.length} order{s(jobs.length)}</span>
                            </div>
                            <span className="text-[10px] text-white/30">{fmtK(statusVal)}</span>
                          </div>
                          <p className="text-[11px] text-white/40 leading-relaxed">{STATUS_EXPLAIN[status] || ''}</p>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Repeat customers */}
              {data.repeatOverdueCustomers.length > 0 && (
                <div className="px-5 py-3 border-b border-white/5">
                  <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Customers With Multiple Overdue Orders</h3>
                  <div className="space-y-1.5">
                    {data.repeatOverdueCustomers.slice(0, 8).map(([name, jobs]) => (
                      <div key={name} className="flex items-center justify-between text-xs bg-black/10 rounded-lg px-3 py-1.5">
                        <span className="text-white/60">{name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-red-400/80 font-semibold">{jobs.length} overdue</span>
                          <span className="text-white/20">{fmtK(jobs.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full order list */}
              <div className="px-5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-wider">All Overdue Orders</h3>
                  {data.overdue.length > 8 && (
                    <button className="text-[10px] text-indigo-400 hover:text-indigo-300" onClick={() => setShowAllOverdue(!showAllOverdue)}>
                      {showAllOverdue ? 'Show less' : `Show all ${data.overdue.length}`}
                    </button>
                  )}
                </div>
                <div className="space-y-0.5 max-h-80 overflow-y-auto">
                  {(showAllOverdue ? data.overdue : data.overdue.slice(0, 8)).map(j => {
                    const due = pd(j.dateDue) || pd(j.productionDueDate);
                    const daysLate = due ? daysBetween(due, now) : 0;
                    return (
                      <div
                        key={j.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                        onClick={() => onNavigateToOrder(j.jobNumber)}
                      >
                        <span className={`text-xs font-bold shrink-0 w-12 text-right ${
                          daysLate > 30 ? 'text-red-400' : daysLate > 14 ? 'text-orange-400' : daysLate > 7 ? 'text-amber-400' : 'text-yellow-400'
                        }`}>{daysLate}d</span>
                        <span className="text-[10px] font-mono text-indigo-400/80 w-14 shrink-0">#{j.jobNumber}</span>
                        <span className="text-xs text-white/70 truncate flex-1 min-w-0">{j.customerName}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                          BLOCKED.has(j.status || '') ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                        }`}>{j.status}</span>
                        <span className="text-[10px] text-white/25 w-14 text-right shrink-0">{fmtK(j.orderTotal || j.billableAmount || 0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TWO-COLUMN: PIPELINE + WEEK ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* LEFT: Pipeline */}
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
            <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Pipeline Breakdown</h2>
            <span className="text-[10px] text-white/25">{data.active.length} active \u00b7 {fmtK(data.pipelineVal)}</span>
          </div>

          {/* Flow bar */}
          <div className="px-5 pt-4 pb-2">
            <div className="flex rounded-lg overflow-hidden h-6">
              {FLOW.filter(st => data.stages[st]?.length).map(st => {
                const n = data.stages[st]!.length;
                const p = Math.max((n / data.active.length) * 100, 3);
                return (
                  <div
                    key={st}
                    className={`${BAR[st] || 'bg-gray-500'}/40 flex items-center justify-center cursor-pointer hover:brightness-125 border-r border-black/20 last:border-0 transition-all`}
                    style={{ width: `${p}%` }}
                    onClick={() => setExpandedStage(expandedStage === st ? null : st)}
                    title={`${st}: ${n}`}
                  >
                    {p > 8 && <span className="text-[10px] font-bold text-white/80">{n}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-white/20">Waiting</span>
              <span className="text-[9px] text-white/20">Producing</span>
            </div>
          </div>

          {/* Stage list */}
          <div className="px-4 pb-3">
            {FLOW.filter(st => data.stages[st]?.length).map(st => {
              const jobs = data.stages[st]!;
              const val = jobs.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
              const isBlocked = BLOCKED.has(st);
              const overdueInStage = jobs.filter(j => { const d = pd(j.dateDue) || pd(j.productionDueDate); return d && d < t0; }).length;
              const isOpen = expandedStage === st;
              return (
                <div key={st}>
                  <div
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${isOpen ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                    onClick={() => setExpandedStage(isOpen ? null : st)}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[st] || 'bg-gray-400'}`} />
                    <span className={`text-xs flex-1 font-medium ${isBlocked ? 'text-white/50' : 'text-white/70'}`}>{st}</span>
                    {overdueInStage > 0 && <span className="text-[9px] text-red-400/80 font-semibold">{overdueInStage} late</span>}
                    <span className="text-xs font-bold text-white/60 w-7 text-right">{jobs.length}</span>
                    <span className="text-[10px] text-white/25 w-14 text-right">{fmtK(val)}</span>
                    <Chevron open={isOpen} small />
                  </div>
                  {isOpen && (
                    <div className="ml-5 mb-2 border-l border-white/5 pl-2">
                      <p className="text-[11px] text-white/35 px-2 py-1.5 italic leading-relaxed">{STATUS_EXPLAIN[st] || ''}</p>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {jobs.sort((a, b) => {
                          const da = pd(a.dateDue) || pd(a.productionDueDate);
                          const db = pd(b.dateDue) || pd(b.productionDueDate);
                          return (da?.getTime() || 0) - (db?.getTime() || 0);
                        }).slice(0, 20).map(j => (
                          <JobRow key={j.id} j={j} now={now} onClick={() => onNavigateToOrder(j.jobNumber)} />
                        ))}
                        {jobs.length > 20 && <p className="text-[10px] text-white/20 py-1 pl-2">+ {jobs.length - 20} more</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Blockers summary */}
          {data.blockedStages.length > 0 && (
            <div className="px-5 py-3 border-t border-white/5">
              <h3 className="text-[10px] font-bold text-amber-400/60 uppercase tracking-wider mb-2">Blocked Work Summary</h3>
              <div className="flex flex-wrap gap-2">
                {data.blockedStages.map(b => (
                  <span key={b.stage} className="text-[11px] text-white/50 bg-white/[0.04] px-2.5 py-1 rounded-lg">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${DOT[b.stage] || 'bg-gray-400'}`} />
                    {b.stage}: <span className="font-semibold text-white/70">{b.count}</span>
                    <span className="text-white/25 ml-1">({fmtK(b.value)})</span>
                    {b.overdueCount > 0 && <span className="text-red-400/60 ml-1">{b.overdueCount} late</span>}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-white/30 mt-2">
                {pct(data.blockedCount, data.active.length)}% of all active orders are blocked.
                {data.producingCount === 0 ? ' Nothing is currently in production.' : ` Only ${data.producingCount} order${s(data.producingCount)} in production.`}
              </p>
            </div>
          )}
        </div>

        {/* RIGHT: Week + Performance */}
        <div className="space-y-4">
          {/* Week Schedule */}
          <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">This Week</h2>
              <span className="text-[10px] text-white/25">{data.weekDays.reduce((acc, w) => acc + w.total, 0)} due</span>
            </div>
            <div className="grid grid-cols-5 gap-0 border-b border-white/5">
              {data.weekDays.map(day => (
                <div
                  key={day.label}
                  className={`text-center py-3 cursor-pointer transition-colors ${
                    day.isToday ? 'bg-indigo-500/10' :
                    day.isPast ? 'opacity-40' : 'hover:bg-white/[0.03]'
                  }`}
                  onClick={() => setExpandedDay(expandedDay === day.label ? null : day.label)}
                >
                  <div className={`text-[10px] font-bold uppercase ${day.isToday ? 'text-indigo-400' : 'text-white/40'}`}>{day.label}</div>
                  <div className={`text-lg font-black mt-0.5 ${
                    day.total === 0 ? 'text-white/15' : day.notReady > 0 ? 'text-white' : 'text-white/80'
                  }`}>{day.total}</div>
                  {day.notReady > 0 && <div className="text-[9px] text-amber-400 mt-0.5">{day.notReady} not ready</div>}
                  {day.total > 0 && day.notReady === 0 && <div className="text-[9px] text-emerald-400/50 mt-0.5">all ready</div>}
                </div>
              ))}
            </div>
            {expandedDay && (() => {
              const day = data.weekDays.find(w => w.label === expandedDay);
              if (!day || day.jobs.length === 0) return null;
              return (
                <div className="px-3 py-2 border-b border-white/5 max-h-48 overflow-y-auto">
                  <p className="text-[10px] text-white/30 px-2 mb-1">{day.dateStr} \u2014 {day.total} due, {fmtK(day.value)}</p>
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
            {data.todayShip.length > 0 ? (
              <div className="px-4 py-3">
                <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">
                  Today's Shipments ({data.todayShip.length})
                  {data.todayNotReady.length > 0 && (
                    <span className="text-amber-400 ml-1 normal-case font-normal">\u2014 {data.todayNotReady.length} not ready</span>
                  )}
                </h3>
                {data.todayShip.map(j => (
                  <JobRow key={j.id} j={j} now={now} onClick={() => onNavigateToOrder(j.jobNumber)} />
                ))}
              </div>
            ) : (
              <div className="px-5 py-3 text-xs text-white/20 italic">No orders due today</div>
            )}
          </div>

          {/* Performance */}
          <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5">
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Performance</h2>
            </div>
            <div className="grid grid-cols-2 gap-0 divide-x divide-white/5">
              <div className="px-4 py-3 text-center">
                <div className={`text-2xl font-black ${data.shipped7d.length > 0 ? 'text-emerald-400' : 'text-white/20'}`}>{data.shipped7d.length}</div>
                <div className="text-[10px] text-white/35 mt-0.5">Shipped (7 days)</div>
                {data.shippedPrev7d.length > 0 && (
                  <div className={`text-[10px] mt-1 ${data.shipped7d.length >= data.shippedPrev7d.length ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                    {data.shipped7d.length >= data.shippedPrev7d.length ? '\u25b2' : '\u25bc'} vs {data.shippedPrev7d.length} prev week
                  </div>
                )}
              </div>
              <div className="px-4 py-3 text-center">
                <div className={`text-2xl font-black ${data.onTimeRate !== null ? data.onTimeRate >= 80 ? 'text-emerald-400' : data.onTimeRate >= 50 ? 'text-amber-400' : 'text-red-400' : 'text-white/20'}`}>
                  {data.onTimeRate !== null ? `${data.onTimeRate}%` : '\u2014'}
                </div>
                <div className="text-[10px] text-white/35 mt-0.5">On-time (14 days)</div>
                {data.onTimeRate !== null && (
                  <div className="text-[10px] text-white/25 mt-1">{data.onTimeCount} of {data.shipped14d.length}</div>
                )}
              </div>
            </div>
            {data.avgCycle !== null && (
              <div className="px-5 py-2.5 border-t border-white/5 flex items-center justify-between">
                <span className="text-xs text-white/40">Avg turnaround</span>
                <span className="text-xs text-white/70 font-semibold">{data.avgCycle}d <span className="text-white/25 font-normal">(fastest: {data.fastestCycle}d, slowest: {data.slowestCycle}d)</span></span>
              </div>
            )}
            {data.shippedYesterday.length > 0 && (
              <div className="px-5 py-3 border-t border-white/5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-xs text-white/40">Shipped yesterday</span>
                  <span className="text-xs text-emerald-400/70 font-semibold">{data.shippedYesterday.length} \u00b7 {fmtK(data.shippedYestVal)}</span>
                </div>
                {data.shippedYesterday.map(j => (
                  <div key={j.id} className="flex items-center gap-2 text-[11px] text-white/35 py-0.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                    <span className="truncate flex-1">{j.customerName}</span>
                    <span className="text-white/20 shrink-0">#{j.jobNumber}</span>
                    <span className="text-white/15 shrink-0">{fmtK(j.orderTotal || j.billableAmount || 0)}</span>
                  </div>
                ))}
              </div>
            )}
            {data.newOrders.length > 0 && (
              <div className="px-5 py-3 border-t border-white/5">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-xs text-white/40">New orders</span>
                  <span className="text-xs text-blue-400/70 font-semibold">{data.newOrders.length} \u00b7 {fmtK(data.newVal)}</span>
                </div>
                {data.newOrders.map(j => (
                  <div key={j.id} className="flex items-center gap-2 text-[11px] text-white/35 py-0.5">
                    <span className="w-1 h-1 rounded-full bg-blue-500 shrink-0" />
                    <span className="truncate flex-1">{j.customerName}</span>
                    <span className="text-white/20 shrink-0">{fmtK(j.orderTotal || j.billableAmount || 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function HeroStat({ label, value, warn, good }: { label: string; value: number | string; warn?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-lg font-black ${warn ? 'text-amber-400' : good ? 'text-emerald-400' : 'text-white/90'}`}>{value}</span>
      <span className="text-xs text-white/35">{label}</span>
    </div>
  );
}

function Chevron({ open, small }: { open: boolean; small?: boolean }) {
  return (
    <svg className={`${small ? 'w-3 h-3' : 'w-4 h-4'} text-white/20 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function JobRow({ j, now, onClick }: { j: DecoJob; now: Date; onClick: () => void }) {
  const due = pd(j.dateDue) || pd(j.productionDueDate);
  const late = due && due < now;
  const daysLate = due ? daysBetween(due, now) : 0;
  const isBlocked = BLOCKED.has(j.status || '');

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors group"
      onClick={onClick}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[j.status || ''] || 'bg-gray-400'}`} />
      <span className="text-[10px] font-mono text-indigo-400/70 w-12 shrink-0 group-hover:text-indigo-300">#{j.jobNumber}</span>
      <span className={`text-[11px] truncate flex-1 min-w-0 ${late ? 'text-white/70' : 'text-white/50'}`}>{j.customerName}</span>
      {isBlocked && <span className="text-[9px] text-amber-400/50 shrink-0 hidden sm:inline">{j.status}</span>}
      {late && <span className={`text-[9px] font-bold shrink-0 ${daysLate > 14 ? 'text-red-400' : daysLate > 7 ? 'text-orange-400' : 'text-amber-400'}`}>{daysLate}d late</span>}
      {!late && due && <span className="text-[9px] text-white/20 shrink-0">{due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>}
      <span className="text-[9px] text-white/15 w-12 text-right shrink-0">{fmtK(j.orderTotal || j.billableAmount || 0)}</span>
    </div>
  );
}
