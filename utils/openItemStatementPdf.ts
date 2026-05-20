// ─── Open-item statement PDF — Marx / QuickBooks print layout ────────────
// Page 1: letterhead, logos, green “Statement”, TO + meta, green table header.
// Page 2+: aging + payment at top, then continued line items.

import type { AgingSummary, OpenItemStatement } from './openItemStatement';
import {
  STATEMENT_COLORS,
  STATEMENT_COMPANY,
  STATEMENT_PAYMENT,
  STASH_LOGO_URL,
} from '../constants/statementBranding';

export interface StatementPdfOptions {
  companyName?: string;
  companyAddressLines?: string[];
  accountsEmail?: string;
  website?: string;
  payment?: typeof STATEMENT_PAYMENT;
  stashLogoUrl?: string;
}

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const FOOTER_Y = PAGE_H - 10;
const { green, greenText, headerText } = STATEMENT_COLORS;

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
let stashLogoData: string | null | undefined;

function loadPdfLibs() {
  if (!pdfLibs) {
    pdfLibs = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([jspdf, autotable]) => ({
      jsPDF: jspdf.jsPDF,
      autoTable: autotable.default,
    }));
  }
  return pdfLibs;
}

async function loadStashLogo(url: string): Promise<string | null> {
  if (stashLogoData !== undefined) return stashLogoData;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    stashLogoData = dataUrl;
    return dataUrl;
  } catch {
    stashLogoData = null;
    return null;
  }
}

function drawMarxLogo(doc: import('jspdf').jsPDF, rightX: number, topY: number) {
  const w = 42;
  const x = rightX - w;
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(13);
  doc.setTextColor(...greenText);
  doc.text('MARX', x, topY + 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('CORPORATE', x, topY + 9);
}

function drawStashLogo(
  doc: import('jspdf').jsPDF,
  dataUrl: string | null,
  rightX: number,
  topY: number,
) {
  const x = rightX - 38;
  if (dataUrl) {
    try {
      doc.addImage(dataUrl, 'PNG', x, topY, 36, 10);
      return;
    } catch {
      /* fall through to text */
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text('STASH', x, topY + 5);
  doc.setFontSize(8);
  doc.text('INC.', x + 22, topY + 5);
}

/** Page 1 — company block, logos, green Statement, TO, meta (no aging/payment). */
function drawFirstPageLetterhead(
  doc: import('jspdf').jsPDF,
  statement: OpenItemStatement,
  company: { name: string; addressLines: string[] },
  accountsEmail: string,
  website: string,
  stashLogo: string | null,
): number {
  const leftX = MARGIN;
  const rightX = PAGE_W - MARGIN;
  const topY = MARGIN;

  drawMarxLogo(doc, rightX - 44, topY);
  drawStashLogo(doc, stashLogo, rightX, topY);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(company.name, leftX, topY + 4);
  doc.text(company.name, leftX, topY + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let ly = topY + 13;
  company.addressLines.forEach(line => {
    doc.text(line, leftX, ly);
    ly += 4;
  });
  doc.text(accountsEmail, leftX, ly);
  ly += 4;
  doc.text(website, leftX, ly);
  ly += 8;

  doc.setTextColor(...green);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(24);
  doc.text('Statement', leftX, ly);
  const afterTitleY = ly + 6;

  const toX = leftX;
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TO', toX, afterTitleY + 4);

  doc.setFont('helvetica', 'normal');
  let ty = afterTitleY + 9;
  statement.customerAddressLines.forEach(line => {
    doc.text(line, toX, ty);
    ty += 4;
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  let ry = afterTitleY;
  const meta: [string, string][] = [
    ['STATEMENT NO.', statement.statementNumber],
    ['DATE', statement.asAtDateShort],
    ['TOTAL DUE GBP', formatAmount(statement.totalOutstanding)],
    ['ENCLOSED', ''],
  ];
  meta.forEach(([label, value]) => {
    doc.text(label, rightX, ry, { align: 'right' });
    ry += 4;
    if (value) {
      doc.setFont('helvetica', 'normal');
      doc.text(value, rightX, ry, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      ry += 5;
    } else {
      ry += 3;
    }
  });

  return Math.max(ty, ry) + 6;
}

function drawAgingBar(doc: import('jspdf').jsPDF, y: number, aging: AgingSummary): number {
  const tableW = PAGE_W - MARGIN * 2;
  const colW = tableW / 6;
  const x0 = MARGIN;

  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.15);
  doc.rect(x0, y, tableW, 13);

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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(80, 80, 80);
  headers.forEach((h, i) => {
    const cx = x0 + colW * i + colW / 2;
    doc.text(h.line1, cx, y + 3.5, { align: 'center' });
    doc.text(h.line2, cx, y + 6.5, { align: 'center' });
    if (i < 5) doc.line(x0 + colW * (i + 1), y, x0 + colW * (i + 1), y + 13);
  });

  doc.line(x0, y + 8, x0 + tableW, y + 8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  values.forEach((v, i) => {
    const cx = x0 + colW * i + colW / 2;
    doc.text(i === 5 ? `GBP ${formatAmount(v)}` : formatAmount(v), cx, y + 11.5, { align: 'center' });
  });

  return y + 15;
}

function drawPaymentBlock(doc: import('jspdf').jsPDF, y: number, payment: typeof STATEMENT_PAYMENT): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(60, 60, 60);
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
    cy += 3.5;
  });
  return cy + 2;
}

function drawPageFooter(doc: import('jspdf').jsPDF, pageNum: number, totalPages: number) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`-- ${pageNum} of ${totalPages} --`, PAGE_W / 2, FOOTER_Y, { align: 'center' });
}

function chunkLines<T>(items: T[], firstSize: number, restSize: number): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [items.slice(0, firstSize)];
  let i = firstSize;
  while (i < items.length) {
    pages.push(items.slice(i, i + restSize));
    i += restSize;
  }
  return pages;
}

function drawLineTable(
  doc: import('jspdf').jsPDF,
  autoTable: AutoTableModule['default'],
  startY: number,
  chunk: OpenItemStatement['lines'],
  pageIndex: number,
  totalPages: number,
) {
  const body = chunk.map(l => [
    l.txnDateShort,
    l.description,
    formatAmount(l.amountDue),
    formatAmount(l.amountDue),
  ]);

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, bottom: 14 },
    head: [['DATE', 'DESCRIPTION', 'AMOUNT', 'OPEN AMOUNT']],
    body,
    theme: 'plain',
    styles: {
      fontSize: 8.5,
      textColor: [40, 40, 40],
      cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
      lineWidth: 0,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 8.5,
      fillColor: [...green],
      textColor: [...headerText],
      cellPadding: { top: 3, right: 2, bottom: 3, left: 2 },
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 26, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
    },
    didDrawPage: () => {
      drawPageFooter(doc, pageIndex + 1, totalPages);
    },
  });
}

