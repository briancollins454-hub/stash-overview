import type { ReferenceProduct, SupplierCatalogItem, SupplierImport } from '../types';
import { normalizeBarcodeInput } from './productResolver';
import { isSupabaseReady, supabaseFetch } from './supabase';
import { guessSupplierColumnMapping, parseCsvText, type SupplierCsvField } from '../utils/csvParse';

const IMPORTS_TABLE = 'stash_supplier_imports';
const CATALOG_TABLE = 'stash_supplier_catalog';
const UPSERT_CHUNK = 100;

export function newSupplierImportId(): string {
  return `si_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newSupplierCatalogRowId(): string {
  return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function rowToItem(row: Record<string, unknown>): SupplierCatalogItem {
  return {
    id: String(row.id),
    supplierName: String(row.supplier_name || ''),
    importId: row.import_id ? String(row.import_id) : null,
    ean: String(row.ean || ''),
    vendor: String(row.vendor || ''),
    productCode: String(row.product_code || ''),
    description: String(row.description || ''),
    colour: String(row.colour || ''),
    size: String(row.size || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

/** Latest row per EAN when multiple suppliers share a barcode. */
export function collapseSupplierCatalogByEan(items: SupplierCatalogItem[]): SupplierCatalogItem[] {
  const byEan = new Map<string, SupplierCatalogItem>();
  const sorted = [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  for (const item of sorted) {
    const key = normalizeBarcodeInput(item.ean);
    if (!key) continue;
    if (!byEan.has(key)) byEan.set(key, { ...item, ean: key });
  }
  return Array.from(byEan.values());
}

export function mergeSupplierCatalogToReference(
  catalog: SupplierCatalogItem[],
  existing: ReferenceProduct[],
): ReferenceProduct[] {
  const map = new Map(existing.map(p => [normalizeBarcodeInput(p.ean), p]));
  for (const item of catalog) {
    const ean = normalizeBarcodeInput(item.ean);
    if (!ean) continue;
    map.set(ean, {
      ean,
      vendor: item.vendor || item.supplierName,
      productCode: item.productCode,
      description: item.description,
      colour: item.colour,
      size: item.size,
    });
  }
  return Array.from(map.values());
}

export async function fetchSupplierCatalog(): Promise<SupplierCatalogItem[]> {
  if (!isSupabaseReady()) return [];
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const res = await supabaseFetch(
      `${CATALOG_TABLE}?select=*&order=updated_at.desc&limit=${limit}&offset=${offset}`,
      'GET',
    );
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return collapseSupplierCatalogByEan(rows.map(rowToItem));
}

export async function fetchSupplierImports(limit = 30): Promise<SupplierImport[]> {
  if (!isSupabaseReady()) return [];
  const res = await supabaseFetch(
    `${IMPORTS_TABLE}?select=*&order=created_at.desc&limit=${limit}`,
    'GET',
  );
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows.map(r => ({
    id: String(r.id),
    supplierName: String(r.supplier_name || ''),
    fileName: r.file_name ? String(r.file_name) : null,
    rowCount: Number(r.row_count) || 0,
    uploadedBy: r.uploaded_by ? String(r.uploaded_by) : null,
    createdAt: String(r.created_at || ''),
  }));
}

export interface ParsedSupplierCsv {
  headers: string[];
  sampleRows: string[][];
  mapping: Record<SupplierCsvField, string>;
  rowCount: number;
}

export function parseSupplierCsvFile(text: string): ParsedSupplierCsv {
  const { headers, rows } = parseCsvText(text);
  return {
    headers,
    sampleRows: rows.slice(0, 3),
    mapping: guessSupplierColumnMapping(headers),
    rowCount: rows.length,
  };
}

function cellsToCatalogRows(
  supplierName: string,
  importId: string,
  headers: string[],
  dataRows: string[][],
  mapping: Record<SupplierCsvField, string>,
): SupplierCatalogItem[] {
  const idx: Record<SupplierCsvField, number> = {
    ean: -1, vendor: -1, productCode: -1, description: -1, colour: -1, size: -1,
  };
  for (const [field, hdr] of Object.entries(mapping) as [SupplierCsvField, string][]) {
    idx[field] = hdr ? headers.indexOf(hdr) : -1;
  }
  if (idx.ean < 0) throw new Error('Map the EAN / barcode column before uploading.');

  const now = new Date().toISOString();
  const out: SupplierCatalogItem[] = [];
  let rowNum = 0;
  for (const cells of dataRows) {
    rowNum += 1;
    const rawEan = cells[idx.ean] || '';
    const ean = normalizeBarcodeInput(rawEan);
    if (!ean || ean.length < 4) continue;
    const pick = (field: SupplierCsvField) => {
      const i = idx[field];
      return i >= 0 ? (cells[i] || '').trim() : '';
    };
    out.push({
      id: `${importId || 'sc'}_${rowNum}`,
      supplierName,
      importId,
      ean,
      vendor: pick('vendor') || supplierName,
      productCode: pick('productCode'),
      description: pick('description') || `Item ${ean}`,
      colour: pick('colour'),
      size: pick('size'),
      updatedAt: now,
    });
  }
  return out;
}

export interface UploadSupplierCsvParams {
  supplierName: string;
  fileName: string;
  csvText: string;
  mapping: Record<SupplierCsvField, string>;
  replaceExisting: boolean;
  uploadedBy?: string;
}

export interface UploadSupplierCsvResult {
  import: SupplierImport;
  catalogRows: SupplierCatalogItem[];
  mergedReference: ReferenceProduct[];
}

export async function uploadSupplierCsv(
  params: UploadSupplierCsvParams,
  existingReference: ReferenceProduct[],
): Promise<UploadSupplierCsvResult> {
  if (!isSupabaseReady()) throw new Error('Supabase not configured.');
  const supplierName = params.supplierName.trim();
  if (!supplierName) throw new Error('Supplier name is required.');

  const { headers, rows } = parseCsvText(params.csvText);
  const catalogRows = cellsToCatalogRows(
    supplierName,
    '',
    headers,
    rows,
    params.mapping,
  );
  if (catalogRows.length === 0) throw new Error('No rows with valid barcodes found.');

  const importId = newSupplierImportId();
  catalogRows.forEach(r => { r.importId = importId; });

  const importRow = {
    id: importId,
    supplier_name: supplierName,
    file_name: params.fileName || null,
    row_count: catalogRows.length,
    uploaded_by: params.uploadedBy || null,
    created_at: new Date().toISOString(),
  };

  await supabaseFetch(IMPORTS_TABLE, 'POST', importRow);

  if (params.replaceExisting) {
    await supabaseFetch(
      `${CATALOG_TABLE}?supplier_name=eq.${encodeURIComponent(supplierName)}`,
      'DELETE',
    );
  }

  const dbRows = catalogRows.map(r => ({
    id: r.id,
    supplier_name: r.supplierName,
    import_id: r.importId,
    ean: r.ean,
    vendor: r.vendor,
    product_code: r.productCode,
    description: r.description,
    colour: r.colour,
    size: r.size,
    updated_at: r.updatedAt,
  }));

  for (let i = 0; i < dbRows.length; i += UPSERT_CHUNK) {
    const batch = dbRows.slice(i, i + UPSERT_CHUNK);
    await supabaseFetch(CATALOG_TABLE, 'POST', batch, 'resolution=merge-duplicates');
  }

  const mergedReference = mergeSupplierCatalogToReference(catalogRows, existingReference);

  return {
    import: {
      id: importId,
      supplierName,
      fileName: params.fileName || null,
      rowCount: catalogRows.length,
      uploadedBy: params.uploadedBy || null,
      createdAt: importRow.created_at,
    },
    catalogRows,
    mergedReference,
  };
}
