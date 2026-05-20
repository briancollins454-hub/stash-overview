// ─── Open-item statement PDF (client-side, lazy-loaded jspdf) ─────────────
// Produces a proper A4 PDF file for email attachment — not browser print.

import type { OpenItemStatement } from './openItemStatement';

export interface StatementPdfOptions {
  companyName?: string;
  companyAddress?: string;
  accountsEmail?: string;
  /** Optional remittance / bank details line on the footer */
  paymentNote?: string;
}

const DEFAULT_COMPANY = 'Marx Corporate';
const DEFAULT_ACCOUNTS = 'accounts@marxcorporate.com';

const formatMoney = (v: number) =>
  '£' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Safe filename: `Statement - Acme Ltd - 2026-05-20.pdf` */
export function statementPdfFilename(customerName: string, asAt = new Date()): string {
  const date = asAt.toISOString().slice(0, 10);
  const safe = customerName
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'Customer';
  return `Statement - ${safe} - ${date}.pdf`;
}

type JsPDFModule = typeof import('jspdf');
type AutoTableModule = typeof import('jspdf-autotable');

let pdfLibs: Promise<{ jsPDF: JsPDFModule['jsPDF']; autoTable: AutoTableModule['default'] }> | null = null;

function loadPdfLibs() {
  if (!pdfLibs) {
    pdfLibs = Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]).then(([jspdf, autotable]) => ({
      jsPDF: jspdf.jsPDF,
      autoTable: autotable.default,
    }));
  }
  return pdfLibs;
}

/**
 * Build an A4 portrait PDF and trigger a file download in the browser.
 */
export async function downloadOpenItemStatementPdf(
  statement: OpenItemStatement,
  opts: StatementPdfOptions = {},
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const company = opts.companyName || DEFAULT_COMPANY;
  const accounts = opts.accountsEmail || DEFAULT_ACCOUNTS;
  const address = opts.companyAddress || '';
  const paymentNote =
    opts.paymentNote ||
    'Please remit payment quoting invoice number(s). If you have already paid, send remittance advice so we can allocate your payment.';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = margin;

  // ─── Header band ─────────────────────────────────────────────────────
  doc.setFillColor(79, 70, 229); // indigo-600
  doc.rect(0, 0, pageW, 32, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(company.toUpperCase(), margin, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('OPEN ITEM STATEMENT', margin, 19);

  doc.setFontSize(8);
  const generated = new Date().toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.text(`Generated ${generated}`, pageW - margin, 12, { align: 'right' });
  if (address) {
    doc.text(address, pageW - margin, 19, { align: 'right' });
  }

  y = 42;
  doc.setTextColor(31, 41, 55);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(statement.customerName, margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.text(`Statement date: ${statement.asAtDate}`, margin, y);
  y += 5;
  doc.text(`Account reference: ${statement.customerId || '—'}`, margin, y);
  y += 5;
  doc.text(
    `${statement.lines.length} open invoice${statement.lines.length === 1 ? '' : 's'}`,
    margin,
    y,
  );
  y += 10;

  // ─── Line items table ──────────────────────────────────────────────────
  const body = statement.lines.map(l => [
    l.docNumber,
    l.txnDate,
    l.dueDate,
    String(l.daysOutstanding),
    formatMoney(l.amountDue),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Invoice no.', 'Invoice date', 'Due date', 'Days', 'Amount due']],
    body,
    foot: [[
      { content: 'Total outstanding', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: formatMoney(statement.totalOutstanding), styles: { fontStyle: 'bold', halign: 'right' } },
    ]],
    theme: 'striped',
    headStyles: {
      fillColor: [79, 70, 229],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
    },
    bodyStyles: { fontSize: 9, textColor: [31, 41, 55] },
    footStyles: { fillColor: [238, 242, 255], textColor: [67, 56, 202], fontSize: 10 },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold' },
      1: { cellWidth: 28 },
      2: { cellWidth: 28 },
      3: { cellWidth: 16, halign: 'right' },
      4: { cellWidth: 32, halign: 'right' },
    },
    didDrawPage: (data) => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text(
        `${company} · Open item statement · Page ${data.pageNumber}`,
        pageW / 2,
        pageH - 8,
        { align: 'center' },
      );
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY ?? y + 40;

  // ─── Footer notes ────────────────────────────────────────────────────
  let noteY = finalY + 12;
  if (noteY > 250) {
    doc.addPage();
    noteY = margin;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(31, 41, 55);
  doc.text('Payment & enquiries', margin, noteY);
  noteY += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  const wrapped = doc.splitTextToSize(paymentNote, pageW - margin * 2);
  doc.text(wrapped, margin, noteY);
  noteY += wrapped.length * 4.5 + 4;

  doc.text(`Accounts: ${accounts}`, margin, noteY);

  doc.save(statementPdfFilename(statement.customerName));
}
