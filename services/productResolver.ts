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

/** Normalise scanner input (EAN-13, UPC-A padded, trimmed). */
export function normalizeBarcodeInput(raw: string): string {
  const t = raw.replace(/\s/g, '').replace(/[^\dA-Za-z-]/g, '');
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

function matchesScanInput(stored: string | undefined, input: string): boolean {
  if (!stored?.trim()) return false;
  if (matchEanValue(stored, input)) return true;
  return scanKey(stored) === scanKey(input);
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
  const ean = normalizeBarcodeInput(code);
  if (!ean || ean.length < 4) return null;

  const matchEan = (a: string | undefined) => matchEanValue(a, ean);

  const supplier = ctx.supplierCatalog?.find(
    s => matchesScanInput(s.ean, ean) || matchesScanInput(s.productCode, ean),
  );
  if (supplier) {
    return {
      ean: supplier.ean.trim(),
      vendor: supplier.vendor || supplier.supplierName,
      productCode: supplier.productCode || '',
      description: supplier.description || '',
      colour: supplier.colour || '',
      size: supplier.size || '',
      source: 'supplier',
    };
  }

  const ref = ctx.referenceProducts.find(
    r => matchesScanInput(r.ean, ean) || matchesScanInput(r.productCode, ean),
  );
  if (ref) {
    return {
      ean: ref.ean.trim(),
      vendor: ref.vendor || '',
      productCode: ref.productCode || '',
      description: ref.description || '',
      colour: ref.colour || '',
      size: ref.size || '',
      source: 'reference',
    };
  }

  const ps = ctx.physicalStock.find(
    s => matchesScanInput(s.ean, ean) || matchesScanInput(s.productCode, ean),
  );
  if (ps) {
    return {
      ean: ps.ean.trim(),
      vendor: ps.vendor || '',
      productCode: ps.productCode || '',
      description: ps.description || '',
      colour: ps.colour || '',
      size: ps.size || '',
      source: 'physical_stock',
    };
  }

  for (const job of ctx.decoJobs) {
    for (const item of job.items || []) {
      if (!matchEan(item.ean)) continue;
      const name = item.name || 'Item';
      const parts = name.split(' - ');
      return {
        ean: (item.ean || ean).trim(),
        vendor: '',
        productCode: item.productCode || item.vendorSku || '',
        description: name,
        colour: parts.length > 2 ? parts[parts.length - 2] : '',
        size: parts.length > 1 ? parts[parts.length - 1] : '',
        source: 'deco',
      };
    }
  }

  return null;
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
