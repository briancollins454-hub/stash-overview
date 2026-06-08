import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { loadPdfJs } from './pdfjsNode.js';

const GBP_IN_POUND = /£\s*([\d,]+\.\d{2})/g;
const GBP_SUFFIX = /([\d,]+\.\d{2})\s*GBP\b/gi;

function formatEurAmount(gbpNumeric: string, rate: number): string {
  const gbp = parseFloat(gbpNumeric.replace(/,/g, ''));
  if (!Number.isFinite(gbp)) return gbpNumeric;
  const eur = Math.round(gbp * rate * 100) / 100;
  return `€${eur.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function replaceGbpText(str: string, rate: number): { text: string; changed: boolean } {
  let changed = false;
  let out = str.replace(GBP_IN_POUND, (full, num) => {
    changed = true;
    return formatEurAmount(num, rate);
  });
  out = out.replace(GBP_SUFFIX, (full, num) => {
    changed = true;
    return formatEurAmount(num, rate);
  });
  if (!changed && str.includes('£')) {
    out = out.replace(/£/g, '€');
    changed = true;
  }
  if (!changed && /\bGBP\b/i.test(str)) {
    out = out.replace(/\bGBP\b/gi, 'EUR');
    changed = true;
  }
  return { text: out, changed };
}

type TextOverlay = {
  pageIndex: number;
  x: number;
  y: number;
  fontSize: number;
  oldText: string;
  newText: string;
};

/** Owned copy — pdfjs getDocument() can zero/transfer the buffer it receives. */
function toPdfBytes(input: Uint8Array | Buffer): Uint8Array {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) {
    return Uint8Array.from(input);
  }
  return Uint8Array.from(input);
}

/**
 * Amends a DecoNetwork invoice PDF in place: finds £ / GBP amounts via text
 * positions and overwrites with € equivalents. Layout and branding stay Deco’s.
 */
export async function amendDecoPdfToEur(
  pdfBytes: Uint8Array | Buffer,
  rate: number,
  rateNote: string,
): Promise<Uint8Array> {
  const pdfjs = await loadPdfJs();
  const original = toPdfBytes(pdfBytes);
  if (original.byteLength < 5 || String.fromCharCode(...original.slice(0, 4)) !== '%PDF') {
    throw new Error('Invalid PDF bytes (missing %PDF header)');
  }

  const doc = await pdfjs.getDocument({
    data: original.slice(),
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const overlays: TextOverlay[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const str = String(item.str || '').trim();
      if (!str) continue;
      const { text, changed } = replaceGbpText(str, rate);
      if (!changed) continue;
      const tx = item.transform;
      const fontSize = Math.max(6, Math.abs(tx[0]) || Math.abs(tx[3]) || 10);
      overlays.push({
        pageIndex: pageNum - 1,
        x: tx[4],
        y: tx[5],
        fontSize,
        oldText: str,
        newText: text,
      });
    }
  }

  const libDoc = await PDFDocument.load(original);
  const font = await libDoc.embedFont(StandardFonts.Helvetica);
  const pages = libDoc.getPages();

  for (const o of overlays) {
    const page = pages[o.pageIndex];
    if (!page) continue;
    const oldW = font.widthOfTextAtSize(o.oldText, o.fontSize);
    const newW = font.widthOfTextAtSize(o.newText, o.fontSize);
    const pad = 2;
    page.drawRectangle({
      x: o.x - pad,
      y: o.y - o.fontSize * 0.15,
      width: Math.max(oldW, newW) + pad * 2,
      height: o.fontSize * 1.25,
      color: rgb(1, 1, 1),
    });
    page.drawText(o.newText, {
      x: o.x,
      y: o.y,
      size: o.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const last = pages[pages.length - 1];
  const footer = [
    `Amounts converted from GBP at 1 GBP = ${rate.toFixed(4)} EUR.`,
    rateNote,
  ].filter(Boolean).join(' ');
  last.drawText(footer.slice(0, 140), {
    x: 12,
    y: 10,
    size: 6.5,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  return libDoc.save();
}
