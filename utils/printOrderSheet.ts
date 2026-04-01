import { UnifiedOrder } from '../types';
import { getNotesForOrder } from '../services/notesService';

function renderItemRow(i: UnifiedOrder['shopify']['items'][0]): string {
  const props = (i.properties || []).filter(p => p.value);
  const propsHtml = props.length > 0
    ? props.map(p => '<br><small style="color:#555;font-size:8px;">' + p.name + ': ' + p.value + '</small>').join('')
    : '';
  const skuHtml = i.sku ? '<br><small style="color:#888;font-size:8px;">SKU: ' + i.sku + '</small>' : '';
  const eanHtml = i.ean && i.ean !== '-' ? '<br><small style="color:#888;font-size:8px;">EAN: ' + i.ean + '</small>' : '';
  const imgHtml = i.imageUrl
    ? '<img src="' + i.imageUrl + '" style="width:32px;height:32px;object-fit:cover;" />'
    : '';
  const unitPrice = i.price ? parseFloat(i.price) : 0;
  const lineTotal = unitPrice * (i.quantity || 0);
  const qty = i.quantity || 0;
  const qtyHtml = qty > 1 ? '<strong style="font-size:12px;">' + qty + '</strong>' : '' + qty;
  return '<tr>' +
    '<td style="width:36px;text-align:center;">' + imgHtml + '</td>' +
    '<td>' + i.name + propsHtml + skuHtml + eanHtml + '</td>' +
    '<td style="text-align:center;">' + qtyHtml + '</td>' +
    '<td style="text-align:right;">\u00A3' + unitPrice.toFixed(2) + '</td>' +
    '<td style="text-align:right;">\u00A3' + lineTotal.toFixed(2) + '</td>' +
    '<td style="width:60px;"></td>' +
    '</tr>';
}

