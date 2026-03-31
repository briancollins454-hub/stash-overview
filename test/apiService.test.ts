import { describe, it, expect } from 'vitest';
import { standardizeSize, isEligibleForMapping } from '../services/apiService';

describe('standardizeSize', () => {
  it('normalizes common size strings', () => {
    expect(standardizeSize('small')).toBe('S');
    expect(standardizeSize('SMALL')).toBe('S');
    expect(standardizeSize('medium')).toBe('M');
    expect(standardizeSize('large')).toBe('L');
    expect(standardizeSize('xl')).toBe('XL');
    expect(standardizeSize('xlarge')).toBe('XL');
    expect(standardizeSize('2xl')).toBe('2XL');
    expect(standardizeSize('xxl')).toBe('2XL');
    expect(standardizeSize('3xl')).toBe('3XL');
    expect(standardizeSize('xs')).toBe('XS');
    expect(standardizeSize('onesize')).toBe('ONE');
  });

  it('returns empty string for empty input', () => {
    expect(standardizeSize('')).toBe('');
  });

  it('uppercases unknown sizes', () => {
    expect(standardizeSize('custom')).toBe('CUSTOM');
  });

  it('strips non-alphanumeric chars before matching', () => {
    expect(standardizeSize('X-L')).toBe('XL');
    expect(standardizeSize('2-XL')).toBe('2XL');
  });
});

describe('isEligibleForMapping', () => {
  it('returns true for regular product items', () => {
    expect(isEligibleForMapping('Nike Polo Shirt')).toBe(true);
    expect(isEligibleForMapping('Club Jersey - Home')).toBe(true);
  });

  it('excludes personalisation services', () => {
    expect(isEligibleForMapping('Add Name')).toBe(false);
    expect(isEligibleForMapping('Add Initials')).toBe(false);
    expect(isEligibleForMapping('Personalisation')).toBe(false);
    expect(isEligibleForMapping('Printing Service')).toBe(false);
    expect(isEligibleForMapping('Embroidery Service')).toBe(false);
    expect(isEligibleForMapping('Customisation Option')).toBe(false);
  });

  it('excludes service product types', () => {
    expect(isEligibleForMapping('Some Item', 'Service')).toBe(false);
    expect(isEligibleForMapping('Some Item', 'Embroidery Service')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isEligibleForMapping('ADD NAME')).toBe(false);
    expect(isEligibleForMapping('PERSONALISATION')).toBe(false);
  });
});
