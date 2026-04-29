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
 *   • Ready status uses production-complete date whenever available.
 *       - `dateShipped` is populated from `date_shipped || date_completed`
 *         by the Deco mapper, so it is the best available anchor for
 *         "Awaiting Shipping" age.
 *       - If no completion date exists yet, we fall back to `now`.
 *   • Existing cached anchors are backfilled if a better (earlier)
 *     completion date appears later.
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
    const completionIso = (() => {
      if (!j.dateShipped) return null;
      const d = new Date(j.dateShipped);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();

    if (isReady) {
      if (!map[j.id]) {
        map[j.id] = completionIso || nowIso;
        dirty = true;
      } else if (completionIso) {
        const current = new Date(map[j.id]);
        const completion = new Date(completionIso);
        // Backfill to production-complete timestamp when cached value is later.
        if (Number.isNaN(current.getTime()) || current.getTime() > completion.getTime()) {
          map[j.id] = completionIso;
          dirty = true;
        }
      }
    } else if (map[j.id]) {
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
