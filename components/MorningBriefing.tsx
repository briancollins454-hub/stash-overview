import React, { useState, useMemo, useEffect } from 'react';
import type { DecoJob, UnifiedOrder } from '../types';
import { getItem } from '../services/localStore';

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

// Extract staff name from salesPerson which may be string, object {firstname,lastname,login,id}, or undefined
const extractSP = (sp: any): string | undefined => {
  if (!sp) return undefined;
  if (typeof sp === 'string') return sp;
  if (typeof sp === 'object') {
    if (sp.firstname || sp.lastname) return `${sp.firstname || ''} ${sp.lastname || ''}`.trim();
    if (sp.name) return sp.name;
    if (sp.full_name) return sp.full_name;
    if (sp.login) return sp.login;
    const strVal = Object.values(sp).find((v: any) => typeof v === 'string' && v.length > 1);
    if (strVal) return strVal as string;
    return sp.id ? String(sp.id) : undefined;
  }
  return String(sp);
};

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

// Import shared priority engine
import { calculatePriority, URGENCY_STYLE } from '../services/priorityEngine';

export default function MorningBriefing({ decoJobs, orders, onNavigateToOrder }: Props) {
  const [expandedSection, setExpandedSection] = useState<string | null>('issues');
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(0);
  const [financeJobs, setFinanceJobs] = useState<DecoJob[] | null>(null);

  // Load cached finance data (same source as Financial Dashboard) for complete Deco picture
  useEffect(() => {
    (async () => {
      try {
        const cached = await getItem<DecoJob[]>('stash_finance_jobs');
        if (cached && cached.length > 0) setFinanceJobs(cached);
      } catch { /* no cache available */ }
    })();
  }, []);

  // Use whichever data source is more complete
  // Fresh prop data overrides cache — prop data has salesPerson from include_user_assignments
  const allDecoJobs = useMemo(() => {
    if (!financeJobs || financeJobs.length <= decoJobs.length) return decoJobs;
    // Merge: prop data (with salesPerson) takes priority over cache (without)
    const propMap = new Map(decoJobs.map(j => [j.jobNumber, j]));
    return financeJobs.map(j => propMap.get(j.jobNumber) || j)
      .concat(decoJobs.filter(j => !financeJobs.some(f => f.jobNumber === j.jobNumber)));
  }, [decoJobs, financeJobs]);



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

    const live = allDecoJobs.filter(j => !isCancelled(j));
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

    // ── PRODUCTION PROGRESS ──────────────────────────────────────────────
    const totalItemsCount = active.reduce((acc, j) => acc + (j.totalItems || 0), 0);
    const itemsProducedCount = active.reduce((acc, j) => acc + (j.itemsProduced || 0), 0);
    const productionPct = totalItemsCount > 0 ? pct(itemsProducedCount, totalItemsCount) : null;
    const ordersWithProgress = active.filter(j => (j.totalItems || 0) > 0);
    const ordersNoProgress = ordersWithProgress.filter(j => (j.itemsProduced || 0) === 0);

    // ── ACCOUNTS RECEIVABLE ──────────────────────────────────────────────
    const arJobs = live.filter(j => (j.outstandingBalance || 0) > 0);
    const totalAR = arJobs.reduce((acc, j) => acc + (j.outstandingBalance || 0), 0);
    const arOverdue = arJobs.filter(j => {
      const inv = pd(j.dateInvoiced);
      return inv && daysBetween(inv, now) > 30;
    });
    const totalAROverdue = arOverdue.reduce((acc, j) => acc + (j.outstandingBalance || 0), 0);

    // ── PAYMENT RISK ─────────────────────────────────────────────────────
    const paymentRisk = active.filter(j => {
      const bal = j.outstandingBalance || 0;
      const inProd = PRODUCING.has(j.status || '');
      return inProd && bal > 0;
    });
    const paymentRiskVal = paymentRisk.reduce((acc, j) => acc + (j.outstandingBalance || 0), 0);

    // ── MTO vs STOCK ─────────────────────────────────────────────────────
    const mtoOrders = orders.filter(o => o.isMto && o.shopify.fulfillmentStatus !== 'fulfilled');
    const stockOrders = orders.filter(o => o.hasStockItems && !o.isMto && o.shopify.fulfillmentStatus !== 'fulfilled');
    const mixedOrders = orders.filter(o => o.isMto && o.hasStockItems && o.shopify.fulfillmentStatus !== 'fulfilled');
    const avgMtoCompletion = mtoOrders.length > 0
      ? Math.round(mtoOrders.reduce((acc, o) => acc + (o.mtoCompletionPercentage || 0), 0) / mtoOrders.length) : null;
    const avgStockCompletion = stockOrders.length > 0
      ? Math.round(stockOrders.reduce((acc, o) => acc + (o.stockCompletionPercentage || 0), 0) / stockOrders.length) : null;

    // ── CLUB BREAKDOWN ───────────────────────────────────────────────────
    const clubMap = new Map<string, { total: number; overdue: number; ready: number; value: number }>();
    orders.filter(o => o.clubName && o.shopify.fulfillmentStatus !== 'fulfilled').forEach(o => {
      const club = o.clubName!;
      const entry = clubMap.get(club) || { total: 0, overdue: 0, ready: 0, value: 0 };
      entry.total++;
      if (o.daysRemaining !== undefined && o.daysRemaining < 0) entry.overdue++;
      if (o.isStockDispatchReady) entry.ready++;
      entry.value += parseFloat(o.shopify.totalPrice || '0');
      clubMap.set(club, entry);
    });
    const clubs = Array.from(clubMap.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.total - a.total);

    // ── SLA COUNTDOWN ────────────────────────────────────────────────────
    const slaUrgent = orders.filter(o => {
      return o.shopify.fulfillmentStatus !== 'fulfilled'
        && o.daysRemaining !== undefined
        && o.daysRemaining >= 0
        && o.daysRemaining <= 2;
    }).sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));

    // ── MAPPING GAPS ─────────────────────────────────────────────────────
    const mappingGaps = orders.filter(o =>
      o.shopify.fulfillmentStatus !== 'fulfilled'
      && (o.eligibleCount || 0) > 0
      && (o.mappedPercentage || 0) < 100
    );
    const avgMapping = mappingGaps.length > 0
      ? Math.round(orders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled' && (o.eligibleCount || 0) > 0)
          .reduce((acc, o) => acc + (o.mappedPercentage || 0), 0)
        / orders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled' && (o.eligibleCount || 0) > 0).length)
      : 100;

    // ── REFUNDS ──────────────────────────────────────────────────────────
    const recentRefunds = live.filter(j => j.refunds && j.refunds.length > 0);
    const totalRefunded = recentRefunds.reduce((acc, j) =>
      acc + (j.refunds || []).reduce((a, r) => a + (r.amount || 0), 0), 0);

    // ══════════════════════════════════════════════════════════════════════
    // UPGRADES 1-8
    // ══════════════════════════════════════════════════════════════════════

    // ── 1. DO FIRST PRIORITY LIST (scored by priority engine) ───────────
    const doFirst = active.map(j => calculatePriority(j, now))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    // ── 2. REVENUE VELOCITY ──────────────────────────────────────────────
    const ordersIn7d = live.filter(j => { const o = pd(j.dateOrdered); return o && o >= sevenAgo; });
    const ordersInPrev7d = live.filter(j => { const o = pd(j.dateOrdered); return o && o >= fourteenAgo && o < sevenAgo; });
    const revIn7d = ordersIn7d.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const revInPrev7d = ordersInPrev7d.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const revOut7d = shipped7d.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const revOutPrev7d = shippedPrev7d.reduce((acc, j) => acc + (j.orderTotal || j.billableAmount || 0), 0);
    const netFlow7d = revIn7d - revOut7d;

    // ── 3. TOP CUSTOMERS AT RISK ─────────────────────────────────────────
    const customerRiskMap = new Map<string, { name: string; overdue: number; atRisk: number; blocked: number; total: number; value: number }>();
    active.forEach(j => {
      const name = j.customerName || 'Unknown';
      const entry = customerRiskMap.get(name) || { name, overdue: 0, atRisk: 0, blocked: 0, total: 0, value: 0 };
      entry.total++;
      entry.value += j.orderTotal || j.billableAmount || 0;
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      if (due && due < t0) entry.overdue++;
      if (due && due >= t0 && due <= in48h && BLOCKED.has(j.status || '')) entry.atRisk++;
      if (BLOCKED.has(j.status || '')) entry.blocked++;
      customerRiskMap.set(name, entry);
    });
    const customersAtRisk = Array.from(customerRiskMap.values())
      .filter(c => c.overdue > 0 || c.atRisk > 0)
      .sort((a, b) => (b.overdue * 3 + b.atRisk * 2 + b.blocked) - (a.overdue * 3 + a.atRisk * 2 + a.blocked))
      .slice(0, 10);

    // ── 4. VENDOR BOTTLENECK INTELLIGENCE ────────────────────────────────
    const vendorMap = new Map<string, { vendor: string; totalItems: number; orderCount: number; blockedOrders: number; overdueOrders: number; value: number }>();
    orders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled').forEach(o => {
      const isBlk = o.deco ? BLOCKED.has(o.deco.status || '') : false;
      const isOvd = o.daysRemaining !== undefined && o.daysRemaining < 0;
      const vendors = new Set(o.shopify.items.map(i => i.vendor || 'Unknown'));
      vendors.forEach(vendor => {
        const entry = vendorMap.get(vendor) || { vendor, totalItems: 0, orderCount: 0, blockedOrders: 0, overdueOrders: 0, value: 0 };
        const vi = o.shopify.items.filter(i => (i.vendor || 'Unknown') === vendor);
        entry.totalItems += vi.reduce((acc, i) => acc + i.quantity, 0);
        entry.orderCount++;
        if (isBlk) entry.blockedOrders++;
        if (isOvd) entry.overdueOrders++;
        entry.value += vi.reduce((acc, i) => acc + parseFloat(i.price || '0') * i.quantity, 0);
        vendorMap.set(vendor, entry);
      });
    });
    const vendorBottlenecks = Array.from(vendorMap.values())
      .filter(v => v.totalItems >= 3)
      .sort((a, b) => (b.overdueOrders * 3 + b.blockedOrders) - (a.overdueOrders * 3 + a.blockedOrders))
      .slice(0, 8);

    // ── 5. CAPACITY FORECAST ─────────────────────────────────────────────
    const dailyThroughput = shipped7d.length > 0 ? +(shipped7d.length / 7).toFixed(1) : null;
    const daysToClear = dailyThroughput && dailyThroughput > 0 ? Math.ceil(active.length / dailyThroughput) : null;

    // ── 6. DAYS-IN-STAGE AGING ───────────────────────────────────────────
    const stageAging = FLOW.filter(st => (stages[st] || []).length > 0).map(st => {
      const stJobs = stages[st]!;
      const ages = stJobs.map(j => {
        const ord = pd(j.dateOrdered);
        return ord ? daysBetween(ord, now) : 0;
      }).filter(a => a > 0);
      const avgAge = ages.length > 0 ? +(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : 0;
      const maxAge = ages.length > 0 ? Math.max(...ages) : 0;
      return { stage: st, count: stJobs.length, avgAge, maxAge };
    });

    // ── 7. EMAIL ENQUIRY ALERTS ──────────────────────────────────────────
    const emailEnquiries = orders.filter(o =>
      o.hasEmailEnquiry && o.shopify.fulfillmentStatus !== 'fulfilled'
    );

    // ── 8. CARRIER & SHIPPING COST SUMMARY ───────────────────────────────
    const carrierMap = new Map<string, { carrier: string; shipments: number; totalCost: number }>();
    orders.filter(o => o.shipStationTracking).forEach(o => {
      const tr = o.shipStationTracking!;
      const carrier = tr.carrier || tr.carrierCode || 'Unknown';
      const entry = carrierMap.get(carrier) || { carrier, shipments: 0, totalCost: 0 };
      entry.shipments++;
      entry.totalCost += tr.shippingCost || 0;
      carrierMap.set(carrier, entry);
    });
    const carriers = Array.from(carrierMap.values()).sort((a, b) => b.shipments - a.shipments);
    const totalShippingCost = carriers.reduce((acc, c) => acc + c.totalCost, 0);

    // ── PLATFORM COMPARISON: SHOPIFY vs DECO ─────────────────────────────
    const openOrders = orders.filter(o => o.shopify.fulfillmentStatus !== 'fulfilled');
    const shopifyByFulfillment: Record<string, { count: number; value: number }> = {};
    const shopifyByPayment: Record<string, { count: number; value: number }> = {};
    openOrders.forEach(o => {
      const fs = o.shopify.fulfillmentStatus || 'unfulfilled';
      const label = fs === 'unfulfilled' ? 'Unfulfilled' : fs === 'partial' ? 'Partially Fulfilled' : fs === 'restocked' ? 'Restocked' : fs;
      if (!shopifyByFulfillment[label]) shopifyByFulfillment[label] = { count: 0, value: 0 };
      shopifyByFulfillment[label].count++;
      shopifyByFulfillment[label].value += parseFloat(o.shopify.totalPrice || '0');

      const ps = o.shopify.paymentStatus || 'pending';
      const pLabel = ps === 'paid' ? 'Paid' : ps === 'pending' ? 'Pending' : ps === 'refunded' ? 'Refunded' : ps;
      if (!shopifyByPayment[pLabel]) shopifyByPayment[pLabel] = { count: 0, value: 0 };
      shopifyByPayment[pLabel].count++;
      shopifyByPayment[pLabel].value += parseFloat(o.shopify.totalPrice || '0');
    });
    // Items-level breakdown for Shopify
    const shopifyItemStatuses: Record<string, { count: number; items: number }> = {};
    openOrders.forEach(o => {
      o.shopify.items.forEach(item => {
        const ist = item.itemStatus === 'fulfilled' ? 'Fulfilled' : item.itemStatus === 'restocked' ? 'Restocked' : 'Unfulfilled';
        if (!shopifyItemStatuses[ist]) shopifyItemStatuses[ist] = { count: 0, items: 0 };
        shopifyItemStatuses[ist].count++;
        shopifyItemStatuses[ist].items += item.quantity;
      });
    });

    // Deco statuses for the same comparison
    const decoByStatus: Record<string, { count: number; value: number }> = {};
    active.forEach(j => {
      const st = j.status || 'Unknown';
      if (!decoByStatus[st]) decoByStatus[st] = { count: 0, value: 0 };
      decoByStatus[st].count++;
      decoByStatus[st].value += (j.orderTotal || j.billableAmount || 0);
    });
    // Add shipped/completed from live (not active)
    const shippedJobs = live.filter(j => (j.status || '').toLowerCase() === 'shipped');
    const completedJobs = live.filter(j => (j.status || '').toLowerCase() === 'completed');
    if (shippedJobs.length > 0) {
      decoByStatus['Shipped'] = { count: shippedJobs.length, value: shippedJobs.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0) };
    }
    if (completedJobs.length > 0) {
      decoByStatus['Completed'] = { count: completedJobs.length, value: completedJobs.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0) };
    }

    // ── DECO-ONLY: exclude Shopify-imported orders ──
    // Exclude if customer contains "stash shop"
    const isShopifyImport = (j: DecoJob) => {
      const n = (j.customerName || '').toLowerCase().replace(/\s+/g, '');
      return n.includes('stashshop');
    };
    const decoOnlyLive = live.filter(j => !isShopifyImport(j));
    const decoOnlyActive = decoOnlyLive.filter(j => {
      const st = (j.status || '').toLowerCase();
      return st !== 'shipped' && st !== 'completed';
    });
    const decoOnlyShipped = decoOnlyLive.filter(j => (j.status || '').toLowerCase() === 'shipped');
    const decoOnlyCompleted = decoOnlyLive.filter(j => (j.status || '').toLowerCase() === 'completed');
    const decoOnlyBlocked = decoOnlyActive.filter(j => BLOCKED.has(j.status || '')).length;
    const decoOnlyProducing = decoOnlyActive.filter(j => PRODUCING.has(j.status || '')).length;
    const decoOnlyOverdue = decoOnlyActive.filter(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      return due && due < t0;
    });
    const decoOnlyVal = decoOnlyLive.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);
    const decoOnlyPipelineVal = decoOnlyActive.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);
    const decoOnlyOverdueVal = decoOnlyOverdue.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);
    const decoOnlyItems = decoOnlyActive.reduce((a, j) => a + (j.totalItems || 0), 0);
    const decoOnlyProduced = decoOnlyActive.reduce((a, j) => a + (j.itemsProduced || 0), 0);
    const decoOnlyProdPct = decoOnlyItems > 0 ? pct(decoOnlyProduced, decoOnlyItems) : null;
    const decoOnlyByStatus: Record<string, { count: number; value: number }> = {};
    decoOnlyActive.forEach(j => {
      const st = j.status || 'Unknown';
      if (!decoOnlyByStatus[st]) decoOnlyByStatus[st] = { count: 0, value: 0 };
      decoOnlyByStatus[st].count++;
      decoOnlyByStatus[st].value += (j.orderTotal || j.billableAmount || 0);
    });
    if (decoOnlyShipped.length > 0) {
      decoOnlyByStatus['Shipped'] = { count: decoOnlyShipped.length, value: decoOnlyShipped.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0) };
    }
    if (decoOnlyCompleted.length > 0) {
      decoOnlyByStatus['Completed'] = { count: decoOnlyCompleted.length, value: decoOnlyCompleted.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0) };
    }
    const decoOnlyBottleneck = FLOW.reduce((top, st) => {
      const n = decoOnlyActive.filter(j => j.status === st).length;
      return n > top.count ? { stage: st, count: n } : top;
    }, { stage: '', count: 0 });
    // Recent shipped/completed (last 30 days only)
    const thirtyAgo = new Date(t0); thirtyAgo.setDate(t0.getDate() - 30);
    const decoOnlyShippedRecent = decoOnlyShipped.filter(j => { const d = pd(j.dateShipped); return d && d >= thirtyAgo; });
    const decoOnlyCompletedRecent = decoOnlyCompleted.filter(j => { const d = pd(j.dateShipped) || pd(j.dateDue); return d && d >= thirtyAgo; });

    // ── STAFF ANALYTICS ──────────────────────────────────────────────────
    const staffMap = new Map<string, {
      name: string; active: number; blocked: number; overdue: number; overdueJobs: DecoJob[];
      producing: number; pipelineVal: number; stale: number; staleJobs: DecoJob[];
      shippedRecent: number; totalTurnaround: number; turnaroundCount: number;
    }>();
    active.forEach(j => {
      const sp = extractSP(j.salesPerson) || 'Unassigned';
      const e = staffMap.get(sp) || { name: sp, active: 0, blocked: 0, overdue: 0, overdueJobs: [], producing: 0, pipelineVal: 0, stale: 0, staleJobs: [], shippedRecent: 0, totalTurnaround: 0, turnaroundCount: 0 };
      e.active++;
      e.pipelineVal += j.orderTotal || j.billableAmount || 0;
      if (BLOCKED.has(j.status || '')) e.blocked++;
      if (PRODUCING.has(j.status || '')) e.producing++;
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      if (due && due < t0) { e.overdue++; e.overdueJobs.push(j); }
      const ord = pd(j.dateOrdered);
      if (ord && daysBetween(ord, now) > 30 && BLOCKED.has(j.status || '')) { e.stale++; e.staleJobs.push(j); }
      staffMap.set(sp, e);
    });
    // Add turnaround data from recent shipped
    const ninetyAgo = new Date(t0); ninetyAgo.setDate(t0.getDate() - 90);
    shipped.filter(j => { const d = pd(j.dateShipped); return d && d >= ninetyAgo; }).forEach(j => {
      const sp = extractSP(j.salesPerson) || 'Unassigned';
      const e = staffMap.get(sp) || { name: sp, active: 0, blocked: 0, overdue: 0, overdueJobs: [], producing: 0, pipelineVal: 0, stale: 0, staleJobs: [], shippedRecent: 0, totalTurnaround: 0, turnaroundCount: 0 };
      e.shippedRecent++;
      const ord = pd(j.dateOrdered); const shp = pd(j.dateShipped);
      if (ord && shp) { e.totalTurnaround += daysBetween(ord, shp); e.turnaroundCount++; }
      staffMap.set(sp, e);
    });
    const staffSummary = Array.from(staffMap.values())
      .filter(s => s.name !== 'Unassigned')
      .sort((a, b) => b.active - a.active);
    const staffUnassigned = staffMap.get('Unassigned') || null;
    // Do First grouped by staff
    const doFirstByStaff = new Map<string, typeof doFirst>();
    doFirst.forEach(item => {
      const sp = extractSP(item.job.salesPerson) || 'Unassigned';
      const arr = doFirstByStaff.get(sp) || [];
      arr.push(item);
      doFirstByStaff.set(sp, arr);
    });

    // Shopify orders grouped by their linked Deco job status
    const shopifyByDecoStatus: Record<string, { count: number; value: number }> = {};
    let shopifyLinked = 0;
    let shopifyUnlinked = 0;
    openOrders.forEach(o => {
      const decoStatus = o.deco ? (o.deco.status || 'Unknown') : 'No Deco Link';
      if (o.deco) shopifyLinked++; else shopifyUnlinked++;
      if (!shopifyByDecoStatus[decoStatus]) shopifyByDecoStatus[decoStatus] = { count: 0, value: 0 };
      shopifyByDecoStatus[decoStatus].count++;
      shopifyByDecoStatus[decoStatus].value += parseFloat(o.shopify.totalPrice || '0');
    });

    const totalShopifyOpen = openOrders.length;
    const totalShopifyVal = openOrders.reduce((a, o) => a + parseFloat(o.shopify.totalPrice || '0'), 0);
    const totalDecoLive = live.length;
    const totalDecoVal = live.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);

    return {
      active, shipped, stages, overdue, overdueAging, overdueByStatus,
      overdueByCustomer, repeatOverdueCustomers, atRisk, todayShip, todayReady,
      todayNotReady, newOrders, shippedYesterday, shipped7d, shipped14d, shippedPrev7d,
      avgCycle, fastestCycle, slowestCycle, weekDays,
      pipelineVal, overdueVal, shippedYestVal, newVal,
      producingCount, blockedCount, bottleneck, blockedStages, stockReady,
      noDueDate, onTimeRate, onTimeCount, uniqueCustomers, staleOrders,
      // New data
      totalItemsCount, itemsProducedCount, productionPct, ordersNoProgress,
      arJobs, totalAR, arOverdue, totalAROverdue,
      paymentRisk, paymentRiskVal,
      mtoOrders, stockOrders, mixedOrders, avgMtoCompletion, avgStockCompletion,
      clubs, slaUrgent, mappingGaps, avgMapping,
      recentRefunds, totalRefunded,
      // Upgrades 1-8
      doFirst, revIn7d, revInPrev7d, revOut7d, revOutPrev7d, netFlow7d,
      customersAtRisk, vendorBottlenecks,
      dailyThroughput, daysToClear,
      stageAging, emailEnquiries,
      carriers, totalShippingCost,
      // Platform comparison
      shopifyByFulfillment, shopifyByPayment, shopifyItemStatuses,
      decoByStatus, shopifyByDecoStatus, shopifyLinked, shopifyUnlinked,
      totalShopifyOpen, totalShopifyVal, totalDecoLive, totalDecoVal,
      // Deco-only (non-Shopify)
      decoOnlyLive, decoOnlyActive, decoOnlyShipped, decoOnlyCompleted,
      decoOnlyBlocked, decoOnlyProducing, decoOnlyOverdue, decoOnlyOverdueVal,
      decoOnlyVal, decoOnlyPipelineVal, decoOnlyItems, decoOnlyProduced, decoOnlyProdPct,
      decoOnlyByStatus, decoOnlyBottleneck,
      decoOnlyShippedRecent, decoOnlyCompletedRecent,
      // Staff analytics
      staffSummary, staffUnassigned, doFirstByStaff,
    };
  }, [allDecoJobs, orders, now, t0]);

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

    // 7. Accounts Receivable alert
    if (data.totalAR > 500) {
      issues.push({
        severity: data.totalAROverdue > 1000 ? 'critical' : data.totalAR > 2000 ? 'warning' : 'info',
        title: `${fmt(data.totalAR)} outstanding across ${data.arJobs.length} order${s(data.arJobs.length)}`,
        brief: `Accounts receivable is at ${fmt(data.totalAR)}.`
          + (data.arOverdue.length > 0 ? ` ${data.arOverdue.length} invoice${s(data.arOverdue.length)} totalling ${fmt(data.totalAROverdue)} are 30+ days overdue \u2014 these need chasing.` : ' All invoices are within terms.'),
        detail: data.arOverdue.length > 0
          ? `Invoices overdue by 30+ days:\n\n${data.arOverdue.slice(0, 10).map(j => {
              const inv = pd(j.dateInvoiced);
              const age = inv ? daysBetween(inv, now) : 0;
              return `\u2022 #${j.jobNumber} ${j.customerName} \u2014 ${fmt(j.outstandingBalance || 0)} invoiced ${age} days ago`;
            }).join('\n')}${data.arOverdue.length > 10 ? `\n\u2022 ...and ${data.arOverdue.length - 10} more` : ''}`
          : `All ${data.arJobs.length} outstanding invoices are within payment terms. Total: ${fmt(data.totalAR)}.`,
        action: data.arOverdue.length > 0
          ? `Send payment reminders for the ${data.arOverdue.length} overdue invoice${s(data.arOverdue.length)}. Escalate accounts over 60 days to management. Consider pausing new work for customers with outstanding aged debt.`
          : `Monitor \u2014 no action needed yet, all invoices are within terms.`,
      });
    }

    // 8. Payment risk \u2014 in production but unpaid
    if (data.paymentRisk.length > 0) {
      issues.push({
        severity: data.paymentRiskVal > 2000 ? 'warning' : 'info',
        title: `${data.paymentRisk.length} order${s(data.paymentRisk.length)} in production with unpaid balance (${fmt(data.paymentRiskVal)})`,
        brief: `These orders are being produced but still have outstanding payment. You're doing the work before receiving full payment, which is a financial risk.`,
        detail: data.paymentRisk.slice(0, 10).map(j =>
          `\u2022 #${j.jobNumber} ${j.customerName} \u2014 ${j.status}, outstanding: ${fmt(j.outstandingBalance || 0)}`
        ).join('\n') + (data.paymentRisk.length > 10 ? `\n\u2022 ...and ${data.paymentRisk.length - 10} more` : ''),
        jobs: data.paymentRisk,
        action: `Review payment terms for these orders. Consider holding shipment until payment is received for any that aren't on approved credit terms.`,
      });
    }

    // 9. Mapping gaps
    if (data.mappingGaps.length > 3 && data.avgMapping < 80) {
      issues.push({
        severity: data.avgMapping < 50 ? 'warning' : 'info',
        title: `Product mapping coverage at ${data.avgMapping}%`,
        brief: `${data.mappingGaps.length} order${s(data.mappingGaps.length)} have items that aren't fully mapped to Deco products. This means stock levels and production tracking may be inaccurate for these orders.`,
        detail: `Orders with incomplete mappings:\n\n${data.mappingGaps.slice(0, 8).map(o =>
          `\u2022 #${o.shopify.orderNumber} \u2014 ${o.mappedCount}/${o.eligibleCount} mapped (${o.mappedPercentage || 0}%)`
        ).join('\n')}${data.mappingGaps.length > 8 ? `\n\u2022 ...and ${data.mappingGaps.length - 8} more orders` : ''}`,
        action: `Review unmapped items and match them to Deco products. Better mapping coverage improves production tracking accuracy and stock readiness checks.`,
      });
    }

    // 10. Refund activity
    if (data.recentRefunds.length > 0) {
      issues.push({
        severity: data.totalRefunded > 500 ? 'warning' : 'info',
        title: `${data.recentRefunds.length} order${s(data.recentRefunds.length)} with refunds (${fmt(data.totalRefunded)})`,
        brief: `Refund activity detected. ${data.recentRefunds.length} order${s(data.recentRefunds.length)} have had refunds processed totalling ${fmt(data.totalRefunded)}. Review to understand if there are quality or service issues.`,
        detail: data.recentRefunds.slice(0, 8).map(j => {
          const refAmt = (j.refunds || []).reduce((a, r) => a + (r.amount || 0), 0);
          return `\u2022 #${j.jobNumber} ${j.customerName} \u2014 refund: ${fmt(refAmt)} (order total: ${fmt(j.orderTotal || 0)})`;
        }).join('\n') + (data.recentRefunds.length > 8 ? `\n\u2022 ...and ${data.recentRefunds.length - 8} more` : ''),
        action: `Review refund reasons. If there's a pattern (wrong items, quality issues, late delivery), address the root cause to reduce future refunds.`,
      });
    }

    // 11. SLA countdown \u2014 orders about to breach SLA
    if (data.slaUrgent.length > 0) {
      issues.push({
        severity: 'warning',
        title: `${data.slaUrgent.length} order${s(data.slaUrgent.length)} within 2 days of SLA target`,
        brief: `These orders are approaching their SLA deadline and need to ship within 48 hours to stay on-time.`,
        detail: data.slaUrgent.slice(0, 10).map(o => {
          const days = o.daysRemaining ?? 0;
          const target = o.slaTargetDate ? new Date(o.slaTargetDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '?';
          return `\u2022 #${o.shopify.orderNumber} \u2014 ${days === 0 ? 'DUE TODAY' : `${days} day${s(days)} left`} (target: ${target}), ${o.productionStatus || 'unknown status'}`;
        }).join('\n') + (data.slaUrgent.length > 10 ? `\n\u2022 ...and ${data.slaUrgent.length - 10} more` : ''),
        action: `Prioritise these for immediate dispatch. Check production status and ensure nothing is blocked.`,
      });
    }

    // 12. Email enquiry alerts
    if (data.emailEnquiries.length > 0) {
      issues.push({
        severity: data.emailEnquiries.length > 5 ? 'warning' : 'info',
        title: `${data.emailEnquiries.length} order${s(data.emailEnquiries.length)} with email enquiries pending`,
        brief: `These orders have unanswered email enquiries from customers. Delayed responses can lead to cancellations and poor customer experience.`,
        detail: data.emailEnquiries.slice(0, 10).map(o =>
          `\u2022 #${o.shopify.orderNumber} ${o.shopify.customerName} \u2014 ${o.productionStatus || 'unknown status'}`
        ).join('\n') + (data.emailEnquiries.length > 10 ? `\n\u2022 ...and ${data.emailEnquiries.length - 10} more` : ''),
        action: `Respond to customer enquiries today. Prioritise oldest emails first. A prompt reply prevents escalation and keeps orders moving.`,
      });
    }

    // 13. Vendor bottleneck alert
    const problemVendors = data.vendorBottlenecks.filter(v => v.overdueOrders > 0 || v.blockedOrders > 3);
    if (problemVendors.length > 0) {
      issues.push({
        severity: problemVendors.some(v => v.overdueOrders > 5) ? 'warning' : 'info',
        title: `${problemVendors.length} vendor${s(problemVendors.length)} causing bottlenecks`,
        brief: `Some vendors have a high number of blocked or overdue items in the pipeline. This may indicate supply chain issues.`,
        detail: problemVendors.map(v =>
          `\u2022 ${v.vendor}: ${v.totalItems} items across ${v.orderCount} orders, ${v.blockedOrders} blocked, ${v.overdueOrders} overdue (${fmtK(v.value)})`
        ).join('\n'),
        action: `Contact underperforming vendors for ETAs. Consider alternative suppliers for vendors with consistently delayed deliveries.`,
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

    if (data.productionPct !== null && data.productionPct > 0) {
      positives.push({
        title: `Production progress: ${data.itemsProducedCount} of ${data.totalItemsCount} items (${data.productionPct}%)`,
        detail: `Across all active orders${data.ordersNoProgress.length > 0 ? `. ${data.ordersNoProgress.length} order${s(data.ordersNoProgress.length)} with tracked items haven't started production yet.` : '. All orders with tracked items have some progress.'}`,
      });
    }

    if (data.mtoOrders.length > 0 || data.stockOrders.length > 0) {
      const parts: string[] = [];
      if (data.mtoOrders.length > 0) parts.push(`${data.mtoOrders.length} MTO${data.avgMtoCompletion !== null ? ` (${data.avgMtoCompletion}% avg completion)` : ''}`);
      if (data.stockOrders.length > 0) parts.push(`${data.stockOrders.length} stock-only${data.avgStockCompletion !== null ? ` (${data.avgStockCompletion}% avg completion)` : ''}`);
      if (data.mixedOrders.length > 0) parts.push(`${data.mixedOrders.length} mixed`);
      positives.push({
        title: `Order mix: ${parts.join(', ')}`,
        detail: `MTO orders require production lead time. Stock orders can ship faster once items are available.${data.mixedOrders.length > 0 ? ` ${data.mixedOrders.length} order${s(data.mixedOrders.length)} contain both MTO and stock items.` : ''}`,
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

    if (data.productionPct !== null) {
      summaryParts.push(
        `Production progress: ${data.itemsProducedCount} of ${data.totalItemsCount} items produced (${data.productionPct}%).`
        + (data.mtoOrders.length > 0 ? ` MTO: ${data.mtoOrders.length} order${s(data.mtoOrders.length)}${data.avgMtoCompletion !== null ? ` at ${data.avgMtoCompletion}% avg completion` : ''}.` : '')
        + (data.stockOrders.length > 0 ? ` Stock: ${data.stockOrders.length} order${s(data.stockOrders.length)}${data.avgStockCompletion !== null ? ` at ${data.avgStockCompletion}% avg completion` : ''}.` : '')
      );
    }

    if (data.totalAR > 500) {
      summaryParts.push(
        `Accounts receivable: ${fmt(data.totalAR)} outstanding.`
        + (data.arOverdue.length > 0 ? ` ${fmt(data.totalAROverdue)} is 30+ days overdue across ${data.arOverdue.length} invoice${s(data.arOverdue.length)}.` : '')
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
            {data.productionPct !== null && <HeroStat label="Items Produced" value={`${data.productionPct}%`} warn={data.productionPct < 30} good={data.productionPct >= 70} />}
            {data.totalAR > 500 && <HeroStat label="Outstanding AR" value={fmtK(data.totalAR)} warn={data.arOverdue.length > 0} />}
            {data.dailyThroughput !== null && <HeroStat label="Daily Output" value={data.dailyThroughput} />}
            {data.daysToClear !== null && <HeroStat label="Days to Clear" value={`${data.daysToClear}d`} warn={data.daysToClear > 30} good={data.daysToClear <= 14} />}
          </div>

          {/* Production progress bar */}
          {data.productionPct !== null && data.totalItemsCount > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-white/35 uppercase tracking-wider font-bold">Production Progress</span>
                <span className="text-[10px] text-white/40">{data.itemsProducedCount.toLocaleString()} / {data.totalItemsCount.toLocaleString()} items</span>
              </div>
              <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${data.productionPct >= 70 ? 'bg-emerald-500' : data.productionPct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(data.productionPct, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Staff workload snapshot */}
          {data.staffSummary.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-white/35 uppercase tracking-wider font-bold">Team Workload</span>
                <span className="text-[10px] text-white/40">{data.staffSummary.length} staff active{data.staffUnassigned ? ` \u00b7 ${data.staffUnassigned.active} unassigned` : ''}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.staffSummary.map(st => (
                  <div key={st.name} className={`px-3 py-1.5 rounded-lg text-xs border ${
                    st.overdue > 0 ? 'border-red-500/20 bg-red-500/5' : st.blocked > st.producing ? 'border-amber-500/20 bg-amber-500/5' : 'border-white/5 bg-white/[0.02]'
                  }`}>
                    <span className="font-semibold text-white/80">{String(st.name).split(' ')[0]}</span>
                    <span className="text-white/40 ml-1.5">{st.active} job{s(st.active)}</span>
                    {st.overdue > 0 && <span className="text-red-400 ml-1.5">({st.overdue} overdue)</span>}
                    {st.overdue === 0 && st.stale > 0 && <span className="text-amber-400 ml-1.5">({st.stale} stale)</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Situation brief */}
          <div className="bg-black/20 rounded-xl px-5 py-4 border border-white/5">
            <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Situation Brief</h3>
            <p className="text-sm text-white/70 leading-relaxed whitespace-pre-line">{intelligence.summary}</p>
          </div>
        </div>
      </div>

      {/* ═══ PLATFORM OVERVIEW: SHOPIFY vs DECO ═══ */}
      <div className="grid grid-cols-2 gap-4">

        {/* LEFT: Shopify — exact hero card clone */}
        <div className={`relative rounded-2xl overflow-hidden border ${data.shopifyUnlinked > 50 ? 'border-red-500/30 bg-gradient-to-br from-red-500/15 via-rose-600/5 to-transparent' : 'border-green-500/30 bg-gradient-to-br from-green-500/15 via-green-600/5 to-transparent'}`}>
          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-xl font-black text-white tracking-tight">Shopify Orders</h1>
                <p className="text-xs text-white/35 mt-0.5">Orders placed on Shopify, imported to Deco for production</p>
              </div>
              <div className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-green-500/20 text-green-400">
                {data.totalShopifyOpen} Open
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-5">
              <HeroStat label="Open Orders" value={data.totalShopifyOpen} />
              <HeroStat label="Unfulfilled" value={data.shopifyByFulfillment['Unfulfilled']?.count || 0} warn={(data.shopifyByFulfillment['Unfulfilled']?.count || 0) > 0} />
              <HeroStat label="Partial" value={data.shopifyByFulfillment['Partially Fulfilled']?.count || 0} />
              <HeroStat label="Paid" value={data.shopifyByPayment['Paid']?.count || 0} good={(data.shopifyByPayment['Paid']?.count || 0) > 0} />
              <HeroStat label="Pending Payment" value={data.shopifyByPayment['Pending']?.count || 0} warn={(data.shopifyByPayment['Pending']?.count || 0) > 0} />
              <HeroStat label="Total Value" value={fmtK(data.totalShopifyVal)} />
              <HeroStat label="Imported to Deco" value={data.shopifyLinked} good={data.shopifyLinked > 0} />
              <HeroStat label="Not Imported" value={data.shopifyUnlinked} warn={data.shopifyUnlinked > 0} />
            </div>

            {/* Deco import progress bar */}
            {data.totalShopifyOpen > 0 && (() => {
              const importPct = pct(data.shopifyLinked, data.totalShopifyOpen);
              return (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-white/35 uppercase tracking-wider font-bold">Deco Import Progress</span>
                    <span className="text-[10px] text-white/40">{data.shopifyLinked} of {data.totalShopifyOpen} imported ({Math.round(importPct)}%)</span>
                  </div>
                  <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${importPct >= 90 ? 'bg-emerald-500' : importPct >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(importPct, 100)}%` }} />
                  </div>
                </div>
              );
            })()}

            {/* Unlinked warning */}
            {data.shopifyUnlinked > 0 && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-red-400 text-lg mt-0.5">⚠</span>
                <div>
                  <p className="text-sm font-semibold text-red-300">{data.shopifyUnlinked} orders not imported to Deco</p>
                  <p className="text-xs text-red-300/60 mt-0.5">These Shopify orders have not been manually imported into DecoNetwork yet — no production tracking, no fulfilment visibility.</p>
                </div>
              </div>
            )}

            {/* Brief */}
            <div className="bg-black/20 rounded-xl px-5 py-4 border border-white/5">
              <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Shopify Summary</h3>
              <p className="text-sm text-white/70 leading-relaxed">
                {data.totalShopifyOpen.toLocaleString()} open orders worth {fmtK(data.totalShopifyVal)}.
                {' '}{data.shopifyByFulfillment['Unfulfilled']?.count || 0} unfulfilled, {data.shopifyByFulfillment['Partially Fulfilled']?.count || 0} partially fulfilled.
                {' '}{data.shopifyByPayment['Paid']?.count || 0} paid, {data.shopifyByPayment['Pending']?.count || 0} pending payment{data.shopifyByPayment['Refunded'] ? `, ${data.shopifyByPayment['Refunded'].count} refunded` : ''}.
                {' '}{data.shopifyLinked} of {data.totalShopifyOpen} have been imported to Deco ({Math.round(pct(data.shopifyLinked, data.totalShopifyOpen))}%).
                {data.shopifyUnlinked > 0 ? ` ${data.shopifyUnlinked} orders still need to be manually imported — these have no production tracking until they are.` : ''}
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT: Deco-only (phone/direct orders, not from Shopify) */}
        <div className="relative rounded-2xl overflow-hidden border border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 via-indigo-600/5 to-transparent">
          <div className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-xl font-black text-white tracking-tight">Deco Direct Jobs</h1>
                <p className="text-xs text-white/35 mt-0.5">Phone &amp; direct orders — excludes Shopify imports</p>
              </div>
              <div className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400">
                {data.decoOnlyActive.length} Active
              </div>
            </div>

            {/* Active pipeline — needs attention */}
            <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">Active Pipeline</h3>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-4">
              <HeroStat label="Active Jobs" value={data.decoOnlyActive.length} />
              <HeroStat label="Pipeline Value" value={fmtK(data.decoOnlyPipelineVal)} />
              <HeroStat label="In Production" value={data.decoOnlyProducing} good={data.decoOnlyProducing > 0} warn={data.decoOnlyProducing === 0} />
              <HeroStat label="Blocked" value={data.decoOnlyBlocked} warn={data.decoOnlyBlocked > data.decoOnlyProducing} />
              <HeroStat label="Overdue" value={data.decoOnlyOverdue.length} warn={data.decoOnlyOverdue.length > 0} />
              <HeroStat label="Awaiting Stock" value={data.decoOnlyByStatus['Awaiting Stock']?.count || 0} warn={(data.decoOnlyByStatus['Awaiting Stock']?.count || 0) > 5} />
              <HeroStat label="Awaiting Processing" value={data.decoOnlyByStatus['Awaiting Processing']?.count || 0} />
            </div>

            {/* Production progress bar */}
            {data.decoOnlyProdPct !== null && data.decoOnlyItems > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-white/35 uppercase tracking-wider font-bold">Production Progress</span>
                  <span className="text-[10px] text-white/40">{data.decoOnlyProduced.toLocaleString()} / {data.decoOnlyItems.toLocaleString()} items</span>
                </div>
                <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${data.decoOnlyProdPct >= 70 ? 'bg-emerald-500' : data.decoOnlyProdPct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(data.decoOnlyProdPct, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Completed work — last 30 days */}
            <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2 mt-1">Last 30 Days</h3>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-5">
              <HeroStat label="Shipped" value={data.decoOnlyShippedRecent.length} good={data.decoOnlyShippedRecent.length > 0} />
              <HeroStat label="Completed" value={data.decoOnlyCompletedRecent.length} good={data.decoOnlyCompletedRecent.length > 0} />
            </div>

            {/* Brief */}
            <div className="bg-black/20 rounded-xl px-5 py-4 border border-white/5">
              <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2">Deco Direct Summary</h3>
              <p className="text-sm text-white/70 leading-relaxed">
                {data.decoOnlyActive.length} active jobs worth {fmtK(data.decoOnlyPipelineVal)} need attention.
                {' '}{data.decoOnlyBlocked} blocked ({data.decoOnlyActive.length > 0 ? pct(data.decoOnlyBlocked, data.decoOnlyActive.length) : 0}%), {data.decoOnlyProducing} in production.
                {data.decoOnlyOverdue.length > 0 ? ` ${data.decoOnlyOverdue.length} overdue totalling ${fmtK(data.decoOnlyOverdueVal)}.` : ' No overdue.'}
                {data.decoOnlyBottleneck.count > 0 ? ` Biggest queue: ${data.decoOnlyBottleneck.stage} with ${data.decoOnlyBottleneck.count} job${s(data.decoOnlyBottleneck.count)}.` : ''}
                {` ${data.decoOnlyShippedRecent.length} shipped in the last 30 days.`}
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ═══ DO FIRST ═══ */}
      {data.doFirst.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-indigo-500/20 overflow-hidden">
          <button
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
            onClick={() => toggleSection('doFirst')}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center">
                <span className="text-indigo-400 text-sm font-black">!</span>
              </div>
              <div className="text-left">
                <h2 className="text-sm font-bold text-indigo-300">Do First</h2>
                <p className="text-[11px] text-white/40">Top {data.doFirst.length} auto-prioritised action items</p>
              </div>
            </div>
            <Chevron open={expandedSection === 'doFirst'} />
          </button>
          {expandedSection === 'doFirst' && (
            <div className="border-t border-white/5 px-3 py-2 space-y-0.5">
              {Array.from(data.doFirstByStaff.entries()).map(([staff, items]) => (
                <div key={staff}>
                  <div className="px-2.5 pt-2 pb-1 flex items-center gap-2">
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">{staff}</span>
                    <span className="text-[10px] text-white/15">{items.length} item{s(items.length)}</span>
                  </div>
                  {items.map((item, i) => {
                    const us = URGENCY_STYLE[item.urgency];
                    return (
                    <div
                      key={item.job.id}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => onNavigateToOrder(item.job.jobNumber)}
                    >
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${us.dot}${us.pulse}`}>{i + 1}</span>
                      <span className="text-[10px] font-mono text-indigo-400/70 w-12 shrink-0">#{item.job.jobNumber}</span>
                      <span className="text-xs text-white/70 truncate flex-1 min-w-0">{item.job.customerName}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${us.pill}`}>{item.score}</span>
                      <span className={`text-[9px] px-2 py-0.5 rounded-full shrink-0 ${us.pill}`}>{item.reason}</span>
                      {item.matchedRules.length > 1 && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30 shrink-0">+{item.matchedRules.length - 1}</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                        BLOCKED.has(item.job.status || '') ? 'text-amber-400/60' : 'text-emerald-400/60'
                      }`}>{item.job.status}</span>
                      <span className="text-[9px] text-white/15 w-12 text-right shrink-0">{fmtK(item.job.orderTotal || item.job.billableAmount || 0)}</span>
                    </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

      {/* ═══ MTO vs STOCK + CLUB BREAKDOWN ═══ */}
      {(data.mtoOrders.length > 0 || data.clubs.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* MTO vs Stock */}
          {(data.mtoOrders.length > 0 || data.stockOrders.length > 0) && (
            <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5">
                <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">MTO vs Stock Orders</h2>
              </div>
              <div className="px-5 py-4 space-y-3">
                {/* MTO bar */}
                {data.mtoOrders.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-purple-300 font-semibold">Made-to-Order</span>
                      <span className="text-[10px] text-white/40">{data.mtoOrders.length} order{s(data.mtoOrders.length)} {data.avgMtoCompletion !== null && `\u00b7 ${data.avgMtoCompletion}% avg`}</span>
                    </div>
                    <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(data.avgMtoCompletion || 0, 100)}%` }} />
                    </div>
                  </div>
                )}
                {/* Stock bar */}
                {data.stockOrders.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-cyan-300 font-semibold">Stock Only</span>
                      <span className="text-[10px] text-white/40">{data.stockOrders.length} order{s(data.stockOrders.length)} {data.avgStockCompletion !== null && `\u00b7 ${data.avgStockCompletion}% avg`}</span>
                    </div>
                    <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                      <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${Math.min(data.avgStockCompletion || 0, 100)}%` }} />
                    </div>
                  </div>
                )}
                {/* Mixed bar */}
                {data.mixedOrders.length > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-white/40 pt-1 border-t border-white/5">
                    <span>{data.mixedOrders.length} mixed order{s(data.mixedOrders.length)} (MTO + stock items)</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Club Breakdown */}
          {data.clubs.length > 0 && (
            <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">By Club</h2>
                <span className="text-[10px] text-white/25">{data.clubs.length} club{s(data.clubs.length)}</span>
              </div>
              <div className="px-4 py-2 max-h-60 overflow-y-auto">
                {data.clubs.slice(0, 12).map(club => (
                  <div key={club.name} className="flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.03] rounded-lg transition-colors">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                    <span className="text-xs text-white/60 flex-1 truncate min-w-0">{club.name}</span>
                    <span className="text-xs font-bold text-white/70 w-6 text-right">{club.total}</span>
                    {club.overdue > 0 && <span className="text-[9px] text-red-400 font-semibold shrink-0">{club.overdue} late</span>}
                    {club.ready > 0 && <span className="text-[9px] text-emerald-400/60 shrink-0">{club.ready} ready</span>}
                    <span className="text-[10px] text-white/20 w-14 text-right shrink-0">{fmtK(club.value)}</span>
                  </div>
                ))}
                {data.clubs.length > 12 && <p className="text-[10px] text-white/20 py-1 pl-4">+ {data.clubs.length - 12} more clubs</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ STAFF PERFORMANCE ═══ */}
      {data.staffSummary.length > 0 && (
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <button
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
            onClick={() => toggleSection('staff')}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
                <span className="text-violet-400 text-sm font-black">{data.staffSummary.length}</span>
              </div>
              <div className="text-left">
                <h2 className="text-sm font-bold text-violet-300">Staff Performance</h2>
                <p className="text-[11px] text-white/40">
                  Overdue, turnaround &amp; stale alerts by team member
                  {data.staffUnassigned && data.staffUnassigned.active > 0 ? ` \u00b7 ${data.staffUnassigned.active} unassigned` : ''}
                </p>
              </div>
            </div>
            <Chevron open={expandedSection === 'staff'} />
          </button>
          {expandedSection === 'staff' && (
            <div className="border-t border-white/5">
              {/* Staff table */}
              <div className="px-5 py-3">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-4 gap-y-0.5 text-[10px]">
                  {/* Header */}
                  <span className="text-white/25 font-bold uppercase tracking-wider pb-1">Name</span>
                  <span className="text-white/25 font-bold uppercase tracking-wider pb-1 text-right">Active</span>
                  <span className="text-white/25 font-bold uppercase tracking-wider pb-1 text-right">Overdue</span>
                  <span className="text-white/25 font-bold uppercase tracking-wider pb-1 text-right">Blocked</span>
                  <span className="text-white/25 font-bold uppercase tracking-wider pb-1 text-right">Stale</span>
                  <span className="text-white/25 font-bold uppercase tracking-wider pb-1 text-right">Avg Days</span>
                  <span className="text-white/25 font-bold uppercase tracking-wider pb-1 text-right">Pipeline</span>
                  {/* Rows */}
                  {data.staffSummary.map(st => {
                    const avgDays = st.turnaroundCount > 0 ? Math.round(st.totalTurnaround / st.turnaroundCount) : null;
                    return (
                      <React.Fragment key={st.name}>
                        <span className="text-xs text-white/70 font-medium py-1.5">{st.name}</span>
                        <span className="text-xs text-white/60 text-right py-1.5 font-semibold">{st.active}</span>
                        <span className={`text-xs text-right py-1.5 font-semibold ${st.overdue > 0 ? 'text-red-400' : 'text-white/30'}`}>{st.overdue || '-'}</span>
                        <span className={`text-xs text-right py-1.5 ${st.blocked > st.producing ? 'text-amber-400 font-semibold' : 'text-white/40'}`}>{st.blocked || '-'}</span>
                        <span className={`text-xs text-right py-1.5 ${st.stale > 0 ? 'text-orange-400 font-semibold' : 'text-white/30'}`}>{st.stale || '-'}</span>
                        <span className={`text-xs text-right py-1.5 ${avgDays && avgDays > 21 ? 'text-amber-400' : 'text-white/50'}`}>{avgDays ? `${avgDays}d` : '-'}</span>
                        <span className="text-xs text-white/40 text-right py-1.5">{fmtK(st.pipelineVal)}</span>
                      </React.Fragment>
                    );
                  })}
                  {/* Unassigned row */}
                  {data.staffUnassigned && data.staffUnassigned.active > 0 && (
                    <>
                      <span className="text-xs text-white/30 italic py-1.5 border-t border-white/5">Unassigned</span>
                      <span className="text-xs text-white/30 text-right py-1.5 border-t border-white/5">{data.staffUnassigned.active}</span>
                      <span className={`text-xs text-right py-1.5 border-t border-white/5 ${data.staffUnassigned.overdue > 0 ? 'text-red-400' : 'text-white/20'}`}>{data.staffUnassigned.overdue || '-'}</span>
                      <span className="text-xs text-white/20 text-right py-1.5 border-t border-white/5">{data.staffUnassigned.blocked || '-'}</span>
                      <span className="text-xs text-white/20 text-right py-1.5 border-t border-white/5">{data.staffUnassigned.stale || '-'}</span>
                      <span className="text-xs text-white/20 text-right py-1.5 border-t border-white/5">-</span>
                      <span className="text-xs text-white/20 text-right py-1.5 border-t border-white/5">{fmtK(data.staffUnassigned.pipelineVal)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Stale job alerts */}
              {data.staffSummary.some(st => st.stale > 0) && (
                <div className="px-5 py-3 border-t border-white/5">
                  <h3 className="text-[10px] font-bold text-orange-400/60 uppercase tracking-wider mb-2">Stale Job Alerts (30+ days blocked)</h3>
                  <div className="space-y-2">
                    {data.staffSummary.filter(st => st.stale > 0).sort((a, b) => b.stale - a.stale).map(st => (
                      <div key={st.name}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-white/60">{st.name}</span>
                          <span className="text-[10px] text-orange-400/70">{st.stale} stale job{s(st.stale)}</span>
                        </div>
                        <div className="space-y-0.5 ml-3">
                          {st.staleJobs.slice(0, 5).map(j => {
                            const ord = pd(j.dateOrdered);
                            const age = ord ? daysBetween(ord, now) : 0;
                            return (
                              <div
                                key={j.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer transition-colors"
                                onClick={() => onNavigateToOrder(j.jobNumber)}
                              >
                                <span className="text-[10px] font-mono text-indigo-400/70 w-12 shrink-0">#{j.jobNumber}</span>
                                <span className="text-[11px] text-white/50 truncate flex-1 min-w-0">{j.customerName}</span>
                                <span className="text-[9px] text-orange-400/60">{age}d old</span>
                                <span className="text-[9px] text-white/20">{j.status}</span>
                              </div>
                            );
                          })}
                          {st.staleJobs.length > 5 && <p className="text-[9px] text-white/15 pl-2">+ {st.staleJobs.length - 5} more</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Overdue breakdown */}
              {data.staffSummary.some(st => st.overdue > 0) && (
                <div className="px-5 py-3 border-t border-white/5">
                  <h3 className="text-[10px] font-bold text-red-400/60 uppercase tracking-wider mb-2">Overdue by Staff</h3>
                  <div className="space-y-2">
                    {data.staffSummary.filter(st => st.overdue > 0).sort((a, b) => b.overdue - a.overdue).map(st => (
                      <div key={st.name}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-white/60">{st.name}</span>
                          <span className="text-[10px] text-red-400/70">{st.overdue} overdue</span>
                          <span className="text-[10px] text-white/20">{fmtK(st.overdueJobs.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0))}</span>
                        </div>
                        <div className="space-y-0.5 ml-3">
                          {st.overdueJobs.sort((a, b) => {
                            const da = pd(a.dateDue) || pd(a.productionDueDate);
                            const db = pd(b.dateDue) || pd(b.productionDueDate);
                            return (da?.getTime() || 0) - (db?.getTime() || 0);
                          }).slice(0, 5).map(j => {
                            const due = pd(j.dateDue) || pd(j.productionDueDate);
                            const daysLate = due ? daysBetween(due, now) : 0;
                            return (
                              <div
                                key={j.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer transition-colors"
                                onClick={() => onNavigateToOrder(j.jobNumber)}
                              >
                                <span className={`text-[10px] font-bold w-8 text-right ${daysLate > 30 ? 'text-red-400' : daysLate > 14 ? 'text-orange-400' : 'text-amber-400'}`}>{daysLate}d</span>
                                <span className="text-[10px] font-mono text-indigo-400/70 w-12 shrink-0">#{j.jobNumber}</span>
                                <span className="text-[11px] text-white/50 truncate flex-1 min-w-0">{j.customerName}</span>
                                <span className="text-[9px] text-white/20">{j.status}</span>
                                <span className="text-[9px] text-white/15">{fmtK(j.orderTotal || j.billableAmount || 0)}</span>
                              </div>
                            );
                          })}
                          {st.overdueJobs.length > 5 && <p className="text-[9px] text-white/15 pl-2">+ {st.overdueJobs.length - 5} more</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ INSIGHTS GRID ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Revenue Velocity */}
        <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5">
            <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Revenue Velocity</h2>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">In (7d)</div>
                <div className="text-lg font-black text-emerald-400">{fmtK(data.revIn7d)}</div>
                {data.revInPrev7d > 0 && (
                  <div className={`text-[10px] mt-0.5 ${data.revIn7d >= data.revInPrev7d ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                    {data.revIn7d >= data.revInPrev7d ? '\u25b2' : '\u25bc'} vs {fmtK(data.revInPrev7d)} prev
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Out (7d)</div>
                <div className="text-lg font-black text-sky-400">{fmtK(data.revOut7d)}</div>
                {data.revOutPrev7d > 0 && (
                  <div className={`text-[10px] mt-0.5 ${data.revOut7d >= data.revOutPrev7d ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                    {data.revOut7d >= data.revOutPrev7d ? '\u25b2' : '\u25bc'} vs {fmtK(data.revOutPrev7d)} prev
                  </div>
                )}
              </div>
            </div>
            <div className={`text-xs font-semibold px-3 py-2 rounded-lg ${data.netFlow7d >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              Net flow: {data.netFlow7d >= 0 ? `+${fmtK(data.netFlow7d)}` : `-${fmtK(Math.abs(data.netFlow7d))}`}
              <span className="text-white/30 font-normal ml-1">{data.netFlow7d >= 0 ? 'pipeline growing' : 'pipeline shrinking'}</span>
            </div>
          </div>
        </div>

        {/* Top Customers at Risk */}
        {data.customersAtRisk.length > 0 && (
          <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Customers at Risk</h2>
              <span className="text-[10px] text-red-400/60">{data.customersAtRisk.length} account{s(data.customersAtRisk.length)}</span>
            </div>
            <div className="px-3 py-2 max-h-52 overflow-y-auto">
              {data.customersAtRisk.map(c => (
                <div key={c.name} className="flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.03] rounded-lg transition-colors">
                  <span className="text-xs text-white/60 flex-1 truncate min-w-0">{c.name}</span>
                  <span className="text-xs font-bold text-white/50">{c.total}</span>
                  {c.overdue > 0 && <span className="text-[9px] text-red-400 font-semibold">{c.overdue} late</span>}
                  {c.atRisk > 0 && <span className="text-[9px] text-amber-400 font-semibold">{c.atRisk} at risk</span>}
                  <span className="text-[10px] text-white/20 w-14 text-right shrink-0">{fmtK(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vendor Bottleneck */}
        {data.vendorBottlenecks.length > 0 && (
          <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Vendor Intelligence</h2>
              <span className="text-[10px] text-white/25">{data.vendorBottlenecks.length} vendor{s(data.vendorBottlenecks.length)}</span>
            </div>
            <div className="px-3 py-2 max-h-52 overflow-y-auto">
              {data.vendorBottlenecks.map(v => (
                <div key={v.vendor} className="flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.03] rounded-lg transition-colors">
                  <span className="text-xs text-white/60 flex-1 truncate min-w-0">{v.vendor}</span>
                  <span className="text-[10px] text-white/30">{v.totalItems} items</span>
                  {v.overdueOrders > 0 && <span className="text-[9px] text-red-400 font-semibold">{v.overdueOrders} late</span>}
                  {v.blockedOrders > 0 && <span className="text-[9px] text-amber-400/70">{v.blockedOrders} blocked</span>}
                  <span className="text-[10px] text-white/20 w-12 text-right shrink-0">{fmtK(v.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Days-in-Stage Aging */}
        {data.stageAging.length > 0 && (
          <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5">
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Days-in-Stage Aging</h2>
            </div>
            <div className="px-3 py-2">
              {data.stageAging.map(sa => (
                <div key={sa.stage} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/[0.03] rounded-lg transition-colors">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[sa.stage] || 'bg-gray-400'}`} />
                  <span className="text-xs text-white/50 flex-1 truncate min-w-0">{sa.stage}</span>
                  <span className="text-xs font-bold text-white/60 w-6 text-right">{sa.count}</span>
                  <span className={`text-[10px] w-14 text-right shrink-0 ${sa.avgAge > 21 ? 'text-red-400' : sa.avgAge > 10 ? 'text-amber-400' : 'text-white/30'}`}>~{sa.avgAge}d avg</span>
                  <span className={`text-[9px] w-12 text-right shrink-0 ${sa.maxAge > 30 ? 'text-red-400/50' : 'text-white/15'}`}>max {sa.maxAge}d</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Carrier & Shipping */}
        {data.carriers.length > 0 && (
          <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Carrier Summary</h2>
              <span className="text-[10px] text-white/25">{fmt(data.totalShippingCost)} total</span>
            </div>
            <div className="px-3 py-2">
              {data.carriers.map(c => {
                const avgCost = c.shipments > 0 ? c.totalCost / c.shipments : 0;
                return (
                  <div key={c.carrier} className="flex items-center gap-2 px-2.5 py-2 hover:bg-white/[0.03] rounded-lg transition-colors">
                    <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                    <span className="text-xs text-white/60 flex-1 truncate min-w-0">{c.carrier}</span>
                    <span className="text-[10px] text-white/40">{c.shipments} shipment{s(c.shipments)}</span>
                    <span className="text-xs text-white/50 font-semibold w-16 text-right">{fmt(c.totalCost)}</span>
                    <span className="text-[9px] text-white/20 w-14 text-right">{fmt(avgCost)}/ea</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Capacity Forecast */}
        {data.daysToClear !== null && (
          <div className="bg-[#1e1e3a] rounded-2xl border border-white/5 overflow-hidden">
            <div className="px-5 py-3 border-b border-white/5">
              <h2 className="text-xs font-bold text-white/60 uppercase tracking-wider">Capacity Forecast</h2>
            </div>
            <div className="px-5 py-4 text-center">
              <div className={`text-3xl font-black ${data.daysToClear > 30 ? 'text-red-400' : data.daysToClear > 14 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {data.daysToClear}
              </div>
              <div className="text-[10px] text-white/30 mt-0.5 uppercase tracking-wider">Days to clear pipeline</div>
              <div className="text-xs text-white/40 mt-2">
                At {data.dailyThroughput}/day throughput
                <span className="text-white/20"> \u00b7 </span>
                {data.active.length} active orders
              </div>
              <div className={`text-[10px] mt-3 px-3 py-1.5 rounded-lg inline-block ${
                data.daysToClear > 30 ? 'bg-red-500/10 text-red-400' : data.daysToClear > 14 ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
              }`}>
                {data.daysToClear > 30 ? 'Pipeline congested \u2014 consider adding capacity' : data.daysToClear > 14 ? 'Manageable but watch for new order spikes' : 'Healthy capacity \u2014 pipeline is light'}
              </div>
            </div>
          </div>
        )}

      </div>

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
