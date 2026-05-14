import type { ShopifyOrder } from '../types';

/**
 * Shopify keeps `displayFulfillmentStatus` as fulfilled after a refund; Stash must
 * reflect money-back state using `displayFinancialStatus`.
 */
export function mapShopifyFulfillmentStatusForStash(
  displayFulfillmentStatus: string | undefined,
  displayFinancialStatus: string | undefined,
): ShopifyOrder['fulfillmentStatus'] {
  const financial = (displayFinancialStatus || '').toLowerCase().replace(/\s+/g, '_');

  let f = (displayFulfillmentStatus || 'unfulfilled').toLowerCase();
  if (f === 'partially_fulfilled') f = 'partial';
  if (!['fulfilled', 'unfulfilled', 'partial', 'restocked'].includes(f)) f = 'unfulfilled';

  if (financial === 'refunded' || financial === 'voided' || financial === 'void') {
    return 'refunded';
  }
  if (financial.includes('partially_refunded')) {
    if (f === 'fulfilled' || f === 'restocked' || f === 'partial') return 'refunded';
  }

  return f as ShopifyOrder['fulfillmentStatus'];
}

/** Re-run financial vs fulfillment rules on cached rows (fixes stale local JSON after a refund). */
export function reconcileShopifyOrderFinancialFulfillment(order: ShopifyOrder): ShopifyOrder {
  const next = mapShopifyFulfillmentStatusForStash(order.fulfillmentStatus, order.paymentStatus);
  if (next === order.fulfillmentStatus) return order;
  return { ...order, fulfillmentStatus: next };
}

/** Orders that should not be pushed to / retained in cloud as “open pipeline”. */
export function isShopifyOrderClosedForCloud(status: string | undefined): boolean {
  const s = (status || '').toLowerCase();
  return s === 'fulfilled' || s === 'restocked' || s === 'refunded';
}

/** Default dashboard: hide completed commerce (fulfilled or refunded). Restocked stays visible (legacy). */
export function isHiddenFromDefaultDashboard(fulfillmentStatus: string | undefined): boolean {
  const s = (fulfillmentStatus || '').toLowerCase();
  return s === 'fulfilled' || s === 'refunded';
}
