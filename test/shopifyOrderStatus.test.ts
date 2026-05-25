import { describe, expect, it } from 'vitest';
import {
  canTreatOrderAsFulfilledFromProduction,
  mapShopifyFulfillmentStatusForStash,
} from '../services/shopifyOrderStatus';

describe('mapShopifyFulfillmentStatusForStash', () => {
  it('maps partially fulfilled from Shopify', () => {
    expect(mapShopifyFulfillmentStatusForStash('PARTIALLY_FULFILLED', 'PAID')).toBe('partial');
  });
});

describe('canTreatOrderAsFulfilledFromProduction', () => {
  it('blocks production override when Shopify is partial', () => {
    expect(canTreatOrderAsFulfilledFromProduction('partial')).toBe(false);
    expect(canTreatOrderAsFulfilledFromProduction('unfulfilled')).toBe(false);
  });

  it('allows override only when Shopify is fully fulfilled', () => {
    expect(canTreatOrderAsFulfilledFromProduction('fulfilled')).toBe(true);
  });
});
