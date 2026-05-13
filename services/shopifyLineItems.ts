import type { ShopifyOrder } from '../types';

export type ShopifyLineItem = ShopifyOrder['items'][number];

/** Units still to pick / ship on this line (after partial fulfillments). */
export function shopifyLineRemainingQuantity(item: ShopifyLineItem): number {
  const q = Math.max(0, Number(item.quantity) || 0);
  const fulfilled = Math.max(0, Number(item.fulfilledQuantity) || 0);
  return Math.max(0, q - fulfilled);
}

/**
 * Line items that should appear on the dashboard, mapping UI, and picking sheets.
 * Excludes fulfilled, restocked, zero-current-qty, and lines with nothing left to fulfill
 * (covers Shopify order edits where the row lingers but unfulfilledQuantity is 0).
 */
export function isShopifyLineItemActiveForOps(item: ShopifyLineItem): boolean {
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
  const originalQty = Number(node.quantity) || 0;
  const currentQty =
    typeof node.currentQuantity === 'number' && !Number.isNaN(node.currentQuantity)
      ? Number(node.currentQuantity)
      : originalQty;
  if (currentQty <= 0) return null;

  const unfRaw = node.unfulfilledQuantity;
  const unfulfilled =
    typeof unfRaw === 'number' && !Number.isNaN(unfRaw)
      ? Math.max(0, Number(unfRaw))
      : currentQty;
  if (unfulfilled <= 0) return null;

  const fulfilledQuantity = Math.max(0, currentQty - unfulfilled);
  const fsRaw = node.fulfillmentStatus ? String(node.fulfillmentStatus).toLowerCase() : 'unfulfilled';
  const itemStatus = fsRaw === 'partially_fulfilled' ? 'unfulfilled' : fsRaw;
  const productType = node.variant?.product?.productType || undefined;

  return {
    id: node.id,
    name: node.name || 'Unknown',
    quantity: currentQty,
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