export async function downloadOpenItemStatementPdf(
  statement: OpenItemStatement,
  opts: StatementPdfOptions = {},
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const stashLogo = await loadStashLogo(opts.stashLogoUrl || STASH_LOGO_URL);

  const company = {
    name: opts.companyName || STATEMENT_COMPANY.name,
    addressLines: opts.companyAddressLines || [...STATEMENT_COMPANY.addressLines],
  };
  const accountsEmail = opts.accountsEmail || STATEMENT_COMPANY.email;
  const website = opts.website || STATEMENT_COMPANY.website;
  const payment = opts.payment || STATEMENT_PAYMENT;

  const FIRST_PAGE_LINES = 18;
  const CONT_PAGE_LINES = 24;
  const pageChunks = chunkLines(statement.lines, FIRST_PAGE_LINES, CONT_PAGE_LINES);
  const totalPages = pageChunks.length;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  pageChunks.forEach((chunk, pageIndex) => {
    if (pageIndex > 0) doc.addPage();

    let tableY: number;
    if (pageIndex === 0) {
      tableY = drawFirstPageLetterhead(
        doc,
        statement,
        company,
        accountsEmail,
        website,
        stashLogo,
      );
    } else {
      let y = MARGIN;
      y = drawAgingBar(doc, y, statement.aging);
      y = drawPaymentBlock(doc, y, payment);
      tableY = y + 2;
    }

    drawLineTable(doc, autoTable, tableY, chunk, pageIndex, totalPages);
  });

  doc.save(statementPdfFilename(statement.customerName));
}
