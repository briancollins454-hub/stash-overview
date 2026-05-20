// ─── Open-item statement PDF — Marx branded customer statements ──────────

import type { OpenItemLine, OpenItemStatement } from './openItemStatement';
import {
  BRAND_TRIO_LOGO_URL,
  STATEMENT_COLORS,
  STATEMENT_COMPANY,
  STATEMENT_PAYMENT,
  type StripePayLink,
} from '../constants/statementBranding';

export interface StatementPdfOptions {
  companyName?: string;
  companyAddressLines?: string[];
  accountsEmail?: string;
  website?: string;
  payment?: typeof STATEMENT_PAYMENT;
  brandLogoUrl?: string;
}

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const FOOTER_Y = PAGE_H - 10;
const { green, greenText, headerText, overdueRed } = STATEMENT_COLORS;

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
const imageCache = new Map<string, string | null>();

function loadPdfLibs() {
  if (!pdfLibs) {
    pdfLibs = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([jspdf, autotable]) => ({
      jsPDF: jspdf.jsPDF,
      autoTable: autotable.default,
    }));
  }
  return pdfLibs;
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  if (imageCache.has(url)) return imageCache.get(url) ?? null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) {
      imageCache.set(url, null);
      return null;
    }
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    imageCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    imageCache.set(url, null);
    return null;
  }
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (dataUrl.includes('image/png')) return 'PNG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  return 'JPEG';
}

function drawBrandLogo(
  doc: import('jspdf').jsPDF,
  dataUrl: string | null,
  rightX: number,
  topY: number,
) {
  const logoW = 58;
  const logoH = 14;
  const x = rightX - logoW;
  if (dataUrl) {
    try {
      doc.addImage(dataUrl, imageFormat(dataUrl), x, topY, logoW, logoH);
      return;
    } catch {
      /* text fallback */
    }
  }
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(12);
  doc.setTextColor(...greenText);
  doc.text('MARX CORPORATE', x, topY + 8);
}

