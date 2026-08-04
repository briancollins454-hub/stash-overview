import { describe, expect, it } from 'vitest';
import { mapDecoStatus, normalizeDecoCancelStatusString } from '../utils/decoStatusMap';

describe('mapDecoStatus', () => {
  it('passes status name strings through', () => {
    expect(mapDecoStatus('Awaiting Stock')).toBe('Awaiting Stock');
    expect(mapDecoStatus('Not Ordered')).toBe('Not Ordered');
  });

  it('normalises cancel variants in name strings', () => {
    expect(mapDecoStatus('canceled')).toBe('Cancelled');
    expect(mapDecoStatus('Order cancelled')).toBe('Cancelled');
  });

  it('maps numeric codes with the canonical table (shared client + finance cron)', () => {
    expect(mapDecoStatus(2)).toBe('Completed');
    expect(mapDecoStatus('3')).toBe('Shipped');
    expect(mapDecoStatus(4)).toBe('Cancelled');
    expect(mapDecoStatus(8)).toBe('Not Ordered');
  });

  it('returns Unknown for empty or unmapped values', () => {
    expect(mapDecoStatus(undefined)).toBe('Unknown');
    expect(mapDecoStatus(null)).toBe('Unknown');
    expect(mapDecoStatus('')).toBe('Unknown');
    expect(mapDecoStatus(999)).toBe('Unknown');
  });
});

describe('normalizeDecoCancelStatusString', () => {
  it('only rewrites cancel variants', () => {
    expect(normalizeDecoCancelStatusString('CANCELLED')).toBe('Cancelled');
    expect(normalizeDecoCancelStatusString('Shipped')).toBeNull();
  });
});
