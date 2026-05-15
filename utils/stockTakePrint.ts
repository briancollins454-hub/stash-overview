import type { StockTakeLineView, StockTakeSession } from '../services/stockTakeService';

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

export function openStockTakePrint(opts: {
  session: StockTakeSession;
  locationLabel: string;
  rows: StockTakePrintRow[];
  totals: { skus: number; units: number };
}): void {
  const { session, locationLabel, rows, totals } = opts;
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

  const sorted = [...rows].sort((a, b) => {
    const da = a.line.description.localeCompare(b.line.description);
    if (da !== 0) return da;
    return a.line.ean.localeCompare(b.line.ean);
  });

  let varianceUnits = 0;
  const bodyRows = sorted.map(({ line, bookQty }, i) => {
    const diff = line.qty - bookQty;
    varianceUnits += diff;
    const diffClass = diff > 0 ? 'pos' : diff < 0 ? 'neg' : '';
    const diffLabel = diff === 0 ? '—' : diff > 0 ? `+${diff}` : String(diff);
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="mono">${esc(line.ean)}</td>
      <td>${esc(line.description)}</td>
      <td>${esc(line.vendor || '—')}</td>
      <td>${esc(line.productCode || '—')}</td>
      <td>${esc(line.colour || '—')}</td>
      <td>${esc(line.size || '—')}</td>
      <td class="num"><strong>${line.qty}</strong></td>
      <td class="num">${bookQty}</td>
      <td class="num ${diffClass}">${diffLabel}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Stock take — ${esc(session.label)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; color: #111; font-size: 11px; }
    .toolbar { position: sticky; top: 0; background: #1e1e3a; color: #fff; padding: 12px 16px; margin: -24px -24px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
    .toolbar button { padding: 10px 18px; border: none; border-radius: 8px; background: #4f46e5; color: #fff; font-weight: 800; font-size: 12px; cursor: pointer; }
    h1 { margin: 0 0 4px; font-size: 18px; }
    .meta { color: #444; margin-bottom: 16px; line-height: 1.5; }
    .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
    .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 8px 14px; min-width: 100px; }
    .kpi span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; font-weight: 700; }
    .kpi strong { font-size: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono { font-family: ui-monospace, monospace; font-size: 10px; }
    .pos { color: #047857; font-weight: 700; }
    .neg { color: #b91c1c; font-weight: 700; }
    @media print {
      .toolbar { display: none; }
      body { padding: 12px; }
      tr { break-inside: avoid; }
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
  </p>
  <div class="kpis">
    <div class="kpi"><span>SKU lines</span><strong>${totals.skus}</strong></div>
    <div class="kpi"><span>Units counted</span><strong>${totals.units}</strong></div>
    <div class="kpi"><span>Net vs book</span><strong>${varianceUnits >= 0 ? '+' : ''}${varianceUnits}</strong></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Barcode / SKU</th>
        <th>Description</th>
        <th>Vendor</th>
        <th>Code</th>
        <th>Colour</th>
        <th>Size</th>
        <th>Counted</th>
        <th>On book</th>
        <th>Diff</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows || '<tr><td colspan="10">No lines</td></tr>'}
    </tbody>
  </table>
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
