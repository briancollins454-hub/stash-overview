import type { ShopifyOrder } from '../types';
import { isShopifyLineItemActiveForOps } from './shopifyLineItems';

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
  // 'refunded' is a Stash-derived status (never a Shopify enum), so it only
  // arrives here from cached rows being reconciled. Keep it sticky: coercing
  // it to 'unfulfilled' (the old behaviour) resurrected partially-refunded
  // returns back into the unfulfilled list on every reconcile pass.
  if (f === 'refunded') return 'refunded';
  if (!['fulfilled', 'unfulfilled', 'partial', 'restocked'].includes(f)) f = 'unfulfilled';

  if (financial === 'refunded' || financial === 'voided' || financial === 'void') {
    return 'refunded';
  }
  if (financial.includes('partially_refunded')) {
    if (f === 'fulfilled' || f === 'restocked' || f === 'partial') return 'refunded';
  }

  return f as ShopifyOrder['fulfillmentStatus'];
}

/**
 * Returned/refunded orders Shopify still reports as open + unshipped:
 * a partial refund (e.g. items refunded but not the shipping charge) leaves
 * `displayFinancialStatus: PARTIALLY_REFUNDED` while the fulfillment side
 * reads `UNFULFILLED` — so the base mapping keeps the order "unfulfilled"
 * and it sits in the dashboard forever. When there is genuinely nothing
 * left to pick or ship (every line is refunded/removed/non-fulfillable),
 * surface it as `refunded` so it folds into the Refunds toggle instead of
 * the unfulfilled list. Orders with ANY active line stay visible — those
 * still need the remaining items shipped.
 */
export function applyPartialRefundInactivityRule(
  status: ShopifyOrder['fulfillmentStatus'],
  displayFinancialStatus: string | undefined,
  items: ShopifyOrder['items'] | undefined,
): ShopifyOrder['fulfillmentStatus'] {
  if (status !== 'unfulfilled') return status;
  const financial = (displayFinancialStatus || '').toLowerCase().replace(/\s+/g, '_');
  if (!financial.includes('partially_refunded')) return status;
  const list = items || [];
  if (list.some(isShopifyLineItemActiveForOps)) return status;
  return 'refunded';
}

/** Re-run financial vs fulfillment rules on cached rows (fixes stale local JSON after a refund). */
export function reconcileShopifyOrderFinancialFulfillment(order: ShopifyOrder): ShopifyOrder {
  const mapped = mapShopifyFulfillmentStatusForStash(order.fulfillmentStatus, order.paymentStatus);
  const next = applyPartialRefundInactivityRule(mapped, order.paymentStatus, order.items);
  if (next === order.fulfillmentStatus) return order;
  return { ...order, fulfillmentStatus: next };
}

/** Orders that should not be pushed to / retained in cloud as “open pipeline”. */
export function isShopifyOrderClosedForCloud(status: string | undefined): boolean {
  const s = (status || '').toLowerCase();
  return s === 'fulfilled' || s === 'restocked' || s === 'refunded';
}

/**
 * Default dashboard: hide completed commerce. `restocked` means every item
 * came back and was restocked (a completed return) — those used to linger in
 * the unfulfilled list because nothing ever refreshed or hid them.
 */
export function isHiddenFromDefaultDashboard(fulfillmentStatus: string | undefined): boolean {
  const s = (fulfillmentStatus || '').toLowerCase();
  return s === 'fulfilled' || s === 'refunded' || s === 'restocked';
}

/**
 * ShipStation / Deco "completed" must not mark an order fulfilled when Shopify still has
 * unfulfilled or partially fulfilled lines.
 */
export function canTreatOrderAsFulfilledFromProduction(
  shopifyFulfillmentStatus: string | undefined,
): boolean {
  const s = (shopifyFulfillmentStatus || '').toLowerCase();
  return s === 'fulfilled' || s === 'restocked';
}
