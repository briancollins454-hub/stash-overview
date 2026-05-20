// ─── Open-item statement PDF — Marx branded customer statements ──────────

import type { OpenItemLine, OpenItemStatement } from './openItemStatement';
import {
  BRAND_TRIO_LOGO_CDN,
  BRAND_TRIO_LOGO_PATH,
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
  /** Emergency only — omit logo if attachment still exceeds size limits after compression. */
  skipBrandLogo?: boolean;
}

const MARGIN = 14;
const PAGE_W = 210;
const PAGE_H = 297;
/** Invoice line table — centered with modest side inset (wider than letterhead text) */
const TABLE_SIDE = 10;
const STATEMENT_TABLE_W = PAGE_W - TABLE_SIDE * 2;
const STATEMENT_TABLE_LEFT = TABLE_SIDE;
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

interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Node / Vercel — no Image or FileReader. */
async function loadImageServer(url: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 8) return null;
    const dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
    return { dataUrl, width: 1075, height: 268 };
  } catch {
    return null;
  }
}

function resolveAssetUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  if (typeof window !== 'undefined') {
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${window.location.origin}${path}`;
  }
  return url;
}

/** Browser — draw to canvas (works for same-origin; avoids brittle fetch+CORS). */
async function loadImageViaCanvas(url: string): Promise<LoadedImage | null> {
  if (typeof window === 'undefined') return null;
  const src = resolveAssetUrl(url);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.naturalWidth < 1 || img.naturalHeight < 1) {
        resolve(null);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadImageWithDimensions(url: string): Promise<LoadedImage | null> {
  const resolved = resolveAssetUrl(url);
  if (typeof window === 'undefined') {
    return loadImageServer(resolved);
  }

  const cacheKey = `dim:${resolved}`;
  const cached = imageCache.get(cacheKey);
  if (cached === null) return null;
  if (cached && cached.startsWith('{')) {
    try {
      return JSON.parse(cached) as LoadedImage;
    } catch {
      /* reload */
    }
  }

  const viaCanvas = await loadImageViaCanvas(resolved);
  if (viaCanvas) {
    imageCache.set(cacheKey, JSON.stringify(viaCanvas));
    return viaCanvas;
  }

  try {
    const res = await fetch(resolved, { mode: 'cors' });
    if (!res.ok) {
      imageCache.set(cacheKey, null);
      return null;
    }
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const dims = await new Promise<{ width: number; height: number } | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });

    if (!dims || dims.width < 1 || dims.height < 1) {
      imageCache.set(cacheKey, null);
      return null;
    }

    const loaded: LoadedImage = { dataUrl, width: dims.width, height: dims.height };
    imageCache.set(cacheKey, JSON.stringify(loaded));
    return loaded;
  } catch {
    imageCache.set(cacheKey, null);
    return null;
  }
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (dataUrl.includes('image/png')) return 'PNG';
  if (dataUrl.includes('image/webp')) return 'WEBP';
  return 'JPEG';
}

function pixelIsLogoBg(r: number, g: number, b: number, a: number): boolean {
  return a < 20 || (r <= 32 && g <= 32 && b <= 32);
}

/** Crop empty black / transparent padding from the square Shopify asset. */
async function trimLogoPadding(loaded: LoadedImage): Promise<LoadedImage> {
  if (typeof window === 'undefined') return loaded;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(loaded);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (!pixelIsLogoBg(data[i], data[i + 1], data[i + 2], data[i + 3])) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (maxX <= minX || maxY <= minY) {
        resolve(loaded);
        return;
      }
      const padPx = 4;
      minX = Math.max(0, minX - padPx);
      minY = Math.max(0, minY - padPx);
      maxX = Math.min(width - 1, maxX + padPx);
      maxY = Math.min(height - 1, maxY + padPx);
      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;
      const out = document.createElement('canvas');
      out.width = cw;
      out.height = ch;
      const octx = out.getContext('2d');
      if (!octx) {
        resolve(loaded);
        return;
      }
      octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
      resolve({ dataUrl: out.toDataURL('image/png'), width: cw, height: ch });
    };
    img.onerror = () => resolve(loaded);
    img.src = loaded.dataUrl;
  });
}

/** Logo for PDF — trim padding, white backdrop, PNG (avoids black JPEG fringing). */
async function prepareLogoForPdf(loaded: LoadedImage): Promise<LoadedImage> {
  const trimmed = await trimLogoPadding(loaded);
  if (typeof window === 'undefined') return trimmed;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const maxPx = 640;
      const scale = Math.min(1, maxPx / img.naturalWidth, maxPx / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(trimmed);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: w, height: h });
    };
    img.onerror = () => resolve(trimmed);
    img.src = trimmed.dataUrl;
  });
}

async function prepareBrandLogo(opts: StatementPdfOptions): Promise<LoadedImage | null> {
  if (opts.skipBrandLogo) return null;

  const candidates = [
    opts.brandLogoUrl,
    BRAND_TRIO_LOGO_PATH,
    BRAND_TRIO_LOGO_CDN,
  ].filter((u): u is string => Boolean(u?.trim()));

  for (const raw of candidates) {
    const loaded = await loadImageWithDimensions(raw);
    if (loaded) return prepareLogoForPdf(loaded);
  }
  return null;
}

/** Fit image in box preserving aspect ratio (mm). */
function fitImageMm(
  naturalW: number,
  naturalH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const ratio = naturalW / naturalH;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

function drawBrandLogo(
  doc: import('jspdf').jsPDF,
  image: LoadedImage | null,
  rightX: number,
  topY: number,
): number {
  const maxW = 72;
  const maxH = 22;
  if (image) {
    try {
      const { w, h } = fitImageMm(image.width, image.height, maxW, maxH);
      const x = rightX - w;
      doc.addImage(image.dataUrl, imageFormat(image.dataUrl), x, topY, w, h);
      return topY + h + 2;
    } catch {
      /* text fallback */
    }
  }
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(12);
  doc.setTextColor(...greenText);
  doc.text('MARX CORPORATE', rightX - maxW, topY + 8);
  return topY + 12;
}

function drawFirstPageLetterhead(
  doc: import('jspdf').jsPDF,
  statement: OpenItemStatement,
  company: { name: string; addressLines: string[] },
  accountsEmail: string,
  website: string,
  brandLogo: LoadedImage | null,
): number {
  const leftX = MARGIN;
  const rightX = PAGE_W - MARGIN;
  const topY = MARGIN;
  const c = statement.customer;

  const logoBottom = drawBrandLogo(doc, brandLogo, rightX, topY);

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
  const customerLines: string[] = [];
  const acctId = c.accountId && /^\d+$/.test(c.accountId) ? c.accountId : null;
  if (acctId) customerLines.push(`Account: ${acctId}`);
  for (const line of c.addressLines) {
    if (line.trim() && !customerLines.includes(line.trim())) {
      customerLines.push(line.trim());
    }
  }
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

  return Math.max(ty, ry, logoBottom) + 6;
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

/** Canvas aspect — must match drawPayNowButtons placement (do not stretch to full column width). */
const PAY_NOW_BTN_ASPECT = 52 / 14;

/** Green “Pay Now” button bitmap (generated in-browser). */
function renderPayNowButtonImage(currencyLabel: string): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 520;
  canvas.height = 140;
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
  ctx.font = 'bold 36px Helvetica, Arial, sans-serif';
  ctx.fillText('PAY NOW', w / 2, 58);
  ctx.font = '600 22px Helvetica, Arial, sans-serif';
  ctx.fillText(currencyLabel, w / 2, 102);

  return canvas.toDataURL('image/png');
}

function buildPayNowButtonImages(links: StripePayLink[]): string[] {
  return links.map(l => renderPayNowButtonImage(l.currency));
}

function drawPayNowButton(
  doc: import('jspdf').jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  link: StripePayLink,
) {
  doc.setFillColor(...green);
  doc.setDrawColor(106, 158, 50);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('PAY NOW', x + w / 2, y + 5.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(link.currency, x + w / 2, y + 11, { align: 'center' });
  doc.link(x, y, w, h, { url: link.url });
}

function drawPayNowButtons(
  doc: import('jspdf').jsPDF,
  y: number,
  links: StripePayLink[],
  buttonImages: string[],
): number {
  const btnH = 14;
  const btnW = btnH * PAY_NOW_BTN_ASPECT;
  const gap = 10;
  const rowW = links.length * btnW + Math.max(0, links.length - 1) * gap;
  const startX = MARGIN + (PAGE_W - MARGIN * 2 - rowW) / 2;
  const btnY = y;

  links.forEach((link, i) => {
    const bx = startX + i * (btnW + gap);
    const img = buttonImages[i];
    if (img) {
      try {
        doc.addImage(img, imageFormat(img), bx, btnY, btnW, btnH);
      } catch {
        drawPayNowButton(doc, bx, btnY, btnW, btnH, link);
      }
    } else {
      drawPayNowButton(doc, bx, btnY, btnW, btnH, link);
    }
    doc.link(bx, btnY, btnW, btnH, { url: link.url });
  });

  return btnY + btnH + 4;
}

function drawBankTransferBox(
  doc: import('jspdf').jsPDF,
  y: number,
  payment: typeof STATEMENT_PAYMENT,
): number {
  const boxW = PAGE_W - MARGIN * 2;
  const startY = y;
  const pad = 3;
  const boxH = 24;
  const textX = MARGIN + pad;

  doc.setFillColor(252, 252, 252);
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.25);
  doc.rect(MARGIN, startY, boxW, boxH, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(payment.bankIntro, textX, startY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let cy = startY + 10;
  const lines = [
    `Account Name: ${payment.accountName}`,
    `Sort Code: ${payment.sortCode}`,
    `Account No: ${payment.accountNo}`,
  ];
  lines.forEach(line => {
    doc.text(line, textX, cy);
    cy += 4;
  });

  return startY + boxH + 4;
}

function drawCardPaymentSection(
  doc: import('jspdf').jsPDF,
  y: number,
  payment: typeof STATEMENT_PAYMENT,
  buttonImages: string[],
): number {
  const boxW = PAGE_W - MARGIN * 2;
  const startY = y;
  const pad = 3;
  const boxH = 36;
  const innerTop = startY + 5;

  doc.setFillColor(248, 252, 240);
  doc.setDrawColor(...green);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, startY, boxW, boxH, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...greenText);
  doc.text('Pay by card', MARGIN + pad, innerTop);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(50, 50, 50);
  doc.text(payment.cardIntro, MARGIN + pad, innerTop + 5);

  drawPayNowButtons(doc, innerTop + 11, payment.stripeLinks, buttonImages);

  return startY + boxH + 4;
}

function drawPaymentSection(
  doc: import('jspdf').jsPDF,
  y: number,
  payment: typeof STATEMENT_PAYMENT,
  buttonImages: string[],
): number {
  let cy = drawCardPaymentSection(doc, y, payment, buttonImages);
  cy = drawBankTransferBox(doc, cy + 2, payment);
  return cy;
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

  const colW = [
    STATEMENT_TABLE_W * 0.14,
    STATEMENT_TABLE_W * 0.20,
    STATEMENT_TABLE_W * 0.18,
    STATEMENT_TABLE_W * 0.24,
    STATEMENT_TABLE_W * 0.24,
  ];

  autoTable(doc, {
    startY,
    tableWidth: STATEMENT_TABLE_W,
    margin: { left: STATEMENT_TABLE_LEFT, right: STATEMENT_TABLE_LEFT, bottom: 14 },
    head: [['DATE', 'INVOICE NO.', 'DUE DATE', 'AMOUNT', 'OPEN AMOUNT']],
    body,
    theme: 'plain',
    styles: {
      fontSize: 9,
      textColor: [40, 40, 40],
      cellPadding: { top: 2.8, right: 3, bottom: 2.8, left: 3 },
      lineWidth: 0,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 9,
      fillColor: [...green],
      textColor: [...headerText],
      cellPadding: { top: 3.2, right: 3, bottom: 3.2, left: 3 },
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: colW[0], halign: 'center' },
      1: { cellWidth: colW[1], halign: 'center' },
      2: { cellWidth: colW[2], halign: 'center' },
      3: { cellWidth: colW[3], halign: 'right' },
      4: { cellWidth: colW[4], halign: 'right' },
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

const FOOTER_SECTION_HEIGHT = 84;

async function renderOpenItemStatementPdf(
  statement: OpenItemStatement,
  opts: StatementPdfOptions = {},
): Promise<import('jspdf').jsPDF> {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const payment = opts.payment || STATEMENT_PAYMENT;
  const brandLogo = await prepareBrandLogo(opts);
  const buttonImages = buildPayNowButtonImages(payment.stripeLinks);

  const company = {
    name: opts.companyName || STATEMENT_COMPANY.name,
    addressLines: opts.companyAddressLines || [...STATEMENT_COMPANY.addressLines],
  };
  const accountsEmail = opts.accountsEmail || STATEMENT_COMPANY.email;
  const website = opts.website || STATEMENT_COMPANY.website;

  const FIRST_PAGE_LINES = 14;
  const CONT_PAGE_LINES = 24;
  const pageChunks = chunkLines(statement.lines, FIRST_PAGE_LINES, CONT_PAGE_LINES);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

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
  return doc;
}

/** Base64 PDF for Resend attachment (same layout as download). */
export async function generateOpenItemStatementPdfBase64(
  statement: OpenItemStatement,
  opts: StatementPdfOptions = {},
): Promise<{ filename: string; base64: string }> {
  const doc = await renderOpenItemStatementPdf(statement, opts);
  const filename = statementPdfFilename(statement.customerName);
  const bytes = doc.output('arraybuffer') as ArrayBuffer;
  let base64: string;
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64');
  } else {
    const u8 = new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
    base64 = btoa(binary);
  }
  if (!base64) throw new Error('Failed to generate PDF');
  return { filename, base64 };
}

export async function downloadOpenItemStatementPdf(
  statement: OpenItemStatement,
  opts: StatementPdfOptions = {},
): Promise<void> {
  const doc = await renderOpenItemStatementPdf(statement, opts);
  doc.save(statementPdfFilename(statement.customerName));
}
