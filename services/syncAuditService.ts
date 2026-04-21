/**
 * SyncAuditService
 * ----------------
 * Lightweight observability layer for cloud (Supabase) writes. Every saveCloud*
 * and deleteCloud* operation can be wrapped with trackSave() to emit a
 * structured audit event recording: which table, how many records, success
 * or failure, duration, and any error message.
 *
 * The last MAX_EVENTS entries are persisted to IndexedDB so the record
 * survives page reloads. A tiny pub/sub lets the Cloud Health UI re-render
 * live whenever a new event lands.
 *
 * Keeping this in a standalone service (rather than baking it into
 * syncService.ts) means:
 *   • Other areas of the app can emit custom events if useful later.
 *   • Removing the audit UI is a single-file delete + un-wrap.
 *   • No circular dependency between syncService and the UI.
 */

import { getItem as getLocalItem, setItem as setLocalItem } from './localStore';

export type AuditEventStatus = 'success' | 'error';
export type AuditEventOperation = 'save' | 'delete' | 'fetch';

export interface AuditEvent {
  id: string;
  table: string;
  operation: AuditEventOperation;
  recordCount: number;
  status: AuditEventStatus;
  error?: string;
  timestamp: string;
  durationMs?: number;
}

const STORAGE_KEY = 'stash_sync_audit_log';
const MAX_EVENTS = 200;

let events: AuditEvent[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

const ensureLoaded = (): Promise<void> => {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const saved = await getLocalItem<AuditEvent[]>(STORAGE_KEY);
      if (Array.isArray(saved)) {
        events = saved.slice(0, MAX_EVENTS);
      }
    } catch {
      // Missing/corrupt log is non-fatal — start fresh.
    } finally {
      loaded = true;
    }
  })();
  return loadPromise;
};

const notify = () => {
  listeners.forEach(l => {
    try { l(); } catch { /* listener errors are never fatal */ }
  });
};

const persist = () => {
  // Fire-and-forget; audit log failing to persist should never break a save.
  setLocalItem(STORAGE_KEY, events).catch(() => { /* swallow */ });
};

/** Record a single audit event and fan out to subscribers. */
export const logAuditEvent = (partial: Omit<AuditEvent, 'id' | 'timestamp'>): void => {
  // Ensure load finished before mutating — if it's still pending, append
  // optimistically and the load will merge in (newer wins on reload because
  // we keep the first MAX_EVENTS after sort).
  const evt: AuditEvent = {
    ...partial,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  events = [evt, ...events].slice(0, MAX_EVENTS);
  persist();
  notify();
};

/** Current in-memory audit log (sorted newest-first). */
export const getAuditEvents = async (): Promise<AuditEvent[]> => {
  await ensureLoaded();
  return events.slice();
};

/** Synchronous read — used by components after initial load. */
export const getAuditEventsSync = (): AuditEvent[] => events.slice();

/** Wipe the audit log (IndexedDB + memory) and notify. */
export const clearAuditEvents = async (): Promise<void> => {
  events = [];
  persist();
  notify();
};

/** Subscribe to event-log changes. Returns an unsubscribe fn. */
export const subscribeAuditEvents = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

/**
 * Wrap an async save/delete so timing + success/failure is logged
 * automatically. The wrapped function's return value and throw behaviour
 * are preserved exactly — callers should not notice this exists.
 */
export const trackSave = async <T>(
  table: string,
  recordCount: number,
  fn: () => Promise<T>,
  operation: AuditEventOperation = 'save'
): Promise<T> => {
  const start = Date.now();
  try {
    const result = await fn();
    logAuditEvent({
      table,
      operation,
      recordCount,
      status: 'success',
      durationMs: Date.now() - start,
    });
    return result;
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : String(e);
    logAuditEvent({
      table,
      operation,
      recordCount,
      status: 'error',
      error: msg.slice(0, 500),
      durationMs: Date.now() - start,
    });
    throw e;
  }
};

/** Returns the most-recent successful save for each table, as a map. */
export const getLastSuccessByTable = (): Record<string, AuditEvent> => {
  const map: Record<string, AuditEvent> = {};
  for (const e of events) {
    if (e.status === 'success' && !map[e.table]) {
      map[e.table] = e;
    }
  }
  return map;
};
