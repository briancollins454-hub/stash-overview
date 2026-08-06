import { describe, expect, it } from 'vitest';
import {
  composeOrderNote,
  findPrintedTag,
  formatPrintedTag,
  parseOrderNumbersFromText,
} from '../services/shopifyOrderMutations';

describe('parseOrderNumbersFromText', () => {
  it('parses a plain comma/space separated list', () => {
    expect(parseOrderNumbersFromText('224981, 224992 225004\n225010')).toEqual([
      '224981', '224992', '225004', '225010',
    ]);
  });

  it('prefers #-prefixed numbers when present (CSV export paste)', () => {
    const csv = [
      'Name,Email,Total,Zip',
      '#224981,jonny@example.com,129.99,SW1A 1AA',
      '#224992,someone@example.com,54.50,10115',
    ].join('\n');
    // 129, 54, postcode digits etc. must NOT be picked up
    expect(parseOrderNumbersFromText(csv)).toEqual(['224981', '224992']);
  });

  it('dedupes repeated numbers and ignores short/long tokens', () => {
    expect(parseOrderNumbersFromText('224981 224981 12 123456789')).toEqual(['224981']);
  });

  it('returns empty for no matches', () => {
    expect(parseOrderNumbersFromText('no numbers here')).toEqual([]);
  });
});

describe('composeOrderNote', () => {
  it('appends to an existing note on its own line', () => {
    expect(composeOrderNote('Existing note', 'Job 47963', 'append')).toBe('Existing note\nJob 47963');
  });

  it('uses the addition alone when the order has no note', () => {
    expect(composeOrderNote('', 'Job 47963', 'append')).toBe('Job 47963');
  });

  it('is idempotent — returns null when the note already contains the text', () => {
    expect(composeOrderNote('Order #224981 Job 47963 17/4', 'Job 47963', 'append')).toBeNull();
  });

  it('replace overwrites, but skips when identical', () => {
    expect(composeOrderNote('Old note', 'New note', 'replace')).toBe('New note');
    expect(composeOrderNote('New note', 'New note', 'replace')).toBeNull();
  });

  it('returns null for a blank addition', () => {
    expect(composeOrderNote('Existing', '   ', 'append')).toBeNull();
  });
});

describe('formatPrintedTag', () => {
  it('formats as Printed - DD/MM', () => {
    expect(formatPrintedTag(new Date(2026, 7, 6))).toBe('Printed - 06/08');
    expect(formatPrintedTag(new Date(2026, 11, 25))).toBe('Printed - 25/12');
  });
});

describe('findPrintedTag', () => {
  it('finds any tag starting with "printed" (case-insensitive)', () => {
    expect(findPrintedTag(['Rush', 'Printed - 06/08'])).toBe('Printed - 06/08');
    expect(findPrintedTag(['printed 1/8'])).toBe('printed 1/8');
  });

  it('ignores unrelated tags and empty input', () => {
    expect(findPrintedTag(['MTO', 'Club'])).toBeNull();
    expect(findPrintedTag(undefined)).toBeNull();
  });
});
