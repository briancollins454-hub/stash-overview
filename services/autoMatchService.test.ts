import { describe, expect, it } from 'vitest';
import { autoMatch } from './autoMatchService';
import type { UnifiedOrder } from '../types';

/** Minimal order shaped like the Ballynahinch club-shop case: Shopify SKUs
 * carry the style code, Deco lines have no SKU/EAN but embed the code in
 * the product name. */
function makeOrder(items: any[], decoItems: any[]): UnifiedOrder {
  return {
    shopify: {
      orderNumber: '47001',
      fulfillmentStatus: 'unfulfilled',
      items,
    },
    decoJobId: '225183',
    deco: { items: decoItems },
  } as unknown as UnifiedOrder;
}

const decoItems = [
  { name: 'Ballynahinch Rugby Club - Rugby Short - WD2B16NGM - Navy - XL', quantity: 3 },
  { name: 'Ballynahinch Rugby Club - Rugby Short - WD2B16NGM - Navy - M', quantity: 2 },
  { name: 'Ballynahinch Rugby Club - Icon Tee - JG3552 - Green - XL', quantity: 1 },
  { name: 'Ballynahinch Rugby Club - Core Polo - H57487 - Navy - XL', quantity: 4 },
];

describe('autoMatch style-code matching', () => {
  it('auto-applies when Shopify SKU contains the style code from the Deco name and size matches', () => {
    const order = makeOrder(
      [{ id: 'li1', name: 'Ballynahinch Rugby Club - Rugby Short - Navy - XL', sku: 'WD2B16NGM-XL-SSP', quantity: 1 }],
      decoItems,
    );
    const results = autoMatch([order], {});
    expect(results).toHaveLength(1);
    expect(results[0].suggestedDecoItemName).toContain('Rugby Short');
    expect(results[0].suggestedDecoItemName).toContain('XL');
    expect(results[0].reason).toContain('Style code');
    expect(results[0].isEanMatch).toBe(true);
  });

  it('prefers the right size row of the same style', () => {
    const order = makeOrder(
      [{ id: 'li2', name: 'Ballynahinch Rugby Club - Rugby Short - Navy - M', sku: 'WD2B16NGM-M-SSP', quantity: 1 }],
      decoItems,
    );
    const results = autoMatch([order], {});
    expect(results).toHaveLength(1);
    expect(results[0].suggestedDecoItemName).toContain('- M');
  });

  it('does not match a different style code', () => {
    const order = makeOrder(
      [{ id: 'li3', name: 'Ballynahinch Rugby Club - Icon Tee - Green - XL', sku: 'JG3552-CM-XL', quantity: 1 }],
      decoItems,
    );
    const results = autoMatch([order], {});
    expect(results).toHaveLength(1);
    expect(results[0].suggestedDecoItemName).toContain('Icon Tee');
  });

  it('never auto-applies the same style in the wrong colour', () => {
    const order = makeOrder(
      [{ id: 'li4', name: 'Ballynahinch Rugby Club - Rugby Short - Green - XL', sku: 'WD2B16NGM-XL-SSP', quantity: 1 }],
      [
        { name: 'Ballynahinch Rugby Club - Rugby Short - WD2B16NGM - Navy - XL', quantity: 3 },
      ],
    );
    const results = autoMatch([order], {});
    if (results.length > 0) {
      expect(results[0].isEanMatch).toBeFalsy();
    }
  });
});
