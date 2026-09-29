import { describe, expect, it } from 'vitest';
import type { ShopifyOrder, UnifiedOrder } from '../types';
import { buildOrderSheetHtml } from './printOrderSheet';

type Line = ShopifyOrder['items'][number];

function line(partial: Partial<Line> & Pick<Line, 'id' | 'name'>): Line {
  return {
    quantity: 1,
    currentQuantity: 1,
    fulfillableQuantity: 1,
    sku: 'SKU',
    itemStatus: 'unfulfilled',
    ...partial,
  };
}

function order(partial: Partial<UnifiedOrder> & { items: Line[] }): UnifiedOrder {
  const { items, shopify, ...rest } = partial;
  return {
    matchStatus: 'linked',
    productionStatus: 'In Production',
    completionPercentage: 40,
    stockCompletionPercentage: 0,
    mtoCompletionPercentage: 0,
    daysInProduction: 3,
    daysRemaining: 10,
    slaTargetDate: '2026-09-20',
    clubName: 'Test',
    isMto: true,
    hasStockItems: false,
    isStockDispatchReady: false,
    isStockItemsComplete: false,
    ...rest,
    shopify: {
      id: 'gid://shopify/Order/1',
      orderNumber: '53489',
      customerName: 'Test Club',
      email: 'club@example.com',
      date: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      totalPrice: '120.00',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      timelineComments: [],
      tags: [],
      ...shopify,
      items,
    },
  } as UnifiedOrder;
}

function itemCell(html: string, name: string): string {
  const row = html.split('<tr').find((chunk) => chunk.includes(name));
  expect(row, `row for ${name}`).toBeTruthy();
  const cell = row!.split('</td>')[1] || '';
  return cell;
}

describe('buildOrderSheetHtml deco jobs', () => {
  it('lists every line job in the header and on each row, and skips add-ons with no job', () => {
    const { bodyHtml } = buildOrderSheetHtml(order({
      decoJobId: '226248',
      items: [
        line({ id: '1', name: 'Home Shirt', sku: 'HS', itemDecoJobId: '226248' }),
        line({ id: '2', name: 'Away Shirt', sku: 'AS', itemDecoJobId: '226169' }),
        line({ id: '3', name: 'Custom Initials - Yes', sku: 'INIT' }),
        line({ id: '4', name: 'Training Top', sku: 'TT', itemDecoJobId: '226172' }),
        line({ id: '5', name: 'Home Shirt', sku: 'HS2', itemDecoJobId: '226248' }),
      ],
    }));

    expect(bodyHtml).toContain('>Deco Jobs</td><td>226248, 226169, 226172</td>');
    expect(bodyHtml).not.toContain('>Deco Job</td>');
    expect(itemCell(bodyHtml, 'Home Shirt')).toContain('Deco Job: 226248');
    expect(itemCell(bodyHtml, 'Away Shirt')).toContain('Deco Job: 226169');
    expect(itemCell(bodyHtml, 'Training Top')).toContain('Deco Job: 226172');
    expect(itemCell(bodyHtml, 'Custom Initials - Yes')).not.toContain('Deco Job:');
  });

  it('appends a shipped line job after the open line jobs', () => {
    const { bodyHtml } = buildOrderSheetHtml(order({
      items: [
        line({ id: '1', name: 'Open Jersey', itemDecoJobId: '111111' }),
        line({
          id: '2',
          name: 'Shipped Jersey',
          itemDecoJobId: '222222',
          itemStatus: 'fulfilled',
          fulfilledQuantity: 1,
          fulfillableQuantity: 0,
        }),
      ],
    }));

    expect(bodyHtml).toContain('>Deco Jobs</td><td>111111, 222222</td>');
    expect(itemCell(bodyHtml, 'Shipped Jersey')).toContain('Deco Job: 222222');
  });

  it('falls back to the order-level job and keeps the singular label', () => {
    const { bodyHtml } = buildOrderSheetHtml(order({
      decoJobId: '100001',
      items: [line({ id: '1', name: 'Polo', sku: 'POLO' })],
    }));

    expect(bodyHtml).toContain('>Deco Job</td><td>100001</td>');
    expect(bodyHtml).not.toContain('Deco Jobs');
    expect(itemCell(bodyHtml, 'Polo')).not.toContain('Deco Job:');
  });

  it('omits the production box when neither lines nor the order have a job', () => {
    const { bodyHtml } = buildOrderSheetHtml(order({
      items: [line({ id: '1', name: 'Cap', sku: 'CAP' })],
    }));

    expect(bodyHtml).not.toContain('Production Details');
  });

  it('escapes job ids in the header and on the row', () => {
    const { bodyHtml } = buildOrderSheetHtml(order({
      items: [line({ id: '1', name: 'Jacket', sku: 'J', itemDecoJobId: '1<2&3' })],
    }));

    expect(bodyHtml).toContain('>Deco Job</td><td>1&lt;2&amp;3</td>');
    expect(itemCell(bodyHtml, 'Jacket')).toContain('Deco Job: 1&lt;2&amp;3');
    expect(bodyHtml).not.toContain('Deco Job: 1<2&3');
  });
});
