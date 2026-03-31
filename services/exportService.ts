import { UnifiedOrder } from '../types';

export function exportOrdersToCSV(orders: UnifiedOrder[], filename = 'stash-orders-export.csv') {
  const headers = [
    'Order Number', 'Customer', 'Club/Tag', 'Date', 'Fulfillment Status',
    'Deco Job ID', 'Production Status', 'Days in Production', 'Days Remaining',
    'Items Ready %', 'MTO Items', 'Stock Items', 'Match Status'
  ];

  const rows = orders.map(o => [
    o.shopify.orderNumber,
    o.shopify.customerName,
    o.clubName,
    o.shopify.date,
    o.shopify.fulfillmentStatus,
    o.decoJobId || '',
    o.productionStatus,
    o.daysInProduction,
    o.daysRemaining,
    o.completionPercentage,
    o.totalMtoCount || 0,
    o.totalStockCount || 0,
    o.matchStatus
  ]);

  const escapeCell = (cell: any) => {
    const str = String(cell ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csv = [headers.join(','), ...rows.map(r => r.map(escapeCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
