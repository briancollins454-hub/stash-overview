import type { DecoJob } from '../types';

/**
 * Whether a Deco job should be excluded from active / priority / financial views.
 * Deco tenants vary: "Cancelled", "Canceled", "Order cancelled", payment flags, etc.
 */
export function isDecoJobCancelled(j: DecoJob): boolean {
  const st = (j.status || '').trim().toLowerCase();
  if (!st) {
    // fall through to payment-only signals
  } else if (st === 'cancelled' || st === 'canceled') return true;
  else if (st.includes('cancelled') || st.includes('canceled')) return true;

  const ps = j.paymentStatus != null ? String(j.paymentStatus).trim() : '';
  if (ps === '7') return true;

  return false;
}

/** When Deco sends a free-text status name, map obvious cancel variants to our canonical label. */
export function normalizeDecoCancelStatusString(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === 'canceled' || lower === 'cancelled') return 'Cancelled';
  if (lower.includes('cancelled') || lower.includes('canceled')) return 'Cancelled';
  return null;
}
