import type { ShopifyOrder } from '../types';

export type ShopifyLineItem = ShopifyOrder['items'][number];

function toNum(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Units still to pick / ship on this line (after partial fulfillments). */
export function shopifyLineRemainingQuantity(item: ShopifyLineItem): number {
  const q = Math.max(0, Number(item.quantity) || 0);
  const fulfilled = Math.max(0, Number(item.fulfilledQuantity) || 0);
  return Math.max(0, q - fulfilled);
}

/**
 * Line items that should appear on the dashboard, mapping UI, and picking sheets.
 * Excludes fulfilled, restocked, zero-current-qty, Shopify-removed lines, and lines
 * with nothing left to fulfill.
 */
export function isShopifyLineItemActiveForOps(item: ShopifyLineItem): boolean {
  // New syncs persist `currentQuantity` (effective units still on the order). Old cache may omit it.
  if (Object.prototype.hasOwnProperty.call(item, 'currentQuantity')) {
    const cur = toNum(item.currentQuantity);
    if (cur !== undefined && cur <= 0) return false;
  }
  const fb = toNum(item.fulfillableQuantity);
  if (fb !== undefined && fb <= 0 && shopifyLineRemainingQuantity(item) <= 0) return false;

  const st = (item.itemStatus || 'unfulfilled').toLowerCase();
  if (st === 'fulfilled' || st === 'restocked') return false;
  if ((Number(item.quantity) || 0) <= 0) return false;
  return shopifyLineRemainingQuantity(item) > 0;
}

/**
 * Map one Shopify Admin GraphQL LineItem node → our persisted line shape.
 * Returns null when the line should not appear in Stash (removed / fully handled in Shopify).
 */
export function mapGraphQLLineItemNode(node: any): ShopifyLineItem | null {
  if (!node) return null;
  const originalQty = toNum(node.quantity) ?? 0;
  const currentQtyParsed = toNum(node.currentQuantity);
  const currentQty = currentQtyParsed !== undefined ? currentQtyParsed : originalQty;
  if (currentQty <= 0) return null;

  const fulfillable = toNum(node.fulfillableQuantity);

  const unfulfilledRaw = toNum(node.unfulfilledQuantity);
  const unfulfilled = unfulfilledRaw !== undefined ? unfulfilledRaw : currentQty;
  if (unfulfilled <= 0) return null;

  // Removed / closed lines: nothing left to ship from Shopify's perspective.
  if (fulfillable !== undefined && fulfillable <= 0 && unfulfilled <= 0) return null;

  const fulfilledQuantity = Math.max(0, currentQty - unfulfilled);
  const fsRaw = node.fulfillmentStatus ? String(node.fulfillmentStatus).toLowerCase() : 'unfulfilled';
  const itemStatus = fsRaw === 'partially_fulfilled' ? 'unfulfilled' : fsRaw;
  const productType = node.variant?.product?.productType || undefined;

  return {
    id: node.id,
    name: node.name || 'Unknown',
    quantity: currentQty,
    currentQuantity: currentQty,
    fulfillableQuantity: fulfillable,
    fulfilledQuantity,
    sku: node.sku || '',
    ean: node.variant?.barcode || '-',
    variantId: node.variant?.id || '',
    vendor: node.vendor || '',
    productType,
    itemStatus: itemStatus as ShopifyLineItem['itemStatus'],
    imageUrl: node.image?.url || node.variant?.image?.url || '',
    price: node.originalUnitPriceSet?.shopMoney?.amount || undefined,
    properties: (node.customAttributes || []).map((a: any) => ({ name: a.key, value: a.value })),
  };
}
