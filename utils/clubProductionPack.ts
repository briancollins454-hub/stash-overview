import type { UnifiedOrder } from '../types';
import { isEligibleForMapping } from '../services/apiService';
import { isShopifyLineItemActiveForOps, shopifyLineRemainingQuantity } from '../services/shopifyLineItems';

/** Addon checkbox lines — real text lives in companion fields. */
const ADDON_TOGGLE_PROP_NAMES = new Set([
  'add initials',
  'add name',
  'add squad number',
  'free initials',
]);

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
  itemName: string;
  quantity: number;
  sku: string;
  vendor: string;
  colorLabel: string;
  sizeLabel: string;
  personalizationLabel: string;
  /** Values only — one per property (initials, name, number, etc.). */
  personalizationValues: string[];
  displayProperties: { name: string; value: string }[];
}

export interface ProductionPackPivotBundle {
  lineName: string;
  itemName: string;
  sku: string;
  vendor: string;
  colorLabel: string;
  sizeLabel: string;
  totalQuantity: number;
  /** One full personalisation label per garment (initials, names, shirt number, etc.) */
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
  pivotBundles: ProductionPackPivotBundle[];
  orders: ProductionPackOrderGroup[];
  stats: {
    orderCount: number;
    lineCount: number;
    totalUnits: number;
    productCount: number;
  };
}

export interface ParsedVariant {
  productTitle: string;
  color: string;
  size: string;
}

function normPropName(name: string): string {
  return name.trim().toLowerCase();
}

/** Parse "Club Product - Burgundy - M" → title, colour, size. */
export function parseVariantFromLineName(lineName: string): ParsedVariant {
  const parts = lineName
    .split(' - ')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    const size = parts[parts.length - 1];
    const color = parts[parts.length - 2];
    const productTitle = parts.slice(0, -2).join(' - ');
    return { productTitle, color, size };
  }
  if (parts.length === 2) {
    const last = parts[1];
    if (looksLikeSizeToken(last)) {
      return { productTitle: parts[0], color: '', size: last };
    }
    return { productTitle: parts[0], color: last, size: '' };
  }
  if (parts.length === 1) {
    const only = parts[0];
    if (looksLikeSizeToken(only)) {
      return { productTitle: '', color: '', size: only };
    }
    return { productTitle: only, color: '', size: '' };
  }
  return { productTitle: lineName, color: '', size: '' };
}

function looksLikeSizeToken(token: string): boolean {
  const t = token.trim();
  if (!t || t.length > 14) return false;
  return sizeSortIndex(t) < 900;
}

/** Last segment after " - " when it looks like a size. */
export function extractSizeLabel(lineName: string): string {
  const parts = lineName
    .split(' - ')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 1];
  if (parts.length === 2 && looksLikeSizeToken(parts[1])) return parts[1];
  if (parts.length === 1 && looksLikeSizeToken(parts[0])) return parts[0];
  return '';
}

const LETTER_SIZE_ORDER: Record<string, number> = {
  xxxs: 10,
  xxs: 20,
  xs: 30,
  s: 40,
  small: 40,
  m: 50,
  medium: 50,
  l: 60,
  large: 60,
  xl: 70,
  xlarge: 70,
  '2xl': 80,
  xxl: 80,
  '3xl': 90,
  xxxl: 90,
  '4xl': 100,
  '5xl': 110,
  one: 5,
  onesize: 5,
  os: 5,
};

/** Lower = earlier in size runs (XS → S → M → L → XL, then 7-8, 9-10, etc.). */
export function sizeSortIndex(size: string): number {
  const raw = size.trim();
  if (!raw) return 9999;
  const key = raw.toLowerCase().replace(/\s+/g, '');
  if (LETTER_SIZE_ORDER[key] !== undefined) return LETTER_SIZE_ORDER[key];

  const youth = key.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (youth) return 200 + parseInt(youth[1], 10) * 10 + parseInt(youth[2], 10);

  const age = key.match(/^(\d+)(?:y|yr|years?)?$/i);
  if (age) return 300 + parseInt(age[1], 10);

  if (/^\d+(\.\d+)?$/.test(key)) return 400 + parseFloat(key);

  return 800 + raw.toLowerCase().charCodeAt(0);
}

