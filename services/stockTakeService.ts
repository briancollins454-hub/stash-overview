import { isSupabaseReady, supabaseFetch } from './supabase';
import type { PhysicalStockItem, ReferenceProduct } from '../types';
import {
  manualResolvedProduct,
  physicalStockAggregateKey,
  type ResolvedProduct,
} from './productResolver';

const SESSIONS_TABLE = 'stash_stock_take_sessions';
const LINES_TABLE = 'stash_stock_take_lines';

export type StockTakeLocation = 'church_st' | 'local_stock' | 'all';
export type StockTakeSessionStatus = 'open' | 'committed';

export interface StockTakeSession {
  id: string;
  label: string;
  location: StockTakeLocation;
  status: StockTakeSessionStatus;
  created_by: string | null;
  created_at: string;
  committed_at: string | null;
}

export interface StockTakeLine {
  id: string;
  session_id: string;
  ean: string;
  qty: number;
  vendor: string;
  product_code: string;
  description: string;
  colour: string;
  size: string;
  is_embellished: boolean;
  club_name: string | null;
  resolved_via: string;
  updated_at: string;
}

export interface StockTakeLineView {
  id: string;
  sessionId: string;
  ean: string;
  qty: number;
  vendor: string;
  productCode: string;
  description: string;
  colour: string;
  size: string;
  isEmbellished: boolean;
  clubName?: string;
  resolvedVia: string;
  updatedAt: string;
  stockKey: string;
}

function lineRowToView(row: StockTakeLine): StockTakeLineView {
  const isEmbellished = !!row.is_embellished;
  const clubName = row.club_name || undefined;
  return {
    id: row.id,
    sessionId: row.session_id,
    ean: row.ean,
    qty: row.qty,
    vendor: row.vendor,
    productCode: row.product_code,
    description: row.description,
    colour: row.colour,
    size: row.size,
    isEmbellished,
    clubName,
    resolvedVia: row.resolved_via,
    updatedAt: row.updated_at,
    stockKey: physicalStockAggregateKey({
      ean: row.ean,
      isEmbellished,
      clubName,
      size: row.size,
      colour: row.colour,
    }),
  };
}

function lineViewToRow(v: StockTakeLineView): StockTakeLine {
  return {
    id: v.id,
    session_id: v.sessionId,
    ean: v.ean,
    qty: v.qty,
    vendor: v.vendor,
    product_code: v.productCode,
    description: v.description,
    colour: v.colour,
    size: v.size,
    is_embellished: v.isEmbellished,
    club_name: v.clubName || null,
    resolved_via: v.resolvedVia,
    updated_at: v.updatedAt,
  };
}

