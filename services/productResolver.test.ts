import { describe, expect, it } from 'vitest';
import { normalizeBarcodeInput, resolveProductByBarcode } from './productResolver';

describe('normalizeBarcodeInput', () => {
  it('pads 12-digit UPC to EAN-13', () => {
    expect(normalizeBarcodeInput('506043210001')).toBe('0506043210001');
  });
});

describe('resolveProductByBarcode', () => {
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
