import React, { useMemo, useState, useEffect } from 'react';
import { UnifiedOrder, DecoJob } from '../types';
import { isEligibleForMapping } from '../services/apiService';
import { getTrackingUrl } from '../services/shipstationService';
import { 
    AlertCircle, Truck, Clock, AlertTriangle, Package, CheckCircle2, 
    ChevronDown, ChevronUp, ShoppingBag, ArrowUpDown, ExternalLink, 
    Link as LinkIcon, Copy, Search, Loader2, Zap, Mail, Box, Cog, X, 
    HelpCircle, RefreshCw, Scissors, Filter, ArrowUp, ArrowDown, Check, Pencil, ClipboardList, Shirt, Hash, ShieldOff,
    Download, Unlink, Calendar, Printer
} from 'lucide-react';
import OrderMappingModal from './OrderMappingModal';
import JobIdBadge from './JobIdBadge';
import { getNotesForOrder } from '../services/notesService';

// --- Types ---

export type SortKey = 'date' | 'orderNumber' | 'decoJob' | 'dispatch' | 'itemsReady' | 'productionStatus' | 'shopifyStatus';
export type SortDirection = 'asc' | 'desc';

export interface TableFilters {
    orderSearch: string;
    jobSearch: string;
    shopifyStatuses: Set<string>;
    productionStatuses: Set<string>;
}

export interface OrderTableProps {
    orders: UnifiedOrder[];
    excludedTags: string[];
    shopifyDomain: string;
    onTimelineScan?: (id: string) => void;
    onBulkScan?: (ids: string[]) => void;
    onPabblySync?: (decoJobId: string, orderNumber: string) => void;
    onConfirmMatch?: (itemKey: string, decoId: string) => void;
    onRefreshJob?: (jobId: string) => Promise<void>;
    onSearchJob?: (jobId: string) => Promise<DecoJob | null>;
    onBulkMatch?: (mappings: { itemKey: string, decoId: string, jobId?: string }[], learnedPatterns?: Record<string, string>) => void;
    onManualLink?: (orderIds: string[], jobId: string) => Promise<void>;
    onNavigateToJob?: (jobId: string) => void;
    onItemJobLink?: (orderNumber: string, itemId: string, jobId: string) => Promise<void>;
    sortOption: string;
    onSortChange: (option: string) => void;
    groupingMode?: 'club' | 'vendor';
    isBulkScanning?: boolean;
    scanProgress?: number;
    scanCount?: { current: number, total: number };
    selectedOrderIds: Set<string>;
    onSelectionChange: (ids: Set<string>) => void;
    productMappings?: Record<string, string>;
    confirmedMatches?: Record<string, string>;
}

// --- Helper Components ---

interface HeaderWithMenuProps {
    title: string;
    columnKey: SortKey;
    groupName: string;
    activeMenu: { club: string; col: string } | null;
    onToggle: (club: string, col: string) => void;
    sortConfig: { key: SortKey; dir: SortDirection } | null;
    children?: React.ReactNode;
}

const HeaderWithMenu: React.FC<HeaderWithMenuProps> = ({ 
    title, columnKey, groupName, activeMenu, onToggle, sortConfig, children 
}) => {
    const isOpen = activeMenu?.club === groupName && activeMenu?.col === columnKey;
    
    return (
      <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider relative group">
          <div className="flex items-center gap-2 cursor-pointer" onClick={(e) => { e.stopPropagation(); onToggle(groupName, columnKey); }}>
              <span>{title}</span>
              <button 
                className={`p-1 rounded hover:bg-gray-100 ${isOpen ? 'bg-gray-200 text-indigo-600' : 'text-gray-400 opacity-0 group-hover:opacity-100'} transition-all`}
              >
                  <Filter className="w-3 h-3" />
              </button>
              {sortConfig?.key === columnKey && (
                  sortConfig.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-500" /> : <ArrowDown className="w-3 h-3 text-indigo-500" />
              )}
          </div>
          {isOpen && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50 p-3" onClick={e => e.stopPropagation()}>
                  <div className="space-y-3">
                      {children}
                  </div>
              </div>
          )}
      </th>
    );
};

const WorkflowStatusCell = ({ type, status }: { type: 'ordered' | 'received' | 'produced' | 'shipped', status: number }) => {
    let tickColor = 'text-gray-300';
    let showTick = true;

    switch (type) {
        case 'ordered':
            if (status >= 20) tickColor = 'text-green-500';
            else tickColor = 'text-gray-300';
            break;
        case 'received':
            if (status >= 60) tickColor = 'text-green-500';
            else if (status >= 40) tickColor = 'text-orange-500';
            else tickColor = 'text-gray-300';
            break;
        case 'produced':
            if (status >= 80) tickColor = 'text-green-500';
            else if (status >= 60) tickColor = 'text-orange-500';
            else tickColor = 'text-gray-300';
            break;
        case 'shipped':
            if (status >= 80) tickColor = 'text-green-500';
            else if (status >= 60) tickColor = 'text-orange-500';
            else tickColor = 'text-gray-300';
            break;
    }

    if (status === 0) showTick = false;

    return (
        <div className="flex items-center justify-center h-full">
            {showTick ? <Check className={`w-5 h-5 ${tickColor} stroke-[3]`} /> : <span className="w-5 h-5 block"></span>}
        </div>
    );
};

function guessProductionMethod(name: string, sku: string): string {
  const n = (name + ' ' + sku).toLowerCase();
  if (n.includes('embroider') || n.includes('embroid')) return 'Embroidery';
  if (n.includes('screen') || n.includes('silk')) return 'Screen Print';
  if (n.includes('dtf')) return 'DTF';
  if (n.includes('dtg') || n.includes('direct to garment')) return 'DTG';
  if (n.includes('vinyl') || n.includes('heat press') || n.includes('transfer')) return 'Heat Press';
  if (n.includes('sublim')) return 'Sublimation';
  if (n.includes('print') || n.includes('personalise') || n.includes('custom')) return 'Print (General)';
  return '-';
}

function renderItemRow(i: UnifiedOrder['shopify']['items'][0]): string {
  const props = (i.properties || []).filter(p => p.value);
  const propsHtml = props.length > 0
    ? props.map(p => '<br><small style="color:#555;font-size:8px;">' + p.name + ': ' + p.value + '</small>').join('')
    : '';
  const skuHtml = i.sku ? '<br><small style="color:#888;font-size:8px;">SKU: ' + i.sku + '</small>' : '';
  const imgHtml = i.imageUrl
    ? '<img src="' + i.imageUrl + '" style="width:32px;height:32px;object-fit:cover;" />'
    : '';
  const unitPrice = i.price ? parseFloat(i.price) : 0;
  const lineTotal = unitPrice * (i.quantity || 0);
  return '<tr>' +
    '<td style="width:36px;text-align:center;">' + imgHtml + '</td>' +
    '<td>' + i.name + propsHtml + skuHtml + '</td>' +
    '<td style="text-align:center;">' + i.quantity + '</td>' +
    '<td style="text-align:right;">\u00A3' + unitPrice.toFixed(2) + '</td>' +
    '<td style="text-align:right;">\u00A3' + lineTotal.toFixed(2) + '</td>' +
    '<td style="width:60px;"></td>' +
    '</tr>';
}

