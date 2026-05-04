import type { DecoJob } from '../types';
import { isDecoJobCancelled } from './decoJobFilters';

/* ── Helpers ────────────────────────────────────────────────────────────── */
const pd = (d?: string) => (d ? new Date(d) : null);
const daysBetween = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / 86400000);
const fmt = (n: number) => '\u00a3' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const pct = (n: number, total: number) => total === 0 ? '0%' : Math.round((n / total) * 100) + '%';

/* ── Types ──────────────────────────────────────────────────────────────── */
export interface DigestData {
  type: 'daily' | 'weekly';
  periodLabel: string;
  generated: string;
  summary: {
    totalActive: number;
    totalValue: number;
    newOrders: number;
    newOrdersValue: number;
    completedOrders: number;
    completedValue: number;
    shippedOrders: number;
    overdueOrders: number;
    overdueValue: number;
  };
  statusBreakdown: { status: string; count: number; value: number }[];
  urgentOrders: { jobNumber: string; customer: string; status: string; reason: string; daysSinceOrdered: number; value: number }[];
  topCustomers: { name: string; orders: number; value: number }[];
  staffWorkload: { name: string; orders: number; value: number }[];
}

/* ── Build digest data ──────────────────────────────────────────────────── */
export function buildDigest(jobs: DecoJob[], type: 'daily' | 'weekly'): DigestData {
  const now = new Date();
  const lookbackDays = type === 'daily' ? 1 : 7;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  cutoff.setHours(0, 0, 0, 0);

  const periodLabel = type === 'daily'
    ? fmtDate(now)
    : `${fmtDate(cutoff)} \u2013 ${fmtDate(now)}`;

  // Exclude cancelled
  const active = jobs.filter(j => !isDecoJobCancelled(j));

  const notShipped = active.filter(j => (j.status || '').toLowerCase() !== 'shipped');

  // New orders (ordered within the period)
  const newOrders = active.filter(j => {
    const d = pd(j.dateOrdered);
    return d && d >= cutoff;
  });

  // Completed/shipped in period
  const shippedInPeriod = active.filter(j => {
    const d = pd(j.dateShipped);
    return d && d >= cutoff;
  });
  const completedInPeriod = active.filter(j => {
    const st = (j.status || '').toLowerCase();
    return (st === 'shipped' || st === 'completed' || st === 'ready for shipping') && (() => {
      const d = pd(j.dateShipped) || pd(j.dateDue);
      return d && d >= cutoff;
    })();
  });

  // Overdue
  const overdue = notShipped.filter(j => {
    const due = pd(j.dateDue) || pd(j.productionDueDate);
    return due && due < now;
  });

  // Status breakdown
  const statusMap = new Map<string, { count: number; value: number }>();
  notShipped.forEach(j => {
    const st = j.status || 'Unknown';
    const cur = statusMap.get(st) || { count: 0, value: 0 };
    cur.count++;
    cur.value += j.orderTotal || j.billableAmount || 0;
    statusMap.set(st, cur);
  });
  const statusBreakdown = Array.from(statusMap.entries())
    .map(([status, data]) => ({ status, ...data }))
    .sort((a, b) => b.count - a.count);

  // Urgent (overdue, sorted by days)
  const urgentOrders = overdue
    .map(j => {
      const due = pd(j.dateDue) || pd(j.productionDueDate);
      const ordered = pd(j.dateOrdered);
      return {
        jobNumber: j.jobNumber,
        customer: j.customerName,
        status: j.status || 'Unknown',
        reason: due ? `${daysBetween(due, now)}d overdue` : 'No due date',
        daysSinceOrdered: ordered ? daysBetween(ordered, now) : 0,
        value: j.orderTotal || j.billableAmount || 0,
      };
    })
    .sort((a, b) => b.daysSinceOrdered - a.daysSinceOrdered)
    .slice(0, 15);

  // Top customers by value
  const custMap = new Map<string, { orders: number; value: number }>();
  newOrders.forEach(j => {
    const name = j.customerName || 'Unknown';
    const cur = custMap.get(name) || { orders: 0, value: 0 };
    cur.orders++;
    cur.value += j.orderTotal || j.billableAmount || 0;
    custMap.set(name, cur);
  });
  const topCustomers = Array.from(custMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Staff workload
  const staffMap = new Map<string, { orders: number; value: number }>();
  notShipped.forEach(j => {
    const sp = extractStaff(j.salesPerson);
    if (!sp) return;
    const cur = staffMap.get(sp) || { orders: 0, value: 0 };
    cur.orders++;
    cur.value += j.orderTotal || j.billableAmount || 0;
    staffMap.set(sp, cur);
  });
  const staffWorkload = Array.from(staffMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.orders - a.orders);

  const totalActiveValue = notShipped.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);
  const newValue = newOrders.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);
  const completedValue = completedInPeriod.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);
  const overdueValue = overdue.reduce((a, j) => a + (j.orderTotal || j.billableAmount || 0), 0);

  return {
    type,
    periodLabel,
    generated: now.toISOString(),
    summary: {
      totalActive: notShipped.length,
      totalValue: totalActiveValue,
      newOrders: newOrders.length,
      newOrdersValue: newValue,
      completedOrders: completedInPeriod.length,
      completedValue,
      shippedOrders: shippedInPeriod.length,
      overdueOrders: overdue.length,
      overdueValue,
    },
    statusBreakdown,
    urgentOrders,
    topCustomers,
    staffWorkload,
  };
}

