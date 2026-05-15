/** Split one CSV line respecting quoted fields. */
export function parseCsvLine(text: string): string[] {
  const re = /("([^"]|"")*"|[^,]*)(,|$)/g;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const cell = (m[1] || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
    cells.push(cell);
    if (m[3] === '') break;
  }
  return cells;
}

export function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0] || '');
  const rows = lines.slice(1).map(l => parseCsvLine(l));
  return { headers, rows };
}

export type SupplierCsvField = 'ean' | 'vendor' | 'productCode' | 'description' | 'colour' | 'size';

const EAN_BLOCKLIST = /commodity|supplier\s*code|style\s*code|colourway\s*code|hs\s*code/i;

function headerMatches(h: string, pattern: RegExp): boolean {
  return pattern.test(h.trim());
}

/** Guess CSV columns for supplier feeds (Full Collection, etc.). */
export function guessSupplierColumnMapping(headers: string[]): Record<SupplierCsvField, string> {
  const mapping: Record<SupplierCsvField, string> = {
    ean: '', vendor: '', productCode: '', description: '', colour: '', size: '',
  };

  for (const h of headers) {
    const low = h.toLowerCase().trim();
    if (low === 'sku' || low === 'barcode' || low === 'ean' || low === 'upc' || low === 'gtin') {
      mapping.ean = h;
    }
    if (headerMatches(h, /^style\s*code$/i)) mapping.productCode = h;
    if (low === 'title') mapping.description = h;
    if (headerMatches(h, /^colourway\s*name$/i) || low === 'colour' || low === 'color') {
      mapping.colour = h;
    }
    if (low === 'brand') mapping.vendor = h;
    if (low === 'size' && !low.includes('conversion')) mapping.size = h;
  }

  for (const h of headers) {
    const low = h.toLowerCase();
    if (
      !mapping.ean
      && !EAN_BLOCKLIST.test(h)
      && (low.includes('ean') || low.includes('barcode') || low.includes('upc') || low.includes('gtin'))
    ) {
      mapping.ean = h;
    }
    if (!mapping.vendor && (low.includes('brand') || (low.includes('vendor') && !low.includes('supplier')))) {
      mapping.vendor = h;
    }
    if (
      !mapping.productCode
      && !EAN_BLOCKLIST.test(h)
      && (low.includes('style') || low.includes('product code') || low === 'ref')
    ) {
      mapping.productCode = h;
    }
    if (!mapping.description && (low.includes('title') || low.includes('description') || low.includes('name'))) {
      mapping.description = h;
    }
    if (!mapping.colour && (low.includes('colour') || low.includes('color') || low.includes('shade'))) {
      mapping.colour = h;
    }
    if (!mapping.size && low.includes('size') && !low.includes('conversion')) {
      mapping.size = h;
    }
  }

  return mapping;
}
