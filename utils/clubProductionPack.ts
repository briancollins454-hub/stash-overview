import type { UnifiedOrder } from '../types';
import { isEligibleForMapping } from '../services/apiService';
import { isShopifyLineItemActiveForOps, shopifyLineRemainingQuantity } from '../services/shopifyLineItems';

/** Shopify line properties used for pivot row (matches Excel “Enter Initials New” column). */
export const PIVOT_PERSONALIZATION_KEYS = [
  'Enter Initials New',
  'Enter Initials',
  'Initials Text',
  'Enter Name',
  'Enter Shirt Name',
  'Enter Shirt Number',
  'Personalisation Details',
  'Personalisation Details 1',
  'Free Initials',
] as const;

const DISPLAY_PERSONALIZATION_KEYS = [
  ...PIVOT_PERSONALIZATION_KEYS,
  'Add Initials',
  'Add Name',
  'Add Squad Number',
] as const;

export interface ProductionPackFilters {
  tag: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  unfulfilledOnly: boolean;
}

export interface ProductionPackLine {
  orderId: string;
  orderNumber: string;
  customerName: string;
  email: string;
  orderDate: string;
  lineName: string;
  quantity: number;
  sku: string;
  pivotPersonalization: string;
  displayProperties: { name: string; value: string }[];
}

/** @deprecated Flat pivot row — use ProductionPackPivotBundle */
export interface ProductionPackPivotRow {
  lineName: string;
  personalization: string;
  quantity: number;
}

/** One product line with total qty and one personalisation label per garment. */
export interface ProductionPackPivotBundle {
  lineName: string;
  sizeLabel: string;
  totalQuantity: number;
  /** One label per unit to make — e.g. ["AA", "AA"] when qty 2 with initials AA */
  personalizationUnits: string[];
}

export interface ProductionPackOrderGroup {
  orderNumber: string;
  customerName: string;
  email: string;
  orderDate: string;
  lines: ProductionPackLine[];
  totalUnits: number;
}

export interface ProductionPackReport {
  filters: ProductionPackFilters;
  lines: ProductionPackLine[];
  /** Product types bundled with total qty + personalisation list */
  pivotBundles: ProductionPackPivotBundle[];
  orders: ProductionPackOrderGroup[];
  stats: {
    orderCount: number;
    lineCount: number;
    totalUnits: number;
    productCount: number;
  };
}

/** Last segment after " - " when it looks like a size (e.g. M, 7-8, 2XL). */
export function extractSizeLabel(lineName: string): string {
  const trimmed = lineName.trim();
  const dashParts = trimmed.split(' - ').map(p => p.trim()).filter(Boolean);
  if (dashParts.length >= 2) {
    const last = dashParts[dashParts.length - 1];
    if (last.length > 0 && last.length <= 14) return last;
  }
  const tail = trimmed.match(/\s[-–]\s([^-–]+)$/);
  if (tail?.[1] && tail[1].length <= 14) return tail[1].trim();
  return '';
}

export function formatBundleQty(sizeLabel: string, totalQuantity: number): string {
  if (sizeLabel) return `${totalQuantity}× ${sizeLabel}`;
  return `${totalQuantity}×`;
}

/** Space-separated list for copy/paste (e.g. "AA AA FT"). */
export function formatPersonalizationUnits(units: string[]): string {
  return units.filter(Boolean).join(' ');
}

function normPropName(name: string): string {
  return name.trim().toLowerCase();
}

function propValue(props: { name: string; value: string | number }[], key: string): string {
  const want = normPropName(key);
  const hit = props.find(p => normPropName(String(p.name)) === want);
  if (!hit || hit.value == null || hit.value === '') return '';
  return String(hit.value).trim();
}

/** Value for pivot’s second row field (Excel: Enter Initials New). */
export function pivotPersonalizationFromProperties(
  properties: { name: string; value: string | number }[] | undefined
): string {
  if (!properties?.length) return '';
  for (const key of PIVOT_PERSONALIZATION_KEYS) {
    const v = propValue(properties, key);
    if (v) return v;
  }
  return '';
}

export function displayPersonalizationProperties(
  properties: { name: string; value: string | number }[] | undefined
): { name: string; value: string }[] {
  if (!properties?.length) return [];
  const allowed = new Set(DISPLAY_PERSONALIZATION_KEYS.map(normPropName));
  return properties
    .filter(p => {
      const n = String(p.name);
      if (n.startsWith('_')) return false;
      if (normPropName(n).includes('dispatch')) return false;
      const v = p.value;
      if (v == null || String(v).trim() === '') return false;
      return allowed.has(normPropName(n));
    })
    .map(p => ({ name: String(p.name), value: String(p.value).trim() }));
}