function printOrderSheet(order: UnifiedOrder): void {
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
    '.sticker { width: 3.5in; height: 2.2in; border: none; padding: 10px 10px 6px 10px; overflow: hidden; font-size: 11px; line-height: 1.35; box-sizing: border-box; display: inline-block; }',
    '.sticker p { margin: 0; }',
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
      '<p style="font-weight:bold;font-size:13px;margin-bottom:3px;">#' + order.shopify.orderNumber + ' ' + order.shopify.customerName + '</p>' +
      addrLines.map(function(l) { return '<p>' + l + '</p>'; }).join('') +
      (addr && addr.phone ? '<p>' + addr.phone + '</p>' : '') +
      (orderNote ? '<p style="margin-top:3px;font-weight:bold;">Order Note (repeated)</p><p style="font-size:9px;">' + orderNote + '</p>' : '') +
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

  const html = '<!DOCTYPE html><html><head><title>Order #' + order.shopify.orderNumber + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+39+Text&display=swap" rel="stylesheet">' +
    '<style>' + css + '</style></head><body>' +
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
    '<div class="notes-section">Production Notes (write here):</div>' +
    '</body></html>';

  const w = window.open('', '_blank', 'width=800,height=1100');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.print();
}

const OrderTable: React.FC<OrderTableProps> = ({ 
    orders, excludedTags, sortOption, onSortChange, shopifyDomain, onTimelineScan, onBulkScan, onPabblySync, onConfirmMatch, onRefreshJob, onSearchJob, onBulkMatch, onManualLink, onNavigateToJob, onItemJobLink, isBulkScanning, scanProgress, scanCount,
    selectedOrderIds, onSelectionChange, groupingMode = 'club', productMappings, confirmedMatches
}) => {
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [ordersForMapping, setOrdersForMapping] = useState<UnifiedOrder[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [activeMatchItem, setActiveMatchItem] = useState<{orderId: string, itemId: string, jobId: string} | null>(null);

  // Manual Job Link Modal State
  const [linkJobModalOpen, setLinkJobModalOpen] = useState(false);
  const [orderToLink, setOrderToLink] = useState<string | null>(null);
  const [itemToLink, setItemToLink] = useState<string | null>(null); 
  const [manualJobId, setManualJobId] = useState('');

  const [activeHeaderMenu, setActiveHeaderMenu] = useState<{ club: string, col: string } | null>(null);
  const [sortConfig, setSortConfig] = useState<{key: SortKey, dir: SortDirection} | null>(null);
  const [filters, setFilters] = useState<TableFilters>({
      orderSearch: '',
      jobSearch: '',
      shopifyStatuses: new Set(),
      productionStatuses: new Set()
  });

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id);

  const toggleSelection = (id: string, e: React.SyntheticEvent) => {
      e.stopPropagation();
      const next = new Set(selectedOrderIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      onSelectionChange(next);
  };

  const handleHeaderMenuToggle = (club: string, col: string) => {
      setActiveHeaderMenu(prev => (prev?.club === club && prev?.col === col) ? null : { club, col });
  };

  const handleEditJobLink = (e: React.MouseEvent, orderId: string, currentJobId?: string, itemId?: string) => {
      e.stopPropagation();
      setOrderToLink(orderId);
      setItemToLink(itemId || null);
      setManualJobId(currentJobId || '');
      setLinkJobModalOpen(true);
  };

  const handleUnlinkItemJob = (e: React.MouseEvent, orderNumber: string, itemId: string) => {
      e.stopPropagation();
      if (window.confirm("Sealing individual job inheritance for this line. Proceed?") && onItemJobLink) {
          onItemJobLink(orderNumber, itemId, '');
      }
  };

  const handleBulkLinkClick = () => {
      if (selectedOrderIds.size === 0) return;
      setOrderToLink(null);
      setItemToLink(null);
      setManualJobId('');
      setLinkJobModalOpen(true);
  };

  const handleBulkMapClick = () => {
      const selected = orders.filter(o => selectedOrderIds.has(o.shopify.id));
      if (selected.length === 0) return;
      setOrdersForMapping(selected);
      setMappingModalOpen(true);
  };

  const handleExportSelection = () => {
      const selectedOrders = orders.filter(o => selectedOrderIds.has(o.shopify.id));
      if (selectedOrders.length === 0) return;

      const header = ["Shopify Order #", "Customer Name", "Deco Job #", "Deco Job Name", "% Ready"];
      const rows = selectedOrders.map(u => [
          `#${u.shopify.orderNumber}`,
          u.shopify.customerName,
          u.decoJobId || 'UNLINKED',
          u.deco?.jobName || (u.decoJobId ? 'PENDING SYNC' : 'N/A'),
          `${u.completionPercentage}%`
      ]);

      const csvContent = [
          header.join(','),
          ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `stash_orders_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const filteredAndSortedOrders = useMemo(() => {
      let result = [...orders];

      if (filters.orderSearch) {
          result = result.filter(o => o.shopify.orderNumber.toLowerCase().includes(filters.orderSearch.toLowerCase()));
      }
      if (filters.jobSearch) {
          result = result.filter(o => {
              const mainJob = o.decoJobId && o.decoJobId.toLowerCase().includes(filters.jobSearch.toLowerCase());
              const itemJobs = o.shopify.items.some(i => i.itemDecoJobId && i.itemDecoJobId.toLowerCase().includes(filters.jobSearch.toLowerCase()));
              return mainJob || itemJobs;
          });
      }
      if (filters.shopifyStatuses.size > 0) {
          result = result.filter(o => filters.shopifyStatuses.has(o.shopify.fulfillmentStatus));
      }
      if (filters.productionStatuses.size > 0) {
          result = result.filter(o => filters.productionStatuses.has(o.productionStatus));
      }

      if (sortConfig) {
          result.sort((a, b) => {
              let valA: any = '';
              let valB: any = '';

              switch (sortConfig.key) {
                  case 'date':
                      valA = new Date(a.shopify.date).getTime();
                      valB = new Date(b.shopify.date).getTime();
                      break;
                  case 'orderNumber':
                      valA = parseInt(a.shopify.orderNumber) || 0;
                      valB = parseInt(b.shopify.orderNumber) || 0;
                      break;
                  case 'decoJob':
                      valA = parseInt(a.decoJobId || '0') || 0;
                      valB = parseInt(b.decoJobId || '0') || 0;
                      break;
                  case 'dispatch':
                      valA = a.daysRemaining;
                      valB = b.daysRemaining;
                      break;
                  case 'itemsReady':
                      valA = a.completionPercentage;
                      valB = b.completionPercentage;
                      break;
              }

              if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
              if (valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
              return 0;
          });
      } else {
           result.sort((a, b) => new Date(b.shopify.date).getTime() - new Date(a.shopify.date).getTime());
      }

      return result;
  }, [orders, filters, sortConfig]);

  const groupedOrders = useMemo(() => {
    const groups: { [key: string]: UnifiedOrder[] } = {};
    
    filteredAndSortedOrders.forEach(order => {
      let targetGroups: string[] = [];
      
      if (groupingMode === 'club') {
        const validTags = order.shopify.tags.filter(t => !excludedTags.includes(t));
        targetGroups = validTags.length === 0 ? ['Other'] : validTags;
      } else {
        const vendors = new Set<string>();
        order.shopify.items.forEach(i => {
          if (i.vendor) vendors.add(i.vendor);
        });
        targetGroups = vendors.size === 0 ? ['No Vendor'] : Array.from(vendors);
      }

      targetGroups.forEach(group => {
          if (!groups[group]) groups[group] = [];
          groups[group].push(order);
      });
    });

    const entries = Object.entries(groups);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }, [filteredAndSortedOrders, excludedTags, groupingMode]);

  const handleOpenMapper = (order: UnifiedOrder, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setOrdersForMapping([order]);
      setMappingModalOpen(true);
  };

  const handleManualLinkClick = (orderId: string, item: any, jobId: string) => {
      setActiveMatchItem({ orderId, itemId: item.id, jobId });
      setManualModalOpen(true);
  };

  const handleStatusFilterToggle = (type: 'shopify' | 'production', status: string) => {
      setFilters(prev => {
          const setKey = type === 'shopify' ? 'shopifyStatuses' : 'productionStatuses';
          const newSet = new Set(prev[setKey]);
          if (newSet.has(status)) newSet.delete(status); else newSet.add(status);
          return { ...prev, [setKey]: newSet };
      });
  };

  const handleSelectGroup = (clubOrders: UnifiedOrder[], checked: boolean) => {
      const next = new Set(selectedOrderIds);
      if (checked) {
          clubOrders.forEach(o => next.add(o.shopify.id));
      } else {
          clubOrders.forEach(o => next.delete(o.shopify.id));
      }
      onSelectionChange(next);
  };

  const ManualJobLinkModal = () => {
      if (!linkJobModalOpen) return null;

      const isBulk = !orderToLink;
      const isItemLevel = !!itemToLink;
      const singleOrder = !isBulk ? orders.find(o => o.shopify.id === orderToLink || o.shopify.orderNumber === orderToLink) : null;
      
      if (!isBulk && !singleOrder) return null;

      const handleSubmit = async () => {
          if (manualJobId.trim().length === 6) {
              if (isItemLevel && onItemJobLink) {
                  await onItemJobLink(singleOrder!.shopify.orderNumber, itemToLink!, manualJobId);
              } else if (onManualLink) {
                  const idsToUpdate = isBulk ? Array.from(selectedOrderIds) : [orderToLink!];
                  await onManualLink(idsToUpdate, manualJobId);
                  if (isBulk) onSelectionChange(new Set());
              }
              setLinkJobModalOpen(false);
          }
      };

      return (
          <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={() => setLinkJobModalOpen(false)}>
              <div className="bg-white rounded-xl shadow-xl max-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="px-6 py-4 border-b border-gray-100 bg-indigo-50 flex justify-between items-center">
                      <h3 className="font-bold text-indigo-900 uppercase tracking-widest text-sm">
                          {isItemLevel ? 'Link Item Job' : 'Link Order Job'}
                      </h3>
                      <button onClick={() => setLinkJobModalOpen(false)}><X className="w-5 h-5 text-indigo-400" /></button>
                  </div>
                  <div className="p-6">
                      <p className="text-sm text-gray-600 mb-4">
                          {isItemLevel 
                            ? `Assign unique Job ID to selected item.`
                            : isBulk 
                                ? `Assign Job ID to ${selectedOrderIds.size} selected orders.`
                                : `Manually assign Job ID for Order #${singleOrder?.shopify.orderNumber}.`
                          }
                      </p>
                      <div className="space-y-3">
                          <label className="block text-xs font-bold text-gray-700 uppercase tracking-widest">Deco Job ID (6 Digits)</label>
                          <input 
                            type="text" 
                            autoFocus
                            value={manualJobId}
                            onChange={(e) => setManualJobId(e.target.value.replace(/\D/g, '').substring(0,6))}
                            placeholder="e.g. 285123"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-lg font-mono tracking-wide focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                          <button 
                            onClick={handleSubmit}
                            disabled={manualJobId.length !== 6}
                            className="w-full bg-indigo-600 text-white rounded-lg py-2 font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors uppercase tracking-widest text-xs"
                          >
                              Link Job
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  const ManualMatchModal = () => {
      if (!activeMatchItem) return null;
      const order = orders.find(o => o.shopify.orderNumber === activeMatchItem.orderId);
      const sItem = order?.shopify.items.find(i => i.id === activeMatchItem.itemId);
      
      const candidates = sItem?.candidateDecoItems || order?.deco?.items || [];
      const isLoadingCandidates = candidates.length === 0 && (!!order?.deco || !!sItem?.itemDecoJobId);

      useEffect(() => {
          if (isLoadingCandidates && onRefreshJob && activeMatchItem.jobId) {
              onRefreshJob(activeMatchItem.jobId);
          }
      }, [isLoadingCandidates]);

      if (!manualModalOpen) return null;

      return (
          <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4" onClick={() => setManualModalOpen(false)}>
              <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="px-6 py-4 border-b border-gray-100 bg-indigo-50 flex justify-between items-center">
                      <h3 className="font-bold text-indigo-900 uppercase tracking-widest text-sm">Manual Item Link</h3>
                      <button onClick={() => setManualModalOpen(false)}><X className="w-5 h-5 text-indigo-400" /></button>
                  </div>
                  <div className="p-6">
                      <div className="mb-4">
                          <p className="text-xs text-gray-500 uppercase font-bold mb-1 tracking-widest">Shopify Item:</p>
                          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg font-medium text-gray-800">{sItem?.name}</div>
                      </div>
                      <div>
                          <p className="text-xs text-gray-500 uppercase font-bold mb-2 flex justify-between tracking-widest">
                              <span>Select Matching Deco Item:</span>
                              <span className="text-purple-600 font-mono font-black">JOB #{activeMatchItem.jobId}</span>
                          </p>
                          {isLoadingCandidates ? (
                              <div className="py-8 flex flex-col items-center justify-center text-indigo-600">
                                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                                  <span className="text-xs font-bold uppercase tracking-widest">Fetching items...</span>
                              </div>
                          ) : candidates.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 italic bg-gray-50 rounded-lg border border-dashed border-gray-200 uppercase text-[10px] tracking-widest font-bold">No candidates found in job.</div>
                          ) : (
                              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                                  {candidates.map((cand, idx) => (
                                      <button
                                          key={idx}
                                          onClick={() => {
                                              if(onConfirmMatch) {
                                                  const key = sItem!.id;
                                                  const decoId = cand.vendorSku || cand.productCode || cand.name;
                                                  // Pass jobId as well to ensure the item link is pinned to this job
                                                  onConfirmMatch(key, decoId);
                                                  setManualModalOpen(false);
                                              }
                                          }}
                                          className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all group"
                                      >
                                          <div className="flex justify-between items-center">
                                              <span className="font-bold text-sm text-gray-700 group-hover:text-indigo-900">{cand.name}</span>
                                              <span className="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded text-gray-500 font-bold uppercase tracking-widest">Qty: {cand.quantity}</span>
                                          </div>
                                          <div className="text-[10px] text-gray-400 mt-1 font-mono">{cand.vendorSku || cand.productCode}</div>
                                      </button>
                                  ))}
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  const getProgressColor = (daysRemaining: number) => {
    if (daysRemaining < 0) return 'bg-red-500';
    if (daysRemaining <= 5) return 'bg-orange-500';
    if (daysRemaining <= 10) return 'bg-blue-500';
    return 'bg-emerald-500';
  };

  const getShopifyStatusBadge = (status: string) => {
      switch (status) {
          case 'fulfilled': return 'bg-emerald-50 border-emerald-200 text-emerald-700';
          case 'partial':
          case 'partially_fulfilled': return 'bg-orange-50 border-orange-200 text-orange-700';
          case 'unfulfilled':
          default: return 'bg-slate-100 border-slate-200 text-slate-600';
      }
  };

  const getProductionStatusBadge = (status: string) => {
      const s = status.toLowerCase();
      if (s === 'not ordered') return 'bg-red-50 text-red-800 border-red-200';
      if (s === 'unknown') return 'bg-gray-50 text-gray-400 border-gray-200 italic font-medium';
      if (s === 'awaiting deco data...' || s === 'awaiting deco detail...') return 'bg-indigo-50 text-indigo-400 border-indigo-100 italic animate-pulse-sync';
      if (s === 'cancelled' || s === 'on hold') return 'bg-red-100 text-red-700 border-red-300';
      if (s.includes('awaiting stock')) return 'bg-amber-100 text-amber-800 border-amber-200';
      if (s.includes('quote') || s.includes('artwork') || s.includes('po')) return 'bg-orange-50 text-orange-800 border-orange-200';
      if (s.includes('production') || s.includes('awaiting processing') || s.includes('quality') || s.includes('process')) return 'bg-blue-50 text-blue-800 border-blue-200';
      if (s.includes('shipped') || s.includes('completed') || s.includes('ready')) return 'bg-green-100 text-green-800 border-green-200';
      if (s.includes('identified') || s.includes('linked')) return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      return 'bg-gray-100 text-gray-800';
  };

  const renderHeaderRow = (groupName: string, isGroupSelected?: boolean, handleSelectGroup?: (e: React.ChangeEvent<HTMLInputElement>) => void) => (
      <tr>
        <th className="px-4 py-3 w-12 text-center">
            <input 
                type="checkbox" 
                className={`rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 ${!handleSelectGroup ? 'cursor-not-allowed bg-gray-100' : 'cursor-pointer'}`}
                checked={isGroupSelected || false}
                onChange={handleSelectGroup}
                disabled={!handleSelectGroup}
            />
        </th>

        <HeaderWithMenu title="Shopify Order #" columnKey="orderNumber" groupName={groupName} activeMenu={activeHeaderMenu} onToggle={handleHeaderMenuToggle} sortConfig={sortConfig}>
                <input 
                autoFocus
                type="text" 
                placeholder="Search Order #..." 
                value={filters.orderSearch}
                onChange={(e) => setFilters(prev => ({ ...prev, orderSearch: e.target.value }))}
                className="w-full text-xs p-2 border rounded mb-2 font-bold uppercase"
                />
                <div className="flex gap-1">
                    <button onClick={() => setSortConfig({ key: 'date', dir: 'asc' })} className="flex-1 text-[10px] font-bold uppercase tracking-wider">Oldest First</button>
                    <button onClick={() => setSortConfig({ key: 'date', dir: 'desc' })} className="flex-1 text-[10px] font-bold uppercase tracking-wider">Newest First</button>
                </div>
        </HeaderWithMenu>

        <HeaderWithMenu title="Deco Job #" columnKey="decoJob" groupName={groupName} activeMenu={activeHeaderMenu} onToggle={handleHeaderMenuToggle} sortConfig={sortConfig}>
            <input 
                autoFocus
                type="text" 
                placeholder="Search Job ID..." 
                value={filters.jobSearch}
                onChange={(e) => setFilters(prev => ({ ...prev, jobSearch: e.target.value }))}
                className="w-full text-xs p-2 border rounded mb-2 font-bold uppercase"
                />
                <div className="flex gap-1">
                    <button onClick={() => setSortConfig({ key: 'decoJob', dir: 'asc' })} className="flex-1 text-[10px] font-bold uppercase tracking-wider">0-9</button>
                    <button onClick={() => setSortConfig({ key: 'decoJob', dir: 'desc' })} className="flex-1 text-[10px] font-bold uppercase tracking-wider">9-0</button>
                </div>
        </HeaderWithMenu>

        <HeaderWithMenu title="Est Dispatch" columnKey="dispatch" groupName={groupName} activeMenu={activeHeaderMenu} onToggle={handleHeaderMenuToggle} sortConfig={sortConfig}>
            <div className="flex flex-col gap-1">
                    <button onClick={() => setSortConfig({ key: 'dispatch', dir: 'asc' })} className="text-left text-xs bg-gray-50 border p-2 rounded w-full font-bold uppercase tracking-wider">Urgent First</button>
                    <button onClick={() => setSortConfig({ key: 'dispatch', dir: 'desc' })} className="text-left text-xs bg-gray-50 border p-2 rounded w-full font-bold uppercase tracking-wider">Safe First</button>
                </div>
        </HeaderWithMenu>

        <HeaderWithMenu title="Shopify Status" columnKey="shopifyStatus" groupName={groupName} activeMenu={activeHeaderMenu} onToggle={handleHeaderMenuToggle} sortConfig={sortConfig}>
            <div className="space-y-1">
                {['unfulfilled', 'partial', 'fulfilled'].map(status => (
                    <label key={status} className="flex items-center gap-2 text-xs p-1 hover:bg-gray-50 rounded cursor-pointer capitalize font-bold tracking-widest uppercase">
                        <input 
                            type="checkbox" 
                            checked={filters.shopifyStatuses.has(status)} 
                            onChange={() => handleStatusFilterToggle('shopify', status)}
                        />
                        {status}
                    </label>
                ))}
            </div>
        </HeaderWithMenu>

        <HeaderWithMenu title="Production Status" columnKey="productionStatus" groupName={groupName} activeMenu={activeHeaderMenu} onToggle={handleHeaderMenuToggle} sortConfig={sortConfig}>
            <div className="space-y-1 max-h-40 overflow-y-auto">
                {['Not Ordered', 'Awaiting Processing', 'Production', 'Awaiting Stock', 'Shipped', 'Ready for Shipping', 'Unknown'].map(status => (
                    <label key={status} className="flex items-center gap-2 text-xs p-1 hover:bg-gray-50 rounded cursor-pointer capitalize font-bold tracking-widest uppercase">
                        <input 
                            type="checkbox" 
                            checked={filters.productionStatuses.has(status)} 
                            onChange={() => handleStatusFilterToggle('production', status)}
                        />
                        {status}
                    </label>
                ))}
            </div>
        </HeaderWithMenu>

        <HeaderWithMenu title="Items Ready" columnKey="itemsReady" groupName={groupName} activeMenu={activeHeaderMenu} onToggle={handleHeaderMenuToggle} sortConfig={sortConfig}>
                <div className="flex gap-1">
                    <button onClick={() => setSortConfig({ key: 'itemsReady', dir: 'asc' })} className="flex-1 text-[10px] font-bold uppercase tracking-wider">Low % First</button>
                    <button onClick={() => setSortConfig({ key: 'itemsReady', dir: 'desc' })} className="flex-1 text-[10px] font-bold uppercase tracking-wider">High % First</button>
                </div>
        </HeaderWithMenu>

        <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Order Fulfilled</th>
        <th className="px-6 py-3 w-8"></th>
    </tr>
  );

  return (
    <div className="space-y-8 pb-16 relative" onClick={() => setActiveHeaderMenu(null)}>
      {ordersForMapping.length > 0 && onSearchJob && onBulkMatch && (
          <OrderMappingModal 
              isOpen={mappingModalOpen}
              onClose={() => { setMappingModalOpen(false); setOrdersForMapping([]); }}
              orders={ordersForMapping.map(o => o.shopify)}
              currentDecoJobId={ordersForMapping.length === 1 ? ordersForMapping[0].decoJobId : undefined}
              onSearchJob={onSearchJob}
              onSaveMappings={(mappings, jobId, learnedPatterns) => onBulkMatch(mappings.map(m => ({ ...m, jobId })), learnedPatterns)}
              productMappings={productMappings || {}}
              confirmedMatches={confirmedMatches || {}}
              itemJobLinks={{}} // We don't strictly need this here for auto-mapping but it's required by props
          />
      )}
      <ManualMatchModal />
      <ManualJobLinkModal />
      
      {selectedOrderIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-indigo-900 text-white px-6 py-3 rounded-full shadow-2xl z-50 flex items-center gap-4 animate-in slide-in-from-bottom-4">
              <span className="font-bold text-sm uppercase tracking-widest">{selectedOrderIds.size} Selected</span>
              <div className="h-4 w-px bg-indigo-700"></div>
              {onBulkScan && (
                <button 
                  onClick={() => onBulkScan(Array.from(selectedOrderIds))}
                  className="text-xs hover:text-white text-indigo-200 font-bold flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors uppercase tracking-widest"
                >
                  <Search className="w-4 h-4" />
                  Scan
                </button>
              )}
              {onManualLink && (
                  <button 
                    onClick={handleBulkLinkClick}
                    className="text-xs hover:text-white text-indigo-200 font-bold flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors uppercase tracking-widest"
                  >
                    <LinkIcon className="w-4 h-4" />
                    Link
                  </button>
              )}
              <button 
                onClick={handleBulkMapClick}
                className="text-xs hover:text-white text-indigo-200 font-bold flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors uppercase tracking-widest"
              >
                <Box className="w-4 h-4" />
                Bulk Map
              </button>
              <button 
                  onClick={handleExportSelection}
                  className="text-xs hover:text-white text-indigo-200 font-bold flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors uppercase tracking-widest"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
              <div className="h-4 w-px bg-indigo-700"></div>
              <button className="text-xs hover:text-indigo-200 font-bold uppercase tracking-widest" onClick={() => onSelectionChange(new Set())}>Cancel</button>
          </div>
      )}

      {groupedOrders.length === 0 && (
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-visible">
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center rounded-t-xl">
               <div className="flex items-center gap-2">
                   <h3 className="font-bold text-gray-800 uppercase tracking-widest">No Orders Found</h3>
               </div>
               <button 
                onClick={() => setFilters({ orderSearch: '', jobSearch: '', shopifyStatuses: new Set(), productionStatuses: new Set() })} 
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 uppercase tracking-widest"
               >
                   <RefreshCw className="w-3 h-3" /> Clear Filters
               </button>
            </div>
            <div className="overflow-visible">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-white">
                    {renderHeaderRow('placeholder')}
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    <tr>
                        <td colSpan={9} className="px-6 py-12 text-center text-gray-400 italic font-bold uppercase tracking-widest text-[10px]">
                            No orders match the selected filters.
                        </td>
                    </tr>
                </tbody>
              </table>
            </div>
          </div>
      )}

      {groupedOrders.map(([groupName, ordersInGroup]) => {
         const isGroupSelected = ordersInGroup.length > 0 && ordersInGroup.every(o => selectedOrderIds.has(o.shopify.id));
         
         return (
        <div key={groupName} className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-visible">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center rounded-t-xl">
             <div className="flex items-center gap-2">
                 <h3 className="font-bold text-gray-800 uppercase tracking-widest">{groupName}</h3>
                 <span className="text-xs font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full uppercase tracking-widest">{ordersInGroup.length} Instances</span>
             </div>
          </div>
          <div className="overflow-visible">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-white">
                {renderHeaderRow(groupName, isGroupSelected, (e) => handleSelectGroup(ordersInGroup, e.target.checked))}
              </thead>
              <tbody className="divide-y divide-gray-200">
                {ordersInGroup.map((order) => {
                    const liveProductionStatus = order.productionStatus;
                    const isReadyToShip = ['Ready for Shipping', 'Shipped', 'Completed'].includes(liveProductionStatus);
                    const isLate = order.daysRemaining < 0;
                    const shopifyLink = `https://${shopifyDomain}/admin/orders/${order.shopify.id.split('/').pop()}`;
                    
                    const statusBadgeClass = getProductionStatusBadge(liveProductionStatus);
                    const sliderColor = getProgressColor(order.daysRemaining);
                    const shopifyStatusClass = getShopifyStatusBadge(order.shopify.fulfillmentStatus);

                    const mtoDaysTotal = 91; 
                    const mtoDaysPassed = mtoDaysTotal - (order.mtoDaysRemaining || 0);
                    const mtoProgress = (mtoDaysPassed / mtoDaysTotal) * 100;
                    const mtoColor = getProgressColor(order.mtoDaysRemaining || 0);

                    const linkedPct = order.mappedPercentage ?? 0;

                    const estProdDate = order.deco?.productionDueDate || order.productionDueDate;
                    const isLateProduction = estProdDate && order._rawDispatchDate && new Date(estProdDate) > new Date(order._rawDispatchDate);

                    return (
                  <React.Fragment key={`${groupName}-${order.shopify.id}`}>
                    <tr onClick={() => toggleExpand(`${groupName}-${order.shopify.id}`)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                        <td className="px-4 py-4 w-12 text-center" onClick={(e) => e.stopPropagation()}>
                            <input 
                                type="checkbox" 
                                checked={selectedOrderIds.has(order.shopify.id)}
                                onChange={(e) => toggleSelection(order.shopify.id, e)}
                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                            <div className="inline-flex items-center gap-2 group cursor-pointer" onClick={(e) => {
                                e.stopPropagation();
                                window.open(shopifyLink, '_blank');
                            }}>
                                <span className="text-sm font-bold text-gray-900 group-hover:text-indigo-600 group-hover:underline">#{order.shopify.orderNumber}</span>
                                <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-indigo-500" />
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5 font-bold uppercase tracking-widest">{new Date(order.shopify.date).toLocaleDateString()}</div>
                            <div className="text-xs text-gray-500 font-bold uppercase tracking-widest">{order.shopify.customerName}</div>
                            {order.hasEmailEnquiry && <span className="text-red-500 inline-flex items-center gap-1 mt-1 font-bold uppercase tracking-widest text-[9px]" title="Customer Emailed"><Mail className="w-3 h-3" /> Enquiry</span>}
                            {order.isMto && (
                                <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800 uppercase tracking-widest">
                                    <Scissors className="w-2.5 h-2.5" /> MTO
                                </span>
                            )}
                            <div className="flex flex-wrap gap-1 mt-2">
                                {order.shopify.tags
                                    .filter(tag => !excludedTags.includes(tag))
                                    .map(tag => (
                                        <span key={tag} className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[8px] font-black uppercase tracking-tighter border border-slate-200/50">
                                            {tag}
                                        </span>
                                    ))
                                }
                            </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                            {order.decoJobId ? (
                                <div className="flex flex-col">
                                    <JobIdBadge 
                                        id={order.decoJobId} 
                                        onEdit={(e) => handleEditJobLink(e, order.shopify.id, order.decoJobId)} 
                                        onNavigate={onNavigateToJob}
                                        onRefresh={onRefreshJob}
                                    />
                                    {estProdDate && (
                                        <div className={`mt-1.5 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest bg-slate-50 px-1.5 py-0.5 rounded w-fit border border-slate-100 ${isLateProduction ? 'text-red-600 border-red-200 bg-red-50' : 'text-slate-400'}`}>
                                            <Calendar className={`w-2.5 h-2.5 ${isLateProduction ? 'text-red-500' : 'text-slate-400'}`} />
                                            <span>PROD: {new Date(estProdDate).toLocaleDateString('en-GB')}</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <button onClick={(e) => { e.stopPropagation(); if(onBulkScan) onBulkScan([order.shopify.id]); }} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-white border border-gray-300 text-gray-600 hover:text-indigo-600 hover:border-indigo-300 transition-colors uppercase tracking-widest">
                                        <Search className="w-3 h-3" /> Find Job
                                    </button>
                                    <button 
                                        onClick={(e) => handleEditJobLink(e, order.shopify.id)}
                                        className="p-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded text-gray-500 hover:text-indigo-600"
                                        title="Enter Job ID Manually"
                                    >
                                        <Pencil className="w-3 h-3" />
                                    </button>
                                </div>
                            )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap w-48">
                            {order.hasStockItems && (
                                <div className="mb-2">
                                    <div className="flex justify-between text-[10px] mb-1 font-bold uppercase tracking-widest">
                                        <span className="text-gray-500">Day {order.daysInProduction}</span>
                                        <span className={`font-bold ${isLate ? 'text-red-600' : 'text-gray-500'}`}>
                                            {isLate ? `${Math.abs(order.daysRemaining)} OVER` : `${order.daysRemaining} LEFT`}
                                        </span>
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                                        <div className={`h-1.5 rounded-full ${sliderColor}`} style={{ width: `${Math.min(100, (order.daysInProduction / 20) * 100)}%` }}></div>
                                    </div>
                                </div>
                            )}
                             {order.isMto && (
                                <div className="mb-2">
                                    <div className="flex justify-between text-[10px] text-gray-500 mb-1 font-bold uppercase tracking-widest">
                                        <span className="font-bold text-purple-700">MTO (13W)</span>
                                        <span className={`${order.mtoDaysRemaining && order.mtoDaysRemaining < 0 ? 'text-red-600 font-bold' : ''}`}>
                                            {order.mtoDaysRemaining}D LEFT
                                        </span>
                                    </div>
                                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                                        <div className={`h-1.5 rounded-full ${mtoColor}`} style={{ width: `${Math.min(100, mtoProgress)}%` }}></div>
                                    </div>
                                </div>
                            )}
                            <div className="text-[10px] text-gray-400 mt-1 font-bold uppercase tracking-widest">
                                DISPATCH: {order.slaTargetDate || '-'}
                            </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                             <div className={`inline-flex px-2 py-1 text-[10px] font-bold rounded border capitalize uppercase tracking-widest ${shopifyStatusClass}`}>
                                <span className="inline-flex items-center gap-2 cursor-pointer" onClick={(e) => {e.stopPropagation(); window.open(shopifyLink, '_blank')}}>
                                    {order.shopify.fulfillmentStatus}
                                    <ExternalLink className="w-3 h-3 opacity-50" />
                                </span>
                             </div>
                             {order.shipStationTracking && (
                                <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 rounded border border-blue-200">
                                    <Package className="w-2.5 h-2.5" /> {order.shipStationTracking.carrier}
                                </div>
                             )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                             <span className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-full border uppercase tracking-widest ${statusBadgeClass}`}>
                                {isReadyToShip && <Truck className="w-3 h-3" />}
                                {liveProductionStatus}
                            </span>
                        </td>
                         <td className="px-6 py-4 whitespace-nowrap w-56">
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-col">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[9px] text-gray-400 w-14 font-bold uppercase tracking-widest">Mapped</span>
                                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden min-w-[60px]">
                                            <div className={`h-full rounded-full transition-all ${linkedPct === 100 ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${linkedPct}%` }}></div>
                                        </div>
                                        <div className={`text-[9px] w-14 text-right font-black tracking-widest flex items-center justify-end gap-1 ${linkedPct === 100 ? 'text-green-600' : 'text-indigo-600'}`}>
                                            <span>{linkedPct}%</span>
                                            <span className="text-[8px] opacity-60 font-bold">[{order.mappedCount || 0}/{order.eligibleCount || 0}]</span>
                                        </div>
                                    </div>
                                </div>

                                {order.hasStockItems && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] text-gray-400 w-14 font-bold uppercase tracking-widest">Stock</span>
                                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 min-w-[60px]"><div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${order.stockCompletionPercentage}%` }}></div></div>
                                        <div className="text-[9px] text-gray-600 w-14 text-right font-bold tracking-widest flex items-center justify-end gap-1">
                                            <span>{order.stockCompletionPercentage}%</span>
                                            <span className="text-[8px] opacity-60">[{order.readyStockCount || 0}/{order.totalStockCount || 0}]</span>
                                        </div>
                                    </div>
                                )}
                                {order.isMto && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] text-gray-400 w-14 font-bold uppercase tracking-widest">MTO</span>
                                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 min-w-[60px]"><div className="bg-purple-600 h-1.5 rounded-full" style={{ width: `${order.mtoCompletionPercentage}%` }}></div></div>
                                        <div className="text-[9px] text-gray-600 w-14 text-right font-bold tracking-widest flex items-center justify-end gap-1">
                                            <span>{order.mtoCompletionPercentage}%</span>
                                            <span className="text-[8px] opacity-60">[{order.readyMtoCount || 0}/{order.totalMtoCount || 0}]</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {order.decoJobId && (order.mappedPercentage ?? 0) < 100 && (
                                <div className="mt-2 flex justify-end">
                                    <button 
                                        onClick={(e) => handleOpenMapper(order, e)}
                                        className="text-[9px] text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 hover:bg-indigo-100 flex items-center gap-1 uppercase tracking-widest"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Map Items
                                    </button>
                                </div>
                            )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {order.fulfillmentDate ? (
                                <div className="flex flex-col font-bold uppercase tracking-widest text-[10px]">
                                    <span className="text-gray-900">{new Date(order.fulfillmentDate).toLocaleDateString()}</span>
                                    <span className="text-gray-400">{order.fulfillmentDuration} DAYS</span>
                                </div>
                            ) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                             {expandedId === `${groupName}-${order.shopify.id}` ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                        </td>
                    </tr>
                    {expandedId === `${groupName}-${order.shopify.id}` && (
                        <tr>
                            <td colSpan={9} className="px-6 py-4 bg-gray-50/40 shadow-inner border-t border-gray-100">
                                <div className="flex flex-col md:flex-row gap-8">
                                    <div className="flex-1">
                                        <table className="min-w-full divide-y divide-gray-100">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Item Details</th>
                                                    <th className="px-4 py-2 text-center text-[10px] font-bold text-gray-500 uppercase tracking-widest">Qty</th>
                                                    <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">SKU & Individual Job</th>
                                                    <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Shopify Status</th>
                                                    <th className="px-4 py-2 text-center w-20">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <ClipboardList className="w-4 h-4 text-gray-500" />
                                                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Ordered</span>
                                                        </div>
                                                    </th>
                                                    <th className="px-4 py-2 text-center w-20">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <Box className="w-4 h-4 text-gray-500" />
                                                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Received</span>
                                                        </div>
                                                    </th>
                                                    <th className="px-4 py-2 text-center w-20">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <Shirt className="w-4 h-4 text-gray-500" />
                                                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Produced</span>
                                                        </div>
                                                    </th>
                                                    <th className="px-4 py-2 text-center w-20">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <Truck className="w-4 h-4 text-gray-500" />
                                                            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Shipped</span>
                                                        </div>
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {order.shopify.items.filter(item => isEligibleForMapping(item.name, item.productType)).map((item, idx) => {
                                                    const isPartialItem = item.fulfilledQuantity !== undefined && item.fulfilledQuantity > 0 && item.fulfilledQuantity < item.quantity;
                                                    const isFullItem = item.fulfilledQuantity === item.quantity;
                                                    const isMtoItem = item.name.toLowerCase().includes('mto');
                                                    const isNoMap = item.linkedDecoItemId === '__NO_MAP__';
                                                    const isFulfilled = item.itemStatus === 'fulfilled';
                                                    
                                                    return (
                                                    <tr key={idx} className={`transition-colors ${isFulfilled ? 'bg-emerald-50/20 opacity-70' : 'hover:bg-gray-50'}`}>
                                                        <td className="px-4 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-sm text-gray-900 uppercase tracking-widest">{item.name}</span>
                                                                {!isFulfilled && (item.itemDecoJobId || order.decoJobId) && (
                                                                    <button 
                                                                        onClick={() => handleManualLinkClick(order.shopify.orderNumber, item, item.itemDecoJobId || order.decoJobId!)} 
                                                                        className="text-gray-300 hover:text-indigo-600"
                                                                        title="Manual Item Map"
                                                                    >
                                                                        <LinkIcon className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="text-[10px] text-gray-400 uppercase tracking-widest font-bold flex items-center gap-2">
                                                                {item.vendor} {item.ean && item.ean !== '-' && `• EAN: ${item.ean}`}
                                                                {isMtoItem && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-100 text-[8px] font-black">MTO</span>
                                                                )}
                                                                {isNoMap && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 text-[8px] font-black flex items-center gap-1">
                                                                        <ShieldOff className="w-2 h-2" /> NO MAP REQUIRED
                                                                    </span>
                                                                )}
                                                                {isFulfilled && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 text-[8px] font-black flex items-center gap-1 uppercase tracking-widest">
                                                                        <CheckCircle2 className="w-2 h-2" /> Fulfilled
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <div className="flex flex-col">
                                                                <span className="text-sm text-gray-900 font-bold">{item.quantity || 0}</span>
                                                                {isPartialItem && <span className="text-[8px] text-orange-600 font-black uppercase tracking-tighter whitespace-nowrap">{item.fulfilledQuantity} SHIPPED</span>}
                                                                {isFullItem && item.quantity > 0 && <span className="text-[8px] text-green-600 font-black uppercase tracking-tighter whitespace-nowrap">ALL SHIPPED</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="text-[10px] text-gray-500 font-mono uppercase font-bold tracking-widest mb-1">{item.sku}</div>
                                                            {item.itemDecoJobId ? (
                                                                <JobIdBadge 
                                                                    id={item.itemDecoJobId} 
                                                                    variant="purple" 
                                                                    onEdit={(e) => !isFulfilled && handleEditJobLink(e, order.shopify.id, item.itemDecoJobId, item.id)} 
                                                                    onUnlink={(e) => !isFulfilled && handleUnlinkItemJob(e, order.shopify.orderNumber, item.id)}
                                                                    onNavigate={onNavigateToJob}
                                                                    onRefresh={onRefreshJob}
                                                                />
                                                            ) : isNoMap || isFulfilled ? (
                                                                <span className="text-[9px] text-slate-400 italic uppercase font-bold tracking-widest">{isFulfilled ? 'Completed' : 'Exempt'}</span>
                                                            ) : (
                                                                <button 
                                                                    onClick={(e) => handleEditJobLink(e, order.shopify.id, '', item.id)}
                                                                    className="text-[9px] text-purple-600 font-black bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded hover:bg-purple-100 transition-colors uppercase tracking-widest flex items-center gap-1"
                                                                >
                                                                    <Hash className="w-2.5 h-2.5" /> Set Item Job
                                                                </button>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`inline-block px-2 py-1 text-[10px] font-bold rounded border capitalize uppercase tracking-widest ${getShopifyStatusBadge(item.itemStatus || 'unfulfilled')}`}>
                                                                {item.itemStatus || 'unfulfilled'}
                                                            </span>
                                                            {item.tracking && (
                                                                <div className="mt-2 p-2 bg-indigo-50 border border-indigo-100 rounded flex flex-col gap-1 font-bold tracking-widest text-[9px] shadow-sm animate-in fade-in">
                                                                    <div className="text-indigo-600 uppercase flex items-center gap-1">
                                                                        <Truck className="w-3 h-3" /> Dispatched
                                                                    </div>
                                                                    <a href={item.tracking.url} target="_blank" rel="noreferrer" className="text-indigo-900 hover:underline flex items-center gap-1 uppercase truncate max-w-[150px]">
                                                                        <ExternalLink className="w-2.5 h-2.5" /> {item.tracking.number}
                                                                    </a>
                                                                    <div className="text-gray-400 mt-0.5 border-t border-indigo-100/50 pt-0.5">Date: {new Date(item.tracking.date).toLocaleDateString()}</div>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-center bg-gray-50/50">
                                                            {isNoMap || isFulfilled ? <span className="text-[8px] font-black text-slate-400">N/A</span> : <WorkflowStatusCell type="ordered" status={item.procurementStatus || (item.decoStatus ? 60 : 0)} />}
                                                        </td>
                                                        <td className="px-4 py-3 text-center bg-gray-50/50">
                                                            {isNoMap || isFulfilled ? <span className="text-[8px] font-black text-slate-400">N/A</span> : <WorkflowStatusCell type="received" status={item.procurementStatus || (item.decoReceived ? 60 : 0)} />}
                                                        </td>
                                                        <td className="px-4 py-3 text-center bg-gray-50/50">
                                                            {isNoMap || isFulfilled ? <span className="text-[8px] font-black text-slate-400">N/A</span> : <WorkflowStatusCell type="produced" status={item.productionStatus || (item.decoProduced ? 80 : 0)} />}
                                                        </td>
                                                        <td className="px-4 py-3 text-center bg-gray-50/50">
                                                            {isNoMap || isFulfilled ? <span className="text-[8px] font-black text-slate-400">N/A</span> : <WorkflowStatusCell type="shipped" status={item.shippingStatus || (item.decoShipped ? 80 : 0)} />}
                                                        </td>
                                                    </tr>
                                                )})}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="w-full md:w-72 space-y-4">
                                        {order.shopify.fulfillmentStatus === 'fulfilled' && order.fulfillmentDate && (
                                            <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-200 text-sm shadow-sm font-bold uppercase tracking-widest">
                                                <div className="flex items-center gap-2 text-emerald-800 mb-2">
                                                    <Truck className="w-5 h-5" />
                                                    <span>Order Dispatched</span>
                                                </div>
                                                <div className="text-[10px] text-emerald-600 mb-1 font-bold uppercase tracking-widest">Date: {new Date(order.fulfillmentDate).toLocaleDateString()}</div>
                                                <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Lead Time: {order.fulfillmentDuration} Working Days</div>
                                            </div>
                                        )}

                                        {order.shipStationTracking && (
                                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 text-sm shadow-sm font-bold uppercase tracking-widest">
                                                <div className="flex items-center gap-2 text-blue-800 mb-2">
                                                    <Package className="w-5 h-5" />
                                                    <span>ShipStation</span>
                                                </div>
                                                <div className="text-[10px] text-blue-600 mb-1 font-bold uppercase tracking-widest">Carrier: {order.shipStationTracking.carrier}</div>
                                                <div className="text-[10px] text-blue-600 mb-1 font-bold uppercase tracking-widest">Ship Date: {new Date(order.shipStationTracking.shipDate).toLocaleDateString()}</div>
                                                {order.shipStationTracking.shippingCost > 0 && (
                                                    <div className="text-[10px] text-blue-600 mb-1 font-bold uppercase tracking-widest">Cost: £{order.shipStationTracking.shippingCost.toFixed(2)}</div>
                                                )}
                                                {order.shipStationTracking.trackingNumber && (
                                                    <a 
                                                        href={getTrackingUrl(order.shipStationTracking.carrier, order.shipStationTracking.trackingNumber) || '#'}
                                                        target="_blank" 
                                                        rel="noreferrer"
                                                        className="mt-2 flex items-center gap-1 text-[10px] text-blue-700 hover:text-blue-900 font-black uppercase tracking-widest underline"
                                                    >
                                                        <ExternalLink className="w-3 h-3" /> {order.shipStationTracking.trackingNumber}
                                                    </a>
                                                )}
                                            </div>
                                        )}

                                        {order.decoJobId && (
                                            <div className="bg-white p-4 rounded-lg border border-gray-200 text-sm shadow-sm font-bold uppercase tracking-widest">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                                                    {onNavigateToJob ? (
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); onNavigateToJob(order.decoJobId!); }}
                                                            className="font-bold hover:text-indigo-600 hover:underline text-left transition-colors uppercase tracking-widest text-xs"
                                                        >
                                                            Linked Job #{order.decoJobId}
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs">Linked Job #{order.decoJobId}</span>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-gray-500 mb-2 uppercase font-bold tracking-widest">Primary Production Line</div>
                                                <div className={`text-[10px] font-black mb-3 uppercase tracking-widest ${isLateProduction ? 'text-red-600' : 'text-indigo-600'}`}>
                                                    EST PROD: {estProdDate ? new Date(estProdDate).toLocaleDateString('en-GB') : '-'}
                                                </div>
                                                <div className="border-t border-gray-100 pt-2 mt-2">
                                                    <div className="flex justify-between text-gray-600 mb-1 text-[10px]">
                                                        <span>STATUS:</span>
                                                        <span className={`px-2 py-0.5 rounded text-[9px] border ${getProductionStatusBadge(order.productionStatus)}`}>
                                                            {order.productionStatus}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between text-gray-600 text-[10px]">
                                                        <span>PRODUCED:</span>
                                                        <span>{order.deco?.itemsProduced || 0} / {order.deco?.totalItems || 0}</span>
                                                    </div>
                                                </div>
                                                <div className="mt-4">
                                                    {order.shopify.fulfillmentStatus !== 'fulfilled' && (
                                                        <button onClick={(e) => handleOpenMapper(order, e)} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 rounded border border-indigo-100 font-bold text-[10px] hover:bg-indigo-100 uppercase tracking-widest"><RefreshCw className="w-3 h-3" /> Map Items</button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                printOrderSheet(order);
                                            }}
                                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-50 text-gray-700 rounded border border-gray-200 font-bold text-[10px] hover:bg-gray-100 uppercase tracking-widest mt-2 transition-colors"
                                        >
                                            <Printer className="w-3 h-3" /> Print Order Sheet
                                        </button>

                                        {order.isMto && order.shopify.fulfillmentStatus !== 'fulfilled' && (
                                            <div className="bg-purple-50 p-4 rounded-lg border border-purple-100 text-sm shadow-sm font-bold uppercase tracking-widest">
                                                <div className="flex items-center gap-2 text-purple-800 mb-2">
                                                    <Scissors className="w-5 h-5" />
                                                    <span>MTO Management</span>
                                                </div>
                                                <p className="text-[10px] text-purple-600 leading-relaxed font-bold uppercase tracking-tight mb-3">
                                                    MTO lines can have their own Job IDs. Use the "Set Item Job" button on the line item to override the primary PO.
                                                </p>
                                                <div className="flex flex-col gap-2">
                                                    <button 
                                                        onClick={() => onBulkScan?.(order.shopify.items.filter(i => i.name.toLowerCase().includes('mto') && i.itemStatus !== 'fulfilled').map(i => i.sku))}
                                                        className="w-full py-1.5 bg-white text-purple-700 border border-purple-200 rounded text-[9px] font-black uppercase tracking-widest hover:bg-purple-100 transition-colors"
                                                    >
                                                        Scan MTO Lines
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </td>
                        </tr>
                    )}
                  </React.Fragment>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>
      )})}
    </div>
  );
};
export default OrderTable;