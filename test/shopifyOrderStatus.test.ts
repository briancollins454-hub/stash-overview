import { describe, expect, it } from 'vitest';
import {
  applyPartialRefundInactivityRule,
  canTreatOrderAsFulfilledFromProduction,
  isHiddenFromDefaultDashboard,
  mapShopifyFulfillmentStatusForStash,
  reconcileShopifyOrderFinancialFulfillment,
} from '../services/shopifyOrderStatus';
import type { ShopifyOrder } from '../types';

const activeLine = {
  id: 'gid://shopify/LineItem/1',
  name: 'Hoodie - L',
  quantity: 2,
  currentQuantity: 2,
  fulfilledQuantity: 0,
  sku: 'HD-L',
  ean: '-',
  variantId: 'v1',
  vendor: 'Stash',
  itemStatus: 'unfulfilled',
  imageUrl: '',
} as unknown as ShopifyOrder['items'][number];

const refundedOutLine = {
  ...activeLine,
  id: 'gid://shopify/LineItem/2',
  currentQuantity: 0,
  quantity: 0,
} as unknown as ShopifyOrder['items'][number];

describe('mapShopifyFulfillmentStatusForStash', () => {
  it('maps partially fulfilled from Shopify', () => {
    expect(mapShopifyFulfillmentStatusForStash('PARTIALLY_FULFILLED', 'PAID')).toBe('partial');
  });

  it('keeps a cached "refunded" status sticky instead of coercing it back to unfulfilled', () => {
    // 'refunded' is Stash-derived (never a Shopify enum); it reaches this
    // mapper when cached rows are reconciled. Coercing it to 'unfulfilled'
    // resurrected partially-refunded returns into the unfulfilled list.
    expect(mapShopifyFulfillmentStatusForStash('refunded', 'partially_refunded')).toBe('refunded');
    expect(mapShopifyFulfillmentStatusForStash('refunded', 'paid')).toBe('refunded');
  });

  it('maps full refunds to refunded regardless of fulfillment state', () => {
    expect(mapShopifyFulfillmentStatusForStash('FULFILLED', 'REFUNDED')).toBe('refunded');
    expect(mapShopifyFulfillmentStatusForStash('UNFULFILLED', 'REFUNDED')).toBe('refunded');
  });
});

describe('applyPartialRefundInactivityRule', () => {
  it('marks a partially-refunded order with no active lines as refunded', () => {
    expect(applyPartialRefundInactivityRule('unfulfilled', 'partially_refunded', [refundedOutLine])).toBe('refunded');
    expect(applyPartialRefundInactivityRule('unfulfilled', 'PARTIALLY_REFUNDED', [])).toBe('refunded');
  });

  it('keeps a partially-refunded order visible while any line still needs shipping', () => {
    expect(applyPartialRefundInactivityRule('unfulfilled', 'partially_refunded', [activeLine, refundedOutLine])).toBe('unfulfilled');
  });

  it('leaves non-partially-refunded orders untouched', () => {
    expect(applyPartialRefundInactivityRule('unfulfilled', 'paid', [])).toBe('unfulfilled');
    expect(applyPartialRefundInactivityRule('partial', 'partially_refunded', [])).toBe('partial');
  });
});

describe('reconcileShopifyOrderFinancialFulfillment', () => {
  const base = {
    id: 'gid://shopify/Order/1',
    orderNumber: '1001',
    customerName: 'Test',
    email: '',
    date: '2026-07-01T00:00:00Z',
    totalPrice: '10.00',
    tags: [],
    timelineComments: [],
  } as unknown as ShopifyOrder;

  it('does not downgrade a refunded cached order back to unfulfilled', () => {
    const order = { ...base, fulfillmentStatus: 'refunded', paymentStatus: 'partially_refunded', items: [activeLine] } as ShopifyOrder;
    expect(reconcileShopifyOrderFinancialFulfillment(order).fulfillmentStatus).toBe('refunded');
  });

  it('flips a fully-returned partially-refunded order to refunded', () => {
    const order = { ...base, fulfillmentStatus: 'unfulfilled', paymentStatus: 'partially_refunded', items: [refundedOutLine] } as ShopifyOrder;
    expect(reconcileShopifyOrderFinancialFulfillment(order).fulfillmentStatus).toBe('refunded');
  });
});

describe('isHiddenFromDefaultDashboard', () => {
  it('hides completed returns (restocked) alongside fulfilled and refunded', () => {
    expect(isHiddenFromDefaultDashboard('restocked')).toBe(true);
    expect(isHiddenFromDefaultDashboard('fulfilled')).toBe(true);
    expect(isHiddenFromDefaultDashboard('refunded')).toBe(true);
    expect(isHiddenFromDefaultDashboard('unfulfilled')).toBe(false);
    expect(isHiddenFromDefaultDashboard('partial')).toBe(false);
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
