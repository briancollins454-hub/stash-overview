/**
 * ReadyAtStore
 * ------------
 * Tracks the first moment we observed a deco job in a "ready to ship"
 * state ("Ready for Shipping" or "Completed" but not yet shipped).
 *
 * Why it exists:
 *   The Deco API doesn't expose a per-status timestamp, so the only way
 *   to know how long something has been waiting to ship is to stamp it
 *   ourselves the first time we see it ready. This removes the long-
 *   standing bug where the Priority Board's "Awaiting Shipping" waiting
 *   metric was actually computed from `dateDue` and therefore showed
 *   "79 days past due" for jobs that only became ready yesterday.
 *
 * Semantics:
 *   • First observation of ready status  → stamp readyAt
 *       - For "Completed" jobs we prefer `dateShipped` (which is
 *         actually `date_completed` for non-shipped completed jobs) so
 *         historical data is more accurate.
 *       - For "Ready for Shipping" we stamp `now` (no better signal).
 *   • Leaves ready status (back to production / shipped / cancelled)
 *     → clear the stamp so next re-entry gets a fresh one.
 *   • Job no longer exists in the sync set → prune the stamp.
 *
 * Storage: IndexedDB via localStore (`stash_job_ready_at`).
 */

import type { DecoJob } from '../types';
import { getItem as getLocalItem, setItem as setLocalItem } from './localStore';

const KEY = 'stash_job_ready_at';

const READY_STATUSES = new Set<string>(['Ready for Shipping', 'Completed']);

export type ReadyAtMap = Record<string, string>; // jobId -> ISO timestamp

let cache: ReadyAtMap | null = null;
let loadPromise: Promise<ReadyAtMap> | null = null;

const load = (): Promise<ReadyAtMap> => {
  if (cache) return Promise.resolve(cache);
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const stored = await getLocalItem<ReadyAtMap>(KEY);
      cache = stored && typeof stored === 'object' ? { ...stored } : {};
    } catch {
      cache = {};
    }
    return cache!;
  })();
  return loadPromise;
};

const persist = async (map: ReadyAtMap) => {
  try { await setLocalItem(KEY, map); } catch { /* non-fatal */ }
};

/**
 * Reconcile the readyAt map against the current job set. Returns a
 * fresh snapshot. Safe to call on every render — it's cheap and
 * idempotent, and the underlying IDB write is skipped when nothing
 * changed.
 */
export const refreshReadyAtForJobs = async (jobs: DecoJob[]): Promise<ReadyAtMap> => {
  const map = await load();
  const nowIso = new Date().toISOString();
  let dirty = false;
  const activeIds = new Set<string>();

  for (const j of jobs) {
    if (!j?.id) continue;
    activeIds.add(j.id);
    const isReady = READY_STATUSES.has(j.status || '');

    if (isReady && !map[j.id]) {
      // First observation — try to anchor to the real completion date
      // when we have one, otherwise stamp now.
      let stamp = nowIso;
      if (j.status === 'Completed' && j.dateShipped) {
        const d = new Date(j.dateShipped);
        if (!Number.isNaN(d.getTime())) stamp = d.toISOString();
      }
      map[j.id] = stamp;
      dirty = true;
    } else if (!isReady && map[j.id]) {
      delete map[j.id];
      dirty = true;
    }
  }

  // Prune entries for jobs that no longer appear in the sync set.
  for (const id of Object.keys(map)) {
    if (!activeIds.has(id)) { delete map[id]; dirty = true; }
  }

  if (dirty) {
    cache = { ...map };
    await persist(cache);
    return cache;
  }
  return { ...map };
};

export const getReadyAt = (map: ReadyAtMap | null | undefined, jobId: string): string | undefined => {
  if (!map) return undefined;
  return map[jobId];
};
