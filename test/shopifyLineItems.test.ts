import { describe, expect, it } from 'vitest';
import {
  isEligibleForMapping,
  isPersonalizationAddonLine,
  isShopifyLineFullyShipped,
  isShopifyLinePickable,
  mapGraphQLLineItemNode,
  shopifyLineShippedQtyLabel,
  shopifyLineShortName,
} from '../services/shopifyLineItems';

describe('shopifyLineItems partial fulfillment', () => {
  it('keeps fulfilled lines when includeFulfilled is true', () => {
    const line = mapGraphQLLineItemNode(
      {
        id: 'gid://shopify/LineItem/1',
        name: 'Camphill Tee - Large',
        quantity: 2,
        currentQuantity: 2,
        unfulfilledQuantity: 0,
        fulfillableQuantity: 0,
        sku: 'TEE-L',
        fulfillmentStatus: 'FULFILLED',
      },
      { includeFulfilled: true },
    );
    expect(line?.itemStatus).toBe('fulfilled');
    expect(isShopifyLineFullyShipped(line!)).toBe(true);
  });

  it('excludes personalization add-ons from pick lists', () => {
    expect(isEligibleForMapping('ADD NAME - AJG')).toBe(false);
    const addon = {
      id: '1',
      name: 'ADD NAME - AJG',
      quantity: 1,
      sku: '',
      itemStatus: 'unfulfilled' as const,
      fulfillableQuantity: 1,
      fulfilledQuantity: 0,
    };
    expect(isPersonalizationAddonLine(addon as any)).toBe(true);
    expect(isShopifyLinePickable(addon as any)).toBe(false);
  });

  it('formats shipped qty labels', () => {
    expect(
      shopifyLineShippedQtyLabel({
        id: '1', name: 'x', quantity: 4, fulfilledQuantity: 2, sku: '',
      } as any),
    ).toBe('2/4');
    expect(shopifyLineShortName('Camphill Primary Sweatshirt - Royal - Age 9-10')).toBe('Camphill Primary Sweatshirt');
  });
});
