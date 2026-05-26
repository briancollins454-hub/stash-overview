import { UnifiedOrder } from '../types';
import { fetchSingleShopifyOrder } from '../services/apiService';
import { fetchShipStationOrder } from '../services/shipstationService';
import type { ApiSettings } from '../components/SettingsModal';

/**
 * Pull a fresh Shopify snapshot for the order with `includeFulfilled: true`
 * so the warehouse picking sheet can list items that have already shipped
 * alongside the ones still to pick (critical for partially-fulfilled orders).
 * Also tops up missing line-item images and falls back to ShipStation for
 * the shipping address when Shopify didn't have one.
 *
 * Failure modes are silent — the original order is returned unchanged so the
 * caller can still print even when Shopify / ShipStation is unreachable.
 */
export async function enrichOrderForPrint(
  order: UnifiedOrder,
  settings: ApiSettings | undefined,
): Promise<UnifiedOrder> {
  if (!settings) return order;
  let enriched = order;

  try {
    const fresh = await fetchSingleShopifyOrder(settings, order.shopify.id, { includeFulfilled: true });
    if (fresh) {
      const existingById = new Map(enriched.shopify.items.map(i => [i.id, i]));
      const mergedItems = enriched.shopify.items.map(item => {
        const freshItem = fresh.items.find(fi => fi.id === item.id);
        if (!freshItem) return item;
        return {
          ...item,
          imageUrl: item.imageUrl || freshItem.imageUrl,
          fulfilledQuantity: freshItem.fulfilledQuantity ?? item.fulfilledQuantity,
          currentQuantity: freshItem.currentQuantity ?? item.currentQuantity,
          fulfillableQuantity: freshItem.fulfillableQuantity ?? item.fulfillableQuantity,
          itemStatus: freshItem.itemStatus || item.itemStatus,
        };
      });
      // Fully-fulfilled lines that the Stash cache had dropped — pull these in
      // so warehouse staff don't have to cross-reference Shopify to see which
      // items have already gone out on a previous fulfillment.
      for (const fi of fresh.items) {
        if (!existingById.has(fi.id)) mergedItems.push(fi);
      }
      enriched = {
        ...enriched,
        shopify: {
          ...enriched.shopify,
          items: mergedItems,
          shippingAddress: enriched.shopify.shippingAddress || fresh.shippingAddress,
        },
      };
    }
  } catch {
    /* swallow — fall through to ShipStation fallback */
  }

  if (!enriched.shopify.shippingAddress) {
    try {
      const ss = await fetchShipStationOrder(settings, order.shopify.orderNumber);
      if (ss?.shipTo) {
        enriched = {
          ...enriched,
          shopify: {
            ...enriched.shopify,
            shippingAddress: {
              name: ss.shipTo.name || '',
              address1: ss.shipTo.street1 || '',
              address2: ss.shipTo.street2 || '',
              city: ss.shipTo.city || '',
              province: ss.shipTo.state || '',
              zip: ss.shipTo.postalCode || '',
              country: ss.shipTo.country || '',
              phone: ss.shipTo.phone || '',
            },
          },
        };
      }
    } catch {
      /* leave shippingAddress undefined; the printed sheet shows a warning */
    }
  }

  return enriched;
}