export function comparePivotBundles(a: ProductionPackPivotBundle, b: ProductionPackPivotBundle): number {
  const title = a.itemName.localeCompare(b.itemName, undefined, { sensitivity: 'base' });
  if (title !== 0) return title;

  const color = a.colorLabel.localeCompare(b.colorLabel, undefined, { sensitivity: 'base' });
  if (color !== 0) return color;

  const sizeDiff = sizeSortIndex(a.sizeLabel) - sizeSortIndex(b.sizeLabel);
  if (sizeDiff !== 0) return sizeDiff;

  return a.lineName.localeCompare(b.lineName, undefined, { sensitivity: 'base' });
}

export function formatBundleQty(sizeLabel: string, totalQuantity: number): string {
  if (sizeLabel) return `${totalQuantity}× ${sizeLabel}`;
  return `${totalQuantity}×`;
}

export function formatPersonalizationUnits(units: string[]): string {
  return units.filter(Boolean).join(' · ');
}

/** One row in the pack UI (bundled pivot line or order line). */
export interface ProductionPackWorkRow {
  id: string;
  itemName: string;
  lineName: string;
  sku: string;
  vendor: string;
  colorLabel: string;
  sizeLabel: string;
  /** Single label (order lines). */
  personalization: string;
  /** One chip per garment when pivot bundles are personalised. */
  personalizationUnits: string[];
  quantity: number;
  orderNumber?: string;
}

export function formatProductionPackItemMeta(row: {
  sku: string;
  vendor: string;
  colorLabel: string;
  lineName: string;
}): string {
  const parts: string[] = [];
  if (row.sku) parts.push(row.sku);
  if (row.vendor) parts.push(row.vendor);
  if (row.colorLabel) parts.push(row.colorLabel);
  if (parts.length > 0) return parts.join(' · ');
  return row.lineName;
}

export function productionPackDoneStorageKey(filters: ProductionPackFilters): string {
  return `stash-pp-done:${filters.tag}|${filters.dateFrom}|${filters.dateTo}`;
}

export function loadProductionPackDoneIds(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveProductionPackDoneIds(storageKey: string, ids: Set<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    /* quota / private mode */
  }
}

export function buildWorkRowsFromReport(report: ProductionPackReport): {
  pivotRows: ProductionPackWorkRow[];
  orderRows: ProductionPackWorkRow[];
} {
  const pivotRows: ProductionPackWorkRow[] = [];

  for (const b of report.pivotBundles) {
    pivotRows.push({
      id: `p:${b.lineName}`,
      itemName: b.itemName,
      lineName: b.lineName,
      sku: b.sku,
      vendor: b.vendor,
      colorLabel: b.colorLabel,
      sizeLabel: b.sizeLabel,
      personalization: '',
      personalizationUnits: b.personalizationUnits,
      quantity: b.totalQuantity,
    });
  }

  const orderRows: ProductionPackWorkRow[] = [];
  for (const o of report.orders) {
    for (const line of o.lines) {
      const base = {
        itemName: line.itemName,
        lineName: line.lineName,
        sku: line.sku,
        vendor: line.vendor,
        colorLabel: line.colorLabel,
        sizeLabel: line.sizeLabel,
        orderNumber: o.orderNumber,
      };
      orderRows.push({
        ...base,
        id: `o:${o.orderNumber}:${line.orderId}`,
        personalization: line.personalizationLabel.trim(),
        personalizationUnits: line.personalizationValues,
        quantity: line.quantity,
      });
    }
  }

  return { pivotRows, orderRows };
}

function isMeaningfulPersonalizationProp(name: string, value: string): boolean {
  const n = normPropName(name);
  if (n.startsWith('_') || n.includes('dispatch')) return false;
  const v = value.trim();
  if (!v) return false;
  if (ADDON_TOGGLE_PROP_NAMES.has(n) && /^(yes|no|true|false)$/i.test(v)) return false;
  return true;
}