function extractStaff(sp: any): string | undefined {
  if (!sp) return undefined;
  if (typeof sp === 'string') return sp;
  if (typeof sp === 'object') {
    if (sp.firstname || sp.lastname) return `${sp.firstname || ''} ${sp.lastname || ''}`.trim();
    if (sp.name) return sp.name;
    return undefined;
  }
  return String(sp);
}

/* ── Generate HTML email ────────────────────────────────────────────────── */
export function buildDigestHtml(data: DigestData): string {
  const s = data.summary;
  const isWeekly = data.type === 'weekly';
  const title = isWeekly ? 'Weekly Digest' : 'Daily Digest';

  const statusRows = data.statusBreakdown.map(st =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#333">${st.status}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold">${st.count}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:#666">${fmt(st.value)}</td></tr>`
  ).join('');

  const urgentRows = data.urgentOrders.map(o =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;color:#6366f1">#${o.jobNumber}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#333">${o.customer}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#999;font-size:12px">${o.status}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#ef4444;font-weight:bold;font-size:12px">${o.reason}</td>
     <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;color:#666">${fmt(o.value)}</td></tr>`
  ).join('');

  const customerRows = data.topCustomers.map(c =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#333">${c.name}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${c.orders}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:#666">${fmt(c.value)}</td></tr>`
  ).join('');

  const staffRows = data.staffWorkload.map(st =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#333">${st.name}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold">${st.orders}</td>
     <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:#666">${fmt(st.value)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:20px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1e1e3a,#2d2b55);border-radius:12px;padding:24px 28px;margin-bottom:16px">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800">Stash Overview \u2014 ${title}</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.5);font-size:13px">${data.periodLabel}</p>
  </div>

  <!-- Summary Cards -->
  <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
    ${summaryCard('Active Orders', String(s.totalActive), fmt(s.totalValue), '#6366f1')}
    ${summaryCard('New Orders', String(s.newOrders), fmt(s.newOrdersValue), '#22c55e')}
    ${summaryCard('Completed', String(s.completedOrders), fmt(s.completedValue), '#3b82f6')}
    ${summaryCard('Overdue', String(s.overdueOrders), fmt(s.overdueValue), s.overdueOrders > 0 ? '#ef4444' : '#22c55e')}
  </div>

  <!-- Status Breakdown -->
  <div style="background:#fff;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:16px;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:2px solid #f3f4f6">
      <h2 style="margin:0;font-size:14px;color:#333;font-weight:700">Status Breakdown</h2>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f9fafb"><th style="padding:8px 12px;text-align:left;color:#999;font-size:11px;text-transform:uppercase">Status</th><th style="padding:8px 12px;text-align:center;color:#999;font-size:11px">Count</th><th style="padding:8px 12px;text-align:right;color:#999;font-size:11px">Value</th></tr>
      ${statusRows}
    </table>
  </div>

  ${data.urgentOrders.length > 0 ? `
  <!-- Overdue Orders -->
  <div style="background:#fff;border-radius:10px;border:1px solid #fecaca;margin-bottom:16px;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:2px solid #fee2e2;background:#fef2f2">
      <h2 style="margin:0;font-size:14px;color:#dc2626;font-weight:700">Overdue Orders (${data.urgentOrders.length})</h2>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr style="background:#fef2f2"><th style="padding:8px;text-align:left;color:#999;font-size:10px;text-transform:uppercase">Order</th><th style="padding:8px;text-align:left;color:#999;font-size:10px">Customer</th><th style="padding:8px;text-align:left;color:#999;font-size:10px">Status</th><th style="padding:8px;text-align:left;color:#999;font-size:10px">Overdue</th><th style="padding:8px;text-align:right;color:#999;font-size:10px">Value</th></tr>
      ${urgentRows}
    </table>
  </div>` : ''}

  ${data.topCustomers.length > 0 ? `
  <!-- Top Customers -->
  <div style="background:#fff;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:16px;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:2px solid #f3f4f6">
      <h2 style="margin:0;font-size:14px;color:#333;font-weight:700">New Orders by Customer</h2>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f9fafb"><th style="padding:8px 12px;text-align:left;color:#999;font-size:11px;text-transform:uppercase">Customer</th><th style="padding:8px 12px;text-align:center;color:#999;font-size:11px">Orders</th><th style="padding:8px 12px;text-align:right;color:#999;font-size:11px">Value</th></tr>
      ${customerRows}
    </table>
  </div>` : ''}

  ${data.staffWorkload.length > 0 ? `
  <!-- Staff Workload -->
  <div style="background:#fff;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:16px;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:2px solid #f3f4f6">
      <h2 style="margin:0;font-size:14px;color:#333;font-weight:700">Staff Workload (Active Orders)</h2>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f9fafb"><th style="padding:8px 12px;text-align:left;color:#999;font-size:11px;text-transform:uppercase">Staff</th><th style="padding:8px 12px;text-align:center;color:#999;font-size:11px">Orders</th><th style="padding:8px 12px;text-align:right;color:#999;font-size:11px">Value</th></tr>
      ${staffRows}
    </table>
  </div>` : ''}

  <!-- Footer -->
  <div style="text-align:center;padding:16px;color:#999;font-size:11px">
    Generated by Stash Overview &middot; ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
  </div>
</div>
</body>
</html>`;
}

function summaryCard(label: string, count: string, value: string, color: string): string {
  return `<div style="flex:1;min-width:130px;background:#fff;border-radius:10px;border:1px solid #e5e7eb;padding:16px;text-align:center">
    <div style="font-size:28px;font-weight:800;color:${color}">${count}</div>
    <div style="font-size:12px;font-weight:600;color:#333;margin-top:2px">${label}</div>
    <div style="font-size:11px;color:#999;margin-top:2px">${value}</div>
  </div>`;
}
