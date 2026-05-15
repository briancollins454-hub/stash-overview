import { describe, expect, it } from 'vitest';
import { dedupeSupplierCatalogRows } from './supplierCatalogService';
import { guessSupplierColumnMapping } from '../utils/csvParse';

describe('guessSupplierColumnMapping', () => {
  it('maps Full Collection Phoenix headers to SKU as scan key', () => {
    const m = guessSupplierColumnMapping([
      'SKU', 'Style Code', 'Title', 'Brand', 'Colourway Name', 'Size',
    ]);
    expect(m.ean).toBe('SKU');
    expect(m.productCode).toBe('Style Code');
    expect(m.description).toBe('Title');
    expect(m.vendor).toBe('Brand');
    expect(m.colour).toBe('Colourway Name');
    expect(m.size).toBe('Size');
  });
});

describe('dedupeSupplierCatalogRows', () => {
  it('keeps one row per supplier and scan key', () => {
    const base = {
      supplierName: 'FC',
      importId: 'i1',
      vendor: '',
      productCode: '',
      description: '',
      colour: '',
      size: '',
      updatedAt: '',
    };
    const { rows, skippedDuplicates } = dedupeSupplierCatalogRows([
      { ...base, id: '1', ean: '001M' },
      { ...base, id: '2', ean: '001M' },
      { ...base, id: '3', ean: '002M' },
    ]);
    expect(rows).toHaveLength(2);
    expect(skippedDuplicates).toBe(1);
  });
});
