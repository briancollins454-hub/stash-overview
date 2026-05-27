import type { StockTakeLineView, StockTakeSession } from '../services/stockTakeService';

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface StockTakeCsvRow {
  line: StockTakeLineView;
  bookQty: number;
}

export interface StockTakeCsvMissingRow {
  ean: string;
  description: string;
  vendor: string;
  productCode: string;
  colour: string;
  size: string;
  bookQty: number;
}

/**
 * Download the current count as a flat CSV.  Includes both counted lines and
 * the "missing from count" set so the warehouse / accounts can reconcile in
 * Excel without needing to re-open the app.
 */
export function downloadStockTakeCsv(opts: {
  session: StockTakeSession;
  locationLabel: string;
  rows: StockTakeCsvRow[];
  missing: StockTakeCsvMissingRow[];
}): void {
  const { session, locationLabel, rows, missing } = opts;
  const header = [
    'section',
    'ean',
    'description',
    'vendor',
    'product_code',
    'colour',
    'size',
    'counted_qty',
    'book_qty',
    'variance',
    'embellished',
    'club_name',
    'resolved_via',
  ];

  const counted = rows.map(({ line, bookQty }) => [
    'counted',
    line.ean,
    line.description,
    line.vendor,
    line.productCode,
    line.colour,
    line.size,
    line.qty,
    bookQty,
    line.qty - bookQty,
    line.isEmbellished ? 'yes' : 'no',
    line.clubName || '',
    line.resolvedVia,
  ]);

  const missingRows = missing.map(m => [
    'missing',
    m.ean,
    m.description,
    m.vendor,
    m.productCode,
    m.colour,
    m.size,
    0,
    m.bookQty,
    -m.bookQty,
    '',
    '',
    '',
  ]);

  const meta = [
    `# session,${csvEscape(session.label)}`,
    `# location,${csvEscape(locationLabel)}`,
    `# generated,${new Date().toISOString()}`,
    `# committed_by,${csvEscape(session.committed_by || session.created_by || '')}`,
  ].join('\r\n');

  const body = [header, ...counted, ...missingRows]
    .map(row => row.map(csvEscape).join(','))
    .join('\r\n');

  const csv = `${meta}\r\n${body}\r\n`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeLabel = (session.label || 'stock-take').replace(/[^a-z0-9-]+/gi, '_');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${safeLabel}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
