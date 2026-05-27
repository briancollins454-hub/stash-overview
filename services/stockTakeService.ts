import { isSupabaseReady, supabaseFetch } from './supabase';
import type { PhysicalStockItem, ReferenceProduct } from '../types';
import {
  manualResolvedProduct,
  physicalStockAggregateKey,
  type ResolvedProduct,
} from './productResolver';

const SESSIONS_TABLE = 'stash_stock_take_sessions';
const LINES_TABLE = 'stash_stock_take_lines';
const AUDIT_TABLE = 'stash_stock_take_audit';
const ADD_QTY_RPC = 'rpc/stash_stock_take_add_line_qty';

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
  /** Populated at commit so the session list can show summary metadata. */
  total_skus?: number | null;
  total_units?: number | null;
  net_variance?: number | null;
  committed_by?: string | null;
  reopened_count?: number | null;
}

export interface StockTakeAuditRow {
  id: string;
  session_id: string;
  committed_at: string;
  committed_by: string | null;
  location: string | null;
  ean: string;
  description: string;
  vendor: string;
  product_code: string;
  colour: string;
  size: string;
  is_embellished: boolean;
  club_name: string | null;
  book_qty: number;
  counted_qty: number;
  variance: number;
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

/**
 * Atomic per-line add — adds N to qty server-side so two phones counting the
 * same SKU never race.  Falls back to the REST upsert if the RPC isn't
 * available yet (migration not run).  Returns the resulting line as the
 * server sees it so callers can resync state.
 */
export async function addStockTakeLineQty(
  line: StockTakeLineView,
  addQty: number,
): Promise<StockTakeLineView | null> {
  if (!isSupabaseReady()) return null;
  try {
    const res = await supabaseFetch(
      ADD_QTY_RPC,
      'POST',
      {
        p_id: line.id,
        p_session_id: line.sessionId,
        p_ean: line.ean,
        p_qty: addQty,
        p_vendor: line.vendor,
        p_product_code: line.productCode,
        p_description: line.description,
        p_colour: line.colour,
        p_size: line.size,
        p_is_embellished: line.isEmbellished,
        p_club_name: line.clubName || null,
        p_resolved_via: line.resolvedVia,
      },
      'return=representation',
    );
    const row = await res.json();
    if (row && typeof row === 'object' && 'id' in row) {
      return lineRowToView(row as StockTakeLine);
    }
    if (Array.isArray(row) && row[0]) {
      return lineRowToView(row[0] as StockTakeLine);
    }
  } catch {
    // Fall through to non-atomic upsert so we never silently drop a scan.
    try {
      await upsertStockTakeLine({ ...line, qty: line.qty });
    } catch { /* swallow — UI keeps local state */ }
  }
  return null;
}

export async function deleteStockTakeLine(lineId: string): Promise<void> {
  if (!isSupabaseReady()) return;
  await supabaseFetch(`${LINES_TABLE}?id=eq.${encodeURIComponent(lineId)}`, 'DELETE');
}

export async function markSessionCommitted(
  sessionId: string,
  totals?: {
    skus: number;
    units: number;
    netVariance: number;
    committedBy?: string | null;
  },
): Promise<void> {
  if (!isSupabaseReady()) return;
  const patch: Record<string, unknown> = {
    status: 'committed',
    committed_at: new Date().toISOString(),
  };
  if (totals) {
    patch.total_skus = totals.skus;
    patch.total_units = totals.units;
    patch.net_variance = totals.netVariance;
    if (totals.committedBy) patch.committed_by = totals.committedBy;
  }
  await supabaseFetch(
    `${SESSIONS_TABLE}?id=eq.${encodeURIComponent(sessionId)}`,
    'PATCH',
    patch,
  );
}

/**
 * Flip a committed session back to open so staff can append / fix mistakes
 * without losing the original commit record.  Bumps reopened_count so we
 * can show "re-opened 2×" on the session list.
 */
export async function reopenStockTakeSession(session: StockTakeSession): Promise<void> {
  if (!isSupabaseReady()) return;
  await supabaseFetch(
    `${SESSIONS_TABLE}?id=eq.${encodeURIComponent(session.id)}`,
    'PATCH',
    {
      status: 'open',
      committed_at: null,
      reopened_count: (session.reopened_count || 0) + 1,
    },
  );
}

/**
 * Write a per-line variance snapshot to the audit table at commit time so we
 * can answer "what changed during the May stock take?" three weeks later.
 */
export async function writeStockTakeAudit(
  session: StockTakeSession,
  rows: StockTakeAuditRow[],
): Promise<void> {
  if (!isSupabaseReady() || rows.length === 0) return;
  // Chunked insert keeps each request below proxy URL limits.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    try {
      await supabaseFetch(AUDIT_TABLE, 'POST', slice, 'resolution=merge-duplicates');
    } catch {
      // Audit is best-effort — never block the commit itself.
    }
  }
}

/**
 * Apply counted lines to physical stock (replace qty per aggregate key).
 *
 * `zeroKeys` is the set of stockKeys the user explicitly confirmed during the
 * pre-commit "expected but not counted" review should be zeroed out — they
 * were on the book but staff confirmed they are not actually on hand.
 */
