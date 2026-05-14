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
  const cur = toNum(item.currentQuantity) ?? toNum(item.quantity);
  if (cur !== undefined && cur <= 0) return false;

  const nfl = toNum(item.nonFulfillableQuantity);
  if (cur !== undefined && nfl !== undefined && nfl >= cur) return false;

  const fb = toNum(item.fulfillableQuantity);
  if (fb !== undefined && fb <= 0) return false;

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
  const refundableQty = toNum(node.refundableQuantity);
  const currentQty =
    currentQtyParsed !== undefined ? currentQtyParsed : refundableQty !== undefined ? refundableQty : originalQty;
  if (currentQty <= 0) return null;

  const nonFulfill = toNum(node.nonFulfillableQuantity) ?? 0;
  if (currentQty > 0 && nonFulfill >= currentQty) return null;

  const fulfillable = toNum(node.fulfillableQuantity);

  const unfulfilledRaw = toNum(node.unfulfilledQuantity);
  const unfulfilled = unfulfilledRaw !== undefined ? unfulfilledRaw : currentQty;
  if (unfulfilled <= 0) return null;

  if (fulfillable !== undefined && fulfillable <= 0 && unfulfilled <= 0) return null;

  // Removed / exchange / allocation edge cases: Shopify can leave unfulfilledQuantity > 0 while
  // fulfillableQuantity is 0 — deprecated fulfillmentStatus may still read "unfulfilled".
  if (fulfillable !== undefined && fulfillable <= 0 && unfulfilled > 0) return null;

  const fulfilledQuantity = Math.max(0, currentQty - unfulfilled);
  const fsRaw = node.fulfillmentStatus ? String(node.fulfillmentStatus).toLowerCase() : 'unfulfilled';
  const itemStatus = fsRaw === 'partially_fulfilled' ? 'unfulfilled' : fsRaw;
  const productType = node.variant?.product?.productType || undefined;

  return {
    id: node.id,
    name: node.name || 'Unknown',
    quantity: currentQty,
    currentQuantity: currentQty,
    nonFulfillableQuantity: nonFulfill,
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

/**
 * Line item GIDs that Shopify classifies as non-fulfillable (removed, fully refunded, tips, etc.).
 * Those rows can still appear under `lineItems` in Admin GraphQL — we must skip them for Stash.
 */
export function nonFulfillableLineItemIdSetFromOrderNode(o: unknown): Set<string> {
  const out = new Set<string>();
  const edges = (o as { nonFulfillableLineItems?: { edges?: { node?: { id?: string } }[] } })?.nonFulfillableLineItems?.edges;
  if (!Array.isArray(edges)) return out;
  for (const e of edges) {
    const id = e?.node?.id;
    if (typeof id === 'string' && id.length > 0) out.add(id);
  }
  return out;
}

/** Map `order.lineItems` to persisted items, dropping anything in `nonFulfillableLineItems`. */
export function mapLineItemsFromOrderNode(o: unknown): ShopifyOrder['items'] {
  const skip = nonFulfillableLineItemIdSetFromOrderNode(o);
  const edges = (o as { lineItems?: { edges?: { node?: unknown }[] } })?.lineItems?.edges || [];
  return edges
    .map((edge: { node?: unknown }) => {
      const id = (edge?.node as { id?: string } | undefined)?.id;
      if (id && skip.has(id)) return null;
      return mapGraphQLLineItemNode(edge?.node);
    })
    .filter(Boolean) as ShopifyOrder['items'];
}