export function newSessionId(): string {
  return `st_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newLineId(): string {
  return `stl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function fetchOpenStockTakeSessions(): Promise<StockTakeSession[]> {
  if (!isSupabaseReady()) return [];
  const res = await supabaseFetch(
    `${SESSIONS_TABLE}?status=eq.open&order=created_at.desc&limit=20`,
    'GET',
  );
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export async function fetchCommittedStockTakeSessions(limit = 30): Promise<StockTakeSession[]> {
  if (!isSupabaseReady()) return [];
  const res = await supabaseFetch(
    `${SESSIONS_TABLE}?status=eq.committed&order=committed_at.desc&limit=${limit}`,
    'GET',
  );
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export async function fetchStockTakeSession(sessionId: string): Promise<{
  session: StockTakeSession | null;
  lines: StockTakeLineView[];
}> {
  if (!isSupabaseReady()) return { session: null, lines: [] };
  const [sRes, lRes] = await Promise.all([
    supabaseFetch(`${SESSIONS_TABLE}?id=eq.${encodeURIComponent(sessionId)}`, 'GET'),
    supabaseFetch(
      `${LINES_TABLE}?session_id=eq.${encodeURIComponent(sessionId)}&order=updated_at.desc`,
      'GET',
    ),
  ]);
  const sessions: StockTakeSession[] = await sRes.json();
  const lineRows: StockTakeLine[] = await lRes.json();
  return {
    session: Array.isArray(sessions) && sessions[0] ? sessions[0] : null,
    lines: Array.isArray(lineRows) ? lineRows.map(lineRowToView) : [],
  };
}

export async function createStockTakeSession(opts: {
  label: string;
  location: StockTakeLocation;
  createdBy?: string;
}): Promise<StockTakeSession> {
  const session: StockTakeSession = {
    id: newSessionId(),
    label: opts.label.trim() || `Stock take ${new Date().toLocaleDateString('en-GB')}`,
    location: opts.location,
    status: 'open',
    created_by: opts.createdBy || null,
    created_at: new Date().toISOString(),
    committed_at: null,
  };
  if (isSupabaseReady()) {
    await supabaseFetch(SESSIONS_TABLE, 'POST', session, 'resolution=merge-duplicates');
  }
  return session;
}

export async function upsertStockTakeLine(line: StockTakeLineView): Promise<void> {
  if (!isSupabaseReady()) return;
  await supabaseFetch(LINES_TABLE, 'POST', lineViewToRow(line), 'resolution=merge-duplicates');
}

export async function deleteStockTakeLine(lineId: string): Promise<void> {
  if (!isSupabaseReady()) return;
  await supabaseFetch(`${LINES_TABLE}?id=eq.${encodeURIComponent(lineId)}`, 'DELETE');
}

export async function markSessionCommitted(sessionId: string): Promise<void> {
  if (!isSupabaseReady()) return;
  await supabaseFetch(
    `${SESSIONS_TABLE}?id=eq.${encodeURIComponent(sessionId)}`,
    'PATCH',
    { status: 'committed', committed_at: new Date().toISOString() },
  );
}

/** Apply counted lines to physical stock (replace qty per aggregate key). */
export function buildPhysicalStockFromStockTake(
  lines: StockTakeLineView[],
  existing: PhysicalStockItem[],
): { next: PhysicalStockItem[]; summary: { updated: number; created: number; removed: number } } {
  const byKey = new Map<string, StockTakeLineView>();
  for (const line of lines) {
    const prev = byKey.get(line.stockKey);
    if (prev) byKey.set(line.stockKey, { ...prev, qty: prev.qty + line.qty });
    else byKey.set(line.stockKey, { ...line });
  }

  const touchedKeys = new Set(byKey.keys());
  let updated = 0;
  let created = 0;
  let removed = 0;

  const remaining: PhysicalStockItem[] = [];
  const consumedIds = new Set<string>();

  for (const item of existing) {
    const key = physicalStockAggregateKey(item);
    if (!touchedKeys.has(key)) {
      remaining.push(item);
      continue;
    }
    if (consumedIds.has(key)) {
      removed++;
      continue;
    }
    consumedIds.add(key);
    const line = byKey.get(key)!;
    remaining.push({
      ...item,
      ean: line.ean,
      vendor: line.vendor || item.vendor,
      productCode: line.productCode || item.productCode,
      description: line.description || item.description,
      colour: line.colour || item.colour,
      size: line.size || item.size,
      quantity: line.qty,
      isEmbellished: line.isEmbellished,
      clubName: line.isEmbellished ? line.clubName : undefined,
      addedAt: Date.now(),
    });
    updated++;
  }

  for (const [key, line] of byKey) {
    if (consumedIds.has(key)) continue;
    remaining.push({
      id: `stock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ean: line.ean,
      vendor: line.vendor,
      productCode: line.productCode,
      description: line.description,
      colour: line.colour,
      size: line.size,
      quantity: line.qty,
      isEmbellished: line.isEmbellished,
      clubName: line.isEmbellished ? line.clubName : undefined,
      addedAt: Date.now(),
    });
    created++;
  }

  return { next: remaining, summary: { updated, created, removed } };
}

export function lineFromResolved(
  sessionId: string,
  product: ResolvedProduct,
  qty: number,
  opts?: { isEmbellished?: boolean; clubName?: string },
): StockTakeLineView {
  const isEmbellished = !!opts?.isEmbellished;
  const clubName = isEmbellished ? opts?.clubName?.trim() : undefined;
  const view: StockTakeLineView = {
    id: newLineId(),
    sessionId,
    ean: product.ean,
    qty,
    vendor: product.vendor,
    productCode: product.productCode,
    description: product.description,
    colour: product.colour,
    size: product.size,
    isEmbellished,
    clubName,
    resolvedVia: product.source,
    updatedAt: new Date().toISOString(),
    stockKey: '',
  };
  view.stockKey = physicalStockAggregateKey({
    ean: view.ean,
    isEmbellished: view.isEmbellished,
    clubName: view.clubName,
    size: view.size,
    colour: view.colour,
  });
  return view;
}

export function mergeReferenceFromLines(
  lines: StockTakeLineView[],
  existing: ReferenceProduct[],
): ReferenceProduct[] {
  const byEan = new Map(existing.map(r => [r.ean.trim(), r]));
  for (const line of lines) {
    const ean = line.ean.trim();
    if (!ean || byEan.has(ean)) continue;
    byEan.set(ean, {
      ean,
      vendor: line.vendor,
      productCode: line.productCode,
      description: line.description,
      colour: line.colour,
      size: line.size,
    });
  }
  return Array.from(byEan.values());
}

export function manualProductFromForm(
  ean: string,
  fields: {
    vendor?: string;
    productCode?: string;
    description: string;
    colour?: string;
    size?: string;
  },
): ResolvedProduct {
  return manualResolvedProduct(ean, fields);
}
