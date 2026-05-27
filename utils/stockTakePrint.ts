import type { MissingLine, StockTakeLineView, StockTakeSession } from '../services/stockTakeService';

function esc(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface StockTakePrintRow {
  line: StockTakeLineView;
  bookQty: number;
}

interface VendorGroup {
  vendor: string;
  rows: StockTakePrintRow[];
  unitsCounted: number;
  unitsOnBook: number;
  variance: number;
}

function groupByVendor(rows: StockTakePrintRow[]): VendorGroup[] {
  const groups = new Map<string, VendorGroup>();
  for (const row of rows) {
    const vendor = (row.line.vendor || 'Unspecified vendor').trim() || 'Unspecified vendor';
    let group = groups.get(vendor);
    if (!group) {
      group = { vendor, rows: [], unitsCounted: 0, unitsOnBook: 0, variance: 0 };
      groups.set(vendor, group);
    }
    group.rows.push(row);
    group.unitsCounted += row.line.qty;
    group.unitsOnBook += row.bookQty;
    group.variance += row.line.qty - row.bookQty;
  }
  return Array.from(groups.values()).sort((a, b) => {
    const va = Math.abs(a.variance);
    const vb = Math.abs(b.variance);
    if (vb !== va) return vb - va;
    return a.vendor.localeCompare(b.vendor);
  });
}

export function openStockTakePrint(opts: {
  session: StockTakeSession;
  locationLabel: string;
  rows: StockTakePrintRow[];
  totals: { skus: number; units: number };
  missing?: MissingLine[];
}): void {
  const { session, locationLabel, rows, totals, missing = [] } = opts;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const committedAt = session.committed_at
    ? new Date(session.committed_at).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : null;

  let varianceUnits = 0;
  for (const row of rows) varianceUnits += row.line.qty - row.bookQty;

  const sortedRows = [...rows].sort((a, b) => {
    const va = Math.abs(a.line.qty - a.bookQty);
    const vb = Math.abs(b.line.qty - b.bookQty);
    if (vb !== va) return vb - va;
    const da = a.line.description.localeCompare(b.line.description);
    if (da !== 0) return da;
    return a.line.ean.localeCompare(b.line.ean);
  });
  const groups = groupByVendor(sortedRows);

  const renderGroup = (group: VendorGroup): string => {
    const groupVarianceClass = group.variance > 0 ? 'pos' : group.variance < 0 ? 'neg' : '';
    const lines = group.rows.map((row, i) => {
      const diff = row.line.qty - row.bookQty;
      const diffClass = diff > 0 ? 'pos' : diff < 0 ? 'neg' : '';
      const diffLabel = diff === 0 ? '—' : diff > 0 ? `+${diff}` : String(diff);
      const rowClass = Math.abs(diff) > 0 ? 'variance-row' : '';
      return `<tr class="${rowClass}">
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(row.line.ean)}</td>
        <td>${esc(row.line.description)}</td>
        <td>${esc(row.line.productCode || '—')}</td>
        <td>${esc(row.line.colour || '—')}</td>
        <td>${esc(row.line.size || '—')}</td>
        <td class="num"><strong>${row.line.qty}</strong></td>
        <td class="num">${row.bookQty}</td>
        <td class="num ${diffClass}"><strong>${diffLabel}</strong></td>
      </tr>`;
    }).join('');
    return `<section class="vendor-group">
      <header>
        <h3>${esc(group.vendor)}</h3>
        <span class="vendor-totals">
          ${group.rows.length} SKUs · counted ${group.unitsCounted} ·
          book ${group.unitsOnBook} ·
          <strong class="${groupVarianceClass}">${group.variance >= 0 ? '+' : ''}${group.variance}</strong>
        </span>
      </header>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Barcode</th>
            <th>Description</th>
            <th>Code</th>
            <th>Colour</th>
            <th>Size</th>
            <th>Counted</th>
            <th>Book</th>
            <th>Diff</th>
          </tr>
        </thead>
        <tbody>${lines}</tbody>
      </table>
    </section>`;
  };

  const sortedMissing = [...missing].sort((a, b) => b.bookQty - a.bookQty);
  const missingTable = sortedMissing.length === 0 ? '' : `
    <section class="missing-section">
      <header>
        <h2>Missing from count — ${sortedMissing.length} SKUs, ${sortedMissing.reduce((s, m) => s + m.bookQty, 0)} units on book</h2>
        <p>These were on the book at <strong>${esc(locationLabel)}</strong> but were not scanned. Investigate before treating the count as final.</p>
      </header>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Barcode</th>
            <th>Description</th>
            <th>Vendor</th>
            <th>Code</th>
            <th>Colour</th>
            <th>Size</th>
            <th>Book qty</th>
          </tr>
        </thead>
        <tbody>
          ${sortedMissing.map((m, i) => `<tr>
            <td class="num">${i + 1}</td>
            <td class="mono">${esc(m.ean)}</td>
            <td>${esc(m.description || '—')}</td>
            <td>${esc(m.vendor || '—')}</td>
            <td>${esc(m.productCode || '—')}</td>
            <td>${esc(m.colour || '—')}</td>
            <td>${esc(m.size || '—')}</td>
            <td class="num"><strong>${m.bookQty}</strong></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </section>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Stock take — ${esc(session.label)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; color: #111; font-size: 11px; }
    .toolbar { position: sticky; top: 0; background: #1e1e3a; color: #fff; padding: 12px 16px; margin: -24px -24px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; z-index: 10; }
    .toolbar button { padding: 10px 18px; border: none; border-radius: 8px; background: #4f46e5; color: #fff; font-weight: 800; font-size: 12px; cursor: pointer; }
    h1 { margin: 0 0 4px; font-size: 18px; }
    h2 { margin: 24px 0 8px; font-size: 14px; }
    h3 { margin: 0; font-size: 13px; }
    .meta { color: #444; margin-bottom: 16px; line-height: 1.5; }
    .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
    .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 8px 14px; min-width: 110px; }
    .kpi span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; font-weight: 700; }
    .kpi strong { font-size: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono { font-family: ui-monospace, monospace; font-size: 10px; }
    .pos { color: #047857; font-weight: 800; }
    .neg { color: #b91c1c; font-weight: 800; }
    .variance-row { background: #fef9c3; }
    .vendor-group { margin: 0 0 18px; }
    .vendor-group header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; background: #eef2ff; padding: 6px 10px; border-radius: 6px 6px 0 0; border: 1px solid #c7d2fe; border-bottom: none; }
    .vendor-totals { font-size: 10px; color: #4338ca; font-weight: 700; }
    .missing-section { background: #fff7ed; border: 2px solid #fdba74; padding: 12px; border-radius: 10px; margin-top: 24px; }
    .missing-section header { margin-bottom: 8px; }
    .missing-section header h2 { color: #9a3412; margin: 0 0 4px; font-size: 13px; }
    .missing-section header p { margin: 0; color: #7c2d12; font-size: 10px; }
    .missing-section table th { background: #fed7aa; color: #7c2d12; }
    @media print {
      .toolbar { display: none; }
      body { padding: 12px; }
      tr { break-inside: avoid; }
      .vendor-group { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>Stock take report — use Print → Save as PDF</span>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <h1>${esc(session.label)}</h1>
  <p class="meta">
    ${esc(locationLabel)} · ${esc(dateStr)} ${esc(timeStr)}<br />
    Session ${esc(session.id)}${session.created_by ? ` · ${esc(session.created_by)}` : ''}
    ${committedAt ? `<br />Committed ${esc(committedAt)}` : ''}
    ${session.reopened_count ? `<br />Re-opened ${session.reopened_count}× after initial commit` : ''}
  </p>
  <div class="kpis">
    <div class="kpi"><span>SKU lines</span><strong>${totals.skus}</strong></div>
    <div class="kpi"><span>Units counted</span><strong>${totals.units}</strong></div>
    <div class="kpi"><span>Net vs book</span><strong class="${varianceUnits > 0 ? 'pos' : varianceUnits < 0 ? 'neg' : ''}">${varianceUnits >= 0 ? '+' : ''}${varianceUnits}</strong></div>
    <div class="kpi"><span>Missing SKUs</span><strong class="${sortedMissing.length > 0 ? 'neg' : ''}">${sortedMissing.length}</strong></div>
  </div>
  ${groups.map(renderGroup).join('') || '<p>No lines counted.</p>'}
  ${missingTable}
</body>
</html>`;

  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) {
    window.alert('Please allow pop-ups to generate the stock take PDF.');
    return;
  }
  win.document.write(html);
  win.document.close();
}
