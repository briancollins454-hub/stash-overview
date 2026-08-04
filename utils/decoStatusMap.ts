/**
 * Canonical Deco order-status mapping shared by the client sync
 * (`services/apiService.ts`) and the nightly finance cron
 * (`api/cron/refresh-finance.ts`).
 *
 * Deco usually sends `order_status_name` (a display string) which is used
 * as-is (after cancel normalisation). The numeric map below only applies
 * when a tenant returns bare `order_status` codes — keeping ONE copy of it
 * means the finance cache and the live dashboard can never disagree about
 * what a numeric status means (they previously used two different maps,
 * which put finance-cache-only jobs into the wrong Priority Board section).
 */

export const DECO_NUMERIC_STATUS_MAP: Record<number, string> = {
  1: 'Awaiting Processing',
  2: 'Completed',
  3: 'Shipped',
  4: 'Cancelled',
  7: 'On Hold',
  8: 'Not Ordered',
  9: 'Awaiting Stock',
  10: 'Awaiting Artwork',
  11: 'Awaiting Review',
  12: 'In Production',
  13: 'Ready for Shipping',
};

/** When Deco sends a free-text status name, map obvious cancel variants to our canonical label. */
export function normalizeDecoCancelStatusString(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === 'canceled' || lower === 'cancelled') return 'Cancelled';
  if (lower.includes('cancelled') || lower.includes('canceled')) return 'Cancelled';
  return null;
}

/** Map a raw Deco status (name string or numeric code) to the canonical label. */
export function mapDecoStatus(status: string | number | null | undefined): string {
  if (status == null || status === '') return 'Unknown';
  if (typeof status === 'string' && isNaN(parseInt(status, 10)) && status.trim() !== '') {
    const t = status.trim();
    const canonCancel = normalizeDecoCancelStatusString(t);
    if (canonCancel) return canonCancel;
    return t;
  }
  const statusNum = typeof status === 'string' ? parseInt(status, 10) : status;
  return DECO_NUMERIC_STATUS_MAP[statusNum] || 'Unknown';
}
