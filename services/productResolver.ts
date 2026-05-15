import type { DecoJob, PhysicalStockItem, ReferenceProduct, SupplierCatalogItem } from '../types';

export type ProductResolveSource = 'supplier' | 'reference' | 'physical_stock' | 'deco' | 'unknown';

export interface ResolvedProduct {
  ean: string;
  vendor: string;
  productCode: string;
  description: string;
  colour: string;
  size: string;
  source: ProductResolveSource;
}

/** Excel / CSV sometimes stores barcodes as floats or scientific notation. */
function normalizeExcelNumeric(raw: string): string | null {
  const t = raw.trim();
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) return String(Math.round(n));
  }
  if (/^\d+\.\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6) {
      return String(Math.round(n));
    }
  }
  return null;
}

/** Normalise scanner input (EAN-13, UPC-A padded, trimmed). */
export function normalizeBarcodeInput(raw: string): string {
  const excel = normalizeExcelNumeric(raw);
  const source = excel ?? raw;
  const t = source.replace(/\s/g, '').replace(/[^\dA-Za-z-]/g, '');
  if (/^\d{12}$/.test(t)) return `0${t}`;
  return t;
}

/** Ignore partial camera reads until the barcode looks complete. */
export function isPlausibleScanCode(code: string): boolean {
  if (!code || code.length < 6) return false;
  if (/^\d+$/.test(code)) {
    return code.length >= 8;
  }
  return code.length >= 4;
}