function buildOrderSheetHtml(order: UnifiedOrder): { css: string; bodyHtml: string; orderNumber: string } {
  const items = order.shopify.items;
  const isRush = order.shopify.tags.some(t => ['rush', 'urgent', 'priority', 'express'].includes(t.toLowerCase()));
  const notes = getNotesForOrder(order.shopify.id);
  const daysLeft = order.daysRemaining;
  const isOverdue = daysLeft < 0;
  const unfulfilledItems = items.filter(i => i.itemStatus !== 'fulfilled');
  const fulfilledItems = items.filter(i => i.itemStatus === 'fulfilled');

  const css = [
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    '@page { margin: 10mm; size: A4; }',
    'body { font-family: Arial, sans-serif; padding: 0; color: #111; font-size: 10px; }',
    '.rush { background: #dc2626; color: white; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 3px; text-align: center; padding: 3px 10px; margin-bottom: 4px; }',
    '.items-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9px; }',
    '.items-table th, .items-table td { border: 1px solid #999; padding: 2px 4px; text-align: left; vertical-align: top; }',
    '.items-table th { background: #e5e5e5; text-transform: uppercase; font-size: 8px; letter-spacing: 0.5px; font-weight: bold; }',
    '.section-title { font-size: 10px; font-weight: bold; margin: 6px 0 2px 0; padding-bottom: 2px; border-bottom: 1.5px solid #111; text-transform: uppercase; }',
    '.payment-table { margin-left: auto; width: 50%; margin-top: 4px; border-collapse: collapse; }',
    '.payment-table td { padding: 1px 6px; font-size: 10px; }',
    '.payment-table .total td { font-weight: bold; font-size: 11px; border-top: 2px solid #111; }',
    '.countdown { font-size: 11px; font-weight: 900; text-align: center; padding: 3px; border: 2px solid; margin: 4px 0; }',
    '.overdue { color: #dc2626; font-weight: 900; }',
    '.ok { color: #16a34a; font-weight: bold; }',
    '.check { width: 11px; height: 11px; border: 2px solid #999; display: inline-block; border-radius: 2px; vertical-align: middle; }',
    '.qc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin-top: 3px; }',
    '.qc-item { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: bold; text-transform: uppercase; }',
    '.notes-section { border: 1px dashed #999; padding: 4px; min-height: 20px; font-size: 8px; color: #666; margin-top: 4px; }',
    '.saved-notes { background: #fefce8; border: 1px solid #fde047; padding: 4px; font-size: 8px; margin-top: 4px; }',
    '.saved-notes .note { border-bottom: 1px dotted #ddd; padding: 1px 0; }',
    '.saved-notes .note:last-child { border: none; }',
    '.sticker { width: 3.5in; height: 2.2in; border: none; padding: 10px 10px 6px 10px; overflow: hidden; font-size: 13px; line-height: 1.3; box-sizing: border-box; display: inline-block; word-wrap: break-word; overflow-wrap: break-word; }',
    '.sticker p { margin: 0; }',
    '.sticker .note-text { font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
    '@media print { .rush, .items-table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
  ].join('\n');

  const orderDate = new Date(order.shopify.date).toLocaleDateString('en-GB');
  const shippingMethod = order.shopify.shippingMethod || '-';
  const shippingCost = order.shopify.shippingCost ? '\u00A3' + parseFloat(order.shopify.shippingCost).toFixed(2) : '\u00A30.00';

  // Order note
  const orderNote = order.shopify.timelineComments && order.shopify.timelineComments[0] ? order.shopify.timelineComments[0] : '';

  // Two-column header: logo+barcode+details LEFT, shipping address RIGHT
  const addr = order.shopify.shippingAddress;
  const addrLines = addr
    ? [addr.name, addr.address1, addr.address2, [addr.city, addr.zip].filter(Boolean).join(' '), addr.country].filter(Boolean)
    : [];

  const headerHtml =
    '<table style="width:100%;margin-bottom:6px;border-collapse:collapse;"><tr>' +
    '<td style="vertical-align:top;">' +
      '<img src="https://stashshop.co.uk/cdn/shop/files/stash_shop_text_only_2025_outline_1.svg?v=1753488880" style="max-width:200px;margin-bottom:4px;" />' +
      '<p style="font-family:\'Libre Barcode 39 Text\',cursive;font-size:40px;line-height:1;margin:2px 0 8px 0;">#' + order.shopify.orderNumber + '</p>' +
      '<table style="font-size:10px;border-collapse:collapse;">' +
        '<tr><td style="padding:1px 8px 1px 0;font-weight:bold;">Date</td><td>' + orderDate + '</td></tr>' +
        '<tr><td style="padding:1px 8px 1px 0;font-weight:bold;">Shipping Method</td><td>' + shippingMethod + '</td></tr>' +
        '<tr><td style="padding:1px 8px 1px 0;font-weight:bold;">Shipping Cost</td><td>' + shippingCost + '</td></tr>' +
        '<tr><td style="padding:1px 8px 1px 0;font-weight:bold;">Order Total</td><td>\u00A3' + parseFloat(order.shopify.totalPrice).toFixed(2) + '</td></tr>' +
      '</table>' +
    '</td>' +
    '<td style="vertical-align:top;text-align:right;padding:10mm 10mm 0 0;">' +
      '<div class="sticker">' +
      '<p style="font-weight:bold;font-size:15px;margin-bottom:3px;">#' + order.shopify.orderNumber + ' ' + order.shopify.customerName + '</p>' +
      addrLines.map(function(l) { return '<p>' + l + '</p>'; }).join('') +
      (addr && addr.phone ? '<p>' + addr.phone + '</p>' : '') +
      (orderNote ? '<p style="margin-top:3px;font-weight:bold;">Note:</p><p class="note-text">' + orderNote + '</p>' : '') +
      '<p style="margin-top:2px;">Shipping Paid: <strong>' + shippingCost + '</strong></p>' +
      (order.decoJobId ? '<p>Deco Job: <strong>' + order.decoJobId + '</strong></p>' : '') +
      '</div>' +
    '</td>' +
    '</tr></table>';

  // Order heading with separator
  const orderHeadingHtml =
    '<table style="width:100%;border-top:2px solid #000;border-collapse:collapse;margin-bottom:2px;"><tr>' +
    '<td><h2 style="margin:4px 0;font-size:13px;">Order #' + order.shopify.orderNumber + '</h2></td>' +
    '<td style="text-align:right;"><h3 style="margin:4px 0;font-size:12px;">' + order.shopify.customerName + '</h3></td>' +
    '</tr></table>';

  // SLA Countdown
  let countdownHtml = '';
  if (order.slaTargetDate) {
    const txt = isOverdue
      ? '\u26A0 ' + Math.abs(daysLeft) + ' DAYS OVERDUE \u2014 Target: ' + order.slaTargetDate
      : daysLeft + ' DAYS REMAINING \u2014 Target: ' + order.slaTargetDate;
    const cls = isOverdue ? 'overdue' : 'ok';
    const col = isOverdue ? '#dc2626' : '#16a34a';
    countdownHtml = '<div class="countdown ' + cls + '" style="border-color:' + col + '">' + txt + '</div>';
  }

  // Items table header
  const itemTableHead = '<thead><tr><th style="width:36px">Image</th><th>Item</th><th style="width:50px;text-align:center">Qty</th><th style="width:55px;text-align:right">Price</th><th style="width:55px;text-align:right">Total</th><th style="width:60px;text-align:center">Packed By</th></tr></thead>';

  // Unfulfilled items section
  let unfulfilledSection = '';
  if (unfulfilledItems.length > 0) {
    unfulfilledSection = '<div class="section-title">Unfulfilled Items</div><table class="items-table">' +
      itemTableHead + '<tbody>' + unfulfilledItems.map(renderItemRow).join('') + '</tbody></table>';
  }

  // Fulfilled items section
  let fulfilledSection = '';
  if (fulfilledItems.length > 0) {
    fulfilledSection = '<div class="section-title">Fulfilled Items</div><table class="items-table">' +
      itemTableHead + '<tbody>' + fulfilledItems.map(renderItemRow).join('') + '</tbody></table>';
  }

  // Fallback: show all items if none matched either filter
  if (unfulfilledItems.length === 0 && fulfilledItems.length === 0) {
    unfulfilledSection = '<div class="section-title">Line Items</div><table class="items-table">' +
      itemTableHead + '<tbody>' + items.map(renderItemRow).join('') + '</tbody></table>';
  }

  // Payment Details
  const subtotal = order.shopify.subtotalPrice ? '\u00A3' + parseFloat(order.shopify.subtotalPrice).toFixed(2) : '-';
  const tax = order.shopify.taxPrice ? '\u00A3' + parseFloat(order.shopify.taxPrice).toFixed(2) : '\u00A30.00';
  const paymentHtml =
    '<div class="section-title">Payment Details</div>' +
    '<table class="payment-table">' +
      '<tr><td>Subtotal</td><td style="text-align:right">' + subtotal + '</td></tr>' +
      '<tr><td>Tax</td><td style="text-align:right">' + tax + '</td></tr>' +
      '<tr><td>' + shippingMethod + '</td><td style="text-align:right">' + shippingCost + '</td></tr>' +
      '<tr class="total"><td>Total</td><td style="text-align:right">\u00A3' + parseFloat(order.shopify.totalPrice).toFixed(2) + '</td></tr>' +
    '</table>';

  const noteHtml = orderNote ? '<div class="section-title">Order Note</div><p>' + orderNote + '</p>' : '';

  // Deco production detail
  let decoHtml = '';
  if (order.decoJobId && order.deco) {
    const estDate = order.productionDueDate ? new Date(order.productionDueDate).toLocaleDateString('en-GB') : '-';
    decoHtml =
      '<div class="section-title">Production Details</div>' +
      '<table style="font-size:10px;margin-bottom:6px;border-collapse:collapse;">' +
        '<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Deco Job</td><td>' + order.decoJobId + '</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Est. Production</td><td>' + estDate + '</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Produced</td><td>' + (order.deco.itemsProduced || 0) + ' / ' + (order.deco.totalItems || 0) + '</td></tr>' +
        '<tr><td style="padding:2px 12px 2px 0;font-weight:bold;">Completion</td><td>' + order.completionPercentage + '%</td></tr>' +
      '</table>';
  }

  // QC Checklist
  const qcHtml =
    '<div class="section-title">QC Checklist</div>' +
    '<div class="qc-grid">' +
      '<div class="qc-item"><span class="check"></span> Print Aligned</div>' +
      '<div class="qc-item"><span class="check"></span> Correct Size</div>' +
      '<div class="qc-item"><span class="check"></span> Colour Match</div>' +
      '<div class="qc-item"><span class="check"></span> Packaging</div>' +
      '<div class="qc-item"><span class="check"></span> Labels Attached</div>' +
      '<div class="qc-item"><span class="check"></span> Final Sign-off</div>' +
    '</div>';

  // Saved internal notes
  let savedNotesHtml = '';
  if (notes.length > 0) {
    savedNotesHtml = '<div class="section-title" style="margin-top:16px">Internal Notes</div><div class="saved-notes">' +
      notes.map(function(n) {
        const author = (n.author || 'Unknown').split('@')[0];
        const date = new Date(n.createdAt).toLocaleDateString('en-GB');
        return '<div class="note"><strong>' + author + '</strong> (' + date + '): ' + n.text + '</div>';
      }).join('') + '</div>';
  }

  const bodyHtml =
    (isRush ? '<div class="rush">\u26A1 RUSH ORDER \u26A1</div>' : '') +
    headerHtml +
    orderHeadingHtml +
    countdownHtml +
    unfulfilledSection +
    fulfilledSection +
    paymentHtml +
    noteHtml +
    decoHtml +
    qcHtml +
    savedNotesHtml +
    '<div class="notes-section">Production Notes (write here):</div>';

  return { css, bodyHtml, orderNumber: order.shopify.orderNumber };
}

