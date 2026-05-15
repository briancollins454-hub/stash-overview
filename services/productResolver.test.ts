import { describe, expect, it } from 'vitest';
import {
  explainBarcodeLookup,
  isPlausibleScanCode,
  normalizeBarcodeInput,
  resolveProductByBarcode,
} from './productResolver';

describe('normalizeBarcodeInput', () => {
  it('pads 12-digit UPC to EAN-13', () => {
    expect(normalizeBarcodeInput('506043210001')).toBe('0506043210001');
  });

  it('normalises Excel scientific notation', () => {
    expect(normalizeBarcodeInput('5.014883352434e+12')).toBe('5014883352434');
  });
});

describe('isPlausibleScanCode', () => {
  it('rejects partial numeric reads', () => {
    expect(isPlausibleScanCode('5014883')).toBe(false);
  });
  it('accepts full EAN-13', () => {
    expect(isPlausibleScanCode('5014883352434')).toBe(true);
  });
  it('accepts SKUs with letters', () => {
    expect(isPlausibleScanCode('001MBLK28R')).toBe(true);
  });
});

describe('resolveProductByBarcode', () => {
  it('matches supplier feed before reference', () => {
    const r = resolveProductByBarcode('506043210005', {
      supplierCatalog: [{
        id: '1',
        supplierName: 'Mizuno',
        importId: null,
        ean: '506043210005',
        vendor: 'Mizuno',
        productCode: 'MZ-1',
        description: 'Feed Jersey',
        colour: 'Red',
        size: 'L',
        updatedAt: '2026-01-01',
      }],
      referenceProducts: [{
        ean: '506043210005',
        vendor: 'Nike',
        productCode: 'NK-1',
        description: 'Master Jersey',
        colour: 'Navy',
        size: 'M',
      }],
      physicalStock: [],
      decoJobs: [],
    });
    expect(r?.source).toBe('supplier');
    expect(r?.description).toBe('Feed Jersey');
  });

  it('matches alphanumeric SKU scans to product code', () => {
    const r = resolveProductByBarcode('001MBLK28R', {
      referenceProducts: [{
        ean: '506043210099',
        vendor: 'Mizuno',
        productCode: '001MBLK28R',
        description: 'Sock',
        colour: 'Black',
        size: 'M',
      }],
      physicalStock: [],
      decoJobs: [],
    });
    expect(r?.description).toBe('Sock');
  });

  it('uses product code as GTIN when EAN column has a different number', () => {
    const r = resolveProductByBarcode('5051595439930', {
      referenceProducts: [{
        ean: '6052782439930',
        vendor: 'Test',
        productCode: '5051595439930',
        description: 'Correct label barcode',
        colour: '',
        size: '',
      }],
      physicalStock: [],
      decoJobs: [],
    });
    expect(r?.ean).toBe('5051595439930');
    expect(r?.description).toBe('Correct label barcode');
  });

  it('matches GTIN stored only in product code when EAN is empty', () => {
    const r = resolveProductByBarcode('5051595439930', {
      referenceProducts: [{
        ean: '',
        vendor: 'Test',
        productCode: '5051595439930',
        description: 'Via SKU column',
        colour: '',
        size: '',
      }],
      physicalStock: [],
      decoJobs: [],
    });
    expect(r?.description).toBe('Via SKU column');
  });

  it('indexes numeric product code as GTIN when EAN column differs', () => {
    const r = resolveProductByBarcode('5051595439930', {
      supplierCatalog: [{
        id: '1',
        supplierName: 'FC',
        importId: null,
        ean: '6052782439930',
        vendor: 'FC',
        productCode: '5051595439930',
        description: 'Wrong EAN col',
        colour: '',
        size: '',
        updatedAt: '',
      }],
      referenceProducts: [],
      physicalStock: [],
      decoJobs: [],
    });
    expect(r?.ean).toBe('5051595439930');
    expect(r?.description).toBe('Wrong EAN col');
  });

  it('matches 13-digit barcode to EAN column', () => {
    const r = resolveProductByBarcode('5051595439930', {
      referenceProducts: [{
        ean: '5051595439930',
        vendor: 'Test',
        productCode: '6052782439930',
        description: 'Correct row',
        colour: '',
        size: '',
      }],
      physicalStock: [],
      decoJobs: [],
    });
    expect(r?.ean).toBe('5051595439930');
    expect(r?.description).toBe('Correct row');
  });

  it('matches reference catalogue first', () => {
    const r = resolveProductByBarcode('506043210005', {
      referenceProducts: [{
        ean: '506043210005',
        vendor: 'Nike',
        productCode: 'NK-1',
        description: 'Test Jersey',
        colour: 'Navy',
        size: 'M',
      }],
      physicalStock: [],
      decoJobs: [],
    });
    expect(r?.source).toBe('reference');
    expect(r?.description).toBe('Test Jersey');
  });
});