function scanKey(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

/** True when the scan looks like a GTIN / EAN barcode (not an alphanumeric SKU). */
export function isGtinScan(code: string): boolean {
  const n = normalizeBarcodeInput(code);
  return /^\d{12,13}$/.test(n);
}

/** Lookup keys for EAN / UPC values only (no partial suffixes). */
export function scanKeysForEan(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const keys = new Set<string>();
  const add = (v: string) => {
    const k = scanKey(v);
    if (k) keys.add(k);
  };

  const trimmed = value.trim();
  add(trimmed);
  const n = normalizeBarcodeInput(trimmed);
  add(n);

  const excel = normalizeExcelNumeric(trimmed);
  if (excel) add(normalizeBarcodeInput(excel));

  if (/^\d+$/.test(n)) {
    const stripped = n.replace(/^0+/, '') || '0';
    add(stripped);
    if (n.length === 12) add(`0${n}`);
    if (n.length === 13 && n.startsWith('0')) add(n.slice(1));
  }

  return [...keys];
}

/** Lookup keys for style / SKU codes (not used for 12–13 digit GTIN scans). */
export function scanKeysForSku(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const keys = new Set<string>();
  const add = (v: string) => {
    const k = scanKey(v);
    if (k) keys.add(k);
  };

  const trimmed = value.trim();
  add(trimmed);
  add(normalizeBarcodeInput(trimmed));
  add(trimmed.replace(/-/g, ''));

  return [...keys];
}

/** @deprecated Use scanKeysForEan / scanKeysForSku */
export function scanKeysForValue(value: string | undefined): string[] {
  return [...new Set([...scanKeysForEan(value), ...scanKeysForSku(value)])];
}

export interface BarcodeLookupStats {
  supplierKeys: number;
  referenceKeys: number;
  physicalKeys: number;
  totalKeys: number;
}

export type BarcodeLookup = {
  resolve: (code: string) => ResolvedProduct | null;
  stats: BarcodeLookupStats;
};

export function createBarcodeLookup(ctx: {
  supplierCatalog?: SupplierCatalogItem[];
  referenceProducts: ReferenceProduct[];
  physicalStock: PhysicalStockItem[];
  decoJobs: DecoJob[];
}): BarcodeLookup {
  const eanMap = new Map<string, ResolvedProduct>();
  const skuMap = new Map<string, ResolvedProduct>();
  let supplierKeys = 0;
  let referenceKeys = 0;
  let physicalKeys = 0;

  const indexProduct = (product: ResolvedProduct) => {
    let added = 0;
    for (const key of scanKeysForEan(product.ean)) {
      if (!key || eanMap.has(key)) continue;
      eanMap.set(key, product);
      added += 1;
    }
    if (product.productCode?.trim()) {
      for (const key of scanKeysForSku(product.productCode)) {
        if (!key || skuMap.has(key)) continue;
        skuMap.set(key, product);
        added += 1;
      }
    }
    return added;
  };

  for (const s of ctx.supplierCatalog ?? []) {
    supplierKeys += indexProduct({
      ean: s.ean.trim(),
      vendor: s.vendor || s.supplierName,
      productCode: s.productCode || '',
      description: s.description || '',
      colour: s.colour || '',
      size: s.size || '',
      source: 'supplier',
    });
  }

  for (const r of ctx.referenceProducts) {
    referenceKeys += indexProduct({
      ean: r.ean.trim(),
      vendor: r.vendor || '',
      productCode: r.productCode || '',
      description: r.description || '',
      colour: r.colour || '',
      size: r.size || '',
      source: 'reference',
    });
  }

  for (const ps of ctx.physicalStock) {
    physicalKeys += indexProduct({
      ean: ps.ean.trim(),
      vendor: ps.vendor || '',
      productCode: ps.productCode || '',
      description: ps.description || '',
      colour: ps.colour || '',
      size: ps.size || '',
      source: 'physical_stock',
    });
  }

  for (const job of ctx.decoJobs) {
    for (const item of job.items || []) {
      if (!item.ean?.trim()) continue;
      const name = item.name || 'Item';
      const parts = name.split(' - ');
      indexProduct({
        ean: item.ean.trim(),
        vendor: '',
        productCode: item.productCode || item.vendorSku || '',
        description: name,
        colour: parts.length > 2 ? parts[parts.length - 2] : '',
        size: parts.length > 1 ? parts[parts.length - 1] : '',
        source: 'deco',
      });
    }
  }

  return {
    stats: {
      supplierKeys,
      referenceKeys,
      physicalKeys,
      totalKeys: eanMap.size + skuMap.size,
    },
    resolve(code: string) {
      const normalized = normalizeBarcodeInput(code);
      if (!normalized || normalized.length < 4) return null;

      // GTIN scans must match the EAN column only — not a different row's style/SKU code.
      if (isGtinScan(normalized)) {
        for (const key of scanKeysForEan(normalized)) {
          const hit = eanMap.get(key);
          if (hit) return hit;
        }
        return null;
      }

      for (const key of scanKeysForSku(normalized)) {
        const hit = skuMap.get(key);
        if (hit) return hit;
      }
      for (const key of scanKeysForEan(normalized)) {
        const hit = eanMap.get(key);
        if (hit) return hit;
      }
      return null;
    },
  };
}

export function physicalStockAggregateKey(
  item: Pick<PhysicalStockItem, 'ean' | 'isEmbellished' | 'clubName' | 'size' | 'colour'>,
): string {
  const club = item.isEmbellished ? (item.clubName || '').trim().toLowerCase() : 'plain';
  return [
    item.ean.trim(),
    item.isEmbellished ? '1' : '0',
    club,
    (item.size || '').trim().toLowerCase(),
    (item.colour || '').trim().toLowerCase(),
  ].join('|');
}

export function resolvedToStockKey(
  p: ResolvedProduct,
  opts?: { isEmbellished?: boolean; clubName?: string },
): string {
  const isEmbellished = !!opts?.isEmbellished;
  return physicalStockAggregateKey({
    ean: p.ean,
    isEmbellished,
    clubName: isEmbellished ? opts?.clubName : undefined,
    size: p.size,
    colour: p.colour,
  });
}

function matchEanValue(a: string | undefined, ean: string): boolean {
  if (!a) return false;
  const b = normalizeBarcodeInput(a);
  return b === ean || b.replace(/^0/, '') === ean.replace(/^0/, '');
}

export function resolveProductByBarcode(
  code: string,
  ctx: {
    supplierCatalog?: SupplierCatalogItem[];
    referenceProducts: ReferenceProduct[];
    physicalStock: PhysicalStockItem[];
    decoJobs: DecoJob[];
  },
): ResolvedProduct | null {
  return createBarcodeLookup(ctx).resolve(code);
}

export function manualResolvedProduct(
  ean: string,
  fields: Partial<Omit<ResolvedProduct, 'ean' | 'source'>>,
): ResolvedProduct {
  return {
    ean: normalizeBarcodeInput(ean),
    vendor: fields.vendor || '',
    productCode: fields.productCode || '',
    description: fields.description || 'Unknown product',
    colour: fields.colour || '',
    size: fields.size || '',
    source: 'unknown',
  };
}