function drawFirstPageLetterhead(
  doc: import('jspdf').jsPDF,
  statement: OpenItemStatement,
  company: { name: string; addressLines: string[] },
  accountsEmail: string,
  website: string,
  brandLogo: string | null,
): number {
  const leftX = MARGIN;
  const rightX = PAGE_W - MARGIN;
  const topY = MARGIN;
  const c = statement.customer;

  drawBrandLogo(doc, brandLogo, rightX, topY);

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

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TO', leftX, afterTitleY + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let ty = afterTitleY + 9;
  const customerLines: string[] = [
    `Account: ${c.accountId || statement.customerId || '—'}`,
    ...c.addressLines,
  ];
  if (c.email) customerLines.push(`Email: ${c.email}`);
  if (c.phone) customerLines.push(`Phone: ${c.phone}`);

  customerLines.forEach(line => {
    doc.text(line, leftX, ty);
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

function drawAgingBar(doc: import('jspdf').jsPDF, y: number, aging: OpenItemStatement['aging']): number {
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
  values.forEach((v, i) => {
    const cx = x0 + colW * i + colW / 2;
    const isOverdueBucket = i >= 1 && i <= 4 && v > 0.005;
    doc.setTextColor(...(isOverdueBucket ? overdueRed : [0, 0, 0]));
    doc.text(i === 5 ? `GBP ${formatAmount(v)}` : formatAmount(v), cx, y + 11.5, { align: 'center' });
  });

  return y + 15;
}

/** Render a green “Pay Now” button image for embedding in the PDF. */
function renderPayNowButtonImage(currencyLabel: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 88;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const r = 14;
  const w = canvas.width;
  const h = canvas.height;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#b5dc6a');
  grad.addColorStop(1, '#6a9e32');
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 28px Helvetica, Arial, sans-serif';
  ctx.fillText('PAY NOW', w / 2, 38);
  ctx.font = '600 18px Helvetica, Arial, sans-serif';
  ctx.fillText(currencyLabel, w / 2, 68);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function drawPayNowButtons(
  doc: import('jspdf').jsPDF,
  y: number,
  links: StripePayLink[],
  buttonImages: string[],
): number {
  const boxW = PAGE_W - MARGIN * 2;
  const btnW = (boxW - 8) / 2;
  const btnH = 16;
  const textX = MARGIN + 3;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...greenText);
  doc.text('Pay by card', textX, y + 4);

  const btnY = y + 8;
  links.forEach((link, i) => {
    const bx = MARGIN + i * (btnW + 8);
    const img = buttonImages[i];
    if (img) {
      try {
        doc.addImage(img, 'JPEG', bx, btnY, btnW, btnH);
      } catch {
        drawPayNowButtonFallback(doc, bx, btnY, btnW, btnH, link);
      }
    } else {
      drawPayNowButtonFallback(doc, bx, btnY, btnW, btnH, link);
    }
    doc.link(bx, btnY, btnW, btnH, { url: link.url });
  });

  return btnY + btnH + 6;
}

function drawPayNowButtonFallback(
  doc: import('jspdf').jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  link: StripePayLink,
) {
  doc.setFillColor(...green);
  doc.roundedRect(x, y, w, h, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('PAY NOW', x + w / 2, y + h / 2 - 1, { align: 'center' });
  doc.setFontSize(8);
  doc.text(link.currency, x + w / 2, y + h / 2 + 4, { align: 'center' });
}

function drawBankTransferBlock(
  doc: import('jspdf').jsPDF,
  y: number,
  payment: typeof STATEMENT_PAYMENT,
): number {
  const textX = MARGIN + 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(payment.bankIntro, textX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let cy = y + 5;
  const lines = [
    `Account Name: ${payment.accountName}`,
    `Sort Code: ${payment.sortCode}`,
    `Account No: ${payment.accountNo}`,
  ];
  lines.forEach(line => {
    doc.text(line, textX, cy);
    cy += 4;
  });
  return cy + 2;
}

function drawPaymentSection(
  doc: import('jspdf').jsPDF,
  y: number,
  payment: typeof STATEMENT_PAYMENT,
  buttonImages: string[],
): number {
  const boxW = PAGE_W - MARGIN * 2;
  const boxH = 52;
  doc.setFillColor(248, 252, 240);
  doc.setDrawColor(...green);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, boxW, boxH, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(50, 50, 50);
  doc.text(payment.cardIntro, MARGIN + 3, y + 5);

  let cy = drawPayNowButtons(doc, y + 2, payment.stripeLinks, buttonImages);
  cy = drawBankTransferBlock(doc, cy + 2, payment);

  return y + boxH + 4;
}

function drawStatementFooter(
  doc: import('jspdf').jsPDF,
  startY: number,
  statement: OpenItemStatement,
  payment: typeof STATEMENT_PAYMENT,
  buttonImages: string[],
): number {
  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text('Aging summary', MARGIN, y);
  y += 4;
  y = drawAgingBar(doc, y, statement.aging);
  y = drawPaymentSection(doc, y + 2, payment, buttonImages);
  return y;
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
  chunk: OpenItemLine[],
) {
  const body = chunk.map(l => [
    l.txnDateShort,
    l.docNumber,
    l.dueDateShort,
    formatAmount(l.amountDue),
    formatAmount(l.amountDue),
  ]);

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, bottom: 14 },
    head: [['DATE', 'INVOICE NO.', 'DUE DATE', 'AMOUNT', 'OPEN AMOUNT']],
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
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 28 },
      2: { cellWidth: 24 },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 26, halign: 'right' },
    },
    didParseCell: data => {
      if (data.section !== 'body' || data.column.index !== 2) return;
      const line = chunk[data.row.index];
      if (line?.isOverdue) {
        data.cell.styles.textColor = [...overdueRed];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
}

function redrawAllFooters(doc: import('jspdf').jsPDF) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawPageFooter(doc, p, total);
  }
}

const FOOTER_SECTION_HEIGHT = 78;

export async function downloadOpenItemStatementPdf(
  statement: OpenItemStatement,
  opts: StatementPdfOptions = {},
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const brandLogo = await loadImageDataUrl(opts.brandLogoUrl || BRAND_TRIO_LOGO_URL);
  const buttonImages = STATEMENT_PAYMENT.stripeLinks.map(l => renderPayNowButtonImage(l.currency));

  const company = {
    name: opts.companyName || STATEMENT_COMPANY.name,
    addressLines: opts.companyAddressLines || [...STATEMENT_COMPANY.addressLines],
  };
  const accountsEmail = opts.accountsEmail || STATEMENT_COMPANY.email;
  const website = opts.website || STATEMENT_COMPANY.website;
  const payment = opts.payment || STATEMENT_PAYMENT;

  const FIRST_PAGE_LINES = 14;
  const CONT_PAGE_LINES = 24;
  const pageChunks = chunkLines(statement.lines, FIRST_PAGE_LINES, CONT_PAGE_LINES);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  pageChunks.forEach((chunk, pageIndex) => {
    if (pageIndex > 0) doc.addPage();

    const tableY = pageIndex === 0
      ? drawFirstPageLetterhead(doc, statement, company, accountsEmail, website, brandLogo)
      : MARGIN;

    drawLineTable(doc, autoTable, tableY, chunk);
  });

  doc.setPage(doc.getNumberOfPages());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let footerY = ((doc as any).lastAutoTable?.finalY as number | undefined) ?? MARGIN + 40;
  footerY += 6;

  if (footerY + FOOTER_SECTION_HEIGHT > FOOTER_Y - 4) {
    doc.addPage();
    footerY = MARGIN;
  }

  drawStatementFooter(doc, footerY, statement, payment, buttonImages);
  redrawAllFooters(doc);

  doc.save(statementPdfFilename(statement.customerName));
}
