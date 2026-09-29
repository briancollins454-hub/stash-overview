import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UnifiedOrder } from '../types';
import StockDashboard from '../components/StockDashboard';
import MtoDashboard from '../components/MtoDashboard';

function line(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `line-${name}`,
    name,
    sku: 'SKU',
    quantity: 1,
    currentQuantity: 1,
    fulfillableQuantity: 1,
    itemStatus: 'unfulfilled',
    productType: 'Apparel',
    ...extra,
  };
}

function order(items: ReturnType<typeof line>[]): UnifiedOrder {
  return {
    shopify: {
      id: 'gid://shopify/Order/54000',
      orderNumber: '54000',
      customerName: 'Test Club',
      email: 'club@example.com',
      date: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      totalPrice: '80.00',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      timelineComments: [],
      tags: ['Rangers'],
      items,
    },
    matchStatus: 'unlinked',
    productionStatus: 'Not Ordered',
    completionPercentage: 0,
    stockCompletionPercentage: 0,
    mtoCompletionPercentage: 0,
    daysInProduction: 1,
    daysRemaining: 10,
    slaTargetDate: '2026-09-20',
    clubName: 'Rangers',
    isMto: true,
    hasStockItems: true,
    isStockDispatchReady: false,
    isStockItemsComplete: false,
  } as UnifiedOrder;
}

const mixedOrder = order([
  line('Club Polo'),
  line('Training Shorts'),
  line('MTO Training Top'),
  line('Add Name'),
  line('Personalisation - Yes'),
  line('Hem Service', { productType: 'Service' }),
  line('Removed Cap', { currentQuantity: 0, fulfillableQuantity: 0 }),
]);

describe('StockDashboard', () => {
  it('lists stock lines only and keeps the MTO hub header and styling', () => {
    render(
      <StockDashboard
        orders={[mixedOrder]}
        excludedTags={[]}
        shopifyDomain=""
      />,
    );

    expect(screen.getByRole('heading', { name: /stock production hub/i })).toBeInTheDocument();
    expect(screen.getByText(/granular line-item management for stock orders/i)).toBeInTheDocument();
    expect(screen.getByText('Club Polo')).toBeInTheDocument();
    expect(screen.getByText('Training Shorts')).toBeInTheDocument();
    expect(screen.queryByText('MTO Training Top')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Personalisation - Yes')).not.toBeInTheDocument();
    expect(screen.queryByText('Hem Service')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed Cap')).not.toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/unique pending lines/i)).toBeInTheDocument();
  });

  it('bulk-links selected stock lines to a 6-digit deco job', async () => {
    const onItemJobLink = vi.fn(async () => {});
    render(
      <StockDashboard
        orders={[mixedOrder]}
        excludedTags={[]}
        shopifyDomain=""
        onItemJobLink={onItemJobLink}
      />,
    );

    fireEvent.click(screen.getByText('Club Polo'));
    fireEvent.click(screen.getByText('Training Shorts'));
    fireEvent.click(screen.getByRole('button', { name: /link to job/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g. 285123'), { target: { value: '226248' } });
    fireEvent.click(screen.getByRole('button', { name: /link selected items/i }));

    await waitFor(() => expect(onItemJobLink).toHaveBeenCalledTimes(2));
    expect(onItemJobLink).toHaveBeenCalledWith('54000', 'line-Club Polo', '226248');
    expect(onItemJobLink).toHaveBeenCalledWith('54000', 'line-Training Shorts', '226248');
  });
});

describe('MtoDashboard unchanged filter', () => {
  it('still lists only lines whose names include mto', () => {
    render(
      <MtoDashboard
        orders={[mixedOrder]}
        excludedTags={[]}
        shopifyDomain=""
      />,
    );

    expect(screen.getByRole('heading', { name: /mto production hub/i })).toBeInTheDocument();
    expect(screen.getByText('MTO Training Top')).toBeInTheDocument();
    expect(screen.queryByText('Club Polo')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Name')).not.toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
