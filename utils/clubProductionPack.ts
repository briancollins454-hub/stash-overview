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

export interface ProductionPackPivotRow {
  lineName: string;
  personalization: string;
  quantity: number;
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
  pivot: ProductionPackPivotRow[];
  orders: ProductionPackOrderGroup[];
  stats: {
    orderCount: number;
    lineCount: number;
    totalUnits: number;
    pivotRowCount: number;
  };
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

  const pivotMap = new Map<string, ProductionPackPivotRow>();
  for (const line of lines) {
    const key = `${line.lineName}\0${line.pivotPersonalization}`;
    const existing = pivotMap.get(key);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      pivotMap.set(key, {
        lineName: line.lineName,
        personalization: line.pivotPersonalization,
        quantity: line.quantity,
      });
    }
  }

  const pivot = Array.from(pivotMap.values()).sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    const n = a.lineName.localeCompare(b.lineName);
    if (n !== 0) return n;
    return a.personalization.localeCompare(b.personalization);
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
    pivot,
    orders: ordersGrouped,
    stats: {
      orderCount: ordersGrouped.length,
      lineCount: lines.length,
      totalUnits,
      pivotRowCount: pivot.length,
    },
  };
}
