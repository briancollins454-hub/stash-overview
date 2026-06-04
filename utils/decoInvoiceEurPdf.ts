import { STATEMENT_COMPANY } from '../constants/statementBranding.js';
import type { InvoiceConfig } from './invoiceSettings.js';

type PdfLibs = { jsPDF: typeof import('jspdf').jsPDF; autoTable: typeof import('jspdf-autotable').default };

let pdfLibs: Promise<PdfLibs> | null = null;

function loadPdfLibs(): Promise<PdfLibs> {
  if (!pdfLibs) {
    pdfLibs = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([jspdf, autotable]) => ({
      jsPDF: jspdf.jsPDF,
      autoTable: autotable.default,
    }));
  }
  return pdfLibs;
}

export interface EurInvoiceLine {
  description: string;
  qty: number;
  unitEur: number;
  lineEur: number;
}

export interface EurInvoiceInput {
  orderId: string;
  orderNumber: string;
  customerName: string;
  poNumber?: string;
  jobName?: string;
  dateInvoiced?: string;
  lines: EurInvoiceLine[];
  subtotalGbp: number;
  taxGbp: number;
  totalGbp: number;
  config: InvoiceConfig;
}

function eur(n: number): string {
  return `€${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function gbp(n: number): string {
  return `£${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function convert(gbpAmount: number, rate: number): number {
  return Math.round(gbpAmount * rate * 100) / 100;
}

export async function buildDecoInvoiceEurPdf(input: EurInvoiceInput): Promise<Uint8Array> {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const rate = input.config.gbpToEurRate;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  let y = margin;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE (EUR)', margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(STATEMENT_COMPANY.name, margin, y);
  y += 5;
  for (const line of STATEMENT_COMPANY.addressLines) {
    doc.text(line, margin, y);
    y += 4.5;
  }
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.text('Bill to', margin, y);
  doc.setFont('helvetica', 'normal');
  y += 5;
  doc.text(input.customerName || 'Customer', margin, y);
  y += 8;

  const meta = [
    ['Invoice / order no.', input.orderNumber || input.orderId],
    ['Job', input.jobName || '—'],
    ['PO', input.poNumber || '—'],
    ['Invoice date', input.dateInvoiced || '—'],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 } },
    body: meta,
  });
  y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  y += 6;

  const body = input.lines.length > 0
    ? input.lines.map((l) => [l.description, String(l.qty), eur(l.unitEur), eur(l.lineEur)])
    : [['Order total (see summary)', '1', '—', eur(convert(input.totalGbp, rate))]];

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Description', 'Qty', 'Unit (EUR)', 'Line (EUR)']],
    body,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [60, 60, 60], textColor: 255 },
  });
  y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 30;
  y += 8;

  const subEur = convert(input.subtotalGbp, rate);
  const taxEur = convert(input.taxGbp, rate);
  const totalEur = convert(input.totalGbp, rate);

  const totals = [
    ['Subtotal (EUR)', eur(subEur), `(GBP ${gbp(input.subtotalGbp)})`],
    ['Tax (EUR)', eur(taxEur), `(GBP ${gbp(input.taxGbp)})`],
    ['Total (EUR)', eur(totalEur), `(GBP ${gbp(input.totalGbp)})`],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'plain',
    styles: { fontSize: 9, halign: 'right' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' }, 2: { fontSize: 8, textColor: 100 } },
    body: totals,
  });
  y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 24;
  y += 6;

  doc.setFontSize(8);
  doc.setTextColor(80);
  const note = [
    `Converted from GBP at 1 GBP = ${rate.toFixed(4)} EUR.`,
    input.config.rateNote || '',
    'This document is for customer reference; your official DecoNetwork invoice may be in GBP.',
    `Generated ${new Date().toLocaleDateString('en-GB')} via Stash.`,
  ].filter(Boolean);
  for (const line of note) {
    doc.text(line, margin, y, { maxWidth: 180 });
    y += 4;
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

export function parseDecoOrderForEurInvoice(order: Record<string, unknown>, config: InvoiceConfig): Omit<EurInvoiceInput, 'config'> {
  const billing = (order.billing_details || {}) as Record<string, string>;
  const customerName =
    billing.company
    || `${billing.firstname || ''} ${billing.lastname || ''}`.trim()
    || 'Customer';

  const rate = config.gbpToEurRate;
  const lines: EurInvoiceLine[] = [];
  const orderLines = Array.isArray(order.order_lines) ? order.order_lines : [];
  for (const raw of orderLines) {
    const line = raw as Record<string, unknown>;
    const itemType = Number(line.item_type);
    if (Number.isFinite(itemType) && ![0, 25, 26].includes(itemType)) continue;
    const unitGbp = parseFloat(String(line.unit_price ?? 0)) || 0;
    const totalGbp = parseFloat(String(line.total_price ?? 0)) || unitGbp * (parseFloat(String(line.qty ?? line.quantity ?? 1)) || 1);
    if (totalGbp <= 0 && unitGbp <= 0) continue;
    const qty = parseFloat(String(line.qty ?? line.quantity ?? 1)) || 1;
    const color = (line.product_color as { name?: string })?.name;
    const desc = [line.product_name, color].filter(Boolean).join(' — ') || 'Line item';
    lines.push({
      description: String(desc),
      qty,
      unitEur: convert(unitGbp, rate),
      lineEur: convert(totalGbp, rate),
    });
  }

  const subtotalGbp = parseFloat(String(order.item_amount ?? 0))
    || lines.reduce((s, l) => s + l.lineEur / rate, 0);
  const taxGbp = parseFloat(String(order.tax_amount ?? order.tax ?? 0)) || 0;
  const totalGbp = parseFloat(String(order.total ?? order.order_total ?? 0))
    || subtotalGbp + taxGbp;

  return {
    orderId: String(order.order_id ?? order.id ?? ''),
    orderNumber: String(order.order_number ?? order.order_id ?? ''),
    customerName,
    poNumber: String(order.customer_po_number ?? '') || undefined,
    jobName: String(order.job_name ?? '') || undefined,
    dateInvoiced: String(order.date_invoiced ?? '') || undefined,
    lines,
    subtotalGbp,
    taxGbp,
    totalGbp,
  };
}
