import { getItem, setItem } from './localStore';

/**
 * Tombstones for Deco jobs that have been CONFIRMED deleted in Deco
 * (direct ID lookups completed successfully and returned no order).
 *
 * The app removes ghost jobs from the live cache (IndexedDB
 * `stash_raw_deco_jobs`) and the cloud (`stash_deco_jobs`) when they are
 * confirmed gone — but the nightly finance cache (`stash_finance_jobs` /
 * Supabase `stash_finance_cache`) keeps historical rows and would otherwise
 * re-inject the ghost into the Priority Board on the next merge. This map
 * (jobNumber → ISO timestamp of confirmation) lets every merge point filter
 * confirmed-gone jobs out.
 *
 * A tombstone is lifted automatically if a later Deco API pull returns the
 * job again (e.g. the order was restored in Deco).
 */

const KEY = 'stash_deco_gone_jobs';

export type GoneDecoJobMap = Record<string, string>;

export async function getGoneDecoJobs(): Promise<GoneDecoJobMap> {
  const map = await getItem<GoneDecoJobMap>(KEY);
  return map && typeof map === 'object' ? map : {};
}

export async function recordGoneDecoJobs(jobNumbers: string[]): Promise<GoneDecoJobMap> {
  const map = await getGoneDecoJobs();
  const now = new Date().toISOString();
  let changed = false;
  for (const num of jobNumbers) {
    const key = String(num || '').trim();
    if (!key || map[key]) continue;
    map[key] = now;
    changed = true;
  }
  if (changed) await setItem(KEY, map);
  return map;
}

/** Lift tombstones for jobs the Deco API is returning again. */
export async function clearGoneDecoJobs(jobNumbers: Iterable<string>): Promise<void> {
  const map = await getGoneDecoJobs();
  let changed = false;
  for (const num of jobNumbers) {
    const key = String(num || '').trim();
    if (key && map[key]) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) await setItem(KEY, map);
}

export function filterOutGoneDecoJobs<T extends { jobNumber?: string }>(
  jobs: T[],
  gone: GoneDecoJobMap,
): T[] {
  if (!jobs.length) return jobs;
  const keys = Object.keys(gone);
  if (keys.length === 0) return jobs;
  return jobs.filter(j => !j.jobNumber || !gone[j.jobNumber]);
}
