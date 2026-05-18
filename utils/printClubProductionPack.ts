import type { ProductionPackReport } from './clubProductionPack';

function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(ymd: string): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtOrderDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function openClubProductionPackPrint(report: ProductionPackReport): void {
  const { filters, pivot, orders, stats } = report;
  const now = new Date();
  const printed = now.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const pivotRows = pivot
    .map((row, i) => {
      const pers =
        row.personalization.trim() !== ''
          ? esc(row.personalization)
          : '<span class="muted">—</span>';
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(row.lineName)}</td>
        <td class="pers">${pers}</td>
        <td class="num"><strong>${row.quantity}</strong></td>
      </tr>`;
    })
    .join('');

  const orderBlocks = orders
    .map(o => {
      const lineRows = o.lines
        .map(line => {
          const props =
            line.displayProperties.length > 0
              ? line.displayProperties
                  .map(
                    p =>
                      `<span class="prop"><span class="prop-k">${esc(p.name)}</span> ${esc(p.value)}</span>`
                  )
                  .join('')
              : '<span class="muted">No personalisation</span>';
          return `<tr>
            <td>${esc(line.lineName)}</td>
            <td class="num">${line.quantity}</td>
            <td class="props">${props}</td>
          </tr>`;
        })
        .join('');
      return `<section class="order-card">
        <header>
          <div>
            <h3>${esc(o.orderNumber)}</h3>
            <p class="cust">${esc(o.customerName)}${o.email ? ` · ${esc(o.email)}` : ''}</p>
          </div>
          <div class="order-meta">
            <span>${esc(fmtOrderDate(o.orderDate))}</span>
            <span class="units">${o.totalUnits} unit${o.totalUnits === 1 ? '' : 's'}</span>
          </div>
        </header>
        <table class="order-lines">
          <thead><tr><th>Product</th><th>Qty</th><th>Personalisation</th></tr></thead>
          <tbody>${lineRows}</tbody>
        </table>
      </section>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Production pack — ${esc(filters.tag)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; padding: 24px; color: #0f172a; font-size: 11px; line-height: 1.45; }
    .toolbar { position: sticky; top: 0; z-index: 10; background: #1e1b4b; color: #fff; padding: 12px 16px; margin: -24px -24px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    .toolbar button { padding: 10px 18px; border: none; border-radius: 8px; background: #6366f1; color: #fff; font-weight: 800; font-size: 12px; cursor: pointer; }
    .cover { margin-bottom: 28px; padding-bottom: 20px; border-bottom: 3px solid #1e1b4b; }
    .cover h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.02em; }
    .cover .tag { display: inline-block; background: #eef2ff; color: #3730a3; padding: 4px 12px; border-radius: 999px; font-weight: 800; font-size: 12px; margin-bottom: 10px; }
    .cover .sub { color: #475569; margin: 0 0 14px; }
    .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; min-width: 90px; background: #f8fafc; }
    .kpi span { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; font-weight: 800; }
    .kpi strong { font-size: 18px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #1e1b4b; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #c7d2fe; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 800; color: #334155; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; width: 56px; }
    td.pers { font-weight: 800; font-size: 13px; color: #7c3aed; min-width: 72px; }
    .muted { color: #94a3b8; font-weight: 500; }
    .order-card { break-inside: avoid; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .order-card header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 10px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .order-card h3 { margin: 0; font-size: 14px; }
    .order-card .cust { margin: 2px 0 0; font-size: 10px; color: #64748b; }
    .order-meta { text-align: right; font-size: 10px; color: #64748b; }
    .order-meta .units { display: block; font-weight: 800; color: #1e1b4b; font-size: 12px; margin-top: 2px; }
    .order-lines th, .order-lines td { font-size: 10px; }
    td.props { font-size: 10px; }
    .prop { display: inline-block; margin: 0 8px 4px 0; padding: 2px 8px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 6px; }
    .prop-k { font-weight: 700; color: #6b21a8; }
    .page-break { page-break-before: always; }
    @media print {
      .toolbar { display: none; }
      body { padding: 12px; }
      .order-card { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>Production pack — Print → Save as PDF</span>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="cover">
    <div class="tag">${esc(filters.tag)}</div>
    <h1>Production pack</h1>
    <p class="sub">
      ${esc(fmtDate(filters.dateFrom))} – ${esc(fmtDate(filters.dateTo))}
      · Unfulfilled only
      · Printed ${esc(printed)}
    </p>
    <div class="kpis">
      <div class="kpi"><span>Orders</span><strong>${stats.orderCount}</strong></div>
      <div class="kpi"><span>Line items</span><strong>${stats.lineCount}</strong></div>
      <div class="kpi"><span>Total units</span><strong>${stats.totalUnits}</strong></div>
      <div class="kpi"><span>Pivot rows</span><strong>${stats.pivotRowCount}</strong></div>
    </div>
  </div>

  <h2>Quantity summary (pivot)</h2>
  <p style="color:#64748b;margin:0 0 10px;">Grouped by product and personalisation — same layout as your Excel pivot.</p>
  <table>
    <thead>
      <tr><th>#</th><th>Product</th><th>Personalisation</th><th>Qty</th></tr>
    </thead>
    <tbody>${pivotRows || '<tr><td colspan="4" class="muted">No lines match filters</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right;font-weight:800;">Total units</td>
        <td class="num"><strong>${stats.totalUnits}</strong></td>
      </tr>
    </tfoot>
  </table>

  <div class="page-break"></div>
  <h2>Orders &amp; personalisation</h2>
  <p style="color:#64748b;margin:0 0 14px;">Per-order detail for Deco / production entry after export.</p>
  ${orderBlocks || '<p class="muted">No orders</p>'}
</body>
</html>`;

  const w = window.open('', '_blank', 'width=960,height=1100');
  if (!w) return;
  w.document.write(fixed);
  w.document.close();
}