/** All line-item properties customers filled in (not just initials). */
export function allPersonalizationProperties(
  properties: { name: string; value: string | number }[] | undefined
): { name: string; value: string }[] {
  if (!properties?.length) return [];
  return properties
    .filter(p => isMeaningfulPersonalizationProp(String(p.name), String(p.value ?? '')))
    .map(p => ({ name: String(p.name).trim(), value: String(p.value).trim() }));
}

/** Customer-entered values only (no "Initials:" prefixes) — used for chips and copy. */
export function personalizationValuesFromProperties(
  properties: { name: string; value: string | number }[] | undefined
): string[] {
  return allPersonalizationProperties(properties).map(p => p.value);
}

/** Summary string for CSV (values only, space-separated). */
export function personalizationLabelFromProperties(
  properties: { name: string; value: string | number }[] | undefined
): string {
  return personalizationValuesFromProperties(properties).join(' ');
}

export function displayPersonalizationProperties(
  properties: { name: string; value: string | number }[] | undefined
): { name: string; value: string }[] {
  return allPersonalizationProperties(properties);
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

/** Excludes refunded / restocked orders (line-level refunds handled separately). */
export function isOrderEligibleForProductionPack(order: UnifiedOrder): boolean {
  if (order.shopify.paymentStatus === 'refunded') return false;
  const fs = (order.shopify.fulfillmentStatus || '').toLowerCase();
  if (fs === 'refunded' || fs === 'restocked') return false;
  return true;
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
    if (!isOrderEligibleForProductionPack(o)) continue;
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
    const variant = parseVariantFromLineName(item.name);
    const persValues = personalizationValuesFromProperties(props);

    out.push({
      orderId: order.shopify.id,
      orderNumber: order.shopify.orderNumber,
      customerName: order.shopify.customerName,
      email: order.shopify.email || '',
      orderDate: order.shopify.date,
      lineName: item.name,
      itemName: variant.productTitle,
      quantity: qty,
      sku: item.sku || '',
      vendor: item.vendor || '',
      colorLabel: variant.color,
      sizeLabel: variant.size,
      personalizationLabel: persValues.join(' '),
      personalizationValues: persValues,
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
  filtered = filtered.filter(isOrderEligibleForProductionPack);
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
    {
      lineName: string;
      itemName: string;
      sku: string;
      vendor: string;
      colorLabel: string;
      sizeLabel: string;
      totalQuantity: number;
      units: string[];
    }
  >();

  for (const line of lines) {
    const key = line.lineName;
    let bundle = bundleMap.get(key);
    if (!bundle) {
      bundle = {
        lineName: line.lineName,
        itemName: line.itemName,
        sku: line.sku,
        vendor: line.vendor,
        colorLabel: line.colorLabel,
        sizeLabel: line.sizeLabel,
        totalQuantity: 0,
        units: [],
      };
      bundleMap.set(key, bundle);
    }
    bundle.totalQuantity += line.quantity;
    const values = line.personalizationValues;
    if (values.length > 0) {
      for (let u = 0; u < line.quantity; u++) {
        for (const v of values) {
          bundle.units.push(v);
        }
      }
    }
  }

  const pivotBundles: ProductionPackPivotBundle[] = Array.from(bundleMap.values())
    .map(b => ({
      lineName: b.lineName,
      itemName: b.itemName,
      sku: b.sku,
      vendor: b.vendor,
      colorLabel: b.colorLabel,
      sizeLabel: b.sizeLabel,
      totalQuantity: b.totalQuantity,
      personalizationUnits: b.units,
    }))
    .sort(comparePivotBundles);

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
    g.lines.sort((a, b) => comparePivotBundles(
      {
        lineName: a.lineName,
        itemName: a.itemName,
        sku: a.sku,
        vendor: a.vendor,
        colorLabel: a.colorLabel,
        sizeLabel: a.sizeLabel,
        totalQuantity: 0,
        personalizationUnits: [],
      },
      {
        lineName: b.lineName,
        itemName: b.itemName,
        sku: b.sku,
        vendor: b.vendor,
        colorLabel: b.colorLabel,
        sizeLabel: b.sizeLabel,
        totalQuantity: 0,
        personalizationUnits: [],
      }
    ));
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