export function printOrderSheet(order: UnifiedOrder): void {
  const { css, bodyHtml, orderNumber } = buildOrderSheetHtml(order);

  const html = '<!DOCTYPE html><html><head><title>Order #' + orderNumber + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+39+Text&display=swap" rel="stylesheet">' +
    '<style>' + css + '</style></head><body>' +
    bodyHtml +
    '</body></html>';

  const w = window.open('', '_blank', 'width=800,height=1100');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.print();
}

/**
 * Print multiple order sheets in a single print window with page breaks between them.
 */
export function printOrderSheets(ordersToPrint: UnifiedOrder[]): void {
  if (ordersToPrint.length === 0) return;
  if (ordersToPrint.length === 1) {
    printOrderSheet(ordersToPrint[0]);
    return;
  }

  // Build all sheets and combine into one window with page breaks
  const sheets = ordersToPrint.map(order => buildOrderSheetHtml(order));
  const css = sheets[0].css + '\n.page-break { page-break-after: always; }';

  const combinedBody = sheets.map(function(s, idx) {
    const isLast = idx === sheets.length - 1;
    return '<div' + (isLast ? '' : ' class="page-break"') + '>' + s.bodyHtml + '</div>';
  }).join('');

  const html = '<!DOCTYPE html><html><head><title>Print ' + sheets.length + ' Order Sheets</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+39+Text&display=swap" rel="stylesheet">' +
    '<style>' + css + '</style></head><body>' +
    combinedBody +
    '</body></html>';

  const w = window.open('', '_blank', 'width=800,height=1100');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.print();
}
