import type { DecoJob } from '../types';
import { normalizeDecoCancelStatusString } from '../utils/decoStatusMap';

export { normalizeDecoCancelStatusString };

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