function parseYmd(ymd: string): number | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function orderDayStart(order: UnifiedOrder): number {
  const t = order._rawOrderDate?.getTime() ?? new Date(order.shopify.date).getTime();
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function orderMatchesTag(order: UnifiedOrder, tag: string): boolean {
  const want = tag.trim();
  if (!want) return false;
  return order.shopify.tags.some(t => t.trim() === want);
}

export function isOrderUnfulfilledForPack(order: UnifiedOrder): boolean {
  const s = (order.shopify.fulfillmentStatus || '').toLowerCase();
  return s !== 'fulfilled' && s !== 'restocked';
}

export function collectAvailableTags(
  orders: UnifiedOrder[],
  excludedTags: string[]
): string[] {
  const excluded = new Set(excludedTags.map(t => t.trim()));
  const tags = new Set<string>();
  for (const o of orders) {
    for (const t of o.shopify.tags) {
      const trimmed = t?.trim();
      if (trimmed && !excluded.has(trimmed)) tags.add(trimmed);
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function expandOrderLines(order: UnifiedOrder): ProductionPackLine[] {
  const out: ProductionPackLine[] = [];
  for (const item of order.shopify.items) {
    if (!isShopifyLineItemActiveForOps(item)) continue;
    if (!isEligibleForMapping(item.name, item.productType)) continue;
    const qty = shopifyLineRemainingQuantity(item);
    if (qty <= 0) continue;
    const props = item.properties || [];
    out.push({
      orderId: order.shopify.id,
      orderNumber: order.shopify.orderNumber,
      customerName: order.shopify.customerName,
      email: order.shopify.email || '',
      orderDate: order.shopify.date,
      lineName: item.name,
      quantity: qty,
      sku: item.sku || '',
      pivotPersonalization: pivotPersonalizationFromProperties(props),
      displayProperties: displayPersonalizationProperties(props),
    });
  }
  return out;
}

export function buildProductionPackReport(
  orders: UnifiedOrder[],
  filters: ProductionPackFilters
): ProductionPackReport {
  const fromMs = parseYmd(filters.dateFrom);
  const toMs = parseYmd(filters.dateTo);
  const toEndMs = toMs != null ? toMs + 24 * 60 * 60 * 1000 - 1 : null;

  let filtered = orders.filter(o => orderMatchesTag(o, filters.tag));
  if (filters.unfulfilledOnly) {
    filtered = filtered.filter(isOrderUnfulfilledForPack);
  }
  if (fromMs != null || toEndMs != null) {
    filtered = filtered.filter(o => {
      const day = orderDayStart(o);
      if (fromMs != null && day < fromMs) return false;
      if (toEndMs != null && day > toEndMs) return false;
      return true;
    });
  }

  const lines: ProductionPackLine[] = [];
  for (const o of filtered) {
    lines.push(...expandOrderLines(o));
  }

  const bundleMap = new Map<
    string,
    { lineName: string; totalQuantity: number; units: string[] }
  >();
  for (const line of lines) {
    const key = line.lineName;
    let bundle = bundleMap.get(key);
    if (!bundle) {
      bundle = { lineName: line.lineName, totalQuantity: 0, units: [] };
      bundleMap.set(key, bundle);
    }
    bundle.totalQuantity += line.quantity;
    const label = line.pivotPersonalization.trim();
    if (label) {
      for (let u = 0; u < line.quantity; u++) {
        bundle.units.push(label);
      }
    }
  }

  const pivotBundles: ProductionPackPivotBundle[] = Array.from(bundleMap.values())
    .map(b => ({
      lineName: b.lineName,
      sizeLabel: extractSizeLabel(b.lineName),
      totalQuantity: b.totalQuantity,
      personalizationUnits: b.units,
    }))
    .sort((a, b) => {
      if (b.totalQuantity !== a.totalQuantity) return b.totalQuantity - a.totalQuantity;
      return a.lineName.localeCompare(b.lineName);
    });

  const byOrder = new Map<string, ProductionPackOrderGroup>();
  for (const line of lines) {
    if (!byOrder.has(line.orderNumber)) {
      byOrder.set(line.orderNumber, {
        orderNumber: line.orderNumber,
        customerName: line.customerName,
        email: line.email,
        orderDate: line.orderDate,
        lines: [],
        totalUnits: 0,
      });
    }
    const g = byOrder.get(line.orderNumber)!;
    g.lines.push(line);
    g.totalUnits += line.quantity;
  }

  const ordersGrouped = Array.from(byOrder.values()).sort((a, b) => {
    const na = parseInt(a.orderNumber.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.orderNumber.replace(/\D/g, ''), 10) || 0;
    return nb - na;
  });

  for (const g of ordersGrouped) {
    g.lines.sort((a, b) => a.lineName.localeCompare(b.lineName));
  }

  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);

  return {
    filters,
    lines,
    pivotBundles,
    orders: ordersGrouped,
    stats: {
      orderCount: ordersGrouped.length,
      lineCount: lines.length,
      totalUnits,
      productCount: pivotBundles.length,
    },
  };
}
