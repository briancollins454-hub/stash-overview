// ─── Open-item statement PDF — QuickBooks / MCB print layout ─────────────
// Matches Marx Corporate account print (company block, aging bar, payment,
// DATE | DESCRIPTION | AMOUNT | OPEN AMOUNT, page footers).

import type { AgingSummary, OpenItemStatement } from './openItemStatement';
import {
  STATEMENT_COMPANY,
  STATEMENT_PAYMENT,
} from '../constants/statementBranding';

export interface StatementPdfOptions {
  companyName?: string;
  companyAddressLines?: string[];
  accountsEmail?: string;
  website?: string;
  payment?: typeof STATEMENT_PAYMENT;
}

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const FOOTER_Y = PAGE_H - 10;

const formatAmount = (v: number) =>
  v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

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
    pdfLibs = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([jspdf, autotable]) => ({
      jsPDF: jspdf.jsPDF,
      autoTable: autotable.default,
    }));
  }
  return pdfLibs;
}

function drawAgingBar(doc: import('jspdf').jsPDF, y: number, aging: AgingSummary): number {
  const tableW = PAGE_W - MARGIN * 2;
  const colW = tableW / 6;
  const x0 = MARGIN;
  const headers: { line1: string; line2: string }[] = [
    { line1: 'Current', line2: 'Due' },
    { line1: '1-30 Days', line2: 'Past Due' },
    { line1: '31-60 Days', line2: 'Past Due' },
    { line1: '61-90 Days', line2: 'Past Due' },
    { line1: '90+ Days', line2: 'Past Due' },
    { line1: 'Amount', line2: 'Due' },
  ];
  const values = [
    aging.current,
    aging.pastDue1_30,
    aging.pastDue31_60,
    aging.pastDue61_90,
    aging.pastDue90Plus,
    aging.total,
  ];

  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  doc.rect(x0, y, tableW, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);

  headers.forEach((h, i) => {
    const cx = x0 + colW * i + colW / 2;
    doc.text(h.line1, cx, y + 4, { align: 'center' });
    doc.text(h.line2, cx, y + 7.5, { align: 'center' });
    if (i < 5) doc.line(x0 + colW * (i + 1), y, x0 + colW * (i + 1), y + 14);
  });

  doc.line(x0, y + 9, x0 + tableW, y + 9);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  values.forEach((v, i) => {
    const cx = x0 + colW * i + colW / 2;
    const label = i === 5 ? `GBP ${formatAmount(v)}` : formatAmount(v);
    doc.text(label, cx, y + 12.5, { align: 'center' });
  });

  return y + 16;
}

function drawPaymentBlock(doc: import('jspdf').jsPDF, y: number, payment: typeof STATEMENT_PAYMENT): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);

  const lines = [
    payment.cardIntro,
    payment.stripeGbp,
    payment.stripeEuro,
    payment.bankIntro,
    `Account Name: ${payment.accountName}`,
    `Sort Code: ${payment.sortCode}`,
    `Account No: ${payment.accountNo}`,
  ];

  let cy = y;
  lines.forEach(line => {
    doc.text(line, MARGIN, cy);
    cy += 4;
  });
  return cy + 2;
}

function drawLetterhead(
  doc: import('jspdf').jsPDF,
  y: number,
  statement: OpenItemStatement,
  company: typeof STATEMENT_COMPANY,
  accountsEmail: string,
  website: string,
): number {
  const leftX = MARGIN;
  const toX = 72;
  const rightX = PAGE_W - MARGIN;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(company.name, leftX, y);
  doc.text(company.name, leftX, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let ly = y + 10;
  company.addressLines.forEach(line => {
    doc.text(line, leftX, ly);
    ly += 4;
  });
  doc.text(accountsEmail, leftX, ly);
  ly += 4;
  doc.text(website, leftX, ly);
  ly += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Statement', leftX, ly);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TO', toX, y);

  doc.setFont('helvetica', 'normal');
  let ty = y + 5;
  statement.customerAddressLines.forEach(line => {
    doc.text(line, toX, ty);
    ty += 4;
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  let ry = y;
  const metaRows: [string, string][] = [
    ['STATEMENT NO.', statement.statementNumber],
    ['DATE', statement.asAtDateShort],
    ['TOTAL DUE GBP', formatAmount(statement.totalOutstanding)],
  ];
  metaRows.forEach(([label, value]) => {
    doc.text(label, rightX, ry, { align: 'right' });
    ry += 4;
    doc.setFont('helvetica', 'normal');
    doc.text(value, rightX, ry, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    ry += 6;
  });

  const blockBottom = Math.max(ly, ty, ry) + 4;
  return blockBottom;
}

function drawPageFooter(doc: import('jspdf').jsPDF, pageNum: number, totalPages: number) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(`-- ${pageNum} of ${totalPages} --`, PAGE_W / 2, FOOTER_Y, { align: 'center' });
}

function chunkLines<T>(items: T[], firstSize: number, restSize: number): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  pages.push(items.slice(0, firstSize));
  let i = firstSize;
  while (i < items.length) {
    pages.push(items.slice(i, i + restSize));
    i += restSize;
  }
  return pages;
}

export async function downloadOpenItemStatementPdf(
  statement: OpenItemStatement,
  opts: StatementPdfOptions = {},
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfLibs();

  const company = {
    name: opts.companyName || STATEMENT_COMPANY.name,
    addressLines: opts.companyAddressLines || [...STATEMENT_COMPANY.addressLines],
  };
  const accountsEmail = opts.accountsEmail || STATEMENT_COMPANY.email;
  const website = opts.website || STATEMENT_COMPANY.website;
  const payment = opts.payment || STATEMENT_PAYMENT;

  const FIRST_PAGE_LINES = 14;
  const NEXT_PAGE_LINES = 22;
  const pageChunks = chunkLines(statement.lines, FIRST_PAGE_LINES, NEXT_PAGE_LINES);
  const totalPages = pageChunks.length;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  pageChunks.forEach((chunk, pageIndex) => {
    if (pageIndex > 0) doc.addPage();

    let y = MARGIN;
    y = drawAgingBar(doc, y, statement.aging);
    y = drawPaymentBlock(doc, y, payment);

    if (pageIndex === 0) {
      y = drawLetterhead(doc, y, statement, company, accountsEmail, website);
    }

    const tableBody = chunk.map(l => [
      l.txnDateShort,
      l.description,
      formatAmount(l.amountDue),
      formatAmount(l.amountDue),
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, bottom: 16 },
      head: [['DATE', 'DESCRIPTION', 'AMOUNT', 'OPEN AMOUNT']],
      body: tableBody,
      theme: 'plain',
      styles: {
        fontSize: 8,
        textColor: [0, 0, 0],
        cellPadding: 1.5,
        lineWidth: 0,
        overflow: 'linebreak',
      },
      headStyles: {
        fontStyle: 'bold',
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        lineWidth: { bottom: 0.2 },
        lineColor: [0, 0, 0],
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 24, halign: 'right' },
        3: { cellWidth: 28, halign: 'right' },
      },
      didDrawPage: () => {
        drawPageFooter(doc, pageIndex + 1, totalPages);
      },
    });
  });

  doc.save(statementPdfFilename(statement.customerName));
}