export function buildPhysicalStockFromStockTake(
  lines: StockTakeLineView[],
  existing: PhysicalStockItem[],
  zeroKeys?: Iterable<string>,
): {
  next: PhysicalStockItem[];
  summary: { updated: number; created: number; removed: number; zeroed: number };
} {
  const byKey = new Map<string, StockTakeLineView>();
  for (const line of lines) {
    const prev = byKey.get(line.stockKey);
    if (prev) byKey.set(line.stockKey, { ...prev, qty: prev.qty + line.qty });
    else byKey.set(line.stockKey, { ...line });
  }

  const touchedKeys = new Set(byKey.keys());
  const zeroSet = new Set(zeroKeys || []);
  let updated = 0;
  let created = 0;
  let removed = 0;
  let zeroed = 0;

  const remaining: PhysicalStockItem[] = [];
  const consumedIds = new Set<string>();

  for (const item of existing) {
    const key = physicalStockAggregateKey(item);
    if (zeroSet.has(key)) {
      remaining.push({ ...item, quantity: 0, addedAt: Date.now() });
      zeroed++;
      continue;
    }
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

  return { next: remaining, summary: { updated, created, removed, zeroed } };
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

/**
 * Diff between a counted line and the reference product for the same EAN.
 * Surfaces any field (vendor / description / colour / size / product code)
 * where the scan source disagreed with the master list.  Drives the
 * "description drift" warning on the lines panel.
 */
export interface ReferenceDriftRow {
  lineId: string;
  ean: string;
  fields: Array<{
    label: string;
    scan: string;
    reference: string;
  }>;
}

export function referenceDrift(
  lines: StockTakeLineView[],
  reference: ReferenceProduct[],
): ReferenceDriftRow[] {
  const byEan = new Map(reference.map(r => [r.ean.trim(), r]));
  const out: ReferenceDriftRow[] = [];
  for (const line of lines) {
    const ref = byEan.get(line.ean.trim());
    if (!ref) continue;
    const fields: ReferenceDriftRow['fields'] = [];
    const compare = (label: string, scan: string, refVal: string) => {
      if (!scan || !refVal) return;
      if (scan.trim().toLowerCase() === refVal.trim().toLowerCase()) return;
      fields.push({ label, scan, reference: refVal });
    };
    compare('description', line.description, ref.description);
    compare('vendor', line.vendor, ref.vendor);
    compare('product code', line.productCode, ref.productCode);
    compare('colour', line.colour, ref.colour);
    compare('size', line.size, ref.size);
    if (fields.length > 0) {
      out.push({ lineId: line.id, ean: line.ean, fields });
    }
  }
  return out;
}

/**
 * Overwrite the reference entry for this EAN with the scan's values.  Used
 * when staff hit "use scan" on a description-drift row.
 */
export function applyScanToReference(
  line: StockTakeLineView,
  reference: ReferenceProduct[],
): ReferenceProduct[] {
  const ean = line.ean.trim();
  if (!ean) return reference;
  const next = reference.map(r =>
    r.ean.trim() === ean
      ? {
          ...r,
          vendor: line.vendor || r.vendor,
          productCode: line.productCode || r.productCode,
          description: line.description || r.description,
          colour: line.colour || r.colour,
          size: line.size || r.size,
        }
      : r,
  );
  if (!next.some(r => r.ean.trim() === ean)) {
    next.push({
      ean,
      vendor: line.vendor,
      productCode: line.productCode,
      description: line.description,
      colour: line.colour,
      size: line.size,
    });
  }
  return next;
}

/**
 * Items present on the book at this location but never scanned during the
 * session.  Returned in a stable order (largest book qty first) so the
 * "expected but not counted" review screen leads with the highest-value
 * variance candidates.
 */
export interface MissingLine {
  stockKey: string;
  bookQty: number;
  ean: string;
  description: string;
  vendor: string;
  productCode: string;
  colour: string;
  size: string;
  isEmbellished: boolean;
  clubName?: string;
}

export function missingFromCount(
  lines: StockTakeLineView[],
  physicalStock: PhysicalStockItem[],
): MissingLine[] {
  const counted = new Set(lines.map(l => l.stockKey));
  const byKey = new Map<string, MissingLine>();
  for (const item of physicalStock) {
    if (item.quantity <= 0) continue;
    const key = physicalStockAggregateKey(item);
    if (counted.has(key)) continue;
    const prev = byKey.get(key);
    if (prev) {
      byKey.set(key, { ...prev, bookQty: prev.bookQty + item.quantity });
      continue;
    }
    byKey.set(key, {
      stockKey: key,
      bookQty: item.quantity,
      ean: item.ean,
      description: item.description,
      vendor: item.vendor,
      productCode: item.productCode,
      colour: item.colour,
      size: item.size,
      isEmbellished: !!item.isEmbellished,
      clubName: item.clubName,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => b.bookQty - a.bookQty);
}

/**
 * Build one audit row per counted line — the immutable record of what the
 * book said vs what we actually found.
 */
export function buildAuditRows(
  session: StockTakeSession,
  lines: StockTakeLineView[],
  physicalStock: PhysicalStockItem[],
  committedBy: string | null,
): StockTakeAuditRow[] {
  const bookByKey = new Map<string, number>();
  for (const item of physicalStock) {
    const k = physicalStockAggregateKey(item);
    bookByKey.set(k, (bookByKey.get(k) || 0) + item.quantity);
  }
  const at = new Date().toISOString();
  return lines.map(line => {
    const bookQty = bookByKey.get(line.stockKey) || 0;
    return {
      id: `${session.id}_${line.id}`,
      session_id: session.id,
      committed_at: at,
      committed_by: committedBy,
      location: session.location,
      ean: line.ean,
      description: line.description,
      vendor: line.vendor,
      product_code: line.productCode,
      colour: line.colour,
      size: line.size,
      is_embellished: line.isEmbellished,
      club_name: line.clubName || null,
      book_qty: bookQty,
      counted_qty: line.qty,
      variance: line.qty - bookQty,
    };
  });
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
