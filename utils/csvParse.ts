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

export function guessSupplierColumnMapping(headers: string[]): Record<SupplierCsvField, string> {
  const mapping: Record<SupplierCsvField, string> = {
    ean: '', vendor: '', productCode: '', description: '', colour: '', size: '',
  };
  for (const h of headers) {
    const low = h.toLowerCase();
    if (!mapping.ean && (low.includes('ean') || low.includes('barcode') || low.includes('upc') || low.includes('gtin'))) {
      mapping.ean = h;
    }
    if (!mapping.vendor && (low.includes('vendor') || low.includes('supplier') || low.includes('brand'))) {
      mapping.vendor = h;
    }
    if (!mapping.productCode && (low.includes('sku') || low.includes('style') || low.includes('code') || low.includes('ref'))) {
      mapping.productCode = h;
    }
    if (!mapping.description && (low.includes('name') || low.includes('description') || low.includes('title') || low.includes('item'))) {
      mapping.description = h;
    }
    if (!mapping.colour && (low.includes('color') || low.includes('colour') || low.includes('shade'))) {
      mapping.colour = h;
    }
    if (!mapping.size && low.includes('size')) mapping.size = h;
  }
  return mapping;
}
